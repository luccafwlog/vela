-- 401: ATD do POL — correção manual vence; B/L cancelado não conta (Lote 7
-- do plano docs/plans/2026-10-21-frente-das-importacoes.md; ADR 0095,
-- decisão 23; achado F-48 da revisão
-- docs/archive/audits/2026-10-21-revisao-importacoes.md).
--
-- Problemas (F-48):
--   1. A correção manual do ATD do POL (Rotas e Manifestos → Editar, que grava
--      `audit_logs` `voyage_pol_schedule`/`atd`) era desfeita pela próxima
--      importação de qualquer B/L da Viagem e do POL: o fim de
--      `import_bl_freight_transactional_legacy_070` regravava o menor Laden on
--      Board sem olhar quem tinha gravado o ATD.
--   2. B/L cancelado entrava no menor Laden on Board; cancelar ou reativar o
--      B/L não recalculava o ATD.
--
-- Mudança:
--   1. Tabela `voyage_pol_atd_manual` (Viagem, POL, ATD, quem, quando): a
--      marca da correção manual. Só leitura para a API (RLS de leitura
--      interna); escrita só pelo gatilho abaixo.
--   2. Gatilho `voyage_pol_atd_manual_mark` (AFTER INSERT em `audit_logs`,
--      `voyage_pol_schedule`/`atd`): todo ATD gravado fora do cálculo pelos
--      B/Ls (o cálculo liga `vela.atd_from_bls` na transação) é correção
--      manual e marca o POL com quem gravou e quando. Gravar o ATD vazio à mão
--      desfaz a marca, e o ATD volta na hora ao menor Laden on Board dos B/Ls
--      ativos (com Histórico).
--   3. `_recompute_voyage_pol_atd(viagem, POL, ator, justificativa)`: menor
--      Laden on Board dos B/Ls ativos (`cancelled_at IS NULL`) da Viagem e do
--      POL; não faz nada quando o POL tem marca manual ou a Viagem está
--      cancelada (escala somente leitura); grava o Histórico só quando muda.
--   4. `import_bl_freight_transactional_legacy_070` redefinida: o fim chama o
--      helper (antes: menor Laden on Board de todos os B/Ls, sem olhar a marca).
--   5. Gatilho `voyage_pol_atd_follows_bl_cancel` (AFTER UPDATE OF
--      cancelled_at ON bls): cancelar ou reativar o B/L recalcula o ATD do POL
--      dele (salvo correção manual).
--   6. Marca das correções manuais já gravadas: POL cuja última gravação do
--      ATD não veio do cálculo pelos B/Ls (justificativa diferente de "ATD
--      derivado…") recebe a marca com quem e quando gravou. Só insere na
--      tabela nova; não reescreve nem apaga linhas existentes.
--
-- Rollback: reaplicar `import_bl_freight_transactional_legacy_070` da `346`;
-- DROP dos gatilhos `voyage_pol_atd_manual_mark` e
-- `voyage_pol_atd_follows_bl_cancel`, das funções
-- `voyage_pol_atd_manual_mark`, `voyage_pol_atd_follows_bl_cancel` e
-- `_recompute_voyage_pol_atd` e da tabela `voyage_pol_atd_manual`.

-- 1 -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.voyage_pol_atd_manual (
  voyage_id bigint NOT NULL REFERENCES public.voyages(id) ON DELETE CASCADE,
  pol text NOT NULL,
  atd date NOT NULL,
  marked_by uuid,
  marked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (voyage_id, pol)
);

COMMENT ON TABLE public.voyage_pol_atd_manual IS
  'ATD do POL corrigido à mão (ADR 0095, decisão 23): a importação de B/L e o cancelamento não recalculam o ATD deste POL. Escrita só pelo gatilho voyage_pol_atd_manual_mark (401).';

ALTER TABLE public.voyage_pol_atd_manual ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voyage_pol_atd_manual FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.voyage_pol_atd_manual TO authenticated;
GRANT ALL ON public.voyage_pol_atd_manual TO service_role;

DROP POLICY IF EXISTS voyage_pol_atd_manual_select ON public.voyage_pol_atd_manual;
CREATE POLICY voyage_pol_atd_manual_select ON public.voyage_pol_atd_manual
  FOR SELECT TO authenticated
  USING ((SELECT public.is_active_read_user()));

-- 3 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._recompute_voyage_pol_atd(
  p_voyage_id bigint,
  p_pol text,
  p_actor uuid,
  p_justification text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pol text := upper(btrim(COALESCE(p_pol, '')));
  v_entity text;
  v_canonical date;
  v_current text;
  v_previous_flag text;
BEGIN
  IF p_voyage_id IS NULL OR v_pol = '' THEN
    RETURN;
  END IF;
  -- Viagem cancelada: a escala é somente leitura (gatilho de audit_logs).
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id AND status IS DISTINCT FROM 'cancelled') THEN
    RETURN;
  END IF;
  -- Correção manual vence (ADR 0095, decisão 23).
  IF EXISTS (SELECT 1 FROM public.voyage_pol_atd_manual WHERE voyage_id = p_voyage_id AND pol = v_pol) THEN
    RETURN;
  END IF;

  v_entity := p_voyage_id::text || '::' || v_pol;

  SELECT min(b.laden_on_board) INTO v_canonical
  FROM public.bls AS b
  WHERE b.voyage_id = p_voyage_id
    AND upper(btrim(b.pol)) = v_pol
    AND b.cancelled_at IS NULL;

  SELECT al.new_value INTO v_current
  FROM public.audit_logs AS al
  WHERE al.entity_type = 'voyage_pol_schedule'
    AND al.entity_id = v_entity
    AND al.field_name = 'atd'
  ORDER BY al.changed_at DESC, al.id DESC
  LIMIT 1;

  IF v_current IS NOT DISTINCT FROM v_canonical::text THEN
    RETURN;
  END IF;

  v_previous_flag := current_setting('vela.atd_from_bls', true);
  PERFORM set_config('vela.atd_from_bls', 'on', true);
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyage_pol_schedule', v_entity, 'atd', v_current, v_canonical::text, p_actor, p_justification);
  PERFORM set_config('vela.atd_from_bls', COALESCE(v_previous_flag, 'off'), true);
END;
$function$;

REVOKE ALL ON FUNCTION public._recompute_voyage_pol_atd(bigint, text, uuid, text) FROM PUBLIC, anon, authenticated;

-- 2 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.voyage_pol_atd_manual_mark()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_voyage_id bigint;
  v_pol text;
BEGIN
  IF current_setting('vela.atd_from_bls', true) = 'on' THEN
    RETURN NULL;
  END IF;
  v_voyage_id := NULLIF(split_part(NEW.entity_id, '::', 1), '')::bigint;
  v_pol := upper(btrim(split_part(NEW.entity_id, '::', 2)));
  IF v_voyage_id IS NULL OR v_pol = '' THEN
    RETURN NULL;
  END IF;

  IF NULLIF(btrim(COALESCE(NEW.new_value, '')), '') IS NULL THEN
    -- ATD apagado à mão: desfaz a marca e o ATD volta aos B/Ls ativos.
    DELETE FROM public.voyage_pol_atd_manual WHERE voyage_id = v_voyage_id AND pol = v_pol;
    PERFORM public._recompute_voyage_pol_atd(
      v_voyage_id, v_pol, NEW.changed_by,
      'ATD manual apagado: volta a valer o menor Laden on Board dos B/Ls ativos (ADR 0095, decisão 23)'
    );
    RETURN NULL;
  END IF;

  INSERT INTO public.voyage_pol_atd_manual (voyage_id, pol, atd, marked_by, marked_at)
  SELECT v_voyage_id, v_pol, left(NEW.new_value, 10)::date, NEW.changed_by, COALESCE(NEW.changed_at, now())
  WHERE EXISTS (SELECT 1 FROM public.voyages WHERE id = v_voyage_id)
  ON CONFLICT (voyage_id, pol) DO UPDATE
    SET atd = EXCLUDED.atd, marked_by = EXCLUDED.marked_by, marked_at = EXCLUDED.marked_at;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.voyage_pol_atd_manual_mark() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS voyage_pol_atd_manual_mark ON public.audit_logs;
CREATE TRIGGER voyage_pol_atd_manual_mark
  AFTER INSERT ON public.audit_logs
  FOR EACH ROW
  WHEN (NEW.entity_type = 'voyage_pol_schedule' AND NEW.field_name = 'atd')
  EXECUTE FUNCTION public.voyage_pol_atd_manual_mark();

-- 5 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.voyage_pol_atd_follows_bl_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.voyage_id IS NULL OR NULLIF(btrim(COALESCE(NEW.pol, '')), '') IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM public._recompute_voyage_pol_atd(
    NEW.voyage_id, NEW.pol, COALESCE(auth.uid(), NEW.cancelled_by),
    CASE WHEN NEW.cancelled_at IS NOT NULL
      THEN 'ATD recalculado: B/L ' || NEW.id || ' cancelado; só B/Ls ativos contam (ADR 0095, decisão 23)'
      ELSE 'ATD recalculado: B/L ' || NEW.id || ' reativado (ADR 0095, decisão 23)'
    END
  );
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.voyage_pol_atd_follows_bl_cancel() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS voyage_pol_atd_follows_bl_cancel ON public.bls;
CREATE TRIGGER voyage_pol_atd_follows_bl_cancel
  AFTER UPDATE OF cancelled_at ON public.bls
  FOR EACH ROW
  WHEN ((OLD.cancelled_at IS NULL) IS DISTINCT FROM (NEW.cancelled_at IS NULL))
  EXECUTE FUNCTION public.voyage_pol_atd_follows_bl_cancel();

-- 4 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional_legacy_070(p_bls jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_item jsonb;
  v_bl_id text;
  v_next text[];
  v_current text[];
  v_voyage_ids bigint[] := ARRAY[]::bigint[];
  v_voyage_id bigint;
  v_pol text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Credenciais invalidas para importar frete do BL.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT b.voyage_id ORDER BY b.voyage_id), ARRAY[]::bigint[])
    INTO v_voyage_ids
  FROM public.bls AS b
  WHERE b.id IN (
    SELECT item->>'id'
    FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS item
    WHERE item->>'id' IS NOT NULL
  ) AND b.voyage_id IS NOT NULL;

  PERFORM set_config('alerts.baplie_coverage_deferred', 'on', true);
  v_result := public.import_bl_freight_transactional_legacy_357(p_bls, p_changed_by);

  FOR v_item IN SELECT item FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS item LOOP
    v_bl_id := v_item->>'id';
    CONTINUE WHEN v_bl_id IS NULL;

    -- Preserva o fato já cadastrado quando um payload antigo não possui a chave
    -- e quando o Laden on Board do arquivo é ilegível ou vazio (ADR 0078, item 17).
    IF v_item ? 'laden_on_board' AND NULLIF(btrim(v_item->>'laden_on_board'), '') IS NOT NULL THEN
      UPDATE public.bls
      SET laden_on_board = NULLIF(v_item->>'laden_on_board', '')::date,
          updated_at = now()
      WHERE id = v_bl_id;
    END IF;

    v_next := public.normalize_ncm_codes(v_item->'ncm_codes');
    CONTINUE WHEN cardinality(v_next) = 0;
    SELECT ncm_codes INTO v_current FROM public.bls WHERE id = v_bl_id;
    CONTINUE WHEN NOT FOUND OR v_current = v_next;
    UPDATE public.bls SET ncm_codes = v_next WHERE id = v_bl_id;
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bl', v_bl_id, 'ncm_codes', array_to_string(COALESCE(v_current, ARRAY[]::text[]), ', '), array_to_string(v_next, ', '), p_changed_by, 'NCM declarado no documento reimportado');
  END LOOP;

  PERFORM set_config('alerts.baplie_coverage_deferred', 'off', true);

  SELECT v_voyage_ids || COALESCE(array_agg(DISTINCT b.voyage_id ORDER BY b.voyage_id), ARRAY[]::bigint[])
    INTO v_voyage_ids
  FROM public.bls AS b
  WHERE b.id IN (
    SELECT item->>'id'
    FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS item
    WHERE item->>'id' IS NOT NULL
  ) AND b.voyage_id IS NOT NULL;

  FOR v_voyage_id IN
    SELECT DISTINCT ids.voyage_id FROM unnest(v_voyage_ids) AS ids(voyage_id)
    WHERE ids.voyage_id IS NOT NULL ORDER BY ids.voyage_id
  LOOP
    PERFORM public.reconcile_voyage_baplie_coverage_alerts(v_voyage_id, 'baplie_coverage_import');
    -- O adiamento também segura os gatilhos de B/Ls esperados e CE pendente
    -- (346): reconcilia os dois aqui, uma vez por viagem.
    PERFORM public._reconcile_voyage_bl_alerts(ARRAY[v_voyage_id], 'bl_import');

    -- 401 (ADR 0095, decisão 23): o ATD de cada POL sai do helper, que conta
    -- só B/Ls ativos e não toca o ATD corrigido à mão.
    FOR v_pol IN
      SELECT DISTINCT upper(btrim(b.pol))
      FROM public.bls AS b
      WHERE b.voyage_id = v_voyage_id AND NULLIF(btrim(b.pol), '') IS NOT NULL
    LOOP
      PERFORM public._recompute_voyage_pol_atd(
        v_voyage_id, v_pol, p_changed_by,
        'ATD derivado do menor Laden on Board dos B/Ls ativos, na importação do B/L (ADR 0025; ADR 0095, decisão 23)'
      );
    END LOOP;
  END LOOP;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_bl_freight_transactional_legacy_070(jsonb, uuid) FROM PUBLIC, anon, authenticated;

-- 6 -------------------------------------------------------------------------
-- Correções manuais já gravadas: a última gravação do ATD que não veio do
-- cálculo pelos B/Ls (justificativa "ATD derivado…", 175/346) marca o POL.
INSERT INTO public.voyage_pol_atd_manual (voyage_id, pol, atd, marked_by, marked_at)
SELECT last.voyage_id, last.pol, left(last.new_value, 10)::date, last.changed_by, last.changed_at
FROM (
  SELECT DISTINCT ON (al.entity_id)
    NULLIF(split_part(al.entity_id, '::', 1), '')::bigint AS voyage_id,
    upper(btrim(split_part(al.entity_id, '::', 2))) AS pol,
    al.new_value, al.changed_by, al.changed_at, al.justification
  FROM public.audit_logs AS al
  WHERE al.entity_type = 'voyage_pol_schedule'
    AND al.field_name = 'atd'
    AND split_part(al.entity_id, '::', 1) ~ '^[0-9]+$'
  ORDER BY al.entity_id, al.changed_at DESC, al.id DESC
) AS last
WHERE NULLIF(btrim(COALESCE(last.new_value, '')), '') IS NOT NULL
  AND last.new_value ~ '^\d{4}-\d{2}-\d{2}'
  AND last.pol <> ''
  AND COALESCE(last.justification, '') NOT ILIKE 'ATD derivado%'
  AND EXISTS (SELECT 1 FROM public.voyages AS v WHERE v.id = last.voyage_id)
ON CONFLICT (voyage_id, pol) DO NOTHING;

-- 181: contrato da importação de CE Mercante (M09, M12 e M13 da revisão de
-- 2026-10-09; etapas 8.2 a 8.10 do plano de correção; ADR 0078, itens 4, 6, 7
-- e 9).
--
-- 1. Nº de Manifesto Mercante canônico: 13 caracteres, letras ou dígitos,
--    maiúsculas sem espaços nem separadores (`canonical_manifesto_numero`). O
--    gatilho `trg_manifestos_mercante_canonical` normaliza e recusa fora do
--    formato (P0012); `CHECK` na tabela; busca pela forma canônica; rota
--    comparada por `normalize_port_code`.

-- 2. Cadastro único: `manifestos_mercante` é a fonte. **Informar Nº**
--    (`set_voyage_route_ce_master`) grava nele; `voyage_route_ce_master` fica
--    como espelho para os leitores antigos (gatilhos nos dois sentidos).
-- 3. Mover / Desvincular B/Ls de Manifesto (`move_bls_to_manifesto_mercante`,
--    `unlink_bls_from_manifesto_mercante`), em lote, com motivo, tudo ou
--    nada; destino novo validado e criado na hora. Mudar o POD ou a Viagem do
--    B/L desvincula o Manifesto (`trg_unlink_manifesto_on_route_change`).
-- 4. Prévia no servidor (`preview_ce_mercante_rows`): por B/L, CE atual →
--    novo, faturas vivas, Portal, Comunicado, Desbloqueio e Manifesto atual →
--    novo; avisos (cancelado ignorado) e erros do lote.
-- 5. `apply_ce_mercante_rows_atomic`: trava a Viagem antes dos B/Ls (evita o
--    deadlock entre duas planilhas); B/L cancelado é ignorado com aviso; linha
--    sem CE é erro; troca de CE já gravado e mudança de Manifesto exigem
--    confirmação com motivo (`p_confirm_changes`, `p_reason`); erros por linha
--    em linguagem de negócio; troca com Desbloqueio conferido abre Alerta
--    `ce_trocado_com_desbloqueio`.
-- 6. Emissão em lotes: com `p_defer_billing`, a gravação do CE só calcula (o
--    gatilho do CE não emite) e devolve os B/Ls a emitir; a tela chama
--    `emit_ce_mercante_billing` em lotes, com progresso e Retomar; o efeito
--    `local_billing` fica como rede. A fatura emitida pelo CE é registrada
--    como "Sistema — CE Mercante" (`issued_by` nulo, nota própria).
-- 7. Rastro: CE, Manifesto criado e vínculo no Histórico, um evento por fato.
--
-- Depende da afirmação "Data status" do AGENTS.md: reescreve
-- `manifestos_mercante.numero` e `voyage_route_ce_master.ce_master` para a
-- forma canônica (produção só com dados de teste). Aborta listando os números
-- que colidem depois da normalização.
--
-- ponytail: o espelho `voyage_route_ce_master` continua existindo para os
-- leitores antigos (cards da Viagem, alertas); upgrade: trocar os leitores
-- por `manifestos_mercante` e remover a tabela.
--
-- Rollback: reaplicar `audit_row_changes` da 002 e `_set_bl_ce_mercante` da
-- 177; DROP dos gatilhos e funções novas, do CHECK
-- `manifestos_mercante_numero_canonical`; reaplicar
-- `set_voyage_route_ce_master` da 064, `apply_ce_mercante_rows_atomic` da 164
-- e `trg_auto_bill_bl_after_ce_mercante` da 087. A reescrita dos números não
-- é revertida.

-- 1. Forma canônica do número.
CREATE OR REPLACE FUNCTION public.canonical_manifesto_numero(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT NULLIF(upper(regexp_replace(COALESCE(p_value, ''), '[^A-Za-z0-9]', '', 'g')), '');
$function$;

REVOKE ALL ON FUNCTION public.canonical_manifesto_numero(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.canonical_manifesto_numero(text) TO authenticated, service_role;

DO $precheck_180$
DECLARE
  v_collisions text;
BEGIN
  SELECT string_agg(format('%s (%s)', canonical, numeros), '; ' ORDER BY canonical) INTO v_collisions
  FROM (
    SELECT public.canonical_manifesto_numero(numero) AS canonical, string_agg(numero, ', ' ORDER BY numero) AS numeros
    FROM public.manifestos_mercante
    GROUP BY 1 HAVING count(*) > 1
  ) AS dup;
  IF v_collisions IS NOT NULL THEN
    RAISE EXCEPTION '181: números de Manifesto Mercante que colidem na forma canônica: %. Corrija antes de aplicar.', v_collisions;
  END IF;
END;
$precheck_180$;

-- Data status (AGENTS.md): os números gravados passam à forma canônica.
UPDATE public.manifestos_mercante
   SET numero = public.canonical_manifesto_numero(numero)
 WHERE numero IS DISTINCT FROM public.canonical_manifesto_numero(numero);
UPDATE public.voyage_route_ce_master
   SET ce_master = public.canonical_manifesto_numero(ce_master)
 WHERE ce_master IS DISTINCT FROM public.canonical_manifesto_numero(ce_master);

-- O formato vale para todo número novo; os antigos fora dele ficam listados.
ALTER TABLE public.manifestos_mercante DROP CONSTRAINT IF EXISTS manifestos_mercante_numero_canonical;
ALTER TABLE public.manifestos_mercante
  ADD CONSTRAINT manifestos_mercante_numero_canonical CHECK (numero ~ '^[A-Z0-9]{13}$') NOT VALID;
DO $validate_180$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.manifestos_mercante WHERE numero !~ '^[A-Z0-9]{13}$') THEN
    ALTER TABLE public.manifestos_mercante VALIDATE CONSTRAINT manifestos_mercante_numero_canonical;
  ELSE
    RAISE WARNING '181: Manifestos Mercante fora do formato de 13 caracteres: %',
      (SELECT string_agg(numero, ', ' ORDER BY numero) FROM public.manifestos_mercante WHERE numero !~ '^[A-Z0-9]{13}$');
  END IF;
END;
$validate_180$;

CREATE OR REPLACE FUNCTION public.guard_manifesto_mercante_canonical()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_numero text := public.canonical_manifesto_numero(NEW.numero);
BEGIN
  IF v_numero IS NULL OR v_numero !~ '^[A-Z0-9]{13}$' THEN
    RAISE EXCEPTION 'Nº de Manifesto Mercante inválido: "%". O número tem 13 caracteres, letras ou dígitos (ex.: 1226501860578).', NEW.numero
      USING ERRCODE = 'P0012';
  END IF;
  NEW.numero := v_numero;
  NEW.pol := COALESCE(public.normalize_port_code(NEW.pol), NEW.pol);
  NEW.pod := COALESCE(public.normalize_port_code(NEW.pod), NEW.pod);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_manifestos_mercante_canonical ON public.manifestos_mercante;
CREATE TRIGGER trg_manifestos_mercante_canonical
  BEFORE INSERT OR UPDATE OF numero, pol, pod ON public.manifestos_mercante
  FOR EACH ROW EXECUTE FUNCTION public.guard_manifesto_mercante_canonical();

-- Busca pelo número canônico.
CREATE OR REPLACE FUNCTION public.find_manifesto_mercante(p_numero text)
RETURNS SETOF public.manifestos_mercante
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT * FROM public.manifestos_mercante WHERE numero = public.canonical_manifesto_numero(p_numero);
$function$;

REVOKE ALL ON FUNCTION public.find_manifesto_mercante(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_manifesto_mercante(text) TO authenticated, service_role;

-- 7. Rastro sem evento duplicado: quem registra o fato de negócio (CE,
--    vínculo de Manifesto) pede ao gatilho genérico que pule aquela coluna
--    daquele registro uma vez (`_audit_skip_once`).
CREATE OR REPLACE FUNCTION public._audit_skip_once(p_table text, p_id text, p_field text)
RETURNS void
LANGUAGE sql
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT set_config('vela.audit_skip',
    concat_ws(',', NULLIF(current_setting('vela.audit_skip', true), ''), p_table || '/' || p_id || '/' || p_field), true);
$function$;

REVOKE ALL ON FUNCTION public._audit_skip_once(text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.audit_row_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old JSONB := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  v_new JSONB := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE '{}'::jsonb END;
  v_key_parts TEXT[] := string_to_array(COALESCE(TG_ARGV[0], 'id'), ',');
  v_entity_id TEXT;
  v_field RECORD;
  v_skip text[] := string_to_array(NULLIF(current_setting('vela.audit_skip', true), ''), ',');
  v_token text;
BEGIN
  SELECT string_agg(COALESCE(v_new ->> k, v_old ->> k), '/')
    INTO v_entity_id
    FROM unnest(v_key_parts) AS k;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by)
    VALUES (TG_TABLE_NAME, v_entity_id, 'criado', v_new::TEXT, auth.uid());
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, changed_by, justification)
    VALUES (TG_TABLE_NAME, v_entity_id, 'excluido', v_old::TEXT, auth.uid(),
            NULLIF(btrim(current_setting('vela.delete_reason', true)), ''));
  ELSE
    FOR v_field IN
      SELECT key, value AS old_value, v_new ->> key AS new_value
      FROM jsonb_each_text(v_old)
      WHERE v_old ->> key IS DISTINCT FROM v_new ->> key
    LOOP
      v_token := TG_TABLE_NAME || '/' || v_entity_id || '/' || v_field.key;
      IF v_skip IS NOT NULL AND v_token = ANY(v_skip) THEN
        v_skip := array_remove(v_skip, v_token);
        PERFORM set_config('vela.audit_skip', COALESCE(array_to_string(v_skip, ','), ''), true);
        CONTINUE;
      END IF;
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by)
      VALUES (TG_TABLE_NAME, v_entity_id, v_field.key, v_field.old_value, v_field.new_value, auth.uid());
    END LOOP;
    FOR v_field IN
      SELECT key, value AS new_value
      FROM jsonb_each_text(v_new)
      WHERE NOT (v_old ? key)
    LOOP
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by)
      VALUES (TG_TABLE_NAME, v_entity_id, v_field.key, v_field.new_value, auth.uid());
    END LOOP;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

-- 7. A porta única do CE não duplica o evento no Histórico.
CREATE OR REPLACE FUNCTION public._set_bl_ce_mercante(p_bl_id text, p_ce text, p_actor uuid, p_reason text, p_source text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ce text := NULLIF(regexp_replace(COALESCE(p_ce, ''), '\s', '', 'g'), '');
  v_old text;
  v_previous text := current_setting('vela.ce_mercante_port', true);
  v_result text;
BEGIN
  IF v_ce IS NOT NULL AND v_ce !~ '^[0-9]{15}$' THEN
    RAISE EXCEPTION 'CE Mercante invalido para o B/L %: o CE tem 15 digitos (recebido "%").', p_bl_id, p_ce
      USING ERRCODE = '22023';
  END IF;

  SELECT ce_mercante INTO v_old FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF NULLIF(btrim(COALESCE(v_old, '')), '') IS NOT DISTINCT FROM v_ce THEN
    RETURN 'unchanged';
  END IF;

  PERFORM set_config('vela.ce_mercante_port', 'on', true);
  -- O fato vai no Histórico abaixo, com motivo; o gatilho genérico não repete.
  PERFORM public._audit_skip_once('bls', p_bl_id, 'ce_mercante');
  UPDATE public.bls SET ce_mercante = v_ce WHERE id = p_bl_id;
  PERFORM set_config('vela.ce_mercante_port', COALESCE(v_previous, 'off'), true);

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bl', p_bl_id, 'ce_mercante', COALESCE(v_old, ''), COALESCE(v_ce, ''), p_actor, p_reason);

  v_result := CASE
    WHEN v_ce IS NULL THEN 'removed'
    WHEN NULLIF(btrim(COALESCE(v_old, '')), '') IS NULL THEN 'inserted'
    ELSE 'overwritten'
  END;

  -- Comunicado de CE e Taxas já enviado com o CE anterior: o Cliente precisa
  -- recebê-lo de novo (ADR 0078, itens 4 e 5).
  IF v_result <> 'inserted' AND EXISTS (
    SELECT 1 FROM public.customer_communications AS c
    JOIN public.customer_communication_bls AS cb ON cb.communication_id = c.id
    WHERE cb.bl_id = p_bl_id AND c.kind = 'ce_mercante_taxas' AND c.status IN ('enviado', 'parcial')
  ) THEN
    BEGIN
      PERFORM public.upsert_alert_item(
        'comunicado_ce_reenvio_pendente', 'bl', p_bl_id,
        format('O CE Mercante do B/L %s mudou (%s -> %s) depois do Comunicado de CE e Taxas: reenvie o Comunicado ao Cliente.',
          p_bl_id, COALESCE(v_old, 'sem CE'), COALESCE(v_ce, 'removido')),
        p_source,
        jsonb_build_object('bl_id', p_bl_id, 'old_ce', v_old, 'new_ce', v_ce, 'reason', p_reason),
        '/bls/' || p_bl_id
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Nao foi possivel abrir a pendencia de reenvio do B/L %: %', p_bl_id, SQLERRM;
    END;
  END IF;

  RETURN v_result;
END;
$function$;

-- 2. Cadastro único: Informar Nº grava em manifestos_mercante; o espelho
--    voyage_route_ce_master acompanha.
CREATE OR REPLACE FUNCTION public._upsert_route_manifesto(
  p_voyage_id bigint, p_pol text, p_pod text, p_natureza text, p_numero text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_numero text := public.canonical_manifesto_numero(p_numero);
  v_pol text := COALESCE(public.normalize_port_code(p_pol), upper(btrim(p_pol)));
  v_pod text := COALESCE(public.normalize_port_code(p_pod), upper(btrim(p_pod)));
  v_existing public.manifestos_mercante%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT * INTO v_existing FROM public.manifestos_mercante WHERE numero = v_numero FOR UPDATE;
  IF FOUND THEN
    IF v_existing.voyage_id IS DISTINCT FROM p_voyage_id
       OR COALESCE(public.normalize_port_code(v_existing.pol), upper(v_existing.pol)) <> v_pol
       OR COALESCE(public.normalize_port_code(v_existing.pod), upper(v_existing.pod)) <> v_pod
       OR v_existing.natureza <> p_natureza THEN
      RAISE EXCEPTION 'O Manifesto Mercante % já está cadastrado para outra viagem, rota ou natureza.', v_numero
        USING ERRCODE = 'P0012';
    END IF;
    RETURN v_existing.id;
  END IF;
  INSERT INTO public.manifestos_mercante (voyage_id, pol, pod, numero, natureza)
  VALUES (p_voyage_id, v_pol, v_pod, v_numero, p_natureza)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public._upsert_route_manifesto(bigint, text, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_voyage_route_ce_master(
  p_voyage_id bigint, p_pol text, p_pod text, p_ce_master text, p_changed_by uuid, p_cargo_mode text DEFAULT 'container'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_norm text := public.canonical_manifesto_numero(p_ce_master);
  v_pol text := upper(btrim(COALESCE(p_pol, '')));
  v_pod text := upper(btrim(COALESCE(p_pod, '')));
  v_mode text := lower(btrim(COALESCE(p_cargo_mode, 'container')));
  v_old text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para editar o Nº de Manifesto Mercante.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem % nao encontrada', p_voyage_id USING ERRCODE = 'P0002';
  END IF;
  IF v_norm IS NOT NULL AND v_norm !~ '^[A-Z0-9]{13}$' THEN
    RAISE EXCEPTION 'Nº de Manifesto Mercante inválido: "%". O número tem 13 caracteres, letras ou dígitos (ex.: 1226501860578).', p_ce_master
      USING ERRCODE = 'P0012';
  END IF;

  SELECT ce_master INTO v_old FROM public.voyage_route_ce_master
    WHERE voyage_id = p_voyage_id AND pol = v_pol AND pod = v_pod AND cargo_mode = v_mode;

  -- Fonte única (ADR 0078, item 6): o Manifesto da rota.
  IF v_norm IS NOT NULL THEN
    PERFORM public._upsert_route_manifesto(p_voyage_id, v_pol, v_pod,
      CASE WHEN v_mode = 'vazios' THEN 'vazio' ELSE 'carga' END, v_norm);
  END IF;

  PERFORM set_config('vela.route_manifest_mirror', 'on', true);
  INSERT INTO public.voyage_route_ce_master(voyage_id, pol, pod, cargo_mode, ce_master, updated_by, updated_at)
  VALUES (p_voyage_id, v_pol, v_pod, v_mode, v_norm, p_changed_by, now())
  ON CONFLICT (voyage_id, pol, pod, cargo_mode)
  DO UPDATE SET ce_master = EXCLUDED.ce_master, updated_by = EXCLUDED.updated_by, updated_at = now();
  PERFORM set_config('vela.route_manifest_mirror', 'off', true);

  IF COALESCE(v_old, '') IS DISTINCT FROM COALESCE(v_norm, '') THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('voyage', p_voyage_id::text, 'ce_master', NULLIF(v_old, ''), v_norm, p_changed_by,
            CASE WHEN v_mode = 'vazios' THEN 'Nº de Manifesto Mercante por rota (vazios)'
                 ELSE 'Nº de Manifesto Mercante por rota' END);
  END IF;
END;
$function$;

-- Outras escritas no espelho (importação de vazios) também chegam à fonte.
CREATE OR REPLACE FUNCTION public.sync_route_ce_master_to_manifesto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF current_setting('vela.route_manifest_mirror', true) = 'on' THEN
    RETURN NEW;
  END IF;
  NEW.ce_master := public.canonical_manifesto_numero(NEW.ce_master);
  IF NEW.ce_master IS NOT NULL AND NEW.ce_master ~ '^[A-Z0-9]{13}$' THEN
    PERFORM public._upsert_route_manifesto(NEW.voyage_id, NEW.pol, NEW.pod,
      CASE WHEN NEW.cargo_mode = 'vazios' THEN 'vazio' ELSE 'carga' END, NEW.ce_master);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_route_ce_master_to_manifesto ON public.voyage_route_ce_master;
CREATE TRIGGER trg_sync_route_ce_master_to_manifesto
  BEFORE INSERT OR UPDATE OF ce_master ON public.voyage_route_ce_master
  FOR EACH ROW EXECUTE FUNCTION public.sync_route_ce_master_to_manifesto();

-- E o Manifesto criado pela planilha ou pela tela aparece no espelho.
CREATE OR REPLACE FUNCTION public.sync_manifesto_to_route_ce_master()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mode text := CASE WHEN NEW.natureza = 'vazio' THEN 'vazios' ELSE 'container' END;
BEGIN
  IF current_setting('vela.route_manifest_mirror', true) = 'on' THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('vela.route_manifest_mirror', 'on', true);
  INSERT INTO public.voyage_route_ce_master(voyage_id, pol, pod, cargo_mode, ce_master, updated_by, updated_at)
  VALUES (NEW.voyage_id, upper(btrim(NEW.pol)), upper(btrim(NEW.pod)), v_mode, NEW.numero, auth.uid(), now())
  ON CONFLICT (voyage_id, pol, pod, cargo_mode)
  DO UPDATE SET ce_master = COALESCE(public.voyage_route_ce_master.ce_master, EXCLUDED.ce_master), updated_at = now();
  PERFORM set_config('vela.route_manifest_mirror', 'off', true);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_manifesto_to_route_ce_master ON public.manifestos_mercante;
CREATE TRIGGER trg_sync_manifesto_to_route_ce_master
  AFTER INSERT ON public.manifestos_mercante
  FOR EACH ROW EXECUTE FUNCTION public.sync_manifesto_to_route_ce_master();

-- 3. Mover / Desvincular B/Ls de Manifesto Mercante.
CREATE OR REPLACE FUNCTION public._lock_bls_for_manifesto(p_bl_ids text[])
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ids text[] := ARRAY(SELECT DISTINCT btrim(x) FROM unnest(COALESCE(p_bl_ids, ARRAY[]::text[])) AS x WHERE NULLIF(btrim(x), '') IS NOT NULL ORDER BY 1);
  v_missing text;
  v_cancelled text;
BEGIN
  IF cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um B/L.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_ids) > 2000 THEN
    RAISE EXCEPTION 'No máximo 2000 B/Ls por vez.' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.bls WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;
  SELECT string_agg(x, ', ' ORDER BY x) INTO v_missing FROM unnest(v_ids) AS x WHERE NOT EXISTS (SELECT 1 FROM public.bls WHERE id = x);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'B/L não encontrado: %.', v_missing USING ERRCODE = 'P0002';
  END IF;
  SELECT string_agg(id, ', ' ORDER BY id) INTO v_cancelled FROM public.bls WHERE id = ANY(v_ids) AND cancelled_at IS NOT NULL;
  IF v_cancelled IS NOT NULL THEN
    RAISE EXCEPTION 'B/L cancelado não muda de Manifesto Mercante: %.', v_cancelled USING ERRCODE = '22023';
  END IF;
  RETURN v_ids;
END;
$function$;

REVOKE ALL ON FUNCTION public._lock_bls_for_manifesto(text[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._link_bls_to_manifesto(p_bl_ids text[], p_manifesto_id uuid, p_actor uuid, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
BEGIN
  PERFORM public._audit_skip_once('bls', b.id, 'manifesto_mercante_id')
  FROM public.bls AS b WHERE b.id = ANY(p_bl_ids) AND b.manifesto_mercante_id IS DISTINCT FROM p_manifesto_id;
  WITH previous AS (
    SELECT b.id, m.numero AS old_numero
    FROM public.bls AS b LEFT JOIN public.manifestos_mercante AS m ON m.id = b.manifesto_mercante_id
    WHERE b.id = ANY(p_bl_ids) AND b.manifesto_mercante_id IS DISTINCT FROM p_manifesto_id
  ), changed AS (
    UPDATE public.bls AS b SET manifesto_mercante_id = p_manifesto_id
      FROM previous WHERE b.id = previous.id
    RETURNING b.id
  ), logged AS (
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    SELECT 'bl', previous.id, 'manifesto_mercante', previous.old_numero,
      (SELECT numero FROM public.manifestos_mercante WHERE id = p_manifesto_id), p_actor, p_reason
    FROM previous JOIN changed ON changed.id = previous.id
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM logged;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public._link_bls_to_manifesto(text[], uuid, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.move_bls_to_manifesto_mercante(p_bl_ids text[], p_numero text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_numero text := public.canonical_manifesto_numero(p_numero);
  v_ids text[];
  v_route record;
  v_routes integer;
  v_target public.manifestos_mercante%ROWTYPE;
  v_created boolean := false;
  v_moved integer;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da mudança de Manifesto Mercante.' USING ERRCODE = '22023';
  END IF;
  IF v_numero IS NULL OR v_numero !~ '^[A-Z0-9]{13}$' THEN
    RAISE EXCEPTION 'Nº de Manifesto Mercante inválido: "%". O número tem 13 caracteres, letras ou dígitos (ex.: 1226501860578).', p_numero
      USING ERRCODE = 'P0012';
  END IF;

  v_ids := public._lock_bls_for_manifesto(p_bl_ids);
  SELECT count(DISTINCT (b.voyage_id, public.normalize_port_code(b.pol), public.normalize_port_code(b.pod))) INTO v_routes
  FROM public.bls AS b WHERE b.id = ANY(v_ids);
  IF v_routes > 1 THEN
    RAISE EXCEPTION 'Os B/Ls selecionados são de mais de uma viagem ou rota (POL → POD); um Manifesto tem uma única rota.' USING ERRCODE = '22023';
  END IF;
  SELECT b.voyage_id, btrim(b.pol) AS pol, btrim(b.pod) AS pod INTO v_route FROM public.bls AS b WHERE b.id = ANY(v_ids) LIMIT 1;
  IF NULLIF(v_route.pol, '') IS NULL OR NULLIF(v_route.pod, '') IS NULL THEN
    RAISE EXCEPTION 'Os B/Ls selecionados não têm POL e POD cadastrados; sem rota não há Manifesto.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_target FROM public.manifestos_mercante WHERE numero = v_numero;
  v_created := NOT FOUND;
  PERFORM public._upsert_route_manifesto(v_route.voyage_id, v_route.pol, v_route.pod, 'carga', v_numero);
  SELECT * INTO v_target FROM public.manifestos_mercante WHERE numero = v_numero;
  IF v_created THEN
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('voyage', v_route.voyage_id::text, 'manifesto_mercante_created', NULL, v_numero, v_actor, v_reason);
  END IF;

  v_moved := public._link_bls_to_manifesto(v_ids, v_target.id, v_actor, v_reason);
  RETURN jsonb_build_object(
    'manifesto_mercante_id', v_target.id, 'numero', v_numero, 'created', v_created,
    'moved', v_moved, 'unchanged', cardinality(v_ids) - v_moved);
END;
$function$;

REVOKE ALL ON FUNCTION public.move_bls_to_manifesto_mercante(text[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_bls_to_manifesto_mercante(text[], text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.unlink_bls_from_manifesto_mercante(p_bl_ids text[], p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_ids text[];
  v_count integer;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do desvínculo do Manifesto Mercante.' USING ERRCODE = '22023';
  END IF;
  v_ids := public._lock_bls_for_manifesto(p_bl_ids);
  v_count := public._link_bls_to_manifesto(v_ids, NULL, v_actor, v_reason);
  RETURN jsonb_build_object('unlinked', v_count, 'unchanged', cardinality(v_ids) - v_count);
END;
$function$;

REVOKE ALL ON FUNCTION public.unlink_bls_from_manifesto_mercante(text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unlink_bls_from_manifesto_mercante(text[], text) TO authenticated;

-- Mudar o POD ou a Viagem do B/L desvincula o Manifesto (a rota mudou).
CREATE OR REPLACE FUNCTION public.unlink_manifesto_on_route_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF OLD.manifesto_mercante_id IS NOT NULL
     AND NEW.manifesto_mercante_id IS NOT DISTINCT FROM OLD.manifesto_mercante_id
     AND (NEW.voyage_id IS DISTINCT FROM OLD.voyage_id
          OR public.normalize_port_code(NEW.pod) IS DISTINCT FROM public.normalize_port_code(OLD.pod)) THEN
    NEW.manifesto_mercante_id := NULL;
    PERFORM public._audit_skip_once('bls', OLD.id, 'manifesto_mercante_id');
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bl', OLD.id, 'manifesto_mercante',
      (SELECT numero FROM public.manifestos_mercante WHERE id = OLD.manifesto_mercante_id), NULL, auth.uid(),
      'Desvínculo automático: o POD ou a Viagem do B/L mudou.');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_unlink_manifesto_on_route_change ON public.bls;
CREATE TRIGGER trg_unlink_manifesto_on_route_change
  BEFORE UPDATE OF pod, voyage_id ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public.unlink_manifesto_on_route_change();

-- 4. Prévia no servidor e análise comum à gravação.
INSERT INTO public.alert_type_catalog(type, severity, responsible_department, audience_departments, default_destination)
VALUES ('ce_trocado_com_desbloqueio', 'critical', 'documentacao', ARRAY['documentacao'], '/desbloqueio-ce')
ON CONFLICT (type) DO NOTHING;

CREATE OR REPLACE FUNCTION public._analyze_ce_mercante_rows(
  p_rows jsonb,
  p_manifesto_numero text,
  p_voyage_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_numero text := public.canonical_manifesto_numero(p_manifesto_numero);
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_item jsonb;
  v_bl public.bls%ROWTYPE;
  v_new_ce text;
  v_route record;
  v_routes integer;
  v_manifesto public.manifestos_mercante%ROWTYPE;
  v_has_manifesto boolean := false;
  v_active_ids text[] := ARRAY[]::text[];
  v_current_numero text;
  v_status text;
  v_changes integer := 0;
  v_moves integer := 0;
  v_route_voyage bigint;
  v_route_pol text;
  v_route_pod text;
BEGIN
  IF jsonb_typeof(COALESCE(p_rows, 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('errors', jsonb_build_array(jsonb_build_object('message', 'Nenhuma linha para importar.')),
      'warnings', '[]'::jsonb, 'rows', '[]'::jsonb);
  END IF;
  IF v_numero IS NULL THEN
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('message', 'Informe o número do Manifesto Mercante deste lote antes de importar.'));
  ELSIF v_numero !~ '^[A-Z0-9]{13}$' THEN
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
      format('Nº de Manifesto Mercante inválido: "%s". O número tem 13 caracteres, letras ou dígitos (ex.: 1226501860578).', p_manifesto_numero)));
  ELSE
    SELECT * INTO v_manifesto FROM public.manifestos_mercante WHERE numero = v_numero;
    v_has_manifesto := FOUND;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_new_ce := NULLIF(regexp_replace(COALESCE(v_item->>'ce', ''), '\s', '', 'g'), '');
    SELECT * INTO v_bl FROM public.bls WHERE id = btrim(v_item->>'bl_id');
    IF NOT FOUND THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_item->>'bl_id',
        'message', format('B/L %s não encontrado no sistema.', v_item->>'bl_id')));
      CONTINUE;
    END IF;
    IF v_bl.cancelled_at IS NOT NULL THEN
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_bl.id,
        'message', format('B/L %s cancelado: a linha é ignorada.', v_bl.id)));
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_bl.id, 'status', 'cancelled'));
      CONTINUE;
    END IF;
    IF v_new_ce IS NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_bl.id,
        'message', format('Linha sem CE Mercante para o B/L %s.', v_bl.id)));
      CONTINUE;
    END IF;
    IF v_new_ce !~ '^[0-9]{15}$' THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_bl.id,
        'message', format('CE Mercante inválido para o B/L %s: o CE tem 15 dígitos.', v_bl.id)));
      CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.bls AS other
      WHERE other.id <> v_bl.id AND other.cancelled_at IS NULL
        AND public.ce_mercante_key(other.ce_mercante) = public.ce_mercante_key(v_new_ce)
    ) THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_bl.id,
        'message', format('O CE Mercante %s já está em outro B/L não cancelado (%s).', v_new_ce,
          (SELECT string_agg(other.id, ', ') FROM public.bls AS other WHERE other.id <> v_bl.id AND other.cancelled_at IS NULL
             AND public.ce_mercante_key(other.ce_mercante) = public.ce_mercante_key(v_new_ce)))));
      CONTINUE;
    END IF;

    v_active_ids := array_append(v_active_ids, v_bl.id);
    SELECT numero INTO v_current_numero FROM public.manifestos_mercante WHERE id = v_bl.manifesto_mercante_id;
    v_status := CASE
      WHEN NULLIF(btrim(COALESCE(v_bl.ce_mercante, '')), '') IS NULL THEN 'new'
      WHEN public.ce_mercante_key(v_bl.ce_mercante) = public.ce_mercante_key(v_new_ce) THEN 'same'
      ELSE 'change'
    END;
    IF v_status = 'change' THEN v_changes := v_changes + 1; END IF;
    IF v_current_numero IS NOT NULL AND v_numero IS NOT NULL AND v_current_numero IS DISTINCT FROM v_numero THEN
      v_moves := v_moves + 1;
    END IF;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'row', v_item->'row',
      'bl_id', v_bl.id,
      'status', v_status,
      'current_ce', NULLIF(btrim(COALESCE(v_bl.ce_mercante, '')), ''),
      'new_ce', v_new_ce,
      'current_manifesto', v_current_numero,
      'target_manifesto', v_numero,
      'manifesto_change', v_current_numero IS NOT NULL AND v_current_numero IS DISTINCT FROM v_numero,
      'live_invoices', COALESCE((
        SELECT jsonb_agg(i.invoice_number ORDER BY i.invoice_number)
        FROM public.invoices AS i
        WHERE i.status NOT IN ('draft', 'cancelled', 'obsolete')
          AND (i.bl_id = v_bl.id OR EXISTS (SELECT 1 FROM public.invoice_bls ib WHERE ib.invoice_id = i.id AND ib.bl_id = v_bl.id))
      ), '[]'::jsonb),
      'portal_visible', v_bl.customer_id IS NOT NULL AND NULLIF(btrim(COALESCE(v_bl.ce_mercante, '')), '') IS NOT NULL
        AND public.customer_portal_access_ready(v_bl.customer_id),
      'comunicado_sent', EXISTS (
        SELECT 1 FROM public.customer_communications AS c
        JOIN public.customer_communication_bls AS cb ON cb.communication_id = c.id
        WHERE cb.bl_id = v_bl.id AND c.kind = 'ce_mercante_taxas' AND c.status IN ('enviado', 'parcial')),
      'unlock_confirmed', EXISTS (
        SELECT 1 FROM public.ce_unlock_request_bls AS u WHERE u.bl_id = v_bl.id AND u.active AND u.confirmed_at IS NOT NULL)
    ));
  END LOOP;

  IF cardinality(v_active_ids) > 0 AND v_numero ~ '^[A-Z0-9]{13}$' THEN
    SELECT count(DISTINCT (b.voyage_id, public.normalize_port_code(b.pol), public.normalize_port_code(b.pod))) INTO v_routes
    FROM public.bls AS b WHERE b.id = ANY(v_active_ids);
    SELECT b.voyage_id, btrim(b.pol) AS pol, btrim(b.pod) AS pod INTO v_route FROM public.bls AS b WHERE b.id = ANY(v_active_ids) ORDER BY b.id LIMIT 1;
    v_route_voyage := v_route.voyage_id; v_route_pol := v_route.pol; v_route_pod := v_route.pod;
    IF v_routes > 1 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
        'Os B/Ls da planilha são de mais de uma viagem ou rota (POL → POD). Um manifesto tem uma única rota: separe a planilha por manifesto.'));
    ELSIF NULLIF(v_route.pol, '') IS NULL OR NULLIF(v_route.pod, '') IS NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
        'Os B/Ls da planilha não têm POL e POD cadastrados; sem rota não há manifesto.'));
    ELSIF p_voyage_id IS NOT NULL AND v_route.voyage_id IS DISTINCT FROM p_voyage_id THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message', 'Os B/Ls da planilha não pertencem à viagem selecionada.'));
    ELSIF v_has_manifesto AND (
      v_manifesto.voyage_id IS DISTINCT FROM v_route.voyage_id
      OR COALESCE(public.normalize_port_code(v_manifesto.pol), upper(v_manifesto.pol)) IS DISTINCT FROM public.normalize_port_code(v_route.pol)
      OR COALESCE(public.normalize_port_code(v_manifesto.pod), upper(v_manifesto.pod)) IS DISTINCT FROM public.normalize_port_code(v_route.pod)
      OR v_manifesto.natureza <> 'carga'
    ) THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
        format('O Manifesto Mercante %s já está cadastrado para outra viagem, rota ou natureza.', v_numero)));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'errors', v_errors,
    'warnings', v_warnings,
    'rows', v_rows,
    'active_bl_ids', to_jsonb(v_active_ids),
    'manifesto', jsonb_build_object('numero', v_numero, 'exists', v_has_manifesto,
      'voyage_id', v_route_voyage, 'pol', v_route_pol, 'pod', v_route_pod),
    'changes', v_changes,
    'moves', v_moves,
    'needs_confirmation', (v_changes + v_moves) > 0
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._analyze_ce_mercante_rows(jsonb, text, bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.preview_ce_mercante_rows(
  p_rows jsonb,
  p_manifesto_numero text,
  p_voyage_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  RETURN public._analyze_ce_mercante_rows(p_rows, p_manifesto_numero, p_voyage_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.preview_ce_mercante_rows(jsonb, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_ce_mercante_rows(jsonb, text, bigint) TO authenticated;

-- 6. A fatura emitida pelo CE é do Sistema — CE Mercante.
CREATE OR REPLACE FUNCTION public._auto_bill_bl_core(p_bl_id text, p_actor uuid, p_reuse_calculation boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.bls%ROWTYPE;
  v_actor uuid := COALESCE(p_actor, auth.uid());
  v_calculation jsonb;
  v_ready jsonb;
  v_invoice jsonb;
  v_existing_invoice_id bigint;
  v_previous_context_table text := current_setting('vela.billing_context_table', true);
  v_previous_request_sub text := current_setting('request.jwt.claim.sub', true);
  v_context_table text := format('vela_auto_billing_%s', replace(gen_random_uuid()::text, '-', ''));
  v_impersonated boolean := false;
  v_context_created boolean := false;
  v_sqlstate text;
  v_error_message text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (v_actor IS NULL OR v_actor IS DISTINCT FROM auth.uid() OR NOT public.is_active_user()) THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para faturamento automatico.' USING ERRCODE = '42501';
  END IF;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Faturamento automatico sem ator validado.' USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_bl
  FROM public.bls
  WHERE id = p_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'reason', 'bl_not_found',
      'bl_id', p_bl_id
    );
  END IF;

  -- Repetir o save/import não pode criar uma segunda invoice. O status do B/L
  -- é a guarda rápida; o link ativo cobre estados antigos parcialmente gravados.
  IF COALESCE(v_bl.financial_status, 'pending') <> 'pending' THEN
    RETURN jsonb_build_object(
      'status', 'already_invoiced',
      'idempotent', true,
      'bl_id', v_bl.id,
      'financial_status', v_bl.financial_status
    );
  END IF;

  SELECT inv.id
    INTO v_existing_invoice_id
  FROM public.invoice_bls AS ib
  JOIN public.invoices AS inv ON inv.id = ib.invoice_id
  WHERE ib.bl_id = v_bl.id
    AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
  ORDER BY inv.id DESC
  LIMIT 1;

  IF v_existing_invoice_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'already_invoiced',
      'idempotent', true,
      'bl_id', v_bl.id,
      'invoice_id', v_existing_invoice_id
    );
  END IF;

  IF NULLIF(btrim(COALESCE(v_bl.ce_mercante, '')), '') IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'reason', 'ce_mercante_missing',
      'bl_id', v_bl.id
    );
  END IF;

  IF v_bl.customer_id IS NULL
     OR COALESCE(v_bl.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled') THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'reason', 'customer_reconciliation_pending',
      'bl_id', v_bl.id,
      'customer_id', v_bl.customer_id,
      'customer_reconciliation_status', v_bl.customer_reconciliation_status
    );
  END IF;

  -- O worker carrega o iniciador no GUC antes de chamar esta função. Em uma
  -- chamada server-side direta, o ator explícito recebe o mesmo tratamento.
  -- Só altere a identidade depois das saídas idempotentes acima e restaure-a
  -- em qualquer caminho, para não vazar o ator para o restante da sessão.
  IF auth.uid() IS DISTINCT FROM v_actor THEN
    PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
    v_impersonated := true;
  END IF;

  IF NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Ator inativo para faturamento automatico.' USING ERRCODE = '42501';
  END IF;

  -- O marcador é uma tabela temporária criada sob o owner do SECURITY
  -- DEFINER. O GUC só carrega o nome da tabela e é limpo antes de retornar.
  EXECUTE format(
    'CREATE TEMP TABLE pg_temp.%I (marker boolean NOT NULL) ON COMMIT DROP',
    v_context_table
  );
  v_context_created := true;
  EXECUTE format(
    'INSERT INTO pg_temp.%I(marker) VALUES (true)',
    v_context_table
  );
  PERFORM set_config('vela.billing_context_table', v_context_table, true);

  -- Taxas do dia do CE (decisão de 2026-09-24): ao abrir o gate, a fatura
  -- retida sai com o cálculo que a transição do CE já gravou. Só calcula
  -- quando o B/L nunca teve cálculo (não há cálculo do dia do CE a manter).
  -- `review_required` também é mantido: recalcular apagaria a revisão feita,
  -- e `mark_bl_ready_for_billing` recusa o B/L até a revisão terminar.
  IF p_reuse_calculation
     AND v_bl.charge_status IN ('calculated', 'reviewed', 'ready_for_billing', 'review_required', 'exempt') THEN
    v_calculation := jsonb_build_object('bl_id', v_bl.id, 'status', v_bl.charge_status, 'reused', true);
  ELSE
    v_calculation := public.calculate_bl_local_charges(v_bl.id, v_actor, true);
  END IF;

  -- Isenção legítima não possui linha positiva para uma invoice. O CE foi
  -- processado corretamente, mas não há documento financeiro a emitir.
  IF v_calculation->>'status' = 'exempt' THEN
    EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
    v_context_created := false;
    PERFORM set_config('vela.billing_context_table', COALESCE(v_previous_context_table, ''), true);
    IF v_impersonated THEN
      PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_request_sub, ''), true);
    END IF;
    RETURN v_calculation || jsonb_build_object('status', 'skipped', 'reason', 'exempt');
  END IF;

  -- Trava universal do Portal (ADR 0070): sem Portal pronto e sem Liberação
  -- de faturamento vigente, o CE calcula mas não emite. A retenção fica no
  -- B/L e sai pela ativação do Portal ou pela concessão da Liberação, que
  -- reprocessam o Cliente. Não é falha: a fila de efeitos não é acionada.
  IF NOT public.customer_billing_access_ready(v_bl.customer_id) THEN
    EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
    v_context_created := false;
    PERFORM set_config('vela.billing_context_table', COALESCE(v_previous_context_table, ''), true);
    UPDATE public.bls
       SET billing_hold_reason = COALESCE(NULLIF(btrim(billing_hold_reason), ''), 'Acesso ao portal nao provisionado')
     WHERE id = v_bl.id;
    PERFORM public.reconcile_customer_bl_review_alerts(v_bl.customer_id, NULL, 'portal_billing_hold');
    IF v_impersonated THEN
      PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_request_sub, ''), true);
    END IF;
    RETURN jsonb_build_object(
      'status', 'held',
      'reason', 'portal_not_provisioned',
      'bl_id', v_bl.id,
      'customer_id', v_bl.customer_id,
      'calculation', v_calculation
    );
  END IF;

  v_ready := public.mark_bl_ready_for_billing(v_bl.id, v_actor);
  v_invoice := public.create_invoice_from_bls_core(
    ARRAY[v_bl.id],
    v_bl.customer_id,
    'Sistema — CE Mercante: fatura automática após o registro do CE.',
    true,
    v_actor,
    'internal',
    NULL
  );

  IF NULLIF(v_invoice->>'invoice_id', '') IS NULL THEN
    RAISE EXCEPTION 'Emissao automatica nao retornou invoice para o B/L %.', v_bl.id
      USING ERRCODE = 'P0001';
  END IF;

  EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
  v_context_created := false;
  PERFORM set_config('vela.billing_context_table', COALESCE(v_previous_context_table, ''), true);
  PERFORM public.link_invoice_to_ledger((v_invoice->>'invoice_id')::bigint);

  IF v_impersonated THEN
    PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_request_sub, ''), true);
  END IF;

  RETURN jsonb_build_object(
    'status', 'invoiced',
    'idempotent', false,
    'bl_id', v_bl.id,
    'calculation', v_calculation,
    'ready', v_ready,
    'invoice', v_invoice
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_sqlstate = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT;
    IF v_context_created THEN
      EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
      v_context_created := false;
    END IF;
    PERFORM set_config('vela.billing_context_table', COALESCE(v_previous_context_table, ''), true);
    IF v_impersonated THEN
      PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_request_sub, ''), true);
    END IF;

    -- A atualização documental não é desfeita porque o efeito recuperável
    -- será criado pelo trigger. O worker registrará o bloqueio com o erro
    -- original e poderá ser reprocessado depois da correção operacional.
    RETURN jsonb_build_object(
      'status', 'blocked',
      'reason', 'auto_billing_failed',
      'bl_id', p_bl_id,
      'sqlstate', v_sqlstate,
      'message', left(regexp_replace(COALESCE(v_error_message, ''), '[[:cntrl:]]', ' ', 'g'), 1000)
    );
END;
$function$;

-- 6. Com a emissão em lotes, o gatilho do CE só calcula.
CREATE OR REPLACE FUNCTION public.trg_auto_bill_bl_after_ce_mercante()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_previous_request_role text := current_setting('request.jwt.claim.role', true);
  v_role_impersonated boolean := false;
  v_result jsonb;
BEGIN
  -- Emissão em lotes (migration 181): a planilha grava o CE e o cálculo na
  -- transação e a tela emite logo depois por `emit_ce_mercante_billing`; o
  -- efeito local_billing registrado na gravação fica como rede.
  IF current_setting('vela.ce_billing_deferred', true) = 'on' THEN
    PERFORM public.calculate_bl_local_charges(NEW.id, v_actor, true);
    RETURN NEW;
  END IF;

  v_result := public.auto_bill_bl_after_ce_mercante(NEW.id, v_actor);

  -- `held` é a retenção do Portal: quem a desfaz é a ativação do Portal ou a
  -- Liberação, não uma nova tentativa da fila.
  IF v_result->>'status' NOT IN ('invoiced', 'already_invoiced', 'skipped', 'held')
     AND NOT EXISTS (
       SELECT 1
       FROM public.import_pending_effects AS e
       WHERE e.entity_id = NEW.id
         AND e.effect_kind = 'local_billing'
         AND e.status IN ('pending', 'running', 'retry_wait')
     ) THEN
    -- A trigger disparado por uma conexão sem JWT já passou pela autorização
    -- da operação que alterou o B/L. Para deixar a recuperação registrada sem
    -- inventar um usuário, chama a fila como service_role e restaura o claim
    -- imediatamente depois do insert.
    IF auth.uid() IS NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
      PERFORM set_config('request.jwt.claim.role', 'service_role', true);
      v_role_impersonated := true;
    END IF;

    PERFORM public.enqueue_import_effect(
      gen_random_uuid(),
      'local_billing',
      NEW.id,
      v_actor,
      1,
      NULL,
      jsonb_build_object(
        'source', 'ce_mercante_auto_billing',
        'ce_mercante', NEW.ce_mercante,
        'reason', v_result->>'reason',
        'message', v_result->>'message',
        'actor_source', CASE WHEN v_actor IS NULL THEN 'system' ELSE 'request' END
      )
    );

    IF v_role_impersonated THEN
      PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_request_role, ''), true);
      v_role_impersonated := false;
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    IF v_role_impersonated THEN
      PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_request_role, ''), true);
    END IF;
    RAISE;
END;
$function$;

-- 5. Gravação da planilha de CE Mercante.
DROP FUNCTION IF EXISTS public.apply_ce_mercante_rows_atomic(jsonb, uuid, text, text, bigint);
DROP FUNCTION IF EXISTS public.apply_ce_mercante_rows_atomic(jsonb, uuid, text, text, bigint, boolean, text, boolean);

CREATE FUNCTION public.apply_ce_mercante_rows_atomic(
  p_rows jsonb,
  p_changed_by uuid,
  p_target text DEFAULT 'bls',
  p_manifesto_numero text DEFAULT NULL,
  p_voyage_id bigint DEFAULT NULL,
  p_confirm_changes boolean DEFAULT false,
  p_reason text DEFAULT NULL,
  p_defer_billing boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_row jsonb;
  v_result text;
  v_errors jsonb := '[]'::jsonb;
  v_analysis jsonb;
  v_inserted integer := 0;
  v_overwritten integer := 0;
  v_unchanged integer := 0;
  v_numero text := public.canonical_manifesto_numero(p_manifesto_numero);
  v_bl_ids text[];
  v_active text[];
  v_voyage bigint;
  v_manifesto public.manifestos_mercante%ROWTYPE;
  v_created boolean := false;
  v_pending text[] := ARRAY[]::text[];
  v_previous_deferred text := current_setting('vela.ce_billing_deferred', true);
  v_message text;
  v_state text;
  v_justification text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_target NOT IN ('bls', 'granite') THEN
    RAISE EXCEPTION 'Destino de CE Mercante inválido: %', p_target USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_rows, 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('message', 'Nenhuma linha para importar.')));
  END IF;

  IF p_target = 'granite' THEN
    BEGIN
      FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
        BEGIN
          v_result := public.apply_granite_ce_mercante_update((v_row->>'bl_id')::uuid, v_row->>'ce', p_changed_by);
          CASE v_result
            WHEN 'overwritten' THEN v_overwritten := v_overwritten + 1;
            WHEN 'unchanged' THEN v_unchanged := v_unchanged + 1;
            ELSE v_inserted := v_inserted + 1;
          END CASE;
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_row->'row', 'bl_id', v_row->>'bl_id',
            'message', public._ce_row_error_message(v_state, v_message)));
        END;
      END LOOP;
      IF jsonb_array_length(v_errors) > 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'ce_rows_rollback';
      END IF;
    EXCEPTION WHEN SQLSTATE 'P0099' THEN
      RETURN jsonb_build_object('ok', false, 'errors', v_errors);
    END;
    RETURN jsonb_build_object('ok', true, 'processed', jsonb_array_length(p_rows),
      'inserted', v_inserted, 'overwritten', v_overwritten, 'unchanged', v_unchanged);
  END IF;

  -- Trava a Viagem antes dos B/Ls: duas planilhas da mesma Viagem não se
  -- cruzam travando os B/Ls em ordens diferentes (deadlock, ADR 0078 item 9).
  SELECT array_agg(DISTINCT btrim(value->>'bl_id')) INTO v_bl_ids FROM jsonb_array_elements(p_rows);
  SELECT COALESCE(p_voyage_id, (SELECT b.voyage_id FROM public.bls AS b WHERE b.id = ANY(v_bl_ids) ORDER BY b.id LIMIT 1)) INTO v_voyage;
  IF v_voyage IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('ce_mercante_voyage:' || v_voyage, 180));
  END IF;
  PERFORM 1 FROM public.bls WHERE id = ANY(v_bl_ids) ORDER BY id FOR UPDATE;

  v_analysis := public._analyze_ce_mercante_rows(p_rows, p_manifesto_numero, p_voyage_id);
  IF jsonb_array_length(v_analysis->'errors') > 0 THEN
    RETURN jsonb_build_object('ok', false, 'errors', v_analysis->'errors', 'warnings', v_analysis->'warnings');
  END IF;
  IF (v_analysis->>'needs_confirmation')::boolean AND (NOT p_confirm_changes OR v_reason IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'needs_confirmation', true, 'warnings', v_analysis->'warnings',
      'errors', jsonb_build_array(jsonb_build_object('message', format(
        'A planilha troca o CE de %s B/L(s) e muda o Manifesto de %s B/L(s): confirme na prévia, com motivo.',
        v_analysis->>'changes', v_analysis->>'moves'))));
  END IF;
  v_active := ARRAY(SELECT jsonb_array_elements_text(v_analysis->'active_bl_ids'));
  v_justification := CASE WHEN v_reason IS NULL THEN 'Importacao CE Mercante' ELSE 'Importacao CE Mercante: ' || v_reason END;

  IF cardinality(v_active) > 0 THEN
    SELECT * INTO v_manifesto FROM public.manifestos_mercante WHERE numero = v_numero;
    v_created := NOT FOUND;
  END IF;

  IF p_defer_billing THEN
    PERFORM set_config('vela.ce_billing_deferred', 'on', true);
  END IF;

  BEGIN
    FOR v_row IN
      SELECT value FROM jsonb_array_elements(v_analysis->'rows')
      WHERE value->>'status' IN ('new', 'same', 'change')
    LOOP
      BEGIN
        v_result := public._set_bl_ce_mercante(v_row->>'bl_id', v_row->>'new_ce', v_actor, v_justification, 'ce_mercante_planilha');
        CASE v_result
          WHEN 'overwritten' THEN v_overwritten := v_overwritten + 1;
          WHEN 'unchanged' THEN v_unchanged := v_unchanged + 1;
          ELSE v_inserted := v_inserted + 1;
        END CASE;
        IF v_result <> 'unchanged' THEN
          -- Rede da emissão: o efeito revalida e não refatura (migration 178).
          INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id, created_by)
          VALUES (gen_random_uuid(), 'local_billing', v_row->>'bl_id', v_actor)
          ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
          v_pending := array_append(v_pending, v_row->>'bl_id');
        END IF;
        IF v_result = 'overwritten' AND (v_row->>'unlock_confirmed')::boolean THEN
          PERFORM public.upsert_alert_item(
            'ce_trocado_com_desbloqueio', 'bl', v_row->>'bl_id',
            format('O CE Mercante do B/L %s mudou (%s -> %s) depois do Desbloqueio de CE conferido.',
              v_row->>'bl_id', v_row->>'current_ce', v_row->>'new_ce'),
            'ce_mercante_planilha',
            jsonb_build_object('bl_id', v_row->>'bl_id', 'old_ce', v_row->>'current_ce', 'new_ce', v_row->>'new_ce', 'reason', v_reason),
            '/bls/' || (v_row->>'bl_id'));
        END IF;
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_row->'row', 'bl_id', v_row->>'bl_id',
          'message', public._ce_row_error_message(v_state, v_message)));
      END;
    END LOOP;

    IF jsonb_array_length(v_errors) > 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'ce_rows_rollback';
    END IF;

    IF cardinality(v_active) > 0 THEN
      PERFORM public._upsert_route_manifesto((v_analysis->'manifesto'->>'voyage_id')::bigint,
        v_analysis->'manifesto'->>'pol', v_analysis->'manifesto'->>'pod', 'carga', v_numero);
      SELECT * INTO v_manifesto FROM public.manifestos_mercante WHERE numero = v_numero;
      IF v_created THEN
        INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
        VALUES ('voyage', v_manifesto.voyage_id::text, 'manifesto_mercante_created', NULL, v_numero, v_actor, v_justification);
      END IF;
      PERFORM public._link_bls_to_manifesto(v_active, v_manifesto.id, v_actor, v_justification);
    END IF;
  EXCEPTION WHEN SQLSTATE 'P0099' THEN
    PERFORM set_config('vela.ce_billing_deferred', COALESCE(v_previous_deferred, ''), true);
    RETURN jsonb_build_object('ok', false, 'errors', v_errors, 'warnings', v_analysis->'warnings');
  END;
  PERFORM set_config('vela.ce_billing_deferred', COALESCE(v_previous_deferred, ''), true);

  RETURN jsonb_build_object(
    'ok', true,
    'processed', jsonb_array_length(p_rows),
    'inserted', v_inserted,
    'overwritten', v_overwritten,
    'unchanged', v_unchanged,
    'ignored', (SELECT count(*) FROM jsonb_array_elements(v_analysis->'rows') WHERE value->>'status' = 'cancelled'),
    'warnings', v_analysis->'warnings',
    'manifesto_mercante_id', v_manifesto.id,
    'manifesto_created', v_created,
    'billing_pending_bl_ids', CASE WHEN p_defer_billing THEN to_jsonb(v_pending) ELSE '[]'::jsonb END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_ce_mercante_rows_atomic(jsonb, uuid, text, text, bigint, boolean, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_ce_mercante_rows_atomic(jsonb, uuid, text, text, bigint, boolean, text, boolean) TO authenticated;

-- 8.2: erro por linha em linguagem de negócio.
CREATE OR REPLACE FUNCTION public._ce_row_error_message(p_sqlstate text, p_message text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_sqlstate IN ('P0010', '22023', 'P0002', 'P0003', 'P0011', 'P0012', '42501') THEN p_message
    WHEN p_sqlstate = '23505' THEN 'Este CE Mercante ou Manifesto já está em outro registro; confira o número.'
    WHEN p_sqlstate IN ('40P01', '40001', '55P03') THEN 'Outra gravação estava usando os mesmos B/Ls; importe de novo.'
    WHEN p_sqlstate = '57014' THEN 'A gravação demorou demais; importe a planilha em partes menores.'
    WHEN p_sqlstate LIKE 'P0%' THEN p_message
    ELSE 'Não foi possível gravar o CE desta linha. Confira o B/L e o CE.'
  END;
$function$;

-- Emissão em lotes conduzida pela tela; o efeito local_billing é a rede.
CREATE OR REPLACE FUNCTION public.emit_ce_mercante_billing(p_bl_ids text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_bl_id text;
  v_one jsonb;
  v_results jsonb := '[]'::jsonb;
  v_status text;
  v_state text;
  v_message text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF cardinality(COALESCE(p_bl_ids, ARRAY[]::text[])) > 50 THEN
    RAISE EXCEPTION 'No máximo 50 B/Ls por lote de emissão.' USING ERRCODE = '22023';
  END IF;

  FOREACH v_bl_id IN ARRAY COALESCE(p_bl_ids, ARRAY[]::text[]) LOOP
    BEGIN
      PERFORM 1 FROM public.bls WHERE id = v_bl_id FOR UPDATE;
      IF NOT FOUND THEN
        v_one := jsonb_build_object('status', 'blocked', 'reason', 'not_found', 'message', 'B/L não encontrado.');
      ELSIF EXISTS (SELECT 1 FROM public.bls WHERE id = v_bl_id AND (cancelled_at IS NOT NULL OR NULLIF(btrim(COALESCE(ce_mercante, '')), '') IS NULL)) THEN
        v_one := jsonb_build_object('status', 'skipped', 'reason', 'no_ce_or_cancelled');
      ELSIF EXISTS (SELECT 1 FROM public.bls WHERE id = v_bl_id AND COALESCE(financial_status, 'pending') <> 'pending')
            OR cardinality(public._live_local_invoice_ids_for_bl(v_bl_id)) > 0 THEN
        v_one := jsonb_build_object('status', 'already_invoiced');
      ELSE
        v_one := public._auto_bill_bl_core(v_bl_id, v_actor, true);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
      v_one := jsonb_build_object('status', 'blocked', 'reason', 'auto_billing_failed',
        'message', public._ce_row_error_message(v_state, v_message), 'sqlstate', v_state);
    END;
    v_status := CASE
      WHEN v_one->>'status' IN ('invoiced', 'already_invoiced') THEN 'invoiced'
      WHEN v_one->>'status' = 'held' THEN 'held'
      WHEN v_one->>'status' = 'skipped' THEN 'skipped'
      ELSE 'blocked'
    END;
    IF v_status = 'blocked' THEN
      -- Alerta por B/L (ADR 0041): a falha não fica escondida no lote.
      BEGIN
        PERFORM public.upsert_billing_alert('billing_auto_issue_failed', v_bl_id,
          format('A emissão automática do B/L %s pelo CE Mercante falhou: %s', v_bl_id, COALESCE(v_one->>'message', 'motivo não informado')),
          jsonb_build_object('bl_id', v_bl_id, 'reason', v_one->>'reason', 'source', 'ce_mercante_planilha'));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Alerta de emissão do B/L % não registrado: %', v_bl_id, SQLERRM;
      END;
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'bl_id', v_bl_id,
      'status', v_status,
      'reason', COALESCE(v_one->>'reason', v_one->>'status'),
      'message', v_one->>'message',
      'invoice_number', (SELECT i.invoice_number FROM public.invoices AS i
        WHERE i.id = ANY(public._live_local_invoice_ids_for_bl(v_bl_id)) ORDER BY i.id DESC LIMIT 1)
    ));
  END LOOP;

  RETURN jsonb_build_object('results', v_results);
END;
$function$;

REVOKE ALL ON FUNCTION public.emit_ce_mercante_billing(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emit_ce_mercante_billing(text[]) TO authenticated;

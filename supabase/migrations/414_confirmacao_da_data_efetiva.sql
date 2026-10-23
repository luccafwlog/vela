-- 414: o operador confirma em Chegadas e Saídas a data efetiva de saída ou de
-- chegada; a data do B/L substitui a saída confirmada (revisão manual de
-- 2026-10-22, itens B1 e B2; ADR 0097).
--
-- Problema:
--   A célula vencida (previsão passada sem data efetiva) só sai do âmbar
--   quando chega o ATD do POL, que vem do Laden on Board do B/L, uma a três
--   semanas depois. O operador não tinha como confirmar a data antes.
--
-- Mudança:
--   1. Tabela `voyage_pol_atd_confirmed`: saída do POL confirmada em Chegadas
--      e Saídas (provisória). Escrita só pela RPC abaixo e pelo recálculo.
--   2. RPC `confirm_schedule_effective_date(p_voyage_id, p_port, p_kind,
--      p_value)`, para usuário interno ativo: `pol` grava o ATD do POL (só a
--      data, como o Laden on Board) e a marca de confirmação; `pod` grava o
--      ATA da escala (data e hora, como no modal da Escala). Recusa Viagem
--      cancelada, porto sem programação, escala omitida ou removida, data no
--      futuro e data efetiva já registrada (a correção é na Viagem).
--   3. `_recompute_voyage_pol_atd` (401): com saída confirmada, o B/L sem
--      Laden on Board não mexe; o B/L com a mesma data só tira a marca; o B/L
--      com data diferente substitui a confirmada, com a justificativa que diz
--      as duas datas (aparece na linha do tempo). A correção manual em
--      Viagens continua vencendo tudo (ADR 0095, decisão 23).
--   4. `voyage_pol_atd_manual_mark` (401): a gravação da confirmação não é
--      correção manual (`vela.atd_confirmed`); uma correção manual depois
--      tira a marca de confirmação.
--
-- Não reescreve nem apaga linhas existentes.
--
-- Rollback: DROP FUNCTION public.confirm_schedule_effective_date(bigint, text,
-- text, text); reaplicar `_recompute_voyage_pol_atd` e
-- `voyage_pol_atd_manual_mark` da 401; DROP TABLE
-- public.voyage_pol_atd_confirmed.

-- 1 -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.voyage_pol_atd_confirmed (
  voyage_id bigint NOT NULL REFERENCES public.voyages(id) ON DELETE CASCADE,
  pol text NOT NULL,
  atd date NOT NULL,
  confirmed_by uuid,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (voyage_id, pol)
);

COMMENT ON TABLE public.voyage_pol_atd_confirmed IS
  'Saída do POL confirmada em Chegadas e Saídas (ADR 0097): provisória, o Laden on Board do B/L a substitui. Escrita só por confirm_schedule_effective_date e _recompute_voyage_pol_atd (414).';

ALTER TABLE public.voyage_pol_atd_confirmed ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voyage_pol_atd_confirmed FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.voyage_pol_atd_confirmed TO authenticated;
GRANT ALL ON public.voyage_pol_atd_confirmed TO service_role;

DROP POLICY IF EXISTS voyage_pol_atd_confirmed_select ON public.voyage_pol_atd_confirmed;
CREATE POLICY voyage_pol_atd_confirmed_select ON public.voyage_pol_atd_confirmed
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
  v_confirmed date;
  v_justification text := p_justification;
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

  -- 414 (ADR 0097): saída confirmada em Chegadas e Saídas é provisória.
  SELECT atd INTO v_confirmed FROM public.voyage_pol_atd_confirmed
  WHERE voyage_id = p_voyage_id AND pol = v_pol;
  IF FOUND THEN
    -- Sem Laden on Board nos B/Ls ativos, a confirmada fica.
    IF v_canonical IS NULL THEN
      RETURN;
    END IF;
    DELETE FROM public.voyage_pol_atd_confirmed WHERE voyage_id = p_voyage_id AND pol = v_pol;
    IF v_canonical <> v_confirmed THEN
      v_justification := format(
        'Data do B/L (Laden on Board %s) substitui a saída confirmada em %s em Chegadas e Saídas (ADR 0097)',
        to_char(v_canonical, 'DD/MM/YYYY'), to_char(v_confirmed, 'DD/MM/YYYY'));
    END IF;
  END IF;

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
  VALUES ('voyage_pol_schedule', v_entity, 'atd', v_current, v_canonical::text, p_actor, v_justification);
  PERFORM set_config('vela.atd_from_bls', COALESCE(v_previous_flag, 'off'), true);
END;
$function$;

REVOKE ALL ON FUNCTION public._recompute_voyage_pol_atd(bigint, text, uuid, text) FROM PUBLIC, anon, authenticated;

-- 4 -------------------------------------------------------------------------
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
  -- 414: a confirmação de Chegadas e Saídas não é correção manual.
  IF current_setting('vela.atd_confirmed', true) = 'on' THEN
    RETURN NULL;
  END IF;
  v_voyage_id := NULLIF(split_part(NEW.entity_id, '::', 1), '')::bigint;
  v_pol := upper(btrim(split_part(NEW.entity_id, '::', 2)));
  IF v_voyage_id IS NULL OR v_pol = '' THEN
    RETURN NULL;
  END IF;

  -- A correção manual supersede a confirmação provisória.
  DELETE FROM public.voyage_pol_atd_confirmed WHERE voyage_id = v_voyage_id AND pol = v_pol;

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

-- 2 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_schedule_effective_date(
  p_voyage_id bigint,
  p_port text,
  p_kind text,
  p_value text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_port text := upper(btrim(COALESCE(p_port, '')));
  v_entity text;
  v_status text;
  v_current text;
  v_forecast text;
  v_date date;
  v_ata timestamp;
  v_role text;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para confirmar a data.' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('pol', 'pod') OR v_port = '' THEN
    RAISE EXCEPTION 'Informe o porto e se é saída ou chegada.' USING ERRCODE = '22023';
  END IF;

  SELECT status INTO v_status FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'Viagem cancelada é somente leitura.' USING ERRCODE = '22023';
  END IF;

  v_entity := p_voyage_id::text || '::' || v_port;
  v_role := public.current_actor_role();

  IF p_kind = 'pol' THEN
    BEGIN
      v_date := btrim(p_value)::date;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Data de saída inválida.' USING ERRCODE = '22023';
    END;
    IF v_date > v_today THEN
      RAISE EXCEPTION 'A data de saída confirmada não pode ser futura.' USING ERRCODE = '22023';
    END IF;
    SELECT new_value INTO v_forecast FROM public.audit_logs
    WHERE entity_type = 'voyage_pol_schedule' AND entity_id = v_entity AND field_name = 'etd'
    ORDER BY changed_at DESC, id DESC LIMIT 1;
    IF NULLIF(btrim(COALESCE(v_forecast, '')), '') IS NULL THEN
      RAISE EXCEPTION 'O porto % não tem saída programada nesta viagem.', v_port USING ERRCODE = '22023';
    END IF;
    SELECT new_value INTO v_current FROM public.audit_logs
    WHERE entity_type = 'voyage_pol_schedule' AND entity_id = v_entity AND field_name = 'atd'
    ORDER BY changed_at DESC, id DESC LIMIT 1;
    IF NULLIF(btrim(COALESCE(v_current, '')), '') IS NOT NULL THEN
      RAISE EXCEPTION 'A saída de % já está registrada; corrija em Viagens → Rotas e Manifestos.', v_port USING ERRCODE = '22023';
    END IF;

    PERFORM set_config('vela.atd_confirmed', 'on', true);
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification, actor_role, actor_department)
    VALUES ('voyage_pol_schedule', v_entity, 'atd', v_current, v_date::text, v_actor, clock_timestamp(),
            'Saída confirmada em Chegadas e Saídas; a data do B/L a substitui se for diferente (ADR 0097)', v_role, v_role);
    PERFORM set_config('vela.atd_confirmed', 'off', true);
    INSERT INTO public.voyage_pol_atd_confirmed (voyage_id, pol, atd, confirmed_by)
    VALUES (p_voyage_id, v_port, v_date, v_actor)
    ON CONFLICT (voyage_id, pol) DO UPDATE
      SET atd = EXCLUDED.atd, confirmed_by = EXCLUDED.confirmed_by, confirmed_at = now();
    RETURN jsonb_build_object('kind', 'pol', 'port', v_port, 'atd', v_date);
  END IF;

  -- Chegada: ATA da escala, com hora (regra do modal da Escala).
  BEGIN
    v_ata := btrim(p_value)::timestamp;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Data e hora de chegada inválidas.' USING ERRCODE = '22023';
  END;
  IF btrim(p_value) !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' THEN
    RAISE EXCEPTION 'Informe a hora da chegada.' USING ERRCODE = '22023';
  END IF;
  IF v_ata::date > v_today THEN
    RAISE EXCEPTION 'A data de chegada confirmada não pode ser futura.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT DISTINCT ON (field_name) field_name, new_value FROM public.audit_logs
      WHERE entity_type = 'voyage_pod_schedule' AND entity_id = v_entity AND field_name IN ('deleted', 'omitted')
      ORDER BY field_name, changed_at DESC, id DESC
    ) s WHERE s.new_value = 'true'
  ) THEN
    RAISE EXCEPTION 'A escala de % foi removida ou omitida.', v_port USING ERRCODE = '22023';
  END IF;
  SELECT new_value INTO v_forecast FROM public.audit_logs
  WHERE entity_type = 'voyage_pod_schedule' AND entity_id = v_entity AND field_name = 'eta'
  ORDER BY changed_at DESC, id DESC LIMIT 1;
  IF NULLIF(btrim(COALESCE(v_forecast, '')), '') IS NULL THEN
    RAISE EXCEPTION 'O porto % não tem chegada programada nesta viagem.', v_port USING ERRCODE = '22023';
  END IF;
  SELECT new_value INTO v_current FROM public.audit_logs
  WHERE entity_type = 'voyage_pod_schedule' AND entity_id = v_entity AND field_name = 'ata'
  ORDER BY changed_at DESC, id DESC LIMIT 1;
  IF NULLIF(btrim(COALESCE(v_current, '')), '') IS NOT NULL THEN
    RAISE EXCEPTION 'A chegada em % já está registrada; corrija na escala, em Viagens.', v_port USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification, actor_role, actor_department)
  VALUES ('voyage_pod_schedule', v_entity, 'ata', v_current, to_char(v_ata, 'YYYY-MM-DD"T"HH24:MI:SS'), v_actor, clock_timestamp(),
          'Chegada confirmada em Chegadas e Saídas (ADR 0097)', v_role, v_role);
  RETURN jsonb_build_object('kind', 'pod', 'port', v_port, 'ata', v_ata);
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_schedule_effective_date(bigint, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_schedule_effective_date(bigint, text, text, text) TO authenticated;

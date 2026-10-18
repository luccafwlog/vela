-- Migration 302: Comunicado nasce "Em envio" (pendente), não "simulado".
--
-- Plano de correção dos e-mails, item 1B (docs/plans/2026-10-17-correcao-dos-emails.md).
-- create_customer_communication_atomic_legacy_070 criava o Comunicado já com
-- status 'simulado', como marcador provisório, e
-- refresh_customer_communication_status devolvia o status atual quando não
-- conseguia decidir. Com a chave de envio ligada, uma queda entre registrar e
-- enviar (rede, tempo esgotado, Edge derrubada) deixava o Comunicado
-- 'simulado' para sempre; a produtora automática e a Régua de Cobrança tratam
-- 'simulado' como feito e não tentavam de novo.
--
-- 1. O CHECK de status aceita 'pendente' (rótulo "Em envio" na tela).
-- 2. O Comunicado novo nasce 'pendente'. A definição abaixo é a vigente
--    (migration 243) com essa única mudança.
-- 3. refresh_customer_communication_status:
--    - sucesso (real ou simulado) junto de tentativa pendente → 'parcial';
--    - só tentativas pendentes, ou falhas ainda com pendentes → 'pendente';
--    - demais regras iguais às da migration 039.
-- 'pendente' não barra a produtora nem o scanner de claims da Régua de
-- Cobrança (ambos só aceitam enviado/simulado/parcial), então um Comunicado
-- interrompido volta a ser tentado.
-- Não altera nem apaga linhas existentes.

ALTER TABLE public.customer_communications
  DROP CONSTRAINT IF EXISTS customer_communications_status_check;
ALTER TABLE public.customer_communications
  ADD CONSTRAINT customer_communications_status_check
  CHECK (status = ANY (ARRAY['pendente'::text, 'enviado'::text, 'simulado'::text, 'falha'::text, 'parcial'::text]));

CREATE OR REPLACE FUNCTION public.create_customer_communication_atomic_legacy_070(p_customer_id bigint, p_kind text, p_nature text, p_anchor_voyage_id bigint DEFAULT NULL::bigint, p_anchor_port text DEFAULT NULL::text, p_anchor_atracacao_id uuid DEFAULT NULL::uuid, p_anchor_invoice_id bigint DEFAULT NULL::bigint, p_attempt_discriminator integer DEFAULT 0, p_dispatch_id uuid DEFAULT NULL::uuid, p_vessel_name text DEFAULT NULL::text, p_voyage_number text DEFAULT NULL::text, p_terminal_name text DEFAULT NULL::text, p_created_by uuid DEFAULT NULL::uuid, p_bl_ids text[] DEFAULT '{}'::text[])
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_communication_id BIGINT;
  v_requested_bls INTEGER := COALESCE(cardinality(p_bl_ids), 0);
  v_valid_bls INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  IF p_attempt_discriminator < 0 THEN
    RAISE EXCEPTION 'O discriminador de tentativa nao pode ser negativo.' USING ERRCODE = '22023';
  END IF;

  IF p_kind IN ('aviso_chegada_noa', 'aviso_prontidao_nor', 'aviso_atracacao_nob')
     AND p_dispatch_id IS NOT NULL THEN
    RAISE EXCEPTION 'Avisos operacionais nao usam dispatch_id.' USING ERRCODE = '22023';
  END IF;

  IF p_kind IN ('institucional', 'livre')
     AND p_dispatch_id IS NULL THEN
    RAISE EXCEPTION 'Comunicado sem ancora exige dispatch_id.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN
    RAISE EXCEPTION 'Cliente nao encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.customer_communication_kinds
    WHERE kind = p_kind AND nature = p_nature
  ) THEN
    RAISE EXCEPTION 'Natureza invalida para o tipo de comunicado.' USING ERRCODE = '22023';
  END IF;

  IF v_requested_bls > 0 THEN
    IF p_kind = 'institucional' THEN
      RAISE EXCEPTION 'Comunicado institucional nao pode conter B/Ls.' USING ERRCODE = '22023';
    END IF;
    SELECT count(*)::INTEGER INTO v_valid_bls
    FROM public.bls
    WHERE id = ANY(p_bl_ids) AND customer_id = p_customer_id;
    IF v_valid_bls <> v_requested_bls THEN
      RAISE EXCEPTION 'B/L fora do cliente do comunicado.' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT id
    INTO v_communication_id
  FROM public.customer_communications
  WHERE kind = p_kind
    AND customer_id = p_customer_id
    AND nature = p_nature
    AND anchor_voyage_id IS NOT DISTINCT FROM p_anchor_voyage_id
    AND anchor_port IS NOT DISTINCT FROM NULLIF(btrim(p_anchor_port), '')
    AND anchor_atracacao_id IS NOT DISTINCT FROM p_anchor_atracacao_id
    AND anchor_invoice_id IS NOT DISTINCT FROM p_anchor_invoice_id
    AND dispatch_id IS NOT DISTINCT FROM p_dispatch_id
    AND attempt_discriminator = p_attempt_discriminator
  ORDER BY id DESC
  LIMIT 1
  FOR UPDATE;

  IF v_communication_id IS NULL THEN
    INSERT INTO public.customer_communications (
      customer_id, kind, nature,
      anchor_voyage_id, anchor_port, anchor_atracacao_id, anchor_invoice_id,
      attempt_discriminator, status, dispatch_id,
      vessel_name, voyage_number, terminal_name, created_by
    )
    VALUES (
      p_customer_id, p_kind, p_nature,
      p_anchor_voyage_id, NULLIF(btrim(p_anchor_port), ''),
      p_anchor_atracacao_id, p_anchor_invoice_id,
      p_attempt_discriminator, 'pendente', p_dispatch_id,
      NULLIF(btrim(p_vessel_name), ''), NULLIF(btrim(p_voyage_number), ''),
      NULLIF(btrim(p_terminal_name), ''), p_created_by
    )
    RETURNING id INTO v_communication_id;
  END IF;

  IF v_requested_bls > 0 THEN
    INSERT INTO public.customer_communication_bls (communication_id, bl_id)
    SELECT v_communication_id, value
    FROM unnest(p_bl_ids) AS requested(value)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_communication_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_customer_communication_status(p_communication_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_current_status text;
  v_real_success integer := 0;
  v_simulated_success integer := 0;
  v_failures integer := 0;
  v_pending integer := 0;
  v_legacy_pending integer := 0;
  v_next_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  SELECT status
    INTO v_current_status
  FROM public.customer_communications
  WHERE id = p_communication_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN NULL; END IF;

  WITH normalized_attempts AS (
    SELECT
      COALESCE(NULLIF(btrim(a.recipient_key), ''), 'legacy:' || lower(btrim(a.recipient_masked))) AS recipient_key,
      a.dispatch_mode,
      a.status,
      a.provider_message_id,
      a.created_at,
      a.id
    FROM public.customer_communication_attempts AS a
    WHERE a.communication_id = p_communication_id
  ), latest_attempts AS (
    SELECT DISTINCT ON (a.recipient_key)
      a.recipient_key,
      a.dispatch_mode,
      a.status,
      a.provider_message_id
    FROM normalized_attempts AS a
    ORDER BY a.recipient_key, a.created_at DESC, a.id DESC
  )
  SELECT
    count(*) FILTER (
      WHERE a.dispatch_mode = 'real'
        AND (a.status = 'entregue' OR (a.status = 'aceito' AND a.provider_message_id IS NOT NULL))
    )::integer,
    count(*) FILTER (
      WHERE a.dispatch_mode = 'simulado'
        AND a.status IN ('aceito', 'entregue')
    )::integer,
    count(*) FILTER (WHERE a.status IN ('bounce', 'complaint', 'falha_transitoria', 'falha_permanente'))::integer,
    count(*) FILTER (
      WHERE a.dispatch_mode = 'real'
        AND a.status = 'aceito'
        AND a.provider_message_id IS NULL
    )::integer,
    count(*) FILTER (WHERE a.dispatch_mode = 'legado')::integer
  INTO v_real_success, v_simulated_success, v_failures, v_pending, v_legacy_pending
  FROM latest_attempts AS a;

  -- Tentativas anteriores à coluna dispatch_mode são inconclusivas: não
  -- podem virar sucesso real nem simulação terminal sem nova confirmação.
  IF v_legacy_pending > 0 THEN
    RETURN v_current_status;
  END IF;

  IF (v_failures > 0 OR v_pending > 0) AND (v_real_success + v_simulated_success) > 0 THEN
    v_next_status := 'parcial';
  ELSIF v_real_success > 0 AND v_simulated_success > 0 THEN
    v_next_status := 'parcial';
  ELSIF v_pending > 0 THEN
    v_next_status := 'pendente';
  ELSIF v_failures > 0 THEN
    v_next_status := 'falha';
  ELSIF v_real_success > 0 THEN
    v_next_status := 'enviado';
  ELSIF v_simulated_success > 0 THEN
    v_next_status := 'simulado';
  ELSE
    -- Nenhuma tentativa: quem chamou decide (a Edge grava falha quando o
    -- envio nem chegou a registrar tentativa).
    RETURN v_current_status;
  END IF;

  UPDATE public.customer_communications
     SET status = v_next_status
   WHERE id = p_communication_id;

  RETURN v_next_status;
END;
$function$;

-- Migration 305: Régua de Cobrança de Demurrage — recusa definitiva, grupo que
-- muda depois de falha, fatura líquida zero, janela de envio, data do ROE e
-- só fatura visível no Portal.
--
-- Plano de correção dos e-mails (docs/plans/2026-10-17-correcao-dos-emails.md),
-- itens 1E.1, 1E.2, 1E.3, 1E.6, 2.5, 4.2, 4.3 e 4.4; decisões D6, D7, D9, D10
-- e D21. As definições abaixo partem das vigentes: claim da migration 256,
-- sendable da 010 e grupo da 011.
--
-- 1. demurrage_dunning_claims ganha failure_count, last_error e
--    resume_generation (aditivo, com default; nenhuma linha é reescrita).
-- 2. _demurrage_dunning_invoice_billable: regra única de "fatura cobrável" para
--    a seleção e a revalidação antes de cada envio. Além do que já valia
--    (emitida, sem baixa, sem Disputa, sem suspensão), exige USD líquido > 0
--    (1E.3), B/L com liberação do Portal/CE (4.4, a mesma de
--    _portal_list_demurrage_invoices_core), Cliente ativo (4.4) e ao menos um
--    contato autorizado por customer_communication_recipient_allowed para
--    cobranca_demurrage (1E.6), em vez das caixas fixas no código.
-- 3. _demurrage_dunning_window_open: só dia útil (calendário business_holidays
--    do Itaú PIX, itau_pix_business_day) a partir das 9h de Brasília (4.2, D9).
--    Fora da janela a rodada não reivindica nada; a cobrança vencida sai na
--    primeira rodada da janela seguinte. O vencimento continua contado do
--    último envio (migration 256).
-- 4. _demurrage_dunning_roe_reference_date: data da cotação vigente em
--    demurrage_invoice_history (4.3), em vez de updated_at.
-- 5. claim_demurrage_dunning_candidates: usa 2, 3 e 4; grava claimed_at no
--    p_as_of da rodada; devolve resume_generation.
-- 6. create_customer_dunning_group_atomic (1E.2): antes de criar o grupo,
--    remove a participação das faturas em grupos da mesma tentativa cujo
--    Comunicado terminou em falha ou não tem tentativa aceita; ao reaproveitar
--    o grupo de mesma composição, recoloca a participação que faltar.
-- 7. Alerta cobranca_demurrage_recusada (Administrativo, D21) e
--    settle_demurrage_dunning_claim, que fecha cada fatura da rodada:
--    - refused: recusa definitiva do provedor. Não libera a claim, grava
--      dunning_suspended_reason e abre o alerta (1E.1, D6);
--    - failed: libera a claim, conta a falha e abre o alerta na 3ª seguida
--      da mesma tentativa (2.5);
--    - paused: libera a claim sem contar falha;
--    - partial: mantém a claim; com motivo, abre o alerta;
--    - sent: mantém a claim e fecha o alerta de falha repetida.
-- 8. Resolver o alerta em /alertas retoma a cobrança suspensa pela recusa:
--    tira a suspensão, devolve a posição (mesmo discriminador) e incrementa
--    resume_generation, que entra na chave de idempotência do e-mail para a
--    retomada chamar o provedor de novo.
--
-- Não reescreve nem apaga linhas na aplicação da migration.

ALTER TABLE public.demurrage_dunning_claims
  ADD COLUMN IF NOT EXISTS failure_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS resume_generation integer NOT NULL DEFAULT 0;

ALTER TABLE public.demurrage_dunning_claims
  DROP CONSTRAINT IF EXISTS demurrage_dunning_claims_counters_check;
ALTER TABLE public.demurrage_dunning_claims
  ADD CONSTRAINT demurrage_dunning_claims_counters_check CHECK (failure_count >= 0 AND resume_generation >= 0);

INSERT INTO public.alert_type_catalog (type, severity, responsible_department, audience_departments, default_destination)
VALUES ('cobranca_demurrage_recusada', 'normal', 'administrativo', ARRAY['administrativo'], '/demurrage')
ON CONFLICT (type) DO NOTHING;

-- USD líquido com a regra de apply_demurrage_discount (src/services/demurrage/demurrageNetUsd.ts).
CREATE OR REPLACE FUNCTION public._demurrage_invoice_net_usd(p_total_usd numeric, p_discount_mode text, p_discount_value numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  SELECT GREATEST(
    COALESCE(p_total_usd, 0) - CASE
      WHEN p_discount_value IS NULL OR p_discount_value <= 0 THEN 0
      WHEN p_discount_mode = 'percent' THEN round(COALESCE(p_total_usd, 0) * LEAST(round(p_discount_value, 2), 100) / 100, 2)
      ELSE round(p_discount_value, 2)
    END,
    0
  );
$function$;

REVOKE ALL ON FUNCTION public._demurrage_invoice_net_usd(numeric, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._demurrage_invoice_net_usd(numeric, text, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public._demurrage_dunning_invoice_billable(p_invoice_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.demurrage_invoices AS di
    JOIN public.customers AS c ON c.id = di.customer_id
    WHERE di.id = p_invoice_id
      AND COALESCE(di.status, 'issued') IN ('issued', 'overdue')
      AND di.dunning_suspended_reason IS NULL
      AND di.first_billed_at IS NOT NULL
      AND di.paid_at IS NULL
      AND COALESCE(di.dispute_open, false) = false
      -- 1E.3: fatura com 100% de desconto não tem o que cobrar.
      AND public._demurrage_invoice_net_usd(di.total_usd, di.discount_mode, di.discount_value) > 0
      -- 4.4 (D10): só fatura que o Cliente vê no Portal e de Cliente ativo.
      AND c.deactivated_at IS NULL
      AND public.bl_has_portal_release(di.bl_id)
      -- 1E.6: o mesmo critério de destinatário do envio (caixa ativa ligada a
      -- cobranca_demurrage, contato ativo, e-mail válido, sem supressão).
      AND EXISTS (
        SELECT 1 FROM public.customer_contacts AS cc
        WHERE cc.customer_id = di.customer_id
          AND cc.deactivated_at IS NULL
          AND public.customer_communication_recipient_allowed(di.customer_id, cc.id, 'cobranca_demurrage', 'caixa', NULL)
      )
  );
$function$;

REVOKE ALL ON FUNCTION public._demurrage_dunning_invoice_billable(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._demurrage_dunning_invoice_billable(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public._demurrage_dunning_window_open(p_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  -- D9: dia útil (sem fim de semana nem feriado de business_holidays) a partir
  -- das 9h de Brasília. ponytail: sem o ano cadastrado, feriado conta como dia
  -- útil, como no Itaú PIX (alerta calendario_feriados_pendente).
  SELECT public.itau_pix_business_day((COALESCE(p_at, now()) AT TIME ZONE 'America/Sao_Paulo')::date)
    AND (COALESCE(p_at, now()) AT TIME ZONE 'America/Sao_Paulo')::time >= time '09:00';
$function$;

REVOKE ALL ON FUNCTION public._demurrage_dunning_window_open(timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._demurrage_dunning_window_open(timestamp with time zone) TO service_role;

CREATE OR REPLACE FUNCTION public._demurrage_dunning_roe_reference_date(p_invoice_id bigint, p_current_roe numeric)
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  -- 4.3: a data da cotação é a primeira foto do ROE vigente, depois da última
  -- foto com outro ROE. Fotos de desconto repetem o ROE e ficam depois; a foto
  -- do pagamento não entra.
  SELECT min(h.event_date)
  FROM public.demurrage_invoice_history AS h
  WHERE h.invoice_id = p_invoice_id
    AND h.source <> 'payment'
    AND h.roe_used = p_current_roe
    AND h.event_date >= COALESCE((
      SELECT max(other.event_date)
      FROM public.demurrage_invoice_history AS other
      WHERE other.invoice_id = p_invoice_id
        AND other.source <> 'payment'
        AND other.roe_used IS DISTINCT FROM p_current_roe
    ), '-infinity'::date);
$function$;

REVOKE ALL ON FUNCTION public._demurrage_dunning_roe_reference_date(bigint, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._demurrage_dunning_roe_reference_date(bigint, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_demurrage_dunning_candidates(p_as_of timestamp with time zone DEFAULT now(), p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice RECORD;
  v_interval_days INTEGER;
  v_limit INTEGER;
  v_inserted INTEGER;
  v_claimed_at TIMESTAMPTZ;
  v_resume_generation INTEGER;
  v_as_of TIMESTAMPTZ := COALESCE(p_as_of, now());
  v_candidates JSONB := '[]'::JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NOT NULL AND p_limit < 1 THEN
    RAISE EXCEPTION 'O limite do lote deve ser positivo.' USING ERRCODE = '22023';
  END IF;
  v_limit := LEAST(COALESCE(p_limit, 50), 100);
  SELECT GREATEST(COALESCE(demurrage_dunning_interval_days, 7), 1) INTO v_interval_days FROM public.app_settings WHERE id = 1;
  v_interval_days := COALESCE(v_interval_days, 7);

  UPDATE public.demurrage_dunning_claims AS claim
  SET released_at = v_as_of
  WHERE claim.released_at IS NULL
    AND claim.claimed_at < v_as_of - interval '30 minutes'
    AND NOT EXISTS (
      SELECT 1
      FROM public.customer_communications AS comm
      WHERE comm.kind = 'cobranca_demurrage'
        AND comm.status IN ('enviado', 'simulado', 'parcial')
        AND (
          EXISTS (
            SELECT 1
            FROM public.customer_communication_dunning_invoices AS membership
            WHERE membership.communication_id = comm.id
              AND membership.demurrage_invoice_id = claim.demurrage_invoice_id
              AND membership.attempt_discriminator = claim.attempt_discriminator
          )
          OR (
            NOT EXISTS (
              SELECT 1 FROM public.customer_communication_dunning_groups AS grouped
              WHERE grouped.communication_id = comm.id
            )
            AND comm.attempt_discriminator = claim.attempt_discriminator
            AND (
              comm.anchor_invoice_id = claim.demurrage_invoice_id
              OR EXISTS (
                SELECT 1
                FROM public.customer_communication_bls AS bl
                JOIN public.demurrage_invoices AS di ON di.bl_id = bl.bl_id
                WHERE bl.communication_id = comm.id AND di.id = claim.demurrage_invoice_id
              )
            )
          )
        )
    );

  -- D9: fora de dia útil ou antes das 9h de Brasília nenhuma cobrança sai.
  IF NOT public._demurrage_dunning_window_open(v_as_of) THEN
    RETURN v_candidates;
  END IF;

  FOR v_invoice IN
    SELECT di.id, di.customer_id, di.bl_id, di.doc_number, di.total_usd, di.current_total_brl,
      di.current_roe, di.roe_source, di.first_billed_at,
      COALESCE(claims.claimed_at, v_as_of) AS claimed_at,
      COALESCE(
        public._demurrage_dunning_roe_reference_date(di.id, di.current_roe),
        di.updated_at::DATE, di.doc_date, CURRENT_DATE
      )::TEXT AS roe_reference_date,
      COALESCE(claims.attempt_count, 0)::INTEGER + 1 AS attempt_discriminator
    FROM public.demurrage_invoices AS di
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE prior_claim.released_at IS NULL)::INTEGER AS attempt_count,
        max(prior_claim.claimed_at) FILTER (WHERE prior_claim.released_at IS NULL) AS claimed_at
      FROM public.demurrage_dunning_claims AS prior_claim
      WHERE prior_claim.demurrage_invoice_id = di.id
    ) AS claims ON true
    WHERE COALESCE(di.status, 'issued') IN ('issued', 'overdue')
      AND di.dunning_suspended_reason IS NULL
      AND di.first_billed_at IS NOT NULL AND di.paid_at IS NULL
      AND COALESCE(di.dispute_open, false) = false
      AND public._demurrage_dunning_invoice_billable(di.id)
      -- A15: a 1ª cobrança vence na emissão; as seguintes, um intervalo depois do
      -- dia do último envio (São Paulo). Depois de uma pausa sai uma cobrança e as
      -- seguintes seguem o intervalo normal, sem recuperar as "atrasadas".
      AND v_as_of >= CASE
        WHEN COALESCE(claims.attempt_count, 0) = 0
          THEN di.first_billed_at::TIMESTAMP AT TIME ZONE 'America/Sao_Paulo'
        ELSE ((claims.claimed_at AT TIME ZONE 'America/Sao_Paulo')::DATE + v_interval_days)::TIMESTAMP AT TIME ZONE 'America/Sao_Paulo'
      END
    ORDER BY di.id
    LIMIT v_limit
    FOR UPDATE OF di SKIP LOCKED
  LOOP
    v_inserted := 0;
    v_claimed_at := NULL;
    v_resume_generation := NULL;
    INSERT INTO public.demurrage_dunning_claims (demurrage_invoice_id, attempt_discriminator, claimed_at)
    VALUES (v_invoice.id, v_invoice.attempt_discriminator, v_as_of)
    ON CONFLICT (demurrage_invoice_id, attempt_discriminator) DO UPDATE
      SET claimed_at = v_as_of, released_at = NULL
      WHERE demurrage_dunning_claims.released_at IS NOT NULL
    RETURNING claimed_at, resume_generation INTO v_claimed_at, v_resume_generation;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 1 THEN
      v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
        'invoice_id', v_invoice.id, 'customer_id', v_invoice.customer_id, 'bl_id', v_invoice.bl_id,
        'doc_number', v_invoice.doc_number, 'total_usd', v_invoice.total_usd,
        'current_total_brl', v_invoice.current_total_brl, 'current_roe', v_invoice.current_roe,
        'roe_source', v_invoice.roe_source, 'first_billed_at', v_invoice.first_billed_at,
        'claimed_at', v_claimed_at, 'roe_reference_date', v_invoice.roe_reference_date,
        'attempt_discriminator', v_invoice.attempt_discriminator,
        'resume_generation', COALESCE(v_resume_generation, 0)
      ));
    END IF;
  END LOOP;
  RETURN v_candidates;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_demurrage_dunning_candidates(timestamp with time zone, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_demurrage_dunning_candidates(timestamp with time zone, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.demurrage_dunning_candidate_sendable(p_invoice_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF p_invoice_id IS NULL THEN
    RETURN false;
  END IF;
  -- A mesma regra da seleção, antes de cada destinatário.
  RETURN public._demurrage_dunning_invoice_billable(p_invoice_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.demurrage_dunning_candidate_sendable(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.demurrage_dunning_candidate_sendable(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.create_customer_dunning_group_atomic(p_customer_id bigint,
p_attempt_discriminator integer,p_invoice_ids bigint[],p_anchor_voyage_id bigint DEFAULT NULL,
p_anchor_port text DEFAULT NULL,p_vessel_name text DEFAULT NULL,p_voyage_number text DEFAULT NULL,
p_terminal_name text DEFAULT NULL) RETURNS bigint
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  v_invoice_ids bigint[];
  v_invoice_count integer;
  v_bl_ids text[];
  v_group_key text;
  v_dispatch_id uuid;
  v_communication_id bigint;
  v_existing bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF p_customer_id IS NULL OR p_attempt_discriminator IS NULL OR p_attempt_discriminator < 0
     OR p_invoice_ids IS NULL OR cardinality(p_invoice_ids) = 0 THEN
    RAISE EXCEPTION 'Cliente, tentativa e invoices são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  -- Serializa grupos do mesmo cliente e evita duas comunicações diferentes
  -- durante o primeiro claim do mesmo ciclo.
  PERFORM 1 FROM public.customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  SELECT array_agg(invoice_id ORDER BY invoice_id), count(*)::integer
    INTO v_invoice_ids, v_invoice_count
  FROM (SELECT DISTINCT value AS invoice_id FROM unnest(p_invoice_ids) AS requested(value)) AS distinct_ids;
  IF v_invoice_count <> cardinality(p_invoice_ids) THEN
    RAISE EXCEPTION 'A composição do grupo contém invoice duplicada.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::integer, array_agg(di.bl_id ORDER BY di.id)
    INTO v_invoice_count, v_bl_ids
  FROM public.demurrage_invoices AS di
  WHERE di.id = ANY(v_invoice_ids) AND di.customer_id = p_customer_id;
  IF v_invoice_count <> cardinality(v_invoice_ids) THEN
    RAISE EXCEPTION 'Invoice fora do cliente do comunicado.' USING ERRCODE = '42501';
  END IF;

  v_group_key := md5(format('%s:%s:%s', p_customer_id, p_attempt_discriminator, array_to_string(v_invoice_ids, ',')));
  v_dispatch_id := format('%s-%s-%s-%s-%s',
    substr(v_group_key, 1, 8), substr(v_group_key, 9, 4),
    substr(v_group_key, 13, 4), substr(v_group_key, 17, 4), substr(v_group_key, 21, 12)
  )::uuid;

  -- 1E.2: um grupo da mesma tentativa que não chegou ao Cliente (Comunicado em
  -- falha, ou sem tentativa aceita) não segura a fatura. Sem isto, nova fatura
  -- emitida, fatura paga ou pausa mudam a composição e o índice único
  -- (fatura, tentativa) recusa o grupo novo a cada rodada. O grupo que já foi
  -- aceito pelo provedor (ou simulado) mantém a participação: a colisão segue
  -- recusada, para não cobrar a mesma tentativa duas vezes.
  -- ponytail: tentativa 'aceito' sem id do provedor (queda entre registrar e
  -- enviar) conta como aceita; o grupo fica recusado até a régua avançar.
  DELETE FROM public.customer_communication_dunning_invoices AS membership
  USING public.customer_communications AS comm
  WHERE membership.communication_id = comm.id
    AND membership.demurrage_invoice_id = ANY(v_invoice_ids)
    AND membership.attempt_discriminator = p_attempt_discriminator
    AND NOT EXISTS (
      SELECT 1 FROM public.customer_communication_dunning_groups AS same_group
      WHERE same_group.communication_id = membership.communication_id
        AND same_group.customer_id = p_customer_id
        AND same_group.attempt_discriminator = p_attempt_discriminator
        AND same_group.group_key = v_group_key
    )
    AND (
      comm.status = 'falha'
      OR NOT EXISTS (
        SELECT 1 FROM public.customer_communication_attempts AS attempt
        WHERE attempt.communication_id = comm.id
          AND attempt.status IN ('aceito', 'entregue', 'bounce', 'complaint')
      )
    );

  SELECT communication_id INTO v_existing
  FROM public.customer_communication_dunning_groups
  WHERE customer_id = p_customer_id
    AND attempt_discriminator = p_attempt_discriminator
    AND group_key = v_group_key
  FOR UPDATE;
  IF v_existing IS NOT NULL THEN
    -- A participação pode ter saído quando outra composição foi tentada depois.
    INSERT INTO public.customer_communication_dunning_invoices (
      communication_id, demurrage_invoice_id, customer_id, attempt_discriminator
    )
    SELECT v_existing, invoice_id, p_customer_id, p_attempt_discriminator
    FROM unnest(v_invoice_ids) AS requested(invoice_id)
    ON CONFLICT (communication_id, demurrage_invoice_id) DO NOTHING;
    RETURN v_existing;
  END IF;

  v_communication_id := public.create_customer_communication_atomic(
    p_customer_id,
    'cobranca_demurrage',
    'demurrage',
    p_anchor_voyage_id,
    p_anchor_port,
    NULL,
    v_invoice_ids[1],
    p_attempt_discriminator,
    v_dispatch_id,
    p_vessel_name,
    p_voyage_number,
    p_terminal_name,
    NULL,
    v_bl_ids
  );

  INSERT INTO public.customer_communication_dunning_groups (
    communication_id, customer_id, attempt_discriminator, group_key
  ) VALUES (
    v_communication_id, p_customer_id, p_attempt_discriminator, v_group_key
  );

  INSERT INTO public.customer_communication_dunning_invoices (
    communication_id, demurrage_invoice_id, customer_id, attempt_discriminator
  )
  SELECT v_communication_id, invoice_id, p_customer_id, p_attempt_discriminator
  FROM unnest(v_invoice_ids) AS requested(invoice_id);

  UPDATE public.customer_communications
  SET origin = 'automatico'
  WHERE id = v_communication_id;

  RETURN v_communication_id;
END;
$function$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.create_customer_dunning_group_atomic(bigint, integer, bigint[], bigint, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_dunning_group_atomic(bigint, integer, bigint[], bigint, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.settle_demurrage_dunning_claim(
  p_invoice_id bigint,
  p_attempt_discriminator integer,
  p_outcome text,
  p_reason text DEFAULT NULL
)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := left(NULLIF(btrim(p_reason), ''), 500);
  v_failures integer;
  v_invoice record;
  v_message text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF p_invoice_id IS NULL OR p_attempt_discriminator IS NULL OR p_attempt_discriminator < 1 THEN
    RAISE EXCEPTION 'Invoice e posição da régua são obrigatórios.' USING ERRCODE = '22023';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('sent', 'partial', 'failed', 'refused', 'paused') THEN
    RAISE EXCEPTION 'Desfecho da cobrança inválido.' USING ERRCODE = '22023';
  END IF;

  SELECT di.id, di.doc_number, di.customer_id, c.name AS customer_name, di.dunning_suspended_reason
    INTO v_invoice
  FROM public.demurrage_invoices AS di
  LEFT JOIN public.customers AS c ON c.id = di.customer_id
  WHERE di.id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demurrage invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF p_outcome = 'paused' THEN
    UPDATE public.demurrage_dunning_claims
    SET released_at = COALESCE(released_at, now()), last_error = COALESCE(v_reason, last_error)
    WHERE demurrage_invoice_id = p_invoice_id AND attempt_discriminator = p_attempt_discriminator;
    RETURN FOUND;
  END IF;

  IF p_outcome = 'sent' THEN
    -- O alerta de falha repetida fecha quando a cobrança sai. O de recusa
    -- definitiva só fecha pela pessoa (é o que retoma a fatura suspensa).
    IF v_invoice.dunning_suspended_reason IS NULL THEN
      BEGIN
        PERFORM public.resolve_alert_item('cobranca_demurrage_recusada', 'demurrage_invoice', p_invoice_id::text,
          'demurrage_dunning', jsonb_build_object('attempt_discriminator', p_attempt_discriminator));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Alerta cobranca_demurrage_recusada da invoice % nao fechado: %', p_invoice_id, SQLERRM;
      END;
    END IF;
    RETURN true;
  END IF;

  IF p_outcome = 'partial' THEN
    IF v_reason IS NOT NULL THEN
      v_message := 'Invoice ' || v_invoice.doc_number || ' (Cliente ' || COALESCE(v_invoice.customer_name, v_invoice.customer_id::text)
        || '): a cobrança saiu para parte dos contatos; o provedor recusou em definitivo os demais (' || v_reason || '). Corrija o e-mail do contato.';
    END IF;
  ELSE
    UPDATE public.demurrage_dunning_claims
    SET failure_count = failure_count + 1,
        last_error = COALESCE(v_reason, last_error),
        released_at = CASE WHEN p_outcome = 'failed' THEN COALESCE(released_at, now()) ELSE released_at END
    WHERE demurrage_invoice_id = p_invoice_id AND attempt_discriminator = p_attempt_discriminator
    RETURNING failure_count INTO v_failures;
    IF NOT FOUND THEN
      RETURN false;
    END IF;

    IF p_outcome = 'refused' THEN
      -- 1E.1 (D6): a claim fica consumida e a fatura sai da Régua até a pessoa
      -- corrigir o contato e resolver o alerta.
      UPDATE public.demurrage_invoices
      SET dunning_suspended_reason = 'Cobrança recusada pelo provedor: ' || COALESCE(v_reason, 'recusa definitiva')
      WHERE id = p_invoice_id AND dunning_suspended_reason IS NULL;
      v_message := 'Invoice ' || v_invoice.doc_number || ' (Cliente ' || COALESCE(v_invoice.customer_name, v_invoice.customer_id::text)
        || '): o provedor recusou a cobrança em definitivo (' || COALESCE(v_reason, 'sem motivo') || '). A Régua suspendeu esta Invoice; '
        || 'corrija o contato do Cliente e resolva este alerta para retomar.';
    ELSIF v_failures >= 3 THEN
      -- 2.5: falha passageira repetida (rede, tempo esgotado, 5xx, configuração do provedor).
      v_message := 'Invoice ' || v_invoice.doc_number || ' (Cliente ' || COALESCE(v_invoice.customer_name, v_invoice.customer_id::text)
        || '): ' || v_failures || ' falhas seguidas no envio da cobrança (' || COALESCE(v_reason, 'sem motivo') || '). '
        || 'A Régua segue tentando a cada rodada; o alerta fecha quando a cobrança sair.';
    END IF;
  END IF;

  IF v_message IS NOT NULL THEN
    -- Falha no alerta não desfaz a decisão da claim.
    BEGIN
      PERFORM public.upsert_alert_item(
        'cobranca_demurrage_recusada', 'demurrage_invoice', p_invoice_id::text, v_message, 'demurrage_dunning',
        jsonb_build_object('invoice_id', p_invoice_id, 'customer_id', v_invoice.customer_id,
          'attempt_discriminator', p_attempt_discriminator, 'outcome', p_outcome,
          'failure_count', v_failures, 'reason', v_reason),
        '/demurrage'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Alerta cobranca_demurrage_recusada da invoice % nao gravado: %', p_invoice_id, SQLERRM;
    END;
  END IF;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.settle_demurrage_dunning_claim(bigint, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_demurrage_dunning_claim(bigint, integer, text, text) TO service_role;

-- 1E.1: resolver o alerta de recusa retoma a cobrança suspensa por ela.
CREATE OR REPLACE FUNCTION public.resume_demurrage_dunning_on_alert_resolved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_entity_type text;
  v_entity_id text;
  v_invoice_id bigint;
BEGIN
  IF NEW.item_type IS DISTINCT FROM 'cobranca_demurrage_recusada'
     OR NEW.status IS DISTINCT FROM 'resolved'
     OR OLD.status IS NOT DISTINCT FROM 'resolved' THEN
    RETURN NEW;
  END IF;

  SELECT a.entity_type, a.entity_id INTO v_entity_type, v_entity_id
  FROM public.alerts AS a WHERE a.id = NEW.alert_id;
  IF v_entity_type IS DISTINCT FROM 'demurrage_invoice' OR v_entity_id !~ '^[0-9]+$' THEN
    RETURN NEW;
  END IF;
  v_invoice_id := v_entity_id::bigint;

  UPDATE public.demurrage_invoices
  SET dunning_suspended_reason = NULL
  WHERE id = v_invoice_id
    AND dunning_suspended_reason LIKE 'Cobrança recusada pelo provedor%';
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Retoma no mesmo discriminador; a nova geração muda a chave de
  -- idempotência do e-mail, para a tentativa recusada não ser reaproveitada.
  UPDATE public.demurrage_dunning_claims AS claim
  SET released_at = COALESCE(claim.released_at, now()),
      resume_generation = claim.resume_generation + 1
  WHERE claim.demurrage_invoice_id = v_invoice_id
    AND claim.attempt_discriminator = (
      SELECT max(latest.attempt_discriminator) FROM public.demurrage_dunning_claims AS latest
      WHERE latest.demurrage_invoice_id = v_invoice_id
    );
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.resume_demurrage_dunning_on_alert_resolved() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS resume_demurrage_dunning_on_alert_resolved ON public.alert_items;
CREATE TRIGGER resume_demurrage_dunning_on_alert_resolved
  AFTER UPDATE OF status ON public.alert_items
  FOR EACH ROW
  WHEN (NEW.item_type = 'cobranca_demurrage_recusada' AND NEW.status = 'resolved' AND OLD.status = 'active')
  EXECUTE FUNCTION public.resume_demurrage_dunning_on_alert_resolved();

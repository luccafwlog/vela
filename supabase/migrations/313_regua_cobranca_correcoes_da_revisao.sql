-- Migration 313: Régua de Cobrança de Demurrage — correções da revisão do PR #973.
--
-- Plano de correção dos e-mails (docs/plans/2026-10-17-correcao-dos-emails.md),
-- itens 1E, 4.1 e 4.4; decisões D6, D7 e D10. Parte das definições das
-- migrations 305 (Régua), 306 (desconto integral), 238 (resolver com
-- justificativa) e 002 (aviso do Portal e leitura da Régua).
--
-- Data status: esta migration reescreve linhas existentes (item 6) e depende
-- da afirmação "Data status" da seção Gotchas do AGENTS.md: o banco de
-- produção só tem dados de teste. Se a afirmação tiver sido revogada quando
-- você ler isto, revise o item 6 antes de aplicar: ele quita faturas.
--
-- 1. cobranca_demurrage_recusada entra em _alert_types_resolved_with_justification():
--    a Invoice suspensa pela recusa definitiva (D6) só volta à Régua quando o
--    alerta vira resolved, e nenhuma tela conseguia resolvê-lo (a 305 contava
--    com isso). Espelho em src/services/alerts.ts.
-- 2. _demurrage_dunning_block_reason: o motivo de a Invoice não ser cobrável
--    agora, ou NULL. É a regra única de _demurrage_dunning_invoice_billable
--    (seleção e revalidação) e alimenta a coluna Régua por
--    list_demurrage_dunning_claim_statuses. Além da regra da 305, exige ROE
--    vigente e navio/viagem do B/L: sem eles a mensagem não se compõe e a
--    Invoice voltava a cada rodada.
-- 3. claim_demurrage_dunning_candidates: a varredura de claims órfãs (30 min)
--    não libera a claim de Invoice suspensa por recusa definitiva; quem libera
--    é a resolução do alerta (305).
-- 4. settle_demurrage_dunning_claim ganha p_communication_id: no desfecho
--    paused, a Invoice sai do Comunicado em que foi pausada. Sem isso a
--    participação ficava no grupo já aceito pelo provedor e, quando a Invoice
--    voltava agrupada de outro jeito na mesma etapa, o índice único
--    (fatura, tentativa) da migration 011 recusava o grupo a cada rodada.
--    A assinatura antiga (4 argumentos) é removida.
-- 5. notify_demurrage_issued só avisa o Cliente na emissão. Cancelar a baixa
--    (paid → issued), inclusive de uma Invoice isenta (D7), não é "Nova fatura".
-- 6. Invoices emitidas antes da 306 com desconto igual ao total (USD líquido
--    zero) viram quitadas/isentas como a 306 faria: paid na data do último
--    desconto (Brasília), BRL zero, sem PIX, foto 'payment' e auditoria
--    discount_exemption. Invoice com restituição não é tocada.
-- 7. list_demurrage_dunning_claim_statuses devolve uma linha por Invoice pedida
--    (contador zero sem claim) e pause_reason (item 2). Muda o retorno: DROP e
--    CREATE, com os mesmos grants.

-- 1. Resolver com justificativa.
CREATE OR REPLACE FUNCTION public._alert_types_resolved_with_justification()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT ARRAY['portal_abuso_login', 'bl_vehicles_changed_on_reimport', 'ce_trocado_com_desbloqueio',
    'cobranca_demurrage_recusada']::text[];
$function$;

-- 2. Motivo de a Invoice não ser cobrável agora.
CREATE OR REPLACE FUNCTION public._demurrage_dunning_block_reason(p_invoice_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
BEGIN
  SELECT di.id, di.customer_id, di.bl_id, di.status, di.paid_at, di.first_billed_at,
    di.dunning_suspended_reason, di.dispute_open, di.total_usd, di.discount_mode, di.discount_value,
    di.current_roe, c.deactivated_at AS customer_deactivated_at,
    voy.voyage_number, vessel.name AS vessel_name
    INTO r
  FROM public.demurrage_invoices AS di
  JOIN public.customers AS c ON c.id = di.customer_id
  LEFT JOIN public.bls AS b ON b.id = di.bl_id
  LEFT JOIN public.voyages AS voy ON voy.id = b.voyage_id
  LEFT JOIN public.vessels AS vessel ON vessel.id = voy.vessel_id
  WHERE di.id = p_invoice_id;
  IF NOT FOUND THEN
    RETURN 'Invoice não encontrada';
  END IF;

  -- Os textos aparecem na coluna Régua como "Pausada: <motivo>".
  IF r.status = 'cancelled' THEN RETURN 'cancelada'; END IF;
  IF r.paid_at IS NOT NULL OR r.status = 'paid' THEN RETURN 'liquidada'; END IF;
  IF COALESCE(r.status, 'issued') NOT IN ('issued', 'overdue') OR r.first_billed_at IS NULL THEN
    RETURN 'não emitida';
  END IF;
  IF r.dunning_suspended_reason IS NOT NULL THEN RETURN 'suspensa, aguarda tratamento'; END IF;
  IF COALESCE(r.dispute_open, false) THEN RETURN 'disputa aberta'; END IF;
  -- 1E.3: fatura com 100% de desconto não tem o que cobrar.
  IF public._demurrage_invoice_net_usd(r.total_usd, r.discount_mode, r.discount_value) <= 0 THEN
    RETURN 'valor líquido zero';
  END IF;
  -- 4.4 (D10): só fatura que o Cliente vê no Portal e de Cliente ativo.
  IF r.customer_deactivated_at IS NOT NULL THEN RETURN 'Cliente desativado'; END IF;
  IF NOT public.bl_has_portal_release(r.bl_id) THEN
    RETURN 'B/L sem CE Mercante, a Invoice não aparece no Portal';
  END IF;
  -- O e-mail mostra ROE, navio e viagem por Invoice; sem eles não se compõe.
  IF r.current_roe IS NULL OR r.current_roe <= 0 THEN RETURN 'Invoice sem ROE vigente'; END IF;
  IF NULLIF(btrim(COALESCE(r.voyage_number, '')), '') IS NULL OR NULLIF(btrim(COALESCE(r.vessel_name, '')), '') IS NULL THEN
    RETURN 'B/L sem navio ou viagem';
  END IF;
  -- 1E.6: o mesmo critério de destinatário do envio.
  IF NOT EXISTS (
    SELECT 1 FROM public.customer_contacts AS cc
    WHERE cc.customer_id = r.customer_id
      AND cc.deactivated_at IS NULL
      AND public.customer_communication_recipient_allowed(r.customer_id, cc.id, 'cobranca_demurrage', 'caixa', NULL)
  ) THEN
    RETURN 'Cliente sem contato autorizado para a cobrança';
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public._demurrage_dunning_block_reason(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._demurrage_dunning_block_reason(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public._demurrage_dunning_invoice_billable(p_invoice_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  SELECT public._demurrage_dunning_block_reason(p_invoice_id) IS NULL;
$function$;

REVOKE ALL ON FUNCTION public._demurrage_dunning_invoice_billable(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._demurrage_dunning_invoice_billable(bigint) TO service_role;

-- 3. Seleção da rodada: a definição da 305 com a varredura que preserva a recusa.
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
    -- 1E.1 (D6): a claim da recusa definitiva fica consumida até a pessoa
    -- resolver o alerta (resume_demurrage_dunning_on_alert_resolved, 305).
    AND NOT EXISTS (
      SELECT 1 FROM public.demurrage_invoices AS suspended
      WHERE suspended.id = claim.demurrage_invoice_id
        AND suspended.dunning_suspended_reason LIKE 'Cobrança recusada pelo provedor%'
    )
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

  -- ponytail: o lote é por Invoice (ORDER BY id, LIMIT), não por Cliente. Com
  -- mais Invoices vencidas que o lote, as de um mesmo Cliente e etapa podem
  -- cair em rodadas diferentes e o Cliente recebe dois e-mails da mesma etapa.
  -- Melhoria: ordenar por Cliente e completar o Cliente que começou no lote.
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

-- 4. Desfecho da fatura na rodada, com o Comunicado em que ela estava.
DROP FUNCTION IF EXISTS public.settle_demurrage_dunning_claim(bigint, integer, text, text);

CREATE OR REPLACE FUNCTION public.settle_demurrage_dunning_claim(
  p_invoice_id bigint,
  p_attempt_discriminator integer,
  p_outcome text,
  p_reason text DEFAULT NULL,
  p_communication_id bigint DEFAULT NULL
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
    -- A fatura pausada não foi cobrada neste Comunicado: sai dele, para voltar
    -- em outra composição na mesma etapa sem colidir com o índice único
    -- (fatura, tentativa). O registro do Comunicado e das tentativas fica.
    IF p_communication_id IS NOT NULL THEN
      DELETE FROM public.customer_communication_dunning_invoices
      WHERE communication_id = p_communication_id
        AND demurrage_invoice_id = p_invoice_id
        AND attempt_discriminator = p_attempt_discriminator;
    END IF;
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
      -- corrigir o contato e resolver o alerta com justificativa.
      UPDATE public.demurrage_invoices
      SET dunning_suspended_reason = 'Cobrança recusada pelo provedor: ' || COALESCE(v_reason, 'recusa definitiva')
      WHERE id = p_invoice_id AND dunning_suspended_reason IS NULL;
      v_message := 'Invoice ' || v_invoice.doc_number || ' (Cliente ' || COALESCE(v_invoice.customer_name, v_invoice.customer_id::text)
        || '): o provedor recusou a cobrança em definitivo (' || COALESCE(v_reason, 'sem motivo') || '). A Régua suspendeu esta Invoice; '
        || 'corrija o contato do Cliente e resolva este alerta com justificativa para retomar.';
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

REVOKE ALL ON FUNCTION public.settle_demurrage_dunning_claim(bigint, integer, text, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_demurrage_dunning_claim(bigint, integer, text, text, bigint) TO service_role;

-- 5. Aviso "Nova fatura de demurrage" só na emissão (002 avisava em toda
-- passagem para issued, inclusive no cancelamento da baixa).
CREATE OR REPLACE FUNCTION public.notify_demurrage_issued()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Emissão é inserção já emitida ou rascunho/cancelada que passa a emitida,
  -- como em assert_demurrage_invoice_row. Vencida, paga ou isenta que volta a
  -- issued é a mesma fatura que o Cliente já conhece.
  IF NEW.status = 'issued'
     AND (TG_OP = 'INSERT' OR OLD.status IS NULL OR OLD.status NOT IN ('issued', 'overdue', 'paid')) THEN
    INSERT INTO public.portal_notifications (customer_id, type, title, message, link)
    VALUES (
      NEW.customer_id,
      'demurrage_issued',
      'Nova fatura de demurrage',
      'Demurrage ' || NEW.doc_number || ' no valor de USD ' || COALESCE(round(NEW.total_usd, 2)::text, '0,00') || ' foi emitida.',
      '/portal/billing'
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- 6. Invoices com desconto integral anteriores à 306 viram quitadas/isentas.
-- Depende da afirmação "Data status" do AGENTS.md (ver cabeçalho).
DO $migration$
DECLARE
  v_invoice record;
  v_exempt_date date;
  v_discount_usd numeric(12,2);
BEGIN
  FOR v_invoice IN
    SELECT di.*
    FROM public.demurrage_invoices AS di
    WHERE COALESCE(di.status, 'issued') IN ('issued', 'overdue')
      AND di.paid_at IS NULL
      AND di.discount_mode IS NOT NULL
      AND di.total_usd > 0
      AND public._demurrage_invoice_net_usd(di.total_usd, di.discount_mode, di.discount_value) <= 0
      AND NOT EXISTS (SELECT 1 FROM public.demurrage_refunds AS r WHERE r.invoice_id = di.id AND r.status <> 'cancelled')
    ORDER BY di.id
    FOR UPDATE OF di
  LOOP
    SELECT (max(a.changed_at) AT TIME ZONE 'America/Sao_Paulo')::date INTO v_exempt_date
    FROM public.audit_logs AS a
    WHERE a.entity_type = 'demurrage_invoice' AND a.entity_id = v_invoice.id::text AND a.field_name = 'discount';
    v_exempt_date := COALESCE(v_exempt_date, (COALESCE(v_invoice.updated_at, now()) AT TIME ZONE 'America/Sao_Paulo')::date);
    v_discount_usd := v_invoice.total_usd - public._demurrage_invoice_net_usd(v_invoice.total_usd, v_invoice.discount_mode, v_invoice.discount_value);

    UPDATE public.demurrage_invoices
    SET status = 'paid', paid_at = v_exempt_date, current_total_brl = 0, pix_payload = NULL, updated_at = now()
    WHERE id = v_invoice.id;

    IF v_invoice.current_roe IS NOT NULL AND v_invoice.current_roe > 0 THEN
      INSERT INTO public.demurrage_invoice_history
        (invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
      VALUES
        (v_invoice.id, v_exempt_date, public._demurrage_ptax_from_roe(v_invoice.current_roe), v_invoice.current_roe,
         v_invoice.total_usd, 0, v_discount_usd, 'payment');
    END IF;

    INSERT INTO public.audit_logs(
      entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
    ) VALUES (
      'demurrage_invoice', v_invoice.id::text, 'discount_exemption', COALESCE(v_invoice.status, 'issued'),
      jsonb_build_object('status', 'paid', 'paid_at', v_exempt_date, 'total_brl', 0)::text,
      NULL, now(), 'Migration 313: desconto integral anterior à 306 quita a Invoice (D7).'
    );
  END LOOP;
END;
$migration$;

-- 7. Leitura da Régua por Invoice, com o motivo da pausa.
DROP FUNCTION IF EXISTS public.list_demurrage_dunning_claim_statuses(bigint[]);

CREATE FUNCTION public.list_demurrage_dunning_claim_statuses(p_invoice_ids bigint[])
 RETURNS TABLE(invoice_id bigint, attempt_count integer, last_attempt_at timestamp with time zone, pause_reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_active_read_user()) THEN
    RAISE EXCEPTION 'Usuário interno ativo é obrigatório.' USING ERRCODE = '42501';
  END IF;

  IF p_invoice_ids IS NULL OR cardinality(p_invoice_ids) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    di.id,
    COALESCE(claims.attempt_count, 0)::INTEGER,
    claims.last_attempt_at,
    public._demurrage_dunning_block_reason(di.id)
  FROM public.demurrage_invoices AS di
  LEFT JOIN LATERAL (
    SELECT count(*)::INTEGER AS attempt_count, max(claim.claimed_at) AS last_attempt_at
    FROM public.demurrage_dunning_claims AS claim
    WHERE claim.demurrage_invoice_id = di.id
      AND claim.released_at IS NULL
  ) AS claims ON true
  WHERE di.id = ANY(p_invoice_ids);
END;
$function$;

REVOKE ALL ON FUNCTION public.list_demurrage_dunning_claim_statuses(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_demurrage_dunning_claim_statuses(bigint[]) TO authenticated, service_role;

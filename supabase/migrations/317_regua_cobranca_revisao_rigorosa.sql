-- Migration 317: Régua de Cobrança de Demurrage — revisão rigorosa do PR #973.
--
-- Plano de correção dos e-mails (docs/plans/2026-10-17-correcao-dos-emails.md),
-- itens 1E e 2.5; decisões D6 e D7. Cada função parte da definição vigente:
-- create_customer_dunning_group_atomic e resume_demurrage_dunning_on_alert_resolved
-- da 305, claim_demurrage_dunning_candidates da 313,
-- reconcile_demurrage_invoice_after_payment_reversal da 191 e
-- _reconcile_demurrage_after_dates da 214. Junto, a Edge demurrage-dunning
-- (_shared/demurrageDunningRunner.ts) deixa de devolver a posição de fatura já
-- entregue a alguém quando a rodada cai numa exceção (R1).
--
-- Data status: o bloco DO do item 4 resolve alertas já abertos (e, pelo
-- gatilho da 305, tira a suspensão pela recusa e devolve a posição dessas
-- Invoices pagas ou canceladas). Depende da afirmação "Data status" da seção
-- Gotchas do AGENTS.md: o banco de produção só tem dados de teste. Se a
-- afirmação tiver sido revogada quando você ler isto, revise o item 4.
--
-- 1. create_customer_dunning_group_atomic:
--    - R2: a participação de um grupo da mesma tentativa só sai quando o
--      Comunicado não tem tentativa 'aceito' (com ou sem id do provedor) nem
--      'entregue'. Antes saía sempre que o Comunicado estava em falha, e desde a
--      315 o Comunicado "Em envio" parado vira falha depois de 15 min mesmo com
--      a tentativa aceita sem id: a composição seguinte cobrava de novo quem o
--      provedor pode ter recebido.
--    - R3: na retomada depois da recusa definitiva (resume_generation > 0) a
--      geração entra na chave do grupo e a mensagem nasce num Comunicado novo.
--      Reaproveitar o Comunicado recusado deixava a tentativa recusada do
--      endereço antigo no status, e o Histórico mostrava "Parcial" na cobrança
--      certa. A Edge faz o mesmo no modo unitário, com dispatch_id derivado da
--      Invoice, da tentativa e da geração.
-- 2. claim_demurrage_dunning_candidates (R2): a varredura de posições órfãs
--    (30 min) não solta a posição cujo Comunicado tem tentativa aceita ou
--    entregue, mesmo em falha ou "Em envio". Sem isto, a participação mantida
--    pelo item 1 travava o Cliente: a mesma tentativa voltava noutra composição
--    e o índice único (fatura, tentativa) recusava o grupo a cada rodada.
-- 3. resume_demurrage_dunning_on_alert_resolved (R5): a retomada zera
--    failure_count (a recusa contava uma falha e o alerta de falhas seguidas
--    abria na 2ª, não na 3ª) e, se as datas de container mudaram enquanto a
--    Invoice estava suspensa pela recusa, deixa a suspensão por datas que a
--    reconciliação teria gravado.
-- 4. resolve_demurrage_dunning_alert_on_closed_invoice (R4, gatilho novo): a
--    Invoice que passa a paga (inclusive isenta pelo desconto integral, D7) ou
--    cancelada resolve o alerta cobranca_demurrage_recusada, que antes só
--    fechava com uma cobrança enviada e ficava aberto para sempre. Os alertas
--    já abertos dessas Invoices são resolvidos aqui (bloco DO).
-- 5. reconcile_demurrage_invoice_after_payment_reversal (R5): o estorno da
--    baixa só tira a suspensão por datas ('Datas de container alteradas…'),
--    não a recusa do provedor.
-- 6. _reconcile_demurrage_after_dates (R5): a Invoice paga ou negociada com
--    datas alteradas não tem a suspensão pela recusa sobrescrita; a varredura
--    deixava de reconhecê-la e soltava a posição sem nova geração.

-- 1. Grupo da cobrança: participação com tentativa aceita e geração da retomada.
CREATE OR REPLACE FUNCTION public.create_customer_dunning_group_atomic(p_customer_id bigint, p_attempt_discriminator integer, p_invoice_ids bigint[], p_anchor_voyage_id bigint DEFAULT NULL::bigint, p_anchor_port text DEFAULT NULL::text, p_vessel_name text DEFAULT NULL::text, p_voyage_number text DEFAULT NULL::text, p_terminal_name text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice_ids bigint[];
  v_invoice_count integer;
  v_bl_ids text[];
  v_group_key text;
  v_dispatch_id uuid;
  v_communication_id bigint;
  v_existing bigint;
  v_resume_generation integer;
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

  -- 317 (R3): na retomada depois da recusa definitiva (D6) a geração entra na
  -- chave, e a mensagem nasce num Comunicado novo. Reaproveitar o Comunicado
  -- recusado deixava a tentativa do endereço antigo (outro destinatário) no
  -- status, e a cobrança certa aparecia como "Parcial". Geração 0 mantém a
  -- chave de sempre.
  SELECT COALESCE(max(claim.resume_generation), 0) INTO v_resume_generation
  FROM public.demurrage_dunning_claims AS claim
  WHERE claim.demurrage_invoice_id = ANY(v_invoice_ids)
    AND claim.attempt_discriminator = p_attempt_discriminator;
  v_group_key := md5(format('%s:%s:%s', p_customer_id, p_attempt_discriminator, array_to_string(v_invoice_ids, ','))
    || CASE WHEN v_resume_generation > 0 THEN ':r' || v_resume_generation ELSE '' END);
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
  -- 317 (R2): tentativa 'aceito' (com ou sem id do provedor) ou 'entregue'
  -- segura a participação mesmo com o Comunicado em falha: desde a 315, o
  -- Comunicado "Em envio" parado vira falha depois de 15 min, inclusive com a
  -- tentativa aceita sem id (o provedor pode ter aceitado). A posição dessa
  -- tentativa fica consumida (a varredura de claim_demurrage_dunning_candidates
  -- não a solta, 317), então a Régua passa à etapa seguinte em vez de tentar
  -- de novo esta tentativa noutra composição.
  -- ponytail: a queda entre registrar a tentativa e chamar o provedor também
  -- conta como aceita; essa etapa pode não ter chegado ao Cliente e a próxima
  -- sai depois do intervalo. Melhoria: consultar o provedor pela chave de
  -- idempotência antes de decidir.
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
    AND NOT EXISTS (
      SELECT 1 FROM public.customer_communication_attempts AS accepted
      WHERE accepted.communication_id = comm.id
        AND accepted.status IN ('aceito', 'entregue')
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
$function$;

REVOKE ALL ON FUNCTION public.create_customer_dunning_group_atomic(bigint, integer, bigint[], bigint, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_dunning_group_atomic(bigint, integer, bigint[], bigint, text, text, text, text) TO service_role;

-- 2. Seleção da rodada: a definição da 313 com a varredura que respeita a tentativa aceita.
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
        AND (
          comm.status IN ('enviado', 'simulado', 'parcial')
          -- 317 (R2): tentativa aceita (com ou sem id do provedor) ou entregue
          -- consome a posição mesmo com o Comunicado em falha ou "Em envio".
          OR EXISTS (
            SELECT 1 FROM public.customer_communication_attempts AS accepted
            WHERE accepted.communication_id = comm.id
              AND accepted.status IN ('aceito', 'entregue')
          )
        )
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

-- 3. Retomada pelo alerta resolvido: zera as falhas e respeita as datas alteradas.
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

  -- 317 (R5): as datas de container que mudam com a Invoice suspensa pela
  -- recusa não sobrescrevem o motivo (_reconcile_demurrage_after_dates). Ao
  -- retomar, a Invoice paga ou negociada com datas divergentes fica com a
  -- suspensão por datas, como a reconciliação teria gravado.
  UPDATE public.demurrage_invoices AS di
  SET dunning_suspended_reason = CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      JOIN public.bl_containers AS c ON c.id = item.container_id
      WHERE item.invoice_id = di.id
        AND (c.discharge_date IS DISTINCT FROM item.discharge_date OR c.return_date IS DISTINCT FROM item.return_date)
    ) THEN NULL
    WHEN di.status = 'paid' OR di.paid_at IS NOT NULL
      THEN 'Datas de container alteradas depois do pagamento; conferir a diferença.'
    WHEN COALESCE(di.discount_value, 0) > 0 OR COALESCE(di.dispute_open, false)
      THEN 'Datas de container alteradas em Invoice com desconto ou disputa; reemitir à mão.'
    ELSE NULL
  END
  WHERE di.id = v_invoice_id
    AND di.dunning_suspended_reason LIKE 'Cobrança recusada pelo provedor%';
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Retoma no mesmo discriminador; a nova geração muda a chave de
  -- idempotência do e-mail e o Comunicado (317), para a tentativa recusada não
  -- ser reaproveitada. A contagem de falhas recomeça (317, R5): a recusa
  -- contou uma, e o alerta de falhas seguidas abria na 2ª falha da retomada.
  UPDATE public.demurrage_dunning_claims AS claim
  SET released_at = COALESCE(claim.released_at, now()),
      resume_generation = claim.resume_generation + 1,
      failure_count = 0
  WHERE claim.demurrage_invoice_id = v_invoice_id
    AND claim.attempt_discriminator = (
      SELECT max(latest.attempt_discriminator) FROM public.demurrage_dunning_claims AS latest
      WHERE latest.demurrage_invoice_id = v_invoice_id
    );
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.resume_demurrage_dunning_on_alert_resolved() FROM PUBLIC, anon, authenticated;

-- 4. Invoice paga (inclusive isenta pelo desconto integral, D7) ou cancelada
-- não terá cobrança: o alerta cobranca_demurrage_recusada fecha sozinho.
CREATE OR REPLACE FUNCTION public.resolve_demurrage_dunning_alert_on_closed_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_previous text := current_setting('alerts.foundation_trigger', true);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.alert_items AS i
    JOIN public.alerts AS a ON a.id = i.alert_id
    WHERE i.item_type = 'cobranca_demurrage_recusada' AND i.status = 'active'
      AND a.entity_type = 'demurrage_invoice' AND a.entity_id = NEW.id::text
  ) THEN
    RETURN NULL;
  END IF;
  -- Resolver dispara resume_demurrage_dunning_on_alert_resolved, que tira a
  -- suspensão pela recusa: a Invoice paga ou cancelada já está fora da Régua
  -- e, se a baixa for cancelada, volta a ser cobrada na geração seguinte.
  -- Falha no alerta não desfaz a baixa nem o cancelamento.
  BEGIN
    PERFORM set_config('alerts.foundation_trigger', 'on', true);
    PERFORM public.resolve_alert_item('cobranca_demurrage_recusada', 'demurrage_invoice', NEW.id::text, 'demurrage_dunning',
      jsonb_build_object('resolution', CASE WHEN NEW.status = 'paid' THEN 'invoice_paid' ELSE 'invoice_cancelled' END,
        'invoice_id', NEW.id));
    PERFORM set_config('alerts.foundation_trigger', COALESCE(v_previous, ''), true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('alerts.foundation_trigger', COALESCE(v_previous, ''), true);
    RAISE WARNING 'Alerta cobranca_demurrage_recusada da invoice % nao fechado: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_demurrage_dunning_alert_on_closed_invoice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS resolve_demurrage_dunning_alert_on_closed_invoice ON public.demurrage_invoices;
CREATE TRIGGER resolve_demurrage_dunning_alert_on_closed_invoice
  AFTER UPDATE OF status ON public.demurrage_invoices
  FOR EACH ROW
  WHEN (NEW.status IN ('paid', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.resolve_demurrage_dunning_alert_on_closed_invoice();

-- Alertas já abertos de Invoice paga ou cancelada. Depende da afirmação
-- "Data status" do AGENTS.md (ver cabeçalho).
DO $migration$
DECLARE
  v_previous_role text := current_setting('request.jwt.claim.role', true);
  v_invoice_id text;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  FOR v_invoice_id IN
    SELECT DISTINCT a.entity_id
    FROM public.alert_items AS i
    JOIN public.alerts AS a ON a.id = i.alert_id
    JOIN public.demurrage_invoices AS di ON di.id::text = a.entity_id
    WHERE i.item_type = 'cobranca_demurrage_recusada' AND i.status = 'active'
      AND a.entity_type = 'demurrage_invoice'
      AND di.status IN ('paid', 'cancelled')
    ORDER BY a.entity_id
  LOOP
    PERFORM public.resolve_alert_item('cobranca_demurrage_recusada', 'demurrage_invoice', v_invoice_id, 'demurrage_dunning',
      jsonb_build_object('resolution', 'migration_317_invoice_closed', 'invoice_id', v_invoice_id));
  END LOOP;
  PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_role, ''), true);
END;
$migration$;

-- 5. Estorno da baixa: só tira a suspensão por datas.
CREATE OR REPLACE FUNCTION public.reconcile_demurrage_invoice_after_payment_reversal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.demurrage_invoice_items AS item
    JOIN public.bl_containers AS c ON c.id = item.container_id
    WHERE item.invoice_id = NEW.id
      AND (c.discharge_date IS DISTINCT FROM item.discharge_date OR c.return_date IS DISTINCT FROM item.return_date)
  ) THEN
    PERFORM public._reconcile_demurrage_after_dates(ARRAY[NEW.bl_id], auth.uid());
  ELSE
    -- 317 (R5): só tira a suspensão por datas; a recusa do provedor (D6) fica
    -- até a pessoa resolver o alerta.
    UPDATE public.demurrage_invoices SET dunning_suspended_reason = NULL
    WHERE id = NEW.id AND dunning_suspended_reason LIKE 'Datas de container alteradas%';
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_demurrage_invoice_after_payment_reversal() FROM PUBLIC, anon, authenticated;

-- 6. Datas alteradas depois da emissão: não sobrescreve a recusa do provedor.
CREATE OR REPLACE FUNCTION public._reconcile_demurrage_after_dates(p_bl_ids text[], p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice public.demurrage_invoices%ROWTYPE;
  v_invoice_id bigint;
  v_result jsonb := '[]'::jsonb;
  v_reissue jsonb;
  v_previous text := current_setting('vela.demurrage_internal', true);
  v_paid boolean;
  v_negotiated boolean;
  v_voyage_id bigint;
  v_keys text[];
  v_tried text[];
  v_waiting text[];
  v_extra jsonb;
  v_next_bl text;
  v_attempt jsonb;
  v_unbilled text[];
  v_message text;
BEGIN
  FOR v_invoice_id IN
    SELECT DISTINCT di.id
    FROM unnest(p_bl_ids) AS changed(bl_id)
    JOIN public.demurrage_invoices AS di
      ON di.bl_id = ANY(public.demurrage_group_bl_ids(changed.bl_id) || changed.bl_id)
      -- A Invoice que cobra caixa deste B/L, mesmo ancorada fora do grupo de
      -- hoje (grupo que se dividiu depois da emissão, 214).
      OR EXISTS (
        SELECT 1 FROM public.demurrage_invoice_items AS own_item
        JOIN public.bl_containers AS own ON own.id = own_item.container_id
        WHERE own_item.invoice_id = di.id AND own.bl_id = changed.bl_id
      )
    WHERE di.status IN ('issued', 'overdue', 'paid')
      AND EXISTS (
        SELECT 1 FROM public.demurrage_invoice_items AS item
        JOIN public.bl_containers AS c ON c.id = item.container_id
        WHERE item.invoice_id = di.id
          AND (c.discharge_date IS DISTINCT FROM item.discharge_date OR c.return_date IS DISTINCT FROM item.return_date)
      )
    ORDER BY di.id
  LOOP
    -- A decisão vale para a linha travada (211): uma baixa que confirmou
    -- depois da leitura acima não tem a Invoice paga cancelada e reemitida.
    SELECT * INTO v_invoice FROM public.demurrage_invoices WHERE id = v_invoice_id FOR UPDATE;
    CONTINUE WHEN NOT FOUND OR v_invoice.status NOT IN ('issued', 'overdue', 'paid');
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      JOIN public.bl_containers AS c ON c.id = item.container_id
      WHERE item.invoice_id = v_invoice.id
        AND (c.discharge_date IS DISTINCT FROM item.discharge_date OR c.return_date IS DISTINCT FROM item.return_date)
    );
    v_paid := v_invoice.status = 'paid' OR v_invoice.paid_at IS NOT NULL;
    -- Desconto ou disputa aberta (ADR 0079, decisão 1): houve negociação que o
    -- cálculo não refaz. Como a paga, a Invoice não é reemitida sozinha.
    v_negotiated := NOT v_paid
      AND (COALESCE(v_invoice.discount_value, 0) > 0 OR COALESCE(v_invoice.dispute_open, false));
    v_message := format('As datas de container da Invoice de Demurrage %s mudaram depois da emissão%s.',
        v_invoice.doc_number, CASE
          WHEN v_paid THEN ' e ela já tem pagamento: a Régua suspendeu a cobrança'
          WHEN v_negotiated THEN ' e ela tem desconto ou disputa aberta: a Régua suspendeu a cobrança; cancele, gere de novo e refaça o desconto ou responda a disputa'
          ELSE '' END);

    IF v_paid OR v_negotiated THEN
      PERFORM public.upsert_alert_item(
        'demurrage_invoice_dates_changed', 'demurrage_invoice', v_invoice.id::text, v_message,
        'container-dates',
        jsonb_build_object('invoice_id', v_invoice.id, 'bl_id', v_invoice.bl_id, 'paid', v_paid, 'negotiated', v_negotiated),
        '/demurrage');
      UPDATE public.demurrage_invoices
         SET dunning_suspended_reason = CASE WHEN v_paid
           THEN 'Datas de container alteradas depois do pagamento; conferir a diferença.'
           ELSE 'Datas de container alteradas em Invoice com desconto ou disputa; reemitir à mão.' END
       WHERE id = v_invoice.id
         -- 317 (R5): a suspensão pela recusa do provedor (D6) fica; ao
         -- resolver o alerta, a retomada aplica a suspensão por datas.
         AND (dunning_suspended_reason IS NULL OR dunning_suspended_reason NOT LIKE 'Cobrança recusada pelo provedor%');
      v_result := v_result || jsonb_build_array(jsonb_build_object('invoice_id', v_invoice.id, 'status', 'suspended'));
      CONTINUE;
    END IF;

    -- Sem pagamento: cancela e reemite com as datas atuais (ou só cancela).
    UPDATE public.demurrage_invoices SET status = 'cancelled', updated_at = now()
     WHERE id = v_invoice.id AND status IN ('issued', 'overdue') AND paid_at IS NULL;
    CONTINUE WHEN NOT FOUND;
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
    VALUES ('demurrage_invoice', v_invoice.id::text, 'status', v_invoice.status, 'cancelled', p_actor, now(),
      'Datas de container alteradas: cancelada para reemissão automática.');
    v_extra := '[]'::jsonb;
    v_unbilled := ARRAY[]::text[];
    IF EXISTS (SELECT 1 FROM public.bls WHERE id = v_invoice.bl_id AND cancelled_at IS NOT NULL) THEN
      v_reissue := jsonb_build_object('status', 'bl_cancelled', 'bl_id', v_invoice.bl_id);
    -- Viagem Cancelada não recebe Invoice de Demurrage (211): só cancela.
    ELSIF EXISTS (
      SELECT 1 FROM public.bls AS b JOIN public.voyages AS v ON v.id = b.voyage_id
      WHERE b.id = v_invoice.bl_id AND v.status = 'cancelled'
    ) THEN
      v_reissue := jsonb_build_object('status', 'voyage_cancelled', 'bl_id', v_invoice.bl_id);
    ELSE
      -- Cada caixa uma vez (214): a reemissão cobra as caixas da Invoice
      -- cancelada que nenhuma outra Invoice viva cobre. Primeiro pelo grupo do
      -- B/L dela; a caixa que saiu desse grupo, pelo âncora do B/L ativo que
      -- ainda a tem. Cada âncora é tentado uma vez.
      SELECT voyage_id INTO v_voyage_id FROM public.bls WHERE id = v_invoice.bl_id;
      SELECT COALESCE(array_agg(DISTINCT upper(btrim(item.container_number))), ARRAY[]::text[]) INTO v_keys
      FROM public.demurrage_invoice_items AS item
      WHERE item.invoice_id = v_invoice.id AND NULLIF(btrim(item.container_number), '') IS NOT NULL;
      v_tried := ARRAY[]::text[];
      v_waiting := ARRAY[]::text[];
      v_next_bl := v_invoice.bl_id;
      PERFORM set_config('vela.demurrage_internal', 'on', true);
      LOOP
        v_attempt := public.issue_demurrage_invoice_for_bl(v_next_bl, NULL);
        IF cardinality(v_tried) = 0 THEN
          v_reissue := v_attempt;
        ELSE
          v_extra := v_extra || jsonb_build_array(v_attempt || jsonb_build_object('bl_id', v_next_bl));
        END IF;
        v_tried := array_append(v_tried, COALESCE(v_attempt->>'anchor_bl_id', v_next_bl));
        -- Sem sobreestadia ou aguardando devolução: as caixas do grupo ficam
        -- sem Invoice por regra, não por perda (a devolução enfileira de novo).
        IF v_attempt->>'status' IN ('no_overstay', 'waiting_return') THEN
          v_waiting := v_waiting || ARRAY(
            SELECT DISTINCT upper(btrim(c.container_number)) FROM public.bl_containers AS c
            WHERE c.bl_id = ANY(public.demurrage_group_bl_ids(COALESCE(v_attempt->>'anchor_bl_id', v_next_bl))));
        END IF;
        SELECT holder.id INTO v_next_bl
        FROM unnest(v_keys) AS k(container_key)
        JOIN public.bl_containers AS c ON upper(btrim(c.container_number)) = k.container_key
        JOIN public.bls AS holder ON holder.id = c.bl_id
        WHERE holder.voyage_id = v_voyage_id AND holder.customer_id = v_invoice.customer_id
          AND holder.cancelled_at IS NULL
          AND c.ownership IS DISTINCT FROM 'SOC'
          AND k.container_key <> ALL(v_waiting)
          AND NOT EXISTS (
            SELECT 1 FROM public._demurrage_billed_container_keys(v_voyage_id, v_invoice.customer_id) AS billed
            WHERE billed.container_key = k.container_key)
          AND public.demurrage_group_anchor(holder.id) <> ALL(v_tried)
        ORDER BY k.container_key, holder.id
        LIMIT 1;
        EXIT WHEN NOT FOUND;
      END LOOP;
      PERFORM set_config('vela.demurrage_internal', COALESCE(v_previous, ''), true);
      SELECT COALESCE(array_agg(k.container_key ORDER BY k.container_key), ARRAY[]::text[]) INTO v_unbilled
      FROM unnest(v_keys) AS k(container_key)
      WHERE k.container_key <> ALL(v_waiting)
        AND NOT EXISTS (
          SELECT 1 FROM public._demurrage_billed_container_keys(v_voyage_id, v_invoice.customer_id) AS billed
          WHERE billed.container_key = k.container_key);
    END IF;
    -- Caixa da Invoice cancelada que ficou sem cobrança não é sucesso: o
    -- Alerta diz quais caixas conferir.
    PERFORM public.upsert_alert_item(
      'demurrage_invoice_dates_changed', 'demurrage_invoice', v_invoice.id::text,
      v_message || CASE WHEN cardinality(v_unbilled) > 0 THEN format(
        ' A reemissão automática não cobrou o(s) container(s) %s: confira o grupo e emita a Demurrage deles.',
        array_to_string(v_unbilled, ', ')) ELSE '' END,
      'container-dates',
      jsonb_build_object('invoice_id', v_invoice.id, 'bl_id', v_invoice.bl_id, 'paid', v_paid, 'negotiated', v_negotiated)
        || CASE WHEN cardinality(v_unbilled) > 0
             THEN jsonb_build_object('unbilled_containers', to_jsonb(v_unbilled), 'reissue_status', v_reissue->>'status')
             ELSE '{}'::jsonb END,
      '/demurrage');
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'invoice_id', v_invoice.id, 'status', 'cancelled', 'reissue', v_reissue,
      'reissue_extra', v_extra, 'unbilled_containers', to_jsonb(v_unbilled),
      'reissue_complete', cardinality(v_unbilled) = 0));
  END LOOP;

  -- Com as datas de volta às faturadas, a Invoice com desconto ou disputa sai
  -- da suspensão (a paga sai pelo estorno, como na 191).
  UPDATE public.demurrage_invoices AS di
     SET dunning_suspended_reason = NULL
    FROM unnest(p_bl_ids) AS changed(bl_id)
   WHERE di.bl_id = ANY(public.demurrage_group_bl_ids(changed.bl_id) || changed.bl_id)
     AND di.status IN ('issued', 'overdue')
     AND di.paid_at IS NULL
     AND di.dunning_suspended_reason = 'Datas de container alteradas em Invoice com desconto ou disputa; reemitir à mão.'
     AND NOT EXISTS (
       SELECT 1 FROM public.demurrage_invoice_items AS item
       JOIN public.bl_containers AS c ON c.id = item.container_id
       WHERE item.invoice_id = di.id
         AND (c.discharge_date IS DISTINCT FROM item.discharge_date OR c.return_date IS DISTINCT FROM item.return_date)
     );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public._reconcile_demurrage_after_dates(text[], uuid) FROM PUBLIC, anon, authenticated;

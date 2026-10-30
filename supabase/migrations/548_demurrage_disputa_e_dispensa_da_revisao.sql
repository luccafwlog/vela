-- 548: correções da revisão da release luccafwlog/vela#1117 na Disputa, na
-- dispensa da cobrança e na emissão de Demurrage (ADR 0112, D7, D18 e D24).
--
-- 1. Reabrir Disputa resolvida (`_reopen_demurrage_dispute_impl_20260920`,
--    520) abria na hora o Alerta `demurrage_disputa_prazo` com o prazo
--    vencido: a Disputa voltava a `aberta` antes de a mensagem da reabertura
--    existir, e o gatilho da 520 contava a espera desde a abertura original
--    (`_demurrage_dispute_waiting_since` cai em `created_at`). O sino avisava
--    Equipamentos de um prazo que não tinha vencido, e a rotina de 15 minutos
--    fechava o Alerta. Agora a mensagem é gravada antes; a espera conta da
--    reabertura. Os textos dizem "Disputa".
-- 2. Desfazer a dispensa (`revoke_demurrage_box_waiver`, 517) depois de
--    cancelar o B/L recriava a sobreestadia sem Invoice num B/L cancelado, o
--    estado que o D7 recusa no cancelamento: a caixa ia para Travado
--    (`bl_cancelado`) sem emissão possível. Agora é recusado quando a caixa só
--    está em B/L cancelado do Cliente da dispensa na Viagem ("Reative o B/L
--    antes de desfazer a dispensa."). A trava `FOR SHARE` nesses B/Ls serializa
--    com o `cancel_bl`, que trava o B/L antes de ler os motivos.
-- 3. `issue_demurrage_invoice_for_bl` (517) devolvia `existing`, sem Invoice,
--    para o grupo com todas as caixas dispensadas, e a tela dizia que elas
--    estavam em Invoice emitida ou paga. Agora devolve `waived`. A recusa
--    "B/L … não encontrado." ganha o acento.
-- 4. Acento no texto de recusa reescrito na migration 519:
--    `confirm_demurrage_pix_matches` ("Lista de conciliação inválida.").
--
-- Redefine funções com a mesma assinatura (`CREATE OR REPLACE` preserva dono e
-- grants); não reescreve nem apaga linhas existentes.
--
-- Rollback: recriar `_reopen_demurrage_dispute_impl_20260920` (520),
-- `revoke_demurrage_box_waiver` e `issue_demurrage_invoice_for_bl` (517) e
-- `confirm_demurrage_pix_matches` (519).

-- ─── 1. Reabertura da Disputa sem Alerta de prazo falso (D18) ─────────────

-- Corpo da 520; a mensagem vem antes da mudança de estado.
CREATE OR REPLACE FUNCTION public._reopen_demurrage_dispute_impl_20260920(p_dispute_id bigint, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT := public._portal_actor_role();
  v_dispute public.demurrage_disputes%ROWTYPE;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('equipamentos', 'administrativo') THEN RAISE EXCEPTION 'Apenas Equipamentos ou Administrativo pode reabrir a Dispute.' USING ERRCODE = '42501'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Justificativa é obrigatória.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_dispute FROM public.demurrage_disputes WHERE id = p_dispute_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Disputa não encontrada.' USING ERRCODE = 'P0002'; END IF;
  -- Reabertura só da resolvida (docs/modules/demurrage.md).
  IF v_dispute.state <> 'resolvida' THEN RAISE EXCEPTION 'Só a Disputa resolvida pode ser reaberta.' USING ERRCODE = '22023'; END IF;
  -- 520 (ADR 0112, D17): reabre só em Invoice emitida ou paga.
  IF NOT EXISTS (SELECT 1 FROM public.demurrage_invoices WHERE id = v_dispute.demurrage_invoice_id AND status IN ('issued', 'overdue', 'paid')) THEN
    RAISE EXCEPTION 'A Invoice desta disputa está cancelada: a disputa não reabre.' USING ERRCODE = '22023';
  END IF;
  -- 548 (D18): a mensagem da reabertura vem antes do estado. O gatilho do
  -- prazo (`trg_demurrage_dispute_deadline_alert`, 520) roda no UPDATE e conta
  -- a espera pela primeira mensagem que passou a vez a Equipamentos; sem ela,
  -- contava desde a abertura original e abria o Alerta já vencido.
  INSERT INTO public.demurrage_dispute_messages(dispute_id, author_id, author_type, body, next_responder, metadata)
  VALUES (p_dispute_id, auth.uid(), v_role, btrim(p_reason), 'equipamentos', jsonb_build_object('action', 'reopen'));
  UPDATE public.demurrage_disputes SET state = 'aberta', next_responder = 'equipamentos', resolved_at = NULL, cancelled_at = NULL WHERE id = p_dispute_id;
  UPDATE public.demurrage_invoices SET dispute_open = true, dispute_status = 'aberto' WHERE id = v_dispute.demurrage_invoice_id;
  PERFORM public.block521_upsert_alert('portal_dispute_opened', 'demurrage_invoice', v_dispute.demurrage_invoice_id::text, 'Disputa reaberta; análise de Equipamentos pendente.', 'portal_dispute_reopened', 'equipamentos', jsonb_build_object('dispute_id', p_dispute_id), '/demurrage?dispute=' || p_dispute_id);
END;
$function$;

-- ─── 2. Dispensa desfeita não volta a cobrar caixa de B/L cancelado (D7) ──

-- Corpo da 517, com a recusa do B/L cancelado.
CREATE OR REPLACE FUNCTION public.revoke_demurrage_box_waiver(p_waiver_id bigint, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_waiver public.demurrage_box_waivers%ROWTYPE;
  v_cancelled_bl text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para desfazer a dispensa.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 10 THEN
    RAISE EXCEPTION 'Informe a justificativa para desfazer a dispensa (mínimo de 10 caracteres).' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_waiver FROM public.demurrage_box_waivers WHERE id = p_waiver_id FOR UPDATE;
  IF NOT FOUND OR v_waiver.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Dispensa não encontrada ou já desfeita.' USING ERRCODE = 'P0002';
  END IF;
  -- 548 (ADR 0112, D7): a caixa que só está em B/L cancelado do Cliente da
  -- dispensa na Viagem não volta a ser cobrada: a Invoice não sai para B/L
  -- cancelado, e a caixa ficaria em Travado sem saída. A trava nos B/Ls da
  -- caixa espera o `cancel_bl` em andamento (ele trava o B/L antes de ler os
  -- motivos), e o cancelamento que vier depois vê a dispensa desfeita.
  PERFORM 1
     FROM public.bls AS b
     JOIN public.bl_containers AS c ON c.bl_id = b.id
    WHERE b.voyage_id = v_waiver.voyage_id
      AND b.customer_id IS NOT DISTINCT FROM v_waiver.customer_id
      AND c.ownership IS DISTINCT FROM 'SOC'
      AND upper(btrim(c.container_number)) = v_waiver.container_key
    ORDER BY b.id
      FOR SHARE OF b;
  SELECT b.id INTO v_cancelled_bl
    FROM public.bls AS b
    JOIN public.bl_containers AS c ON c.bl_id = b.id
   WHERE b.voyage_id = v_waiver.voyage_id
     AND b.customer_id IS NOT DISTINCT FROM v_waiver.customer_id
     AND b.cancelled_at IS NOT NULL
     AND c.ownership IS DISTINCT FROM 'SOC'
     AND upper(btrim(c.container_number)) = v_waiver.container_key
   ORDER BY (b.id = v_waiver.bl_id) DESC, b.id
   LIMIT 1;
  IF v_cancelled_bl IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.bls AS b
      JOIN public.bl_containers AS c ON c.bl_id = b.id
     WHERE b.voyage_id = v_waiver.voyage_id
       AND b.customer_id IS NOT DISTINCT FROM v_waiver.customer_id
       AND b.cancelled_at IS NULL
       AND c.ownership IS DISTINCT FROM 'SOC'
       AND upper(btrim(c.container_number)) = v_waiver.container_key
  ) THEN
    RAISE EXCEPTION 'O container % só está no B/L % cancelado. Reative o B/L antes de desfazer a dispensa.',
      v_waiver.container_key, v_cancelled_bl USING ERRCODE = '22023';
  END IF;
  UPDATE public.demurrage_box_waivers
     SET revoked_at = now(), revoked_by = auth.uid(), revoke_reason = v_reason
   WHERE id = p_waiver_id;
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bl', v_waiver.bl_id, 'demurrage_dispensa', v_waiver.container_key, NULL, auth.uid(), v_reason);
  PERFORM public.reconcile_demurrage_travado_alerts(v_waiver.voyage_id, 'demurrage_dispensa');
  RETURN jsonb_build_object('waiver_id', p_waiver_id, 'revoked', true);
END;
$function$;

-- ─── 3. Grupo com todas as caixas dispensadas: `waived` ───────────────────

-- Corpo da 517; muda o retorno do grupo todo dispensado e o acento.
CREATE OR REPLACE FUNCTION public.issue_demurrage_invoice_for_bl(p_bl_id text, p_doc_number text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_group text[] := public.demurrage_group_bl_ids(p_bl_id);
  v_anchor text := v_group[1];
  v_customer_id bigint;
  v_voyage_id bigint;
  v_covering bigint[];
  v_uncovered integer;
  v_container_ids bigint[];
  v_calculation jsonb;
  v_doc text;
  v_block text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('vela.demurrage_internal', true) IS DISTINCT FROM 'on'
     AND (auth.uid() IS NULL OR NOT public.is_active_user()) THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bls WHERE id = p_bl_id AND cancelled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'O B/L % está cancelado: a Invoice de Demurrage não é emitida para B/L cancelado.', p_bl_id
      USING ERRCODE = '22023';
  END IF;

  SELECT customer_id, voyage_id INTO v_customer_id, v_voyage_id FROM public.bls WHERE id = v_anchor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'B/L % sem cliente para emissão de Demurrage.', v_anchor USING ERRCODE = '22023';
  END IF;

  -- Cada caixa uma vez (214): a cobertura é por caixa na Viagem e no Cliente,
  -- não pelo grupo de hoje. A trava vale até o fim da transação.
  PERFORM public._lock_demurrage_box_billing(v_voyage_id, v_customer_id);
  WITH boxes AS (
    SELECT DISTINCT upper(btrim(c.container_number)) AS container_key
    FROM public.bl_containers AS c
    WHERE c.bl_id = ANY(v_group) AND c.ownership IS DISTINCT FROM 'SOC'
      AND NULLIF(btrim(c.container_number), '') IS NOT NULL
  ), billed AS (
    SELECT * FROM public._demurrage_billed_container_keys(v_voyage_id, v_customer_id)
  )
  SELECT
    -- 517: a caixa dispensada conta como coberta, sem Invoice (invoice_id nulo).
    (SELECT array_agg(DISTINCT billed.invoice_id ORDER BY billed.invoice_id)
       FROM billed JOIN boxes USING (container_key) WHERE billed.invoice_id IS NOT NULL),
    (SELECT count(*) FROM boxes
      WHERE NOT EXISTS (SELECT 1 FROM billed WHERE billed.container_key = boxes.container_key))
  INTO v_covering, v_uncovered;
  IF v_uncovered = 0 AND cardinality(v_covering) > 0 THEN
    RETURN jsonb_build_object('status', 'existing', 'invoice_id', v_covering[cardinality(v_covering)],
      'invoice_ids', to_jsonb(v_covering), 'anchor_bl_id', v_anchor, 'idempotent', true);
  END IF;
  -- 548: todas as caixas do grupo dispensadas, nenhuma em Invoice: não há o
  -- que emitir, e não é uma Invoice existente (antes devolvia `existing` sem
  -- Invoice, e a tela dizia "já estão em Invoice emitida ou paga").
  IF v_uncovered = 0 AND EXISTS (
       SELECT 1 FROM public._demurrage_waived_container_keys(v_voyage_id, v_customer_id)) THEN
    RETURN jsonb_build_object('status', 'waived', 'anchor_bl_id', v_anchor, 'group_bl_ids', to_jsonb(v_group),
      'idempotent', true);
  END IF;

  -- 517: a caixa dispensada ainda fora não segura o grupo.
  IF EXISTS (
    SELECT 1 FROM public.bl_containers AS c
    WHERE c.bl_id = ANY(v_group) AND c.ownership IS DISTINCT FROM 'SOC' AND c.return_date IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public._demurrage_waived_container_keys(v_voyage_id, v_customer_id) AS waived
        WHERE waived.container_key = upper(btrim(c.container_number)))
  ) THEN
    RETURN jsonb_build_object('status', 'waiting_return', 'anchor_bl_id', v_anchor, 'group_bl_ids', to_jsonb(v_group));
  END IF;

  SELECT COALESCE(array_agg(pick.id ORDER BY pick.id), ARRAY[]::bigint[]) INTO v_container_ids
  FROM (
    SELECT DISTINCT ON (upper(btrim(c.container_number))) c.id
    FROM public.bl_containers AS c
    WHERE c.bl_id = ANY(v_group) AND c.ownership IS DISTINCT FROM 'SOC'
      AND NULLIF(btrim(c.container_number), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public._demurrage_billed_container_keys(v_voyage_id, v_customer_id) AS billed
        WHERE billed.container_key = upper(btrim(c.container_number))
      )
    ORDER BY upper(btrim(c.container_number)), (c.bl_id = v_anchor) DESC, c.id
  ) AS pick;
  IF cardinality(v_container_ids) = 0 THEN
    RETURN jsonb_build_object('status', 'no_containers', 'anchor_bl_id', v_anchor);
  END IF;

  v_calculation := public._calculate_demurrage_invoice_authoritative(
    v_anchor, v_container_ids, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  IF COALESCE((v_calculation->>'total_usd')::numeric, 0) <= 0 THEN
    RETURN jsonb_build_object('status', 'no_overstay', 'anchor_bl_id', v_anchor);
  END IF;

  -- 472 (DEM-D13): a Invoice de Demurrage segue a trava das faturas: CE
  -- Mercante e Gate de faturamento do Portal aberto. Sem eles, nada é emitido
  -- (a fila não falha); o CE ou a abertura do gate enfileira de novo.
  v_block := public._demurrage_issue_block_reason(v_anchor);
  IF v_block IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'blocked', 'reason', v_block, 'anchor_bl_id', v_anchor);
  END IF;

  v_doc := COALESCE(NULLIF(btrim(p_doc_number), ''), public.next_demurrage_doc_number());
  RETURN public.create_demurrage_invoice_authoritative(v_doc, v_anchor, v_customer_id, v_container_ids, NULL)
    || jsonb_build_object('status', 'issued', 'anchor_bl_id', v_anchor, 'group_bl_ids', to_jsonb(v_group),
         'complementary', COALESCE(cardinality(v_covering), 0) > 0,
         'covering_invoice_ids', to_jsonb(COALESCE(v_covering, ARRAY[]::bigint[])));
END;
$function$;

-- ─── 4. Acento no texto de recusa ────────────────────────────────────────

-- Corpo da 519; só o texto da lista inválida.
CREATE OR REPLACE FUNCTION public.confirm_demurrage_pix_matches(p_matches jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para conciliar Demurrage.' USING ERRCODE = '42501';
  END IF;
  IF p_matches IS NULL OR jsonb_typeof(p_matches) <> 'array' THEN
    RAISE EXCEPTION 'Lista de conciliação inválida.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('vela.demurrage_payment_method', 'extrato', true);
  FOR r IN SELECT * FROM jsonb_to_recordset(p_matches) AS x(invoice_id bigint, paid_at date, pix_txid text, total_brl numeric, ptax_used numeric)
  LOOP
    PERFORM public.register_demurrage_payment(gen_random_uuid(), r.invoice_id, r.paid_at, r.pix_txid, r.total_brl, r.ptax_used);
    v_count := v_count + 1;
  END LOOP;
  PERFORM set_config('vela.demurrage_payment_method', '', true);
  RETURN v_count;
END;
$function$;

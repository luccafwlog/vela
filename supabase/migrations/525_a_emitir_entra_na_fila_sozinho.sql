-- 525: "A emitir" só com o que pede gente (decisão do dono de 2026-10-30, na
-- PR luccafwlog/vela#1113, sobre a ADR 0112).
--
-- A emissão automática da Invoice de Demurrage nascia só da gravação de data
-- de container e do destravamento da emissão retida (CE, Portal, Cliente).
-- O grupo que ficava pronto por outro caminho parava em A emitir esperando o
-- botão: free time do B/L, acordo do Cliente, tarifa ou cadastro de tipos que
-- mudou depois da devolução, ou dispensa da cobrança desfeita.
--
-- 1. A classificação (`_demurrage_billing_board_core`) traz, em cada grupo de
--    A emitir, `cancelled_doc` (a Invoice cancelada à mão que as caixas
--    esperam, sem Invoice que a substitua) e `issue_queued` (a emissão já está
--    na fila de efeitos).
-- 2. `reconcile_demurrage_travado_alerts`, na rotina `demurrage-travado-alerts`
--    (a cada 15 minutos; nos gatilhos a emissão já tem o caminho próprio e
--    enfileirar ali duplicaria o efeito), põe na fila de emissão
--    (`demurrage_billing`) o grupo de A emitir sem Invoice cancelada à mão e
--    sem emissão na fila. A Invoice cancelada à mão continua esperando o
--    **Gerar Invoice** (ADR 0112, D10).
--
-- Não reescreve nem apaga linhas existentes; a primeira passada da rotina
-- enfileira os grupos parados de hoje.
--
-- Rollback: recriar `_demurrage_billing_board_core` (521) e
-- `reconcile_demurrage_travado_alerts` (516).


-- Corpo da 521 (classificação) com os dois campos novos.
CREATE OR REPLACE FUNCTION public._demurrage_billing_board_core(p_customer_id bigint DEFAULT NULL::bigint, p_voyage_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_result jsonb;
BEGIN
  WITH candidate_bls AS (
    -- B/Ls com caixa não-SOC numa Viagem que não foi cancelada.
    SELECT DISTINCT b.id, b.voyage_id, b.customer_id, b.cancelled_at
      FROM public.bls AS b
      JOIN public.voyages AS v ON v.id = b.voyage_id
      JOIN public.bl_containers AS c ON c.bl_id = b.id
     WHERE v.status IS DISTINCT FROM 'cancelled'
       AND c.ownership IS DISTINCT FROM 'SOC'
       AND NULLIF(btrim(c.container_number), '') IS NOT NULL
       AND (p_voyage_id IS NULL OR b.voyage_id = p_voyage_id)
       AND (p_customer_id IS NULL OR b.customer_id = p_customer_id)
  ), grouped AS (
    -- B/L ativo: o grupo do banco (mesmo Cliente e Viagem, caixa dividida).
    -- B/L cancelado ou sem Cliente: ele sozinho.
    SELECT cb.id AS bl_id, cb.voyage_id, cb.customer_id, cb.cancelled_at,
           CASE
             WHEN cb.cancelled_at IS NOT NULL OR cb.customer_id IS NULL THEN ARRAY[cb.id]
             ELSE public.demurrage_group_bl_ids(cb.id)
           END AS group_ids
      FROM candidate_bls AS cb
  ), groups AS (
    SELECT DISTINCT ON (g.group_ids[1]) g.group_ids[1] AS anchor_bl_id, g.group_ids, g.voyage_id, g.customer_id,
           (g.cancelled_at IS NOT NULL) AS cancelled
      FROM grouped AS g
     ORDER BY g.group_ids[1], g.bl_id
  ), boxes AS (
    -- Uma linha por caixa (número) do grupo, a do âncora primeiro, como a emissão.
    SELECT DISTINCT ON (gr.anchor_bl_id, upper(btrim(c.container_number)))
           gr.anchor_bl_id, c.id AS container_id, c.bl_id, upper(btrim(c.container_number)) AS container_key,
           c.container_number, c.type, c.discharge_date, c.return_date,
           b.free_time_override, b.demurrage_rate_override_p1_usd, b.demurrage_rate_override_p2_usd,
           -- 521 (D19): o previsto é a parte do Cliente na caixa dividida.
           public._demurrage_box_share_count(gr.voyage_id, upper(btrim(c.container_number)), gr.customer_id) AS share_count
      FROM groups AS gr
      JOIN public.bl_containers AS c ON c.bl_id = ANY(gr.group_ids)
      JOIN public.bls AS b ON b.id = c.bl_id
     WHERE c.ownership IS DISTINCT FROM 'SOC'
       AND NULLIF(btrim(c.container_number), '') IS NOT NULL
     ORDER BY gr.anchor_bl_id, upper(btrim(c.container_number)), (c.bl_id = gr.anchor_bl_id) DESC, c.id
  ), resolved AS (
    SELECT bx.*, gr.customer_id, gr.voyage_id,
           public._demurrage_canonical_type(bx.type) AS rate_group,
           rate.free_days AS table_free_days, rate.p1_day_to, rate.p1_usd AS table_p1_usd,
           rate.p2_day_from, rate.p2_usd AS table_p2_usd,
           agreement.free_days AS agreement_free_days, agreement.p1_usd AS agreement_p1_usd,
           agreement.p2_usd AS agreement_p2_usd,
           covering.invoice_id AS covered_by,
           waiver.id AS waiver_id
      FROM boxes AS bx
      JOIN groups AS gr ON gr.anchor_bl_id = bx.anchor_bl_id
      LEFT JOIN LATERAL (
        SELECT r.free_days, r.p1_day_to, r.p1_usd, r.p2_day_from, r.p2_usd
          FROM public._active_demurrage_rates(v_today) AS r
         WHERE public._demurrage_canonical_type(r.container_type) = public._demurrage_canonical_type(bx.type)
         ORDER BY r.valid_from DESC, r.id DESC
         LIMIT 1
      ) AS rate ON true
      LEFT JOIN LATERAL (
        SELECT a.free_days, a.p1_usd, a.p2_usd
          FROM public.customer_demurrage_agreements AS a
         WHERE a.customer_id = gr.customer_id AND a.active
           AND bx.discharge_date IS NOT NULL
           AND bx.discharge_date >= a.valid_from
           AND (a.valid_to IS NULL OR bx.discharge_date <= a.valid_to)
         ORDER BY a.valid_from DESC, a.id DESC
         LIMIT 1
      ) AS agreement ON true
      -- 517: dispensa da cobrança da caixa (Viagem, Cliente, número).
      LEFT JOIN LATERAL (
        SELECT w.id FROM public.demurrage_box_waivers AS w
         WHERE gr.customer_id IS NOT NULL AND w.revoked_at IS NULL
           AND w.voyage_id = gr.voyage_id AND w.customer_id = gr.customer_id AND w.container_key = bx.container_key
         LIMIT 1
      ) AS waiver ON true
      LEFT JOIN LATERAL (
        SELECT max(billed.invoice_id) AS invoice_id
          FROM public._demurrage_billed_container_keys(gr.voyage_id, gr.customer_id) AS billed
         WHERE gr.customer_id IS NOT NULL AND billed.container_key = bx.container_key
      ) AS covering ON true
  ), calculated AS (
    SELECT r.*,
           CASE WHEN r.discharge_date IS NULL THEN NULL
                ELSE (COALESCE(r.return_date, v_today) - r.discharge_date)::integer END AS total_days,
           COALESCE(r.free_time_override, r.agreement_free_days, r.table_free_days) AS free_days,
           CASE WHEN r.free_time_override IS NOT NULL THEN 'bl'
                WHEN r.agreement_free_days IS NOT NULL THEN 'acordo'
                WHEN r.table_free_days IS NOT NULL THEN 'tabela' END AS free_source,
           COALESCE(r.demurrage_rate_override_p1_usd, r.agreement_p1_usd, r.table_p1_usd) AS rate_p1_usd,
           COALESCE(r.demurrage_rate_override_p2_usd, r.agreement_p2_usd, r.table_p2_usd) AS rate_p2_usd
      FROM resolved AS r
  ), valued AS (
    SELECT c.*,
           (c.p1_day_to IS NULL OR c.p2_day_from IS NULL OR c.rate_p1_usd IS NULL OR c.rate_p2_usd IS NULL) AS no_rate,
           CASE WHEN c.total_days IS NULL OR c.free_days IS NULL OR c.p1_day_to IS NULL THEN NULL
                ELSE GREATEST(0, LEAST(c.total_days, c.p1_day_to) - c.free_days)::integer END AS days_p1,
           CASE WHEN c.total_days IS NULL OR c.free_days IS NULL OR c.p2_day_from IS NULL THEN NULL
                ELSE GREATEST(0, c.total_days - GREATEST(c.p2_day_from, c.free_days + 1) + 1)::integer END AS days_p2
      FROM calculated AS c
  ), boxed AS (
    SELECT v.*,
           CASE WHEN v.no_rate OR v.days_p1 IS NULL THEN NULL
                ELSE round((v.days_p1 * v.rate_p1_usd + v.days_p2 * v.rate_p2_usd) / GREATEST(1, v.share_count), 2) END AS usd,
           CASE
             WHEN v.covered_by IS NOT NULL THEN 'covered'
             WHEN v.waiver_id IS NOT NULL THEN 'waived'
             WHEN v.discharge_date IS NULL THEN 'no_discharge'
             -- D27: sem tarifa e sem free time de B/L ou acordo, desde a descarga;
             -- com free time, quando ele vence (não há diária para valorar).
             WHEN v.no_rate AND (v.free_days IS NULL OR v.total_days > v.free_days) THEN 'no_rate'
             WHEN v.return_date IS NULL AND v.free_days IS NOT NULL AND v.total_days > v.free_days THEN 'running'
             WHEN v.return_date IS NULL THEN 'in_free_time'
             WHEN v.free_days IS NOT NULL AND v.total_days > v.free_days THEN 'returned_overstay'
             ELSE 'returned_free'
           END AS state
      FROM valued AS v
  ), group_flags AS (
    SELECT gr.anchor_bl_id, gr.group_ids, gr.voyage_id, gr.customer_id, gr.cancelled,
           bool_or(bx.state = 'no_rate') AS has_no_rate,
           bool_or(bx.state = 'running') AS has_running,
           bool_or(bx.state IN ('returned_overstay', 'no_rate') AND bx.return_date IS NOT NULL) AS has_returned_overstay,
           bool_or(bx.state IN ('running', 'returned_overstay', 'no_rate')) AS has_overstay,
           bool_or(bx.return_date IS NULL AND bx.state <> 'waived') AS has_out,
           bool_or(bx.state = 'returned_overstay' AND COALESCE(bx.usd, 0) > 0) AS has_to_issue,
           string_agg(DISTINCT CASE WHEN bx.state = 'no_rate' THEN COALESCE(NULLIF(upper(btrim(bx.type)), ''), '(vazio)') END, ', ') AS no_rate_types,
           COALESCE(sum(bx.usd) FILTER (WHERE bx.state IN ('running', 'returned_overstay')), 0) AS usd
      FROM groups AS gr
      JOIN boxed AS bx ON bx.anchor_bl_id = gr.anchor_bl_id
     GROUP BY gr.anchor_bl_id, gr.group_ids, gr.voyage_id, gr.customer_id, gr.cancelled
  ), blocked AS (
    SELECT gf.*,
           CASE WHEN gf.customer_id IS NOT NULL AND NOT gf.cancelled AND gf.has_overstay
                THEN public._demurrage_issue_block_reason(gf.anchor_bl_id) END AS block_reason,
           CASE WHEN gf.customer_id IS NOT NULL AND NOT gf.cancelled AND gf.has_overstay
                THEN NOT public.bl_has_portal_release(gf.anchor_bl_id) END AS missing_ce
      FROM group_flags AS gf
  ), classified AS (
    SELECT bl.*,
           CASE
             WHEN bl.has_no_rate THEN 'travado'
             WHEN bl.cancelled AND bl.has_overstay THEN 'travado'
             WHEN bl.customer_id IS NULL AND bl.has_overstay THEN 'travado'
             WHEN NOT bl.has_out AND bl.has_to_issue AND bl.block_reason IS NOT NULL THEN 'travado'
             WHEN bl.has_running THEN 'correndo'
             WHEN bl.has_out AND bl.has_returned_overstay THEN 'esperando'
             WHEN NOT bl.has_out AND bl.has_to_issue THEN 'a_emitir'
           END AS division,
           CASE
             WHEN bl.has_no_rate THEN 'sem_tarifa'
             WHEN bl.cancelled AND bl.has_overstay THEN 'bl_cancelado'
             WHEN bl.customer_id IS NULL AND bl.has_overstay THEN 'sem_cliente'
             WHEN NOT bl.has_out AND bl.has_to_issue AND bl.block_reason IS NOT NULL
               THEN CASE WHEN bl.missing_ce THEN 'sem_ce' ELSE 'portal' END
           END AS reason_code
      FROM blocked AS bl
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'anchor_bl_id', cl.anchor_bl_id,
           'bl_ids', to_jsonb(cl.group_ids),
           'voyage_id', cl.voyage_id,
           'voyage_label', (SELECT COALESCE(ve.name, '') || ' / ' || vo.voyage_number
                              FROM public.voyages AS vo LEFT JOIN public.vessels AS ve ON ve.id = vo.vessel_id
                             WHERE vo.id = cl.voyage_id),
           'customer_id', cl.customer_id,
           'customer_name', (SELECT cu.name FROM public.customers AS cu WHERE cu.id = cl.customer_id),
           'customer_cnpj', (SELECT cu.cnpj_cpf FROM public.customers AS cu WHERE cu.id = cl.customer_id),
           'division', cl.division,
           'reason_code', cl.reason_code,
           'reason', CASE cl.reason_code
             WHEN 'sem_tarifa' THEN format('Tipo %s sem tarifa de Demurrage.', cl.no_rate_types)
             WHEN 'bl_cancelado' THEN format('B/L %s cancelado com sobreestadia sem Invoice.', cl.anchor_bl_id)
             WHEN 'sem_cliente' THEN format('B/L %s sem Cliente vinculado.', cl.anchor_bl_id)
             ELSE cl.block_reason END,
           -- Em Correndo e Esperando, o que vai travar a emissão já aparece.
           'warning', CASE WHEN cl.division IN ('correndo', 'esperando') THEN cl.block_reason END,
           'no_rate_types', cl.no_rate_types,
           -- 525: em A emitir, a Invoice cancelada à mão que as caixas esperam
           -- (D10: sem Invoice nova automática) e a emissão já na fila.
           'cancelled_doc', CASE WHEN cl.division = 'a_emitir' THEN (
             SELECT di.doc_number
               FROM public.demurrage_invoices AS di
               JOIN public.bls AS ib ON ib.id = di.bl_id
               JOIN public.demurrage_invoice_items AS it ON it.invoice_id = di.id
              WHERE di.status = 'cancelled' AND di.customer_id = cl.customer_id AND ib.voyage_id = cl.voyage_id
                AND upper(btrim(it.container_number)) IN (
                  SELECT bx.container_key FROM boxed AS bx
                   WHERE bx.anchor_bl_id = cl.anchor_bl_id AND bx.state = 'returned_overstay')
                AND NOT EXISTS (
                  SELECT 1 FROM public.demurrage_invoices AS live
                   WHERE live.replaces_invoice_id = di.id AND live.status IN ('issued', 'overdue', 'paid'))
              ORDER BY di.id DESC LIMIT 1) END,
           'issue_queued', CASE WHEN cl.division = 'a_emitir' THEN EXISTS (
             SELECT 1 FROM public.import_pending_effects AS e
              WHERE e.effect_kind = 'demurrage_billing'
                AND e.entity_id = ANY (cl.group_ids)
                AND e.status IN ('pending', 'running', 'retry_wait')) ELSE false END,
           'usd', cl.usd,
           'boxes', (SELECT jsonb_agg(jsonb_build_object(
                       'container_id', bx.container_id, 'bl_id', bx.bl_id,
                       'container_number', bx.container_number, 'type', bx.type, 'rate_group', bx.rate_group,
                       'discharge_date', bx.discharge_date, 'return_date', bx.return_date,
                       'total_days', bx.total_days, 'free_days', bx.free_days, 'free_source', bx.free_source,
                       'last_free_day', CASE WHEN bx.discharge_date IS NOT NULL AND bx.free_days IS NOT NULL THEN bx.discharge_date + bx.free_days END,
                       'days_p1', bx.days_p1, 'rate_p1_usd', bx.rate_p1_usd,
                       'days_p2', bx.days_p2, 'rate_p2_usd', bx.rate_p2_usd,
                       'usd', CASE WHEN bx.state IN ('running', 'returned_overstay') THEN bx.usd END,
                       'state', bx.state,
                       'covered_by', bx.covered_by,
                       'covered_doc', (SELECT di.doc_number FROM public.demurrage_invoices AS di WHERE di.id = bx.covered_by),
                       'waiver_id', bx.waiver_id,
                       'box_share_count', GREATEST(1, bx.share_count)
                     ) ORDER BY bx.container_key)
                       FROM boxed AS bx WHERE bx.anchor_bl_id = cl.anchor_bl_id)
         ) ORDER BY cl.anchor_bl_id), '[]'::jsonb)
    INTO v_result
    FROM classified AS cl
   WHERE cl.division IS NOT NULL;
  RETURN v_result;
END;
$function$;

-- Corpo da 516 com a fila de emissão de A emitir.
CREATE OR REPLACE FUNCTION public.reconcile_demurrage_travado_alerts(p_voyage_id bigint DEFAULT NULL::bigint, p_source text DEFAULT 'demurrage_travado'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_previous_role text := current_setting('request.jwt.claim.role', true);
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
  v_previous_claims text := current_setting('request.jwt.claims', true);
  v_group jsonb;
  v_board jsonb;
  v_travado text[] := ARRAY[]::text[];
  v_department text;
  v_current text;
  v_item RECORD;
  v_open integer := 0;
BEGIN
  v_board := public._demurrage_billing_board_core(NULL, p_voyage_id);
  -- Chamada também pelo pg_cron e por gatilhos: o Alerta exige executor
  -- autorizado e é do sistema, não de quem gravou a data ou o CE.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  -- 525: o grupo em A emitir parado (a sobreestadia veio da mudança de free
  -- time, tarifa ou acordo, ou de dispensa desfeita, sem gravação de data) vai
  -- para a fila de emissão. Fica de fora o que espera Invoice cancelada à mão
  -- (D10) e o que já está na fila.
  -- Só na rotina: nos gatilhos (CE, Cliente, datas) a emissão já tem o
  -- caminho próprio, e enfileirar ali duplicaria o efeito.
  IF p_source = 'demurrage-travado-alerts' THEN
    FOR v_group IN SELECT value FROM jsonb_array_elements(v_board)
      WHERE value->>'division' = 'a_emitir' AND value->>'cancelled_doc' IS NULL
        AND NOT COALESCE((value->>'issue_queued')::boolean, false)
    LOOP
      INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id, created_by)
      VALUES (gen_random_uuid(), 'demurrage_billing', v_group->>'anchor_bl_id', NULL);
    END LOOP;
  END IF;

  FOR v_group IN SELECT value FROM jsonb_array_elements(v_board) WHERE value->>'division' = 'travado' LOOP
    v_travado := v_travado || (v_group->>'anchor_bl_id');
    v_department := CASE WHEN v_group->>'reason_code' IN ('sem_tarifa', 'bl_cancelado') THEN 'administrativo' ELSE 'documentacao' END;
    SELECT i.department INTO v_current
      FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
     WHERE i.item_type = 'demurrage_travado' AND i.status = 'active'
       AND a.entity_type = 'bl' AND a.entity_id = v_group->>'anchor_bl_id'
     ORDER BY i.id DESC LIMIT 1;
    IF v_current IS NOT NULL AND v_current <> v_department THEN
      PERFORM public.resolve_alert_item('demurrage_travado', 'bl', v_group->>'anchor_bl_id', p_source,
        jsonb_build_object('reason', 'motivo_mudou'));
    END IF;
    PERFORM public.upsert_alert_item(
      'demurrage_travado', 'bl', v_group->>'anchor_bl_id',
      format('Demurrage do B/L %s travada: %s', v_group->>'anchor_bl_id', v_group->>'reason'),
      p_source, v_department,
      jsonb_build_object('bl_id', v_group->>'anchor_bl_id', 'bl_ids', v_group->'bl_ids',
        'reason_code', v_group->>'reason_code', 'no_rate_types', v_group->>'no_rate_types',
        'customer_id', v_group->'customer_id', 'voyage_id', v_group->'voyage_id', 'usd', v_group->'usd'),
      '/demurrage?divisao=travado&busca=' || (v_group->>'anchor_bl_id'));
    v_open := v_open + 1;
  END LOOP;

  -- Fecha pela origem o que saiu de Travado no recorte reconciliado.
  FOR v_item IN
    SELECT DISTINCT a.entity_id
      FROM public.alert_items i
      JOIN public.alerts a ON a.id = i.alert_id
      LEFT JOIN public.bls b ON b.id = a.entity_id
     WHERE i.item_type = 'demurrage_travado' AND i.status = 'active' AND a.entity_type = 'bl'
       AND (p_voyage_id IS NULL OR b.voyage_id = p_voyage_id OR b.id IS NULL)
       AND NOT (a.entity_id = ANY (v_travado))
  LOOP
    PERFORM public.resolve_alert_item('demurrage_travado', 'bl', v_item.entity_id, p_source, '{}'::jsonb);
  END LOOP;

  PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_role, ''), true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_sub, ''), true);
  PERFORM set_config('request.jwt.claims', COALESCE(v_previous_claims, ''), true);
  RETURN v_open;
END;
$function$;

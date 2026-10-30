-- 530: decisões do dono de 2026-10-30 sobre a revisão final da PR
-- luccafwlog/vela#1113 (ADR 0112 D7, D10, D16, D24 e D26).
--
-- 1. Invoice cancelada à mão espera o Gerar Invoice em todo caminho: antes, a
--    gravação de data, o CE ou a troca de Cliente punham a emissão na fila e a
--    Invoice nova saía sozinha. O executor da fila (`_run_import_effect_demurrage`)
--    não emite o grupo que a aba Containers mostra esperando a Invoice
--    cancelada à mão. "À mão" é o cancelamento que não foi automático
--    (`_demurrage_cancelled_by_hand`): a classificação passa a usar a mesma
--    regra, e a cancelada pela reemissão automática não aparece como à mão.
-- 2. A dispensa da cobrança acompanha a troca de Cliente do B/L (correção de
--    CNPJ), com registro na auditoria; antes ficava presa ao Cliente antigo e
--    a caixa voltava a ser cobrada.
-- 3. Cancelar B/L sem Cliente, ou com caixa de tipo sem tarifa e sem free
--    time, com sobreestadia ou travada, passa a ser recusado como no D7 e D26;
--    a dispensa aceita a caixa de B/L sem Cliente, para o B/L criado por
--    engano poder ser cancelado.
-- 4. Cancelar a Invoice com Disputa aberta mandava ao Cliente o motivo
--    interno do cancelamento automático (na troca de CNPJ, a situação do
--    Portal do Cliente novo). O Cliente lê um texto próprio; o motivo do
--    cancelamento à mão continua indo como escrito (D16).
--
-- Não reescreve nem apaga linhas existentes (a coluna `customer_id` da
-- dispensa só deixa de ser obrigatória).
--
-- Rollback: recriar `_demurrage_billing_board_core` (526),
-- `_run_import_effect_demurrage`, `_demurrage_waived_container_keys`,
-- `waive_demurrage_box` e `bl_open_financial_reasons` (517) e
-- `_demurrage_cancel_dispute_with_invoice` (520); apagar
-- `_demurrage_cancelled_by_hand`, `_demurrage_waivers_follow_customer` e o
-- gatilho; recriar o índice sem NULLS NOT DISTINCT e `customer_id NOT NULL`.

-- Decisão 2: a Invoice cancelada à mão é a que não saiu por cancelamento
-- automático (datas, SOC, divisão da caixa, reemissão por troca de CNPJ).
CREATE OR REPLACE FUNCTION public._demurrage_cancelled_by_hand(p_invoice_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((
    SELECT NOT (COALESCE(a.justification, '') LIKE 'Datas de container alteradas: cancelada para reemissão%'
             OR COALESCE(a.justification, '') LIKE 'Troca de CNPJ do B/L %')
      FROM public.audit_logs AS a
     WHERE a.entity_type = 'demurrage_invoice' AND a.entity_id = p_invoice_id::text
       AND a.field_name = 'status' AND a.new_value = 'cancelled'
     ORDER BY a.changed_at DESC, a.id DESC LIMIT 1), true);
$function$;
REVOKE ALL ON FUNCTION public._demurrage_cancelled_by_hand(bigint) FROM PUBLIC, anon, authenticated;

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
       -- 526: a caixa do B/L cancelado que um B/L ativo do mesmo Cliente na
       -- Viagem segura é cobrada por ele (517 aceita esse cancelamento); não
       -- aparece também no cancelado.
       AND NOT (gr.cancelled AND gr.customer_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.bl_containers AS oc JOIN public.bls AS ob ON ob.id = oc.bl_id
          WHERE ob.voyage_id = gr.voyage_id AND ob.customer_id = gr.customer_id AND ob.cancelled_at IS NULL
            AND oc.ownership IS DISTINCT FROM 'SOC'
            AND upper(btrim(oc.container_number)) = upper(btrim(c.container_number))))
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
         WHERE w.revoked_at IS NULL
           AND w.voyage_id = gr.voyage_id AND w.customer_id IS NOT DISTINCT FROM gr.customer_id
           AND w.container_key = bx.container_key
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
             -- 526: devolvida dentro do free time também (D32): a emissão
             -- recusa o grupo com caixa sem tarifa.
             WHEN v.no_rate AND (v.free_days IS NULL OR v.total_days > v.free_days OR v.return_date IS NOT NULL) THEN 'no_rate'
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
           bool_or(bx.state = 'no_rate' AND NOT EXISTS (
             SELECT 1 FROM public.container_types AS t WHERE t.code = upper(btrim(COALESCE(bx.type, ''))))) AS no_rate_new_type,
           bool_or(bx.state = 'no_rate' AND EXISTS (
             SELECT 1 FROM public.container_types AS t WHERE t.code = upper(btrim(COALESCE(bx.type, ''))) AND NOT t.active)) AS no_rate_inactive_type,
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
           -- 526: o que destrava o "sem tarifa": tipo fora do cadastro, tipo
           -- desativado ou tarifa do grupo (D4, D27, D32).
           'no_rate_kind', CASE WHEN cl.reason_code = 'sem_tarifa' THEN
             CASE WHEN cl.no_rate_new_type THEN 'tipo_novo' WHEN cl.no_rate_inactive_type THEN 'tipo_inativo' ELSE 'tarifa' END END,
           -- 525: em A emitir, a Invoice cancelada à mão que as caixas esperam
           -- (D10: sem Invoice nova automática) e a emissão já na fila.
           'cancelled_doc', CASE WHEN cl.division = 'a_emitir' THEN (
             SELECT di.doc_number
               FROM public.demurrage_invoices AS di
               JOIN public.bls AS ib ON ib.id = di.bl_id
               JOIN public.demurrage_invoice_items AS it ON it.invoice_id = di.id
              WHERE di.status = 'cancelled' AND di.customer_id = cl.customer_id AND ib.voyage_id = cl.voyage_id
                -- 530: só a cancelada à mão; a automática tem reemissão própria.
                AND public._demurrage_cancelled_by_hand(di.id)
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

CREATE OR REPLACE FUNCTION public._run_import_effect_demurrage(p_effect_id bigint, p_bl_id text, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl record;
  v_group jsonb;
BEGIN
  SELECT id, voyage_id, customer_id INTO v_bl FROM public.bls WHERE id = p_bl_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado para Demurrage.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  -- 530 (decisão do dono de 2026-10-30, D10): grupo cuja Invoice foi
  -- cancelada à mão espera o Gerar Invoice; nenhum caminho automático (datas,
  -- CE, Cliente, rotina) emite por ele. A mesma regra da aba Containers.
  IF v_bl.customer_id IS NOT NULL THEN
    SELECT grp.value INTO v_group
      FROM jsonb_array_elements(public._demurrage_billing_board_core(v_bl.customer_id, v_bl.voyage_id)) AS grp(value)
     WHERE grp.value->'bl_ids' ? p_bl_id
     LIMIT 1;
    IF v_group->>'division' = 'a_emitir' AND v_group->>'cancelled_doc' IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'awaiting_manual_issue', 'bl_id', p_bl_id,
        'cancelled_doc', v_group->>'cancelled_doc');
    END IF;
  END IF;
  RETURN public.issue_demurrage_invoice_for_bl(p_bl_id, NULL);
END;
$function$;

-- Decisão 4: a dispensa aceita a caixa de B/L sem Cliente.
ALTER TABLE public.demurrage_box_waivers ALTER COLUMN customer_id DROP NOT NULL;
DROP INDEX IF EXISTS public.demurrage_box_waivers_active_key;
CREATE UNIQUE INDEX demurrage_box_waivers_active_key ON public.demurrage_box_waivers
  (voyage_id, customer_id, container_key) NULLS NOT DISTINCT WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public._demurrage_waived_container_keys(p_voyage_id bigint, p_customer_id bigint)
 RETURNS TABLE(container_key text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT w.container_key FROM public.demurrage_box_waivers AS w
   WHERE w.voyage_id = p_voyage_id AND w.customer_id IS NOT DISTINCT FROM p_customer_id AND w.revoked_at IS NULL;
$function$;

CREATE OR REPLACE FUNCTION public.waive_demurrage_box(p_bl_id text, p_container_number text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_key text := upper(btrim(COALESCE(p_container_number, '')));
  v_bl record;
  v_id bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para dispensar a cobrança.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 10 THEN
    RAISE EXCEPTION 'Informe a justificativa da dispensa (mínimo de 10 caracteres).' USING ERRCODE = '22023';
  END IF;
  SELECT b.id, b.voyage_id, b.customer_id INTO v_bl FROM public.bls AS b WHERE b.id = p_bl_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  -- 530 (decisão do dono de 2026-10-30): B/L sem Cliente também dispensa,
  -- para o B/L criado por engano poder ser cancelado (D7, D26).
  IF NOT EXISTS (
    SELECT 1 FROM public.bl_containers AS c
     WHERE c.bl_id = p_bl_id AND upper(btrim(c.container_number)) = v_key AND c.ownership IS DISTINCT FROM 'SOC'
  ) THEN
    RAISE EXCEPTION 'O container % não é do B/L % ou é SOC.', v_key, p_bl_id USING ERRCODE = '22023';
  END IF;
  PERFORM public._lock_demurrage_box_billing(v_bl.voyage_id, v_bl.customer_id);
  IF EXISTS (
    SELECT 1 FROM public._demurrage_billed_container_keys(v_bl.voyage_id, v_bl.customer_id) AS billed
     WHERE billed.container_key = v_key
  ) THEN
    RAISE EXCEPTION 'O container % já está numa Invoice de Demurrage ou com a cobrança dispensada.', v_key USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.demurrage_box_waivers (voyage_id, customer_id, container_key, bl_id, reason, created_by)
  VALUES (v_bl.voyage_id, v_bl.customer_id, v_key, p_bl_id, v_reason, auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bl', p_bl_id, 'demurrage_dispensa', NULL, v_key, auth.uid(), v_reason);
  PERFORM public.reconcile_demurrage_travado_alerts(v_bl.voyage_id, 'demurrage_dispensa');
  RETURN jsonb_build_object('waiver_id', v_id, 'container_key', v_key);
END;
$function$;

CREATE OR REPLACE FUNCTION public.bl_open_financial_reasons(p_bl_id text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reasons text[] := ARRAY[]::text[];
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.status IN ('draft', 'issued', 'partially_paid')
      AND (i.bl_id = p_bl_id OR EXISTS (SELECT 1 FROM public.invoice_bls ib WHERE ib.invoice_id = i.id AND ib.bl_id = p_bl_id))
  ) THEN
    v_reasons := array_append(v_reasons, 'fatura em aberto');
  END IF;
  -- Só o recebível ligado a fatura viva ou com baixa trava; o resto é anulado
  -- (362: vínculo de fatura cancelada não trava, decisão 12).
  IF EXISTS (
    SELECT 1 FROM public.bl_receivables r
    WHERE r.bl_id = p_bl_id AND r.status IN ('open', 'partially_settled')
      AND (r.settled_amount_brl > 0
           OR EXISTS (SELECT 1 FROM public.invoice_receivable_links l JOIN public.invoices li ON li.id = l.invoice_id WHERE l.receivable_id = r.id AND COALESCE(l.status, '') <> 'obsolete' AND coalesce(li.status, 'issued') NOT IN ('cancelled', 'obsolete'))
           OR EXISTS (SELECT 1 FROM public.ledger_settlements s WHERE s.receivable_id = r.id))
  ) THEN
    v_reasons := array_append(v_reasons, 'recebível em aberto');
  END IF;
  -- A Invoice do grupo é emitida no B/L-âncora com as caixas dos irmãos
  -- (ADR 0078, item 20): o item que aponta para container deste B/L também
  -- trava, como a Invoice do próprio B/L.
  IF EXISTS (
    SELECT 1 FROM public.demurrage_invoices d
    WHERE d.status IN ('draft', 'issued', 'overdue')
      AND (d.bl_id = p_bl_id OR EXISTS (
        SELECT 1 FROM public.demurrage_invoice_items AS item
        JOIN public.bl_containers AS c ON c.id = item.container_id
        WHERE item.invoice_id = d.id AND c.bl_id = p_bl_id
      ))
  ) THEN
    v_reasons := array_append(v_reasons, 'fatura de Demurrage em aberto');
  END IF;
  -- 517 (ADR 0112, D7 e D26): caixa do B/L com sobreestadia sem Invoice viva
  -- nem dispensa, devolvida ou ainda fora e passada do free time, que nenhum
  -- outro B/L ativo do mesmo Cliente na Viagem segura: cancelar perderia a
  -- cobrança. Sai com a Invoice emitida ou com a dispensa.
  IF EXISTS (
    SELECT 1
      FROM public.bls AS b
      JOIN public.voyages AS v ON v.id = b.voyage_id
      JOIN public.bl_containers AS c ON c.bl_id = b.id
     WHERE b.id = p_bl_id AND b.customer_id IS NOT NULL
       AND v.status IS DISTINCT FROM 'cancelled'
       AND c.ownership IS DISTINCT FROM 'SOC'
       AND c.discharge_date IS NOT NULL
       AND NULLIF(btrim(c.container_number), '') IS NOT NULL
       AND public._container_free_days(b.id, c.type, c.discharge_date) IS NOT NULL
       AND (COALESCE(c.return_date, (now() AT TIME ZONE 'America/Sao_Paulo')::date) - c.discharge_date)
           > public._container_free_days(b.id, c.type, c.discharge_date)
       AND NOT EXISTS (
         SELECT 1 FROM public._demurrage_billed_container_keys(b.voyage_id, b.customer_id) AS billed
          WHERE billed.container_key = upper(btrim(c.container_number)))
       AND NOT EXISTS (
         SELECT 1 FROM public.bl_containers AS other_c
         JOIN public.bls AS other ON other.id = other_c.bl_id
          WHERE other.id <> b.id AND other.cancelled_at IS NULL
            AND other.voyage_id = b.voyage_id AND other.customer_id = b.customer_id
            AND upper(btrim(other_c.container_number)) = upper(btrim(c.container_number)))
  ) THEN
    v_reasons := array_append(v_reasons, 'Demurrage a faturar: devolva o container e emita a Invoice, ou dispense a cobrança na Demurrage');
  END IF;
  -- 530 (decisão do dono de 2026-10-30): B/L sem Cliente, ou caixa de tipo
  -- sem tarifa e sem free time (Travado desde a descarga, D27), com
  -- sobreestadia ou travada e sem dispensa: cancelar também perderia a
  -- cobrança em silêncio.
  IF EXISTS (
    SELECT 1
      FROM public.bls AS b
      JOIN public.voyages AS v ON v.id = b.voyage_id
      JOIN public.bl_containers AS c ON c.bl_id = b.id
     WHERE b.id = p_bl_id
       AND v.status IS DISTINCT FROM 'cancelled'
       AND c.ownership IS DISTINCT FROM 'SOC'
       AND c.discharge_date IS NOT NULL
       AND NULLIF(btrim(c.container_number), '') IS NOT NULL
       AND (b.customer_id IS NULL OR public._container_free_days(b.id, c.type, c.discharge_date) IS NULL)
       AND (public._container_free_days(b.id, c.type, c.discharge_date) IS NULL
            OR (COALESCE(c.return_date, (now() AT TIME ZONE 'America/Sao_Paulo')::date) - c.discharge_date)
               > public._container_free_days(b.id, c.type, c.discharge_date))
       AND NOT EXISTS (
         SELECT 1 FROM public._demurrage_billed_container_keys(b.voyage_id, b.customer_id) AS billed
          WHERE billed.container_key = upper(btrim(c.container_number)))
  ) THEN
    v_reasons := array_append(v_reasons, 'Demurrage travada: vincule o Cliente ou cadastre a tarifa e emita a Invoice, ou dispense a cobrança na Demurrage');
  END IF;
  RETURN v_reasons;
END;
$function$;

-- Decisão 3: a dispensa da caixa acompanha a troca de Cliente do B/L. Roda
-- antes da troca gravar, para a reemissão pela troca de CNPJ (484) e a fila
-- já verem a caixa dispensada no Cliente novo.
CREATE OR REPLACE FUNCTION public._demurrage_waivers_follow_customer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_waiver record;
BEGIN
  FOR v_waiver IN
    SELECT w.id, w.container_key
      FROM public.demurrage_box_waivers AS w
     WHERE w.revoked_at IS NULL AND w.voyage_id = NEW.voyage_id
       AND w.customer_id IS NOT DISTINCT FROM OLD.customer_id
       AND w.container_key IN (
         SELECT upper(btrim(c.container_number)) FROM public.bl_containers AS c WHERE c.bl_id = NEW.id)
       -- Outro B/L ativo do Cliente antigo com a caixa: a dispensa é dele.
       AND NOT EXISTS (
         SELECT 1 FROM public.bl_containers AS oc JOIN public.bls AS ob ON ob.id = oc.bl_id
          WHERE ob.id <> NEW.id AND ob.cancelled_at IS NULL AND ob.voyage_id = NEW.voyage_id
            AND ob.customer_id IS NOT DISTINCT FROM OLD.customer_id
            AND upper(btrim(oc.container_number)) = w.container_key)
       -- O Cliente novo já tem a caixa dispensada.
       AND NOT EXISTS (
         SELECT 1 FROM public.demurrage_box_waivers AS nw
          WHERE nw.revoked_at IS NULL AND nw.voyage_id = NEW.voyage_id
            AND nw.customer_id IS NOT DISTINCT FROM NEW.customer_id AND nw.container_key = w.container_key)
  LOOP
    UPDATE public.demurrage_box_waivers SET customer_id = NEW.customer_id WHERE id = v_waiver.id;
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bl', NEW.id, 'demurrage_dispensa', OLD.customer_id::text, NEW.customer_id::text, auth.uid(),
      format('A dispensa da cobrança da caixa %s acompanhou a troca de Cliente do B/L.', v_waiver.container_key));
  END LOOP;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._demurrage_waivers_follow_customer() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_bls_waivers_follow_customer
  BEFORE UPDATE OF customer_id ON public.bls
  FOR EACH ROW WHEN (NEW.customer_id IS DISTINCT FROM OLD.customer_id AND NEW.customer_id IS NOT NULL)
  EXECUTE FUNCTION public._demurrage_waivers_follow_customer();

CREATE OR REPLACE FUNCTION public._demurrage_cancel_dispute_with_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_dispute public.demurrage_disputes%ROWTYPE;
  v_reason text;
  v_doc text;
  v_previous_flag text := current_setting('alerts.foundation_trigger', true);
BEGIN
  SELECT * INTO v_dispute FROM public.demurrage_disputes
   WHERE demurrage_invoice_id = NEW.id AND state = 'aberta'
   ORDER BY id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.demurrage_invoices WHERE id = NEW.id AND status = 'cancelled') THEN
    RETURN NULL;
  END IF;
  -- O motivo é o do cancelamento, gravado na mesma transação pelo caminho
  -- que cancelou (à mão, reemissão por datas ou troca de CNPJ).
  SELECT NULLIF(btrim(a.justification), '') INTO v_reason
    FROM public.audit_logs AS a
   WHERE a.entity_type = 'demurrage_invoice' AND a.entity_id = NEW.id::text
     AND a.field_name = 'status' AND a.new_value = 'cancelled'
   ORDER BY a.changed_at DESC, a.id DESC LIMIT 1;
  v_reason := COALESCE(v_reason, 'Invoice cancelada.');
  -- 530: o motivo do cancelamento automático é texto interno (cita o Portal
  -- de outro Cliente na troca de CNPJ); o Cliente lê um texto próprio. O
  -- motivo do cancelamento à mão vai como escrito (D16), e a tela avisa.
  v_reason := CASE
    WHEN v_reason LIKE 'Datas de container alteradas: cancelada para reemissão%'
      THEN 'a Invoice foi recalculada e substituída por uma nova.'
    WHEN v_reason LIKE 'Troca de CNPJ do B/L %'
      THEN 'o B/L passou a outro Cliente.'
    ELSE v_reason END;
  SELECT doc_number INTO v_doc FROM public.demurrage_invoices WHERE id = NEW.id;

  INSERT INTO public.demurrage_dispute_messages(dispute_id, author_id, author_type, body, next_responder, metadata)
  VALUES (v_dispute.id, NULL, 'sistema',
    format('A Invoice %s foi cancelada e esta disputa foi encerrada junto. Motivo: %s', v_doc, v_reason),
    'ninguem', jsonb_build_object('action', 'invoice_cancelled', 'reason', v_reason));
  -- Pelo gatilho da Invoice, a Disputa fica `cancelada` e o Alerta da
  -- Disputa (`portal_dispute_opened`) fecha.
  UPDATE public.demurrage_invoices SET dispute_open = false, dispute_status = 'cancelado' WHERE id = NEW.id;
  UPDATE public.demurrage_disputes SET state = 'cancelada', next_responder = 'ninguem', cancelled_at = COALESCE(cancelled_at, now())
   WHERE id = v_dispute.id AND state <> 'cancelada';
  INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
  VALUES (v_dispute.customer_id, NULL, 'dispute_cancelled', 'Disputa encerrada',
    format('A Invoice de Demurrage %s foi cancelada e a disputa foi encerrada. Motivo: %s', v_doc, v_reason),
    '/portal/billing?tab=demurrage&disputas=1&disputa=' || v_dispute.id);
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  PERFORM public.resolve_alert_item('portal_dispute_opened', 'demurrage_invoice', NEW.id::text, 'demurrage_invoice_cancelled', '{}'::jsonb);
  PERFORM public.resolve_alert_item('demurrage_disputa_prazo', 'demurrage_invoice', NEW.id::text, 'demurrage_invoice_cancelled', '{}'::jsonb);
  PERFORM set_config('alerts.foundation_trigger', COALESCE(v_previous_flag, ''), true);
  RETURN NULL;
END;
$function$;

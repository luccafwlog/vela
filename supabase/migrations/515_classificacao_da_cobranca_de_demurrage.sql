-- 515: Classificação da cobrança de Demurrage no banco (lote 1 do plano da
-- repaginação da Demurrage; ADR 0112, D1 a D5, D25 e D27).
--
-- Antes, a aba Containers montava o grupo, a cobertura e o rótulo no navegador
-- (`buildBillingGroups`, `blBillingState`, filtro `monitored`), a partir do
-- status gravado do container; o B/L sem CE, sem Cliente ou cancelado aparecia
-- "A faturar" com Gerar Invoice que o banco recusava, e o tipo sem tarifa
-- nunca aparecia.
--
-- Agora:
-- 1. `list_demurrage_billing_board(p_customer_id, p_voyage_id)` devolve, por
--    grupo de cobrança (`demurrage_group_bl_ids`), as caixas não-SOC com o
--    cálculo de hoje (mesma regra de `_calculate_demurrage_invoice_authoritative`,
--    com a data de hoje no lugar da devolução da caixa fora), a cobertura por
--    Invoice viva e a divisão do grupo, pela ordem:
--    - Travado: tipo sem tarifa (sem free time de B/L ou acordo desde a
--      descarga; com free time, quando ele vence), B/L sem Cliente com
--      sobreestadia, B/L cancelado com sobreestadia sem Invoice, ou tudo
--      devolvido e a emissão travada (sem CE Mercante ou Gate do Portal);
--    - Correndo: alguma caixa sem Invoice fora e passada do free time;
--    - Esperando: nenhuma correndo, alguma caixa ainda fora (no free time ou
--      sem descarga) e alguma devolvida com sobreestadia sem Invoice;
--    - A emitir: tudo devolvido e alguma caixa sem Invoice com valor;
--    - fora da aba: o resto.
--    Viagem cancelada não cobra (gatilho da migration 200) e fica fora.
-- 2. O status gravado (`bl_containers.demurrage_status`) passa a ser refeito
--    na hora em que muda o free time: condição ou Cliente do B/L, acordo do
--    Cliente, tarifa ou cadastro de tipos (D2). O job da madrugada fica como
--    rede de segurança.
--
-- Não muda dado.
--
-- Rollback: apagar `list_demurrage_billing_board`,
-- `_demurrage_billing_board_core`, `_refresh_demurrage_status_of_bls` e os
-- gatilhos `trg_bls_refresh_demurrage_status`,
-- `trg_agreements_refresh_demurrage_status`,
-- `trg_rates_refresh_demurrage_status` e
-- `trg_container_types_refresh_demurrage_status` com as funções deles.

CREATE OR REPLACE FUNCTION public._demurrage_billing_board_core(
  p_customer_id bigint DEFAULT NULL,
  p_voyage_id bigint DEFAULT NULL)
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
           b.free_time_override, b.demurrage_rate_override_p1_usd, b.demurrage_rate_override_p2_usd
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
           covering.invoice_id AS covered_by
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
                ELSE round(v.days_p1 * v.rate_p1_usd + v.days_p2 * v.rate_p2_usd, 2) END AS usd,
           CASE
             WHEN v.covered_by IS NOT NULL THEN 'covered'
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
           bool_or(bx.return_date IS NULL) AS has_out,
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
                       'covered_doc', (SELECT di.doc_number FROM public.demurrage_invoices AS di WHERE di.id = bx.covered_by)
                     ) ORDER BY bx.container_key)
                       FROM boxed AS bx WHERE bx.anchor_bl_id = cl.anchor_bl_id)
         ) ORDER BY cl.anchor_bl_id), '[]'::jsonb)
    INTO v_result
    FROM classified AS cl
   WHERE cl.division IS NOT NULL;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public._demurrage_billing_board_core(bigint, bigint) FROM PUBLIC, anon, authenticated;

-- Leitura da aba Containers, dos cartões, do Por Cliente e do relatório
-- Exposição: usuário interno ativo.
CREATE OR REPLACE FUNCTION public.list_demurrage_billing_board(
  p_customer_id bigint DEFAULT NULL,
  p_voyage_id bigint DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de leitura.' USING ERRCODE = '42501';
  END IF;
  RETURN public._demurrage_billing_board_core(p_customer_id, p_voyage_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.list_demurrage_billing_board(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_demurrage_billing_board(bigint, bigint) TO authenticated;

-- Status gravado na hora em que muda o free time (D2). NULL refaz todos os
-- containers ainda fora; o job da madrugada continua como rede.
CREATE OR REPLACE FUNCTION public._refresh_demurrage_status_of_bls(p_bl_ids text[] DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_updated integer := 0;
BEGIN
  UPDATE public.bl_containers AS c
     SET demurrage_status = target.status
    FROM (
      SELECT c2.id,
             public._container_demurrage_status(c2.bl_id, c2.type, c2.discharge_date, c2.return_date, c2.ownership) AS status
        FROM public.bl_containers AS c2
       WHERE c2.return_date IS NULL
         AND (p_bl_ids IS NULL OR c2.bl_id = ANY(p_bl_ids))
    ) AS target
   WHERE c.id = target.id
     AND c.demurrage_status IS DISTINCT FROM target.status;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$function$;
REVOKE ALL ON FUNCTION public._refresh_demurrage_status_of_bls(text[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._bls_refresh_demurrage_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.free_time_override IS DISTINCT FROM OLD.free_time_override
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    PERFORM public._refresh_demurrage_status_of_bls(ARRAY[NEW.id]);
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._bls_refresh_demurrage_status() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_bls_refresh_demurrage_status
  AFTER UPDATE OF free_time_override, customer_id ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public._bls_refresh_demurrage_status();

CREATE OR REPLACE FUNCTION public._agreements_refresh_demurrage_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customers bigint[];
BEGIN
  v_customers := ARRAY_REMOVE(ARRAY[
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.customer_id END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.customer_id END], NULL);
  PERFORM public._refresh_demurrage_status_of_bls(
    (SELECT COALESCE(array_agg(b.id), ARRAY[]::text[]) FROM public.bls AS b WHERE b.customer_id = ANY(v_customers)));
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._agreements_refresh_demurrage_status() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_agreements_refresh_demurrage_status
  AFTER INSERT OR UPDATE OR DELETE ON public.customer_demurrage_agreements
  FOR EACH ROW EXECUTE FUNCTION public._agreements_refresh_demurrage_status();

-- Tarifa e cadastro de tipos valem para todos os containers: uma vez por comando.
CREATE OR REPLACE FUNCTION public._catalog_refresh_demurrage_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._refresh_demurrage_status_of_bls(NULL);
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._catalog_refresh_demurrage_status() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_rates_refresh_demurrage_status
  AFTER INSERT OR UPDATE OR DELETE ON public.demurrage_rates
  FOR EACH STATEMENT EXECUTE FUNCTION public._catalog_refresh_demurrage_status();
CREATE TRIGGER trg_container_types_refresh_demurrage_status
  AFTER INSERT OR UPDATE OR DELETE ON public.container_types
  FOR EACH STATEMENT EXECUTE FUNCTION public._catalog_refresh_demurrage_status();

-- 179: faturas, Demurrage, datas e Comunicado (M18, M19, M10 e M21 da
-- revisão de 2026-10-09; ADR 0078, itens 12, 19 e 20; ADR 0077).
--
-- 1. "Nova fatura emitida" sai no COMMIT, com o total gravado: o gatilho vira
--    constraint trigger adiado e relê a fatura (antes lia `total_brl = 0` do
--    INSERT).
-- 2. B/L Cancelado fica fora da prontidão e do conteúdo do Comunicado de CE e
--    Taxas e do Alerta de CE Mercante pendente da Viagem.
-- 3. Datas, desova e status de Demurrage não reabrem a Revisão de B/L
--    faturado: o gatilho de modalidade de carga só reage a mudança de
--    `bl_id`/`container_number`.
-- 4. Invoice de Demurrage aceita container devolvido no free time (item com
--    valor zero); o total precisa ser positivo. SOC fica fora da devolução
--    pendente e da emissão.
-- 5. `demurrage_status` com uma semântica: `returned` quando há devolução;
--    sem devolução, `within_free_time`/`overdue` (o que o cálculo mostra).
-- 6. Planilha de datas: devolução vazia não altera a data gravada; a data vale
--    para todos os B/Ls ativos que dividem o container na mesma Viagem;
--    `set_container_dates` (edição do container) exige motivo para remover
--    uma data. A ATA não preenche mais a descarga na inserção do container.
-- 7. Invoice de Demurrage por grupo: B/Ls do mesmo Cliente ligados por
--    container compartilhado na Viagem recebem uma única Invoice, cada caixa
--    uma vez, emitida pelo B/L-âncora (menor número do grupo) quando todos os
--    containers do grupo voltaram (`issue_demurrage_invoice_for_bl`).
-- 8. Datas que mudam uma Invoice de Demurrage emitida: sem pagamento, ela é
--    cancelada e reemitida (só cancelada se o valor novo for zero); com
--    pagamento, abre o Alerta `demurrage_invoice_dates_changed` e a Régua de
--    Cobrança suspende a fatura (`dunning_suspended_reason`).
-- 9. Recebível sem fatura não trava Cancelar nem Excluir B/L: é anulado
--    (`void`) com o cálculo, com registro no Histórico.
--
-- Não reescreve linhas existentes.
--
-- ponytail: com pagamento, a diferença de Demurrage não é abatida nem vira
-- restituição automática (ADR 0077 item 4): a fatura sai da Régua e o Alerta
-- leva ao Administrativo, que usa a restituição excepcional de Demurrage ou
-- uma avulsa. Upgrade: estender o abatimento de saldo da 0077 a
-- `demurrage_invoices`.
-- ponytail: o grupo é anunciado no B/L-âncora; os outros B/Ls do grupo não
-- mostram a Invoice na própria linha. Upgrade: tabela de vínculo
-- `demurrage_invoice_bls` como `invoice_bls`.
--
-- Rollback: recriar `trg_notify_invoice_issued` AFTER INSERT OR UPDATE OF
-- status (002), `trg_container_discharge_date` (001) e
-- `trg_bl_containers_cargo_mode_update_stmt` com a função da 060; reaplicar
-- as funções redefinidas das migrations de origem citadas em cada bloco;
-- DROP das funções novas e da coluna `demurrage_invoices.dunning_suspended_reason`.

-- 1. Notificação no COMMIT, com o total gravado.
CREATE OR REPLACE FUNCTION public.notify_invoice_issued()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
BEGIN
  IF NEW.status = 'issued' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'issued') THEN
    -- Adiado para o COMMIT: lê a fatura como ficou (itens e total gravados).
    SELECT * INTO v_invoice FROM public.invoices WHERE id = NEW.id;
    IF NOT FOUND OR v_invoice.status IS DISTINCT FROM 'issued' THEN
      RETURN NULL;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.portal_notifications
      WHERE customer_id = v_invoice.customer_id AND type = 'invoice_issued'
        AND message LIKE 'Fatura ' || COALESCE(v_invoice.invoice_number, '#' || v_invoice.id) || ' %'
    ) THEN
      RETURN NULL;
    END IF;
    INSERT INTO public.portal_notifications (customer_id, type, title, message, link)
    VALUES (
      v_invoice.customer_id,
      'invoice_issued',
      'Nova fatura emitida',
      'Fatura ' || COALESCE(v_invoice.invoice_number, '#' || v_invoice.id) || ' no valor de R$ '
        || COALESCE(translate(to_char(round(v_invoice.total_brl, 2), 'FM999,999,999,990.00'), ',.', '.,'), '0,00') || ' foi emitida.',
      '/portal/billing'
    );
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_invoice_issued ON public.invoices;
CREATE CONSTRAINT TRIGGER trg_notify_invoice_issued
  AFTER INSERT OR UPDATE OF status ON public.invoices
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.notify_invoice_issued();

-- 2. B/L Cancelado fora do Comunicado de CE e Taxas e do Alerta de CE.
CREATE OR REPLACE FUNCTION public.customer_local_charges_communication_readiness(p_voyage_id bigint, p_customer_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_active_read_user()) THEN
    RAISE EXCEPTION 'Usuário interno ativo é obrigatório.' USING ERRCODE = '42501';
  END IF;
  IF p_voyage_id IS NULL OR p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Viagem e cliente são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  WITH bl_state AS (
    SELECT
      b.id AS bl_id,
      NULLIF(btrim(b.ce_mercante), '') AS ce_mercante,
      COALESCE(b.financial_status, 'pending') AS financial_status,
      COALESCE(b.cargo_mode, 'container') AS cargo_mode,
      b.bb_weight_ton,
      array_remove(ARRAY[
        CASE WHEN b.review_status = 'pending_review' THEN 'revisao_pendente'::text END,
        CASE WHEN COALESCE(b.cargo_mode, 'container') IN ('carga_solta', 'misto')
                  AND (b.bb_weight_ton IS NULL OR b.bb_weight_ton <= 0)
             THEN 'peso_bb_ausente'::text END
      ], NULL) AS review_pendencies
    FROM public.bls AS b
    WHERE b.voyage_id = p_voyage_id
      AND b.customer_id = p_customer_id
      AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
      AND b.cancelled_at IS NULL
  ), annotated AS (
    SELECT
      bl_state.*,
      array_remove(ARRAY[
        CASE WHEN bl_state.ce_mercante IS NULL THEN 'ce_mercante_ausente'::text END,
        CASE WHEN COALESCE(cardinality(bl_state.review_pendencies), 0) > 0 THEN 'revisao_pendente'::text END,
        CASE WHEN bl_state.financial_status NOT IN ('invoiced', 'paid') THEN 'faturamento_pendente'::text END
      ], NULL) AS blocked_reasons
    FROM bl_state
  ), aggregate AS (
    SELECT
      count(*)::integer AS bl_count,
      count(*) FILTER (WHERE cardinality(blocked_reasons) > 0)::integer AS blocked_bl_count,
      COALESCE(bool_and(cardinality(blocked_reasons) = 0), false) AS ready,
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'bl_id', bl_id,
          'ce_mercante', ce_mercante,
          'financial_status', financial_status,
          'cargo_mode', cargo_mode,
          'review_pendencies', to_jsonb(review_pendencies),
          'blocked_reasons', to_jsonb(blocked_reasons)
        ) ORDER BY bl_id
      ), '[]'::jsonb) AS bls
    FROM annotated
  ), reason_aggregate AS (
    SELECT COALESCE(jsonb_agg(DISTINCT reason ORDER BY reason), '[]'::jsonb) AS reasons
    FROM annotated
    CROSS JOIN LATERAL unnest(annotated.blocked_reasons) AS reason
  )
  SELECT jsonb_build_object(
    'voyage_id', p_voyage_id,
    'customer_id', p_customer_id,
    'ready', CASE WHEN bl_count = 0 THEN false ELSE ready END,
    'reason_code', CASE
      WHEN bl_count = 0 THEN 'no_bls'
      WHEN ready THEN 'ready'
      ELSE COALESCE(reasons ->> 0, 'readiness_blocked')
    END,
    'bl_count', bl_count,
    'blocked_bl_count', blocked_bl_count,
    'reasons', reasons,
    'bls', bls
  ) INTO v_result
  FROM aggregate CROSS JOIN reason_aggregate;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.customer_local_charges_communication_payload(p_voyage_id bigint, p_customer_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  RETURN (
    WITH base_bls AS (
      SELECT b.id AS bl_id, b.ce_mercante, b.pod, c.name AS customer_name,
             v.eta, v.voyage_number, vs.name AS vessel_name
      FROM public.bls b
      JOIN public.customers c ON c.id = b.customer_id
      JOIN public.voyages v ON v.id = b.voyage_id
      LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
      WHERE b.voyage_id = p_voyage_id
        AND b.customer_id = p_customer_id
        AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
        AND b.cancelled_at IS NULL
    ), direct_totals AS (
      SELECT ib.bl_id, sum(COALESCE(ib.subtotal_brl, 0)) AS total_brl
      FROM public.invoice_bls ib
      JOIN base_bls b ON b.bl_id = ib.bl_id
      JOIN public.invoices i ON i.id = ib.invoice_id
      WHERE i.status IN ('issued', 'partially_paid', 'paid', 'covered')
      GROUP BY ib.bl_id
    ), ledger_totals AS (
      SELECT rl.bl_id, sum(COALESCE(rl.subtotal_brl, 0)) AS total_brl
      FROM public.invoice_receivable_links rl
      JOIN base_bls b ON b.bl_id = rl.bl_id
      JOIN public.invoices i ON i.id = rl.invoice_id
      WHERE COALESCE(rl.status, '') <> 'obsolete'
        AND i.status IN ('issued', 'partially_paid', 'paid', 'covered')
        AND NOT EXISTS (SELECT 1 FROM direct_totals d WHERE d.bl_id = rl.bl_id)
      GROUP BY rl.bl_id
    )
    SELECT CASE WHEN count(*) = 0 THEN NULL ELSE jsonb_build_object(
      'customer_id', p_customer_id,
      'customer_name', max(base_bls.customer_name),
      'vessel_name', max(base_bls.vessel_name),
      'voyage_number', max(base_bls.voyage_number),
      'port', (array_agg(COALESCE(base_bls.pod, '—') ORDER BY base_bls.bl_id))[1],
      'milestone_at', max(COALESCE(base_bls.eta::TEXT, '')),
      'bls', jsonb_agg(jsonb_build_object(
        'bl_id', base_bls.bl_id,
        'ce_mercante', NULLIF(btrim(base_bls.ce_mercante), ''),
        'total_brl', COALESCE(direct_totals.total_brl, ledger_totals.total_brl, 0)
      ) ORDER BY base_bls.bl_id)
    ) END
    FROM base_bls
    LEFT JOIN direct_totals ON direct_totals.bl_id = base_bls.bl_id
    LEFT JOIN ledger_totals ON ledger_totals.bl_id = base_bls.bl_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_voyage_ce_mercante_missing_alerts(p_voyage_id bigint, p_source text DEFAULT 'voyage_operation_detector'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_first_eta DATE;
  v_total_bls INTEGER := 0;
  v_missing_ce_count INTEGER := 0;
  v_missing_vazios_count INTEGER := 0;
  v_parts text[] := ARRAY[]::text[];
BEGIN
  v_first_eta := public.get_voyage_first_brazilian_eta(p_voyage_id);

  IF v_first_eta IS NULL OR v_today < (v_first_eta - 5) THEN
    PERFORM public.resolve_alert_item('voyage_ce_mercante_missing', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE ce_mercante IS NULL OR btrim(ce_mercante) = '')
  INTO v_total_bls, v_missing_ce_count
  FROM public.bls
  WHERE voyage_id = p_voyage_id
    AND cancelled_at IS NULL
    AND upper(btrim(pod)) IN (SELECT pod FROM public.get_voyage_eligible_pods(p_voyage_id));

  IF v_total_bls = 0 THEN
    v_missing_ce_count := 0;
  END IF;

  SELECT count(*)
  INTO v_missing_vazios_count
  FROM (
    SELECT DISTINCT upper(btrim(c.pol)) AS pol, upper(btrim(c.pod)) AS pod
    FROM public.vazios_importacao_containers c
    JOIN public.vazios_importacao_manifests m ON m.id = c.manifest_id
    WHERE m.voyage_id = p_voyage_id
      AND NULLIF(btrim(c.pol), '') IS NOT NULL
      AND NULLIF(btrim(c.pod), '') IS NOT NULL
      AND upper(btrim(c.pod)) IN (SELECT pod FROM public.get_voyage_eligible_pods(p_voyage_id))
  ) rota
  WHERE NOT EXISTS (
      SELECT 1 FROM public.manifestos_mercante mm
      WHERE mm.voyage_id = p_voyage_id
        AND mm.natureza = 'vazio'
        AND upper(btrim(mm.pol)) = rota.pol
        AND upper(btrim(mm.pod)) = rota.pod
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.voyage_route_ce_master ce
      WHERE ce.voyage_id = p_voyage_id
        AND lower(ce.cargo_mode) = 'vazios'
        AND NULLIF(btrim(ce.ce_master), '') IS NOT NULL
        AND upper(btrim(ce.pol)) = rota.pol
        AND upper(btrim(ce.pod)) = rota.pod
    );

  IF v_missing_ce_count = 0 AND v_missing_vazios_count = 0 THEN
    PERFORM public.resolve_alert_item('voyage_ce_mercante_missing', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  IF v_missing_ce_count > 0 THEN
    v_parts := v_parts || (v_missing_ce_count || ' B/L(s)');
  END IF;
  IF v_missing_vazios_count > 0 THEN
    v_parts := v_parts || (v_missing_vazios_count || ' rota(s) de vazios sem Nº de manifesto Mercante');
  END IF;

  PERFORM public.upsert_alert_item(
    'voyage_ce_mercante_missing',
    'voyage',
    p_voyage_id::text,
    'CE Mercante pendente para ' || array_to_string(v_parts, ' e ') || ' da viagem ' || p_voyage_id || ' (D-5 atingido)',
    p_source,
    jsonb_build_object(
      'voyage_id', p_voyage_id,
      'missing_ce_count', v_missing_ce_count,
      'missing_vazios_manifest_count', v_missing_vazios_count
    ),
    '/viagens/' || p_voyage_id
  );
END;
$function$;

-- 3. Modalidade de carga: só bl_id/container_number mudam a modalidade.
CREATE OR REPLACE FUNCTION public.trg_sync_bl_cargo_mode_statement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
  v_sql text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Datas, desova, lacre ou status de Demurrage não mudam a modalidade e
    -- não reabrem a Revisão do B/L faturado (migration 179, ADR 0077).
    v_sql := format(
      'SELECT DISTINCT ids.bl_id FROM ('
      || ' SELECT n.bl_id FROM %1$I AS n JOIN %2$I AS o ON o.id = n.id'
      || '  WHERE n.bl_id IS DISTINCT FROM o.bl_id OR upper(btrim(n.container_number)) IS DISTINCT FROM upper(btrim(o.container_number))'
      || ' UNION ALL'
      || ' SELECT o.bl_id FROM %1$I AS n JOIN %2$I AS o ON o.id = n.id'
      || '  WHERE n.bl_id IS DISTINCT FROM o.bl_id'
      || ') AS ids WHERE ids.bl_id IS NOT NULL',
      TG_ARGV[0], TG_ARGV[1]
    );
  ELSE
    v_sql := format('SELECT DISTINCT bl_id FROM %I WHERE bl_id IS NOT NULL', TG_ARGV[0]);
  END IF;

  FOR v_row IN EXECUTE v_sql LOOP
    PERFORM public._recalculate_bl_cargo_mode(v_row.bl_id, lower(TG_OP));
  END LOOP;
  RETURN NULL;
END;
$function$;

-- 5. demurrage_status com uma semântica.
CREATE OR REPLACE FUNCTION public.normalize_container_demurrage_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.return_date IS NOT NULL THEN
    NEW.demurrage_status := 'returned';
  ELSIF NEW.demurrage_status = 'returned' THEN
    NEW.demurrage_status := 'within_free_time';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_container_demurrage_status_semantics ON public.bl_containers;
CREATE TRIGGER trg_container_demurrage_status_semantics
  BEFORE INSERT OR UPDATE OF return_date, demurrage_status ON public.bl_containers
  FOR EACH ROW EXECUTE FUNCTION public.normalize_container_demurrage_status();

-- 6. A ATA não preenche a descarga (ADR 0078, item 19).
DROP TRIGGER IF EXISTS trg_container_discharge_date ON public.bl_containers;

-- 7. Grupo de Demurrage: B/Ls ativos do mesmo Cliente na Viagem ligados por
--    container compartilhado (transitivo). Sem Cliente, o B/L é o grupo.
CREATE OR REPLACE FUNCTION public.demurrage_group_bl_ids(p_bl_id text)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH RECURSIVE root AS (
    SELECT id, voyage_id, customer_id FROM public.bls WHERE id = p_bl_id
  ), grp(bl_id) AS (
    SELECT id FROM root
    UNION
    SELECT other.id
    FROM grp
    JOIN public.bl_containers AS mine ON mine.bl_id = grp.bl_id
    JOIN public.bl_containers AS theirs
      ON upper(btrim(theirs.container_number)) = upper(btrim(mine.container_number))
     AND theirs.bl_id <> mine.bl_id
    JOIN public.bls AS other ON other.id = theirs.bl_id
    CROSS JOIN root
    WHERE root.customer_id IS NOT NULL
      AND other.voyage_id = root.voyage_id
      AND other.customer_id = root.customer_id
      AND other.cancelled_at IS NULL
  )
  SELECT COALESCE(array_agg(bl_id ORDER BY bl_id), ARRAY[p_bl_id]) FROM grp;
$function$;

REVOKE ALL ON FUNCTION public.demurrage_group_bl_ids(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.demurrage_group_bl_ids(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.demurrage_group_anchor(p_bl_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT (public.demurrage_group_bl_ids(p_bl_id))[1];
$function$;

REVOKE ALL ON FUNCTION public.demurrage_group_anchor(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.demurrage_group_anchor(text) TO authenticated, service_role;

-- 4/7. Cálculo: container no free time entra com valor zero; container do grupo.
CREATE OR REPLACE FUNCTION public._calculate_demurrage_invoice_authoritative(p_bl_id text, p_container_ids bigint[], p_calculation_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_requested_count integer := COALESCE(array_length(p_container_ids, 1), 0);
  v_distinct_count integer;
  v_result jsonb;
BEGIN
  IF NULLIF(btrim(p_bl_id), '') IS NULL
     OR v_requested_count = 0
     OR p_calculation_date IS NULL THEN
    RAISE EXCEPTION 'B/L, containers e data de cálculo são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT requested.id)::integer
    INTO v_distinct_count
  FROM unnest(p_container_ids) AS requested(id);
  IF v_distinct_count <> v_requested_count THEN
    RAISE EXCEPTION 'A emissão de Demurrage não aceita container duplicado.' USING ERRCODE = '22023';
  END IF;

  WITH requested AS (
    SELECT requested.id
    FROM unnest(p_container_ids) AS requested(id)
  ), base AS (
    SELECT
      container.id,
      container.bl_id,
      container.container_number,
      container.type,
      container.discharge_date,
      container.return_date,
      container.demurrage_status,
      bl.customer_id,
      bl.free_time_override,
      bl.demurrage_rate_override_p1_usd,
      bl.demurrage_rate_override_p2_usd,
      public._demurrage_canonical_type(container.type) AS canonical_type
    FROM requested
    LEFT JOIN public.bl_containers AS container
      ON container.id = requested.id
     AND container.bl_id = ANY(public.demurrage_group_bl_ids(p_bl_id))
    LEFT JOIN public.bls AS bl ON bl.id = container.bl_id
  ), resolved AS (
    SELECT
      base.*,
      rate.free_days AS table_free_days,
      rate.p1_day_to,
      rate.p1_usd AS table_p1_usd,
      rate.p2_day_from,
      rate.p2_usd AS table_p2_usd,
      agreement.free_days AS agreement_free_days,
      agreement.p1_usd AS agreement_p1_usd,
      agreement.p2_usd AS agreement_p2_usd
    FROM base
    LEFT JOIN LATERAL (
      SELECT r.free_days, r.p1_day_to, r.p1_usd, r.p2_day_from, r.p2_usd
      FROM public._active_demurrage_rates(p_calculation_date) AS r
      WHERE r.active = true
        AND r.valid_from <= p_calculation_date
        AND (r.valid_to IS NULL OR r.valid_to >= p_calculation_date)
        AND public._demurrage_canonical_type(r.container_type) = base.canonical_type
      ORDER BY r.valid_from DESC, r.id DESC
      LIMIT 1
    ) AS rate ON true
    LEFT JOIN LATERAL (
      SELECT a.free_days, a.p1_usd, a.p2_usd
      FROM public.customer_demurrage_agreements AS a
      WHERE a.customer_id = base.customer_id
        AND a.active = true
        AND base.discharge_date >= a.valid_from
        AND (a.valid_to IS NULL OR base.discharge_date <= a.valid_to)
      ORDER BY a.valid_from DESC, a.id DESC
      LIMIT 1
    ) AS agreement ON true
  ), calculated AS (
    SELECT
      resolved.*,
      (resolved.return_date - resolved.discharge_date)::integer AS total_days,
      COALESCE(resolved.free_time_override, resolved.agreement_free_days, resolved.table_free_days) AS free_days,
      COALESCE(resolved.demurrage_rate_override_p1_usd, resolved.agreement_p1_usd, resolved.table_p1_usd) AS rate_p1_usd,
      COALESCE(resolved.demurrage_rate_override_p2_usd, resolved.agreement_p2_usd, resolved.table_p2_usd) AS rate_p2_usd
    FROM resolved
  ), valued AS (
    SELECT
      calculated.*,
      GREATEST(0, LEAST(calculated.total_days, calculated.p1_day_to) - calculated.free_days)::integer AS days_p1,
      GREATEST(
        0,
        calculated.total_days - GREATEST(calculated.p2_day_from, calculated.free_days + 1) + 1
      )::integer AS days_p2
    FROM calculated
  ), totals AS (
    SELECT
      valued.*,
      round(valued.days_p1 * valued.rate_p1_usd + valued.days_p2 * valued.rate_p2_usd, 2) AS subtotal_usd,
      (
        valued.id IS NULL
        OR valued.bl_id IS NULL
        OR valued.demurrage_status NOT IN ('overdue', 'returned')
        OR valued.discharge_date IS NULL
        OR valued.return_date IS NULL
        OR valued.return_date < valued.discharge_date
        OR valued.total_days < 0
        OR valued.free_days IS NULL
        OR valued.free_days < 0
        OR valued.p1_day_to IS NULL
        OR valued.p2_day_from IS NULL
        OR valued.rate_p1_usd IS NULL
        OR valued.rate_p2_usd IS NULL
        OR valued.rate_p1_usd < 0
        OR valued.rate_p2_usd < 0
      ) AS invalid
    FROM valued
  )
  SELECT jsonb_build_object(
    'items', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'container_id', totals.id,
          'container_number', totals.container_number,
          'container_type', totals.type,
          'discharge_date', totals.discharge_date,
          'return_date', totals.return_date,
          'total_days', totals.total_days,
          'free_days', totals.free_days,
          'days_p1', totals.days_p1,
          'rate_p1_usd', totals.rate_p1_usd,
          'days_p2', totals.days_p2,
          'rate_p2_usd', totals.rate_p2_usd,
          'subtotal_usd', totals.subtotal_usd
        ) ORDER BY totals.id
      ) FILTER (WHERE NOT totals.invalid AND totals.subtotal_usd >= 0),
      '[]'::jsonb
    ),
    'total_usd', COALESCE(sum(totals.subtotal_usd) FILTER (WHERE NOT totals.invalid AND totals.subtotal_usd >= 0), 0),
    'ready_at', CASE WHEN bool_and(totals.return_date IS NOT NULL) THEN max(totals.return_date) ELSE NULL END,
    'requested_count', count(*)::integer,
    'distinct_numbers', count(DISTINCT upper(btrim(totals.container_number)))::integer,
    'calculated_count', count(*) FILTER (WHERE NOT totals.invalid AND totals.subtotal_usd >= 0)::integer,
    'invalid_count', count(*) FILTER (WHERE totals.invalid)::integer
  )
    INTO v_result
  FROM totals;

  IF COALESCE((v_result->>'requested_count')::integer, 0) <> v_requested_count THEN
    RAISE EXCEPTION 'Um ou mais containers não pertencem ao B/L informado.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE((v_result->>'invalid_count')::integer, 0) > 0 THEN
    RAISE EXCEPTION 'Dados insuficientes ou tarifa inválida para calcular a Demurrage.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE((v_result->>'distinct_numbers')::integer, 0) <> v_requested_count THEN
    RAISE EXCEPTION 'A Invoice de Demurrage cobra cada caixa uma vez: container repetido no grupo.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE((v_result->>'calculated_count')::integer, 0) <> v_requested_count THEN
    RAISE EXCEPTION 'Nenhum container faturável ou conjunto de containers desatualizado.' USING ERRCODE = '22023';
  END IF;

  RETURN v_result;
END;
$function$;

-- 7. Conjunto completo do grupo: cada caixa não-SOC do grupo uma vez.
CREATE OR REPLACE FUNCTION public.assert_demurrage_invoice_complete(p_invoice_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text;
  v_group text[];
  v_expected integer;
  v_items integer;
BEGIN
  SELECT bl_id INTO v_bl_id FROM public.demurrage_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM public.demurrage_invoices WHERE id = p_invoice_id AND status IN ('issued', 'paid')) THEN
    v_group := public.demurrage_group_bl_ids(v_bl_id);
    SELECT count(DISTINCT upper(btrim(container_number))) INTO v_expected
    FROM public.bl_containers
    WHERE bl_id = ANY(v_group) AND ownership IS DISTINCT FROM 'SOC';
    IF v_expected = 0 THEN
      IF EXISTS (SELECT 1 FROM public.demurrage_invoice_items WHERE invoice_id = p_invoice_id) THEN
        RAISE EXCEPTION 'Demurrage do B/L % possui itens sem containers físicos correspondentes.', v_bl_id USING ERRCODE = '23514';
      END IF;
      RETURN;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.bl_containers
      WHERE bl_id = ANY(v_group) AND return_date IS NULL AND ownership IS DISTINCT FROM 'SOC'
    ) OR EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      WHERE item.invoice_id = p_invoice_id AND item.return_date IS NULL
    ) THEN
      RAISE EXCEPTION 'Demurrage só pode ser emitida após a devolução de todos os containers do B/L %.', v_bl_id USING ERRCODE = '23514';
    END IF;

    SELECT count(DISTINCT upper(btrim(item.container_number))) INTO v_items
    FROM public.demurrage_invoice_items AS item WHERE item.invoice_id = p_invoice_id;
    IF v_items <> v_expected OR EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      WHERE item.invoice_id = p_invoice_id
      GROUP BY upper(btrim(item.container_number))
      HAVING count(*) > 1
    ) OR EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      WHERE item.invoice_id = p_invoice_id
        AND NOT EXISTS (
          SELECT 1 FROM public.bl_containers AS bc
          WHERE bc.id = item.container_id AND bc.bl_id = ANY(v_group) AND bc.ownership IS DISTINCT FROM 'SOC'
        )
    ) THEN
      RAISE EXCEPTION 'Demurrage do B/L % não contém o conjunto completo e exclusivo de containers.', v_bl_id USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$function$;

-- 7. Emissão pelo B/L-âncora; uso interno pela reemissão de datas.
CREATE OR REPLACE FUNCTION public.create_demurrage_invoice_authoritative(p_doc_number text, p_bl_id text, p_customer_id bigint, p_container_ids bigint[], p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.bls%ROWTYPE;
  v_reference public.exchange_rate_reference%ROWTYPE;
  v_calculation jsonb;
  v_items jsonb;
  v_invoice_id bigint;
  v_total_usd numeric(12,2);
  v_current_roe numeric(10,4);
  v_ptax numeric(10,4);
  v_roe_source text;
  v_total_brl numeric(14,2);
  v_pix_payload text;
  v_business_date date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_ready_at date;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('vela.demurrage_internal', true) IS DISTINCT FROM 'on'
     AND (auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_doc_number), '') IS NULL
     OR NULLIF(btrim(p_bl_id), '') IS NULL
     OR p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Documento, B/L e cliente são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_bl
  FROM public.bls
  WHERE id = p_bl_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF v_bl.customer_id IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'Cliente informado não corresponde ao cliente do B/L %.', p_bl_id USING ERRCODE = '22023';
  END IF;
  IF p_expected_updated_at IS NOT NULL AND v_bl.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Prévia de Demurrage desatualizada; recalcule antes de emitir.' USING ERRCODE = '40001';
  END IF;
  -- Grupo de container compartilhado: uma Invoice, pelo B/L-âncora.
  IF public.demurrage_group_anchor(p_bl_id) IS DISTINCT FROM p_bl_id THEN
    RAISE EXCEPTION 'O B/L % divide container com o B/L %: a Invoice de Demurrage do grupo é emitida pelo B/L %.',
      p_bl_id, public.demurrage_group_anchor(p_bl_id), public.demurrage_group_anchor(p_bl_id)
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.demurrage_invoices AS invoice
    WHERE invoice.bl_id = ANY(public.demurrage_group_bl_ids(p_bl_id)) AND invoice.status IN ('issued', 'overdue', 'paid')
  ) THEN
    RAISE EXCEPTION 'Já existe fatura de Demurrage emitida ou paga para o B/L %. Cancele a fatura atual antes de reemitir.', p_bl_id
      USING ERRCODE = '23505';
  END IF;

  IF COALESCE(v_bl.demurrage_roe_manual, false) THEN
    IF v_bl.demurrage_roe IS NULL OR v_bl.demurrage_roe <= 0 OR v_bl.demurrage_roe::text = 'NaN' THEN
      RAISE EXCEPTION 'ROE manual inválido no B/L %.', p_bl_id USING ERRCODE = '22023';
    END IF;
    v_current_roe := round(v_bl.demurrage_roe, 4);
    v_roe_source := 'manual';
    v_ptax := NULL;
  ELSE
    SELECT * INTO v_reference
    FROM public.exchange_rate_reference
    WHERE id = 1
    FOR SHARE;
    IF NOT FOUND OR v_reference.roe IS NULL OR v_reference.roe <= 0 THEN
      RAISE EXCEPTION 'Referência cambial vigente indisponível para emitir Demurrage.' USING ERRCODE = 'P0001';
    END IF;
    v_current_roe := round(v_reference.roe, 4);
    v_roe_source := COALESCE(NULLIF(v_reference.source, ''), 'manual');
    v_ptax := v_reference.ptax;
    IF v_roe_source IN ('bcb_live', 'cached') AND (v_ptax IS NULL OR v_ptax <= 0) THEN
      RAISE EXCEPTION 'Referência cambial sem PTAX factual para a origem %.', v_roe_source USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_calculation := public._calculate_demurrage_invoice_authoritative(
    p_bl_id,
    p_container_ids,
    v_business_date
  );
  v_items := v_calculation->'items';
  v_total_usd := round((v_calculation->>'total_usd')::numeric, 2);
  v_ready_at := NULLIF(v_calculation->>'ready_at', '')::date;
  IF v_total_usd IS NULL OR v_total_usd <= 0 OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Nenhum container com sobreestadia para este B/L.' USING ERRCODE = '22023';
  END IF;

  v_total_brl := round(v_total_usd * v_current_roe, 2);
  v_pix_payload := CASE
    WHEN v_total_brl > 0 THEN public.build_transshipping_pix_payload(v_total_brl, trim(p_doc_number))
    ELSE NULL
  END;

  INSERT INTO public.demurrage_invoices (
    doc_number, bl_id, customer_id, total_usd, ready_at,
    roe_manual, roe, status, billed_at, first_billed_at,
    current_roe, current_total_brl, roe_source, pix_payload
  ) VALUES (
    trim(p_doc_number), p_bl_id, p_customer_id, v_total_usd, v_ready_at,
    COALESCE(v_bl.demurrage_roe_manual, false), v_bl.demurrage_roe, 'issued',
    v_business_date, v_business_date, v_current_roe, v_total_brl, v_roe_source, v_pix_payload
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.demurrage_invoice_items (
    invoice_id, container_id, container_number, container_type,
    discharge_date, return_date, total_days, free_days,
    days_p1, rate_p1_usd, days_p2, rate_p2_usd, subtotal_usd
  )
  SELECT
    v_invoice_id, item.container_id, item.container_number, item.container_type,
    item.discharge_date, item.return_date, item.total_days, item.free_days,
    item.days_p1, item.rate_p1_usd, item.days_p2, item.rate_p2_usd, item.subtotal_usd
  FROM jsonb_to_recordset(v_items) AS item(
    container_id bigint,
    container_number text,
    container_type text,
    discharge_date date,
    return_date date,
    total_days integer,
    free_days integer,
    days_p1 integer,
    rate_p1_usd numeric,
    days_p2 integer,
    rate_p2_usd numeric,
    subtotal_usd numeric
  );

  INSERT INTO public.demurrage_invoice_history
    (invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
  VALUES
    (v_invoice_id, v_business_date, v_ptax, v_current_roe, v_total_usd, v_total_brl, 0, v_roe_source);

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'total_usd', v_total_usd,
    'current_total_brl', v_total_brl,
    'current_roe', v_current_roe,
    'roe_source', v_roe_source,
    'calculation_version', 1
  );
END;
$function$;

-- 7. Emissão do grupo: escolhe as caixas (uma por número, não-SOC) e emite
--    pelo B/L-âncora. Sem sobreestadia no grupo, não emite.
CREATE OR REPLACE FUNCTION public.issue_demurrage_invoice_for_bl(p_bl_id text, p_doc_number text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_group text[] := public.demurrage_group_bl_ids(p_bl_id);
  v_anchor text := v_group[1];
  v_customer_id bigint;
  v_existing bigint;
  v_container_ids bigint[];
  v_calculation jsonb;
  v_doc text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('vela.demurrage_internal', true) IS DISTINCT FROM 'on'
     AND (auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  SELECT customer_id INTO v_customer_id FROM public.bls WHERE id = v_anchor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'B/L % sem cliente para emissão de Demurrage.', v_anchor USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_existing FROM public.demurrage_invoices
  WHERE bl_id = ANY(v_group) AND status IN ('issued', 'overdue', 'paid')
  ORDER BY id DESC LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'existing', 'invoice_id', v_existing, 'anchor_bl_id', v_anchor, 'idempotent', true);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bl_containers
    WHERE bl_id = ANY(v_group) AND ownership IS DISTINCT FROM 'SOC' AND return_date IS NULL
  ) THEN
    RETURN jsonb_build_object('status', 'waiting_return', 'anchor_bl_id', v_anchor, 'group_bl_ids', to_jsonb(v_group));
  END IF;

  SELECT COALESCE(array_agg(pick.id ORDER BY pick.id), ARRAY[]::bigint[]) INTO v_container_ids
  FROM (
    SELECT DISTINCT ON (upper(btrim(c.container_number))) c.id
    FROM public.bl_containers AS c
    WHERE c.bl_id = ANY(v_group) AND c.ownership IS DISTINCT FROM 'SOC'
      AND NULLIF(btrim(c.container_number), '') IS NOT NULL
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

  v_doc := COALESCE(NULLIF(btrim(p_doc_number), ''),
    format('DEM-%s-%s', v_anchor, to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')));
  RETURN public.create_demurrage_invoice_authoritative(v_doc, v_anchor, v_customer_id, v_container_ids, NULL)
    || jsonb_build_object('status', 'issued', 'anchor_bl_id', v_anchor, 'group_bl_ids', to_jsonb(v_group));
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_demurrage_invoice_for_bl(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_demurrage_invoice_for_bl(text, text) TO authenticated, service_role;

-- A emissão automática usa o mesmo caminho (SOC fora, grupo, sem zero).
CREATE OR REPLACE FUNCTION public._run_import_effect_demurrage(p_effect_id bigint, p_bl_id text, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM 1 FROM public.bls WHERE id = p_bl_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado para Demurrage.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  RETURN public.issue_demurrage_invoice_for_bl(p_bl_id, format('DEM-AUTO-%s', p_effect_id));
END;
$function$;

-- 8. Régua de Cobrança suspensa para fatura com datas alteradas após pagamento.
ALTER TABLE public.demurrage_invoices ADD COLUMN IF NOT EXISTS dunning_suspended_reason text;
COMMENT ON COLUMN public.demurrage_invoices.dunning_suspended_reason IS
  'Motivo de a Régua de Cobrança não cobrar esta fatura (ex.: datas alteradas depois de pagamento; migration 179).';

INSERT INTO public.alert_type_catalog(type, severity, responsible_department, audience_departments, default_destination)
VALUES ('demurrage_invoice_dates_changed', 'critical', 'administrativo', ARRAY['administrativo'], '/demurrage')
ON CONFLICT (type) DO NOTHING;

-- Invoices vivas do grupo cujos itens não batem mais com as datas atuais.
CREATE OR REPLACE FUNCTION public._reconcile_demurrage_after_dates(p_bl_ids text[], p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice public.demurrage_invoices%ROWTYPE;
  v_result jsonb := '[]'::jsonb;
  v_reissue jsonb;
  v_previous text := current_setting('vela.demurrage_internal', true);
  v_paid boolean;
BEGIN
  FOR v_invoice IN
    SELECT DISTINCT ON (di.id) di.*
    FROM unnest(p_bl_ids) AS changed(bl_id)
    JOIN public.demurrage_invoices AS di ON di.bl_id = ANY(public.demurrage_group_bl_ids(changed.bl_id))
    WHERE di.status IN ('issued', 'overdue', 'paid')
      AND EXISTS (
        SELECT 1 FROM public.demurrage_invoice_items AS item
        JOIN public.bl_containers AS c ON c.id = item.container_id
        WHERE item.invoice_id = di.id
          AND (c.discharge_date IS DISTINCT FROM item.discharge_date OR c.return_date IS DISTINCT FROM item.return_date)
      )
    ORDER BY di.id
  LOOP
    v_paid := v_invoice.status = 'paid' OR v_invoice.paid_at IS NOT NULL;
    PERFORM public.upsert_alert_item(
      'demurrage_invoice_dates_changed', 'demurrage_invoice', v_invoice.id::text,
      format('As datas de container da Invoice de Demurrage %s mudaram depois da emissão%s.',
        v_invoice.doc_number, CASE WHEN v_paid THEN ' e ela já tem pagamento: a Régua suspendeu a cobrança' ELSE '' END),
      'container-dates',
      jsonb_build_object('invoice_id', v_invoice.id, 'bl_id', v_invoice.bl_id, 'paid', v_paid),
      '/demurrage');

    IF v_paid THEN
      UPDATE public.demurrage_invoices
         SET dunning_suspended_reason = 'Datas de container alteradas depois do pagamento; conferir a diferença.'
       WHERE id = v_invoice.id;
      v_result := v_result || jsonb_build_array(jsonb_build_object('invoice_id', v_invoice.id, 'status', 'suspended'));
      CONTINUE;
    END IF;

    -- Sem pagamento: cancela e reemite com as datas atuais (ou só cancela).
    UPDATE public.demurrage_invoices SET status = 'cancelled', updated_at = now() WHERE id = v_invoice.id;
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
    VALUES ('demurrage_invoice', v_invoice.id::text, 'status', v_invoice.status, 'cancelled', p_actor, now(),
      'Datas de container alteradas: cancelada para reemissão automática.');
    PERFORM set_config('vela.demurrage_internal', 'on', true);
    v_reissue := public.issue_demurrage_invoice_for_bl(v_invoice.bl_id, NULL);
    PERFORM set_config('vela.demurrage_internal', COALESCE(v_previous, ''), true);
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'invoice_id', v_invoice.id, 'status', 'cancelled', 'reissue', v_reissue));
  END LOOP;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public._reconcile_demurrage_after_dates(text[], uuid) FROM PUBLIC, anon, authenticated;

-- 8. A Régua não cobra fatura suspensa.
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
  SET released_at = COALESCE(p_as_of, now())
  WHERE claim.released_at IS NULL
    AND claim.claimed_at < COALESCE(p_as_of, now()) - interval '30 minutes'
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

  FOR v_invoice IN
    SELECT di.id, di.customer_id, di.bl_id, di.doc_number, di.total_usd, di.current_total_brl,
      di.current_roe, di.roe_source, di.first_billed_at,
      COALESCE(claims.claimed_at, now()) AS claimed_at,
      COALESCE(di.updated_at::DATE, di.doc_date, CURRENT_DATE)::TEXT AS roe_reference_date,
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
      AND EXISTS (
        SELECT 1 FROM public.customer_contacts AS cc
        JOIN public.customer_contact_box_links AS bl ON bl.contact_id = cc.id
        WHERE cc.customer_id = di.customer_id
          AND cc.deactivated_at IS NULL
          AND cc.email_normalized IS NOT NULL
          AND cc.email_normalized ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
          AND bl.box_code IN ('demurrage', 'financeiro')
          AND NOT EXISTS (SELECT 1 FROM public.portal_suppressed_emails pse WHERE lower(btrim(pse.email)) = cc.email_normalized AND pse.reason = 'bounce_permanente')
          AND NOT EXISTS (SELECT 1 FROM public.customer_communication_suppressions ccs WHERE lower(btrim(ccs.email)) = cc.email_normalized)
      )
      AND COALESCE(p_as_of, now()) >= (di.first_billed_at::TIMESTAMP AT TIME ZONE 'America/Sao_Paulo' + make_interval(days => v_interval_days * COALESCE(claims.attempt_count, 0)))
    ORDER BY di.id
    LIMIT v_limit
    FOR UPDATE OF di SKIP LOCKED
  LOOP
    v_inserted := 0;
    v_claimed_at := NULL;
    INSERT INTO public.demurrage_dunning_claims (demurrage_invoice_id, attempt_discriminator)
    VALUES (v_invoice.id, v_invoice.attempt_discriminator)
    ON CONFLICT (demurrage_invoice_id, attempt_discriminator) DO UPDATE
      SET claimed_at = now(), released_at = NULL
      WHERE demurrage_dunning_claims.released_at IS NOT NULL
    RETURNING claimed_at INTO v_claimed_at;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 1 THEN
      v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
        'invoice_id', v_invoice.id, 'customer_id', v_invoice.customer_id, 'bl_id', v_invoice.bl_id,
        'doc_number', v_invoice.doc_number, 'total_usd', v_invoice.total_usd,
        'current_total_brl', v_invoice.current_total_brl, 'current_roe', v_invoice.current_roe,
        'roe_source', v_invoice.roe_source, 'first_billed_at', v_invoice.first_billed_at,
        'claimed_at', v_claimed_at, 'roe_reference_date', v_invoice.roe_reference_date,
        'attempt_discriminator', v_invoice.attempt_discriminator
      ));
    END IF;
  END LOOP;
  RETURN v_candidates;
END;
$function$;

CREATE OR REPLACE FUNCTION public.demurrage_dunning_candidate_sendable(p_invoice_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  IF p_invoice_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT di.customer_id INTO v_customer_id
  FROM public.demurrage_invoices AS di
  WHERE di.id = p_invoice_id
    AND COALESCE(di.status, 'issued') IN ('issued', 'overdue')
      AND di.dunning_suspended_reason IS NULL
    AND di.first_billed_at IS NOT NULL
    AND di.paid_at IS NULL
    AND COALESCE(di.dispute_open, false) = false;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.customer_contacts AS cc
    JOIN public.customer_contact_box_links AS bl ON bl.contact_id = cc.id
    WHERE cc.customer_id = v_customer_id
      AND cc.deactivated_at IS NULL
      AND cc.email_normalized IS NOT NULL
      AND cc.email_normalized ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      AND bl.box_code IN ('demurrage', 'financeiro')
      AND NOT EXISTS (
        SELECT 1 FROM public.portal_suppressed_emails pse
        WHERE lower(btrim(pse.email)) = cc.email_normalized AND pse.reason = 'bounce_permanente'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.customer_communication_suppressions ccs
        WHERE lower(btrim(ccs.email)) = cc.email_normalized
      )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_due_demurrage_dunning_invoices(p_limit integer DEFAULT 25, p_as_of timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_interval_days INTEGER := 7;
  v_candidates JSONB := '[]'::JSONB;
  v_invoice RECORD;
  v_inserted INT;
  v_claimed_at TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Acesso negado para cobrança de demurrage.' USING ERRCODE = '42501';
  END IF;

  FOR v_invoice IN
    SELECT di.id, di.customer_id, di.bl_id, di.doc_number, di.total_usd,
      di.first_billed_at,
      concat_ws(':', di.id::text, to_char(COALESCE(p_as_of, now()) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')) AS attempt_discriminator
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
      AND EXISTS (
        SELECT 1 FROM public.customer_contacts AS cc
        JOIN public.customer_contact_box_links AS bl ON bl.contact_id = cc.id
        WHERE cc.customer_id = di.customer_id
          AND cc.deactivated_at IS NULL
          AND bl.box_code IN ('demurrage', 'financeiro')
          AND cc.email_normalized IS NOT NULL
          AND cc.email_normalized ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
          AND NOT EXISTS (
            SELECT 1 FROM public.portal_suppressed_emails pse
            WHERE lower(btrim(pse.email)) = cc.email_normalized AND pse.reason = 'bounce_permanente'
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.customer_communication_suppressions ccs
            WHERE lower(btrim(ccs.email)) = cc.email_normalized
          )
      )
      AND COALESCE(p_as_of, now()) >= (di.first_billed_at::TIMESTAMP AT TIME ZONE 'America/Sao_Paulo' + make_interval(days => v_interval_days * COALESCE(claims.attempt_count, 0)))
    ORDER BY di.id
    LIMIT v_limit
    FOR UPDATE OF di SKIP LOCKED
  LOOP
    v_inserted := 0;
    v_claimed_at := NULL;
    INSERT INTO public.demurrage_dunning_claims (demurrage_invoice_id, attempt_discriminator)
    VALUES (v_invoice.id, v_invoice.attempt_discriminator)
    ON CONFLICT (demurrage_invoice_id, attempt_discriminator) DO UPDATE
      SET claimed_at = now(), released_at = NULL
      WHERE demurrage_dunning_claims.released_at IS NOT NULL
    RETURNING claimed_at INTO v_claimed_at;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 1 THEN
      v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
        'invoice_id', v_invoice.id, 'customer_id', v_invoice.customer_id, 'bl_id', v_invoice.bl_id,
        'doc_number', v_invoice.doc_number, 'total_usd', v_invoice.total_usd,
        'first_billed_at', v_invoice.first_billed_at,
        'attempt_discriminator', v_invoice.attempt_discriminator,
        'claimed_at', v_claimed_at
      ));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'candidates', v_candidates,
    'claimed_count', jsonb_array_length(v_candidates),
    'as_of', COALESCE(p_as_of, now())
  );
END;
$function$;


-- 6. Núcleo das datas: o container e os mesmos números nos B/Ls ativos da
--    mesma Viagem recebem a mesma data. NULL em p_return com p_keep_return
--    preserva a devolução gravada. Devolve os B/Ls tocados.
CREATE OR REPLACE FUNCTION public._apply_container_dates_core(
  p_container_id bigint,
  p_discharge date,
  p_return date,
  p_keep_return boolean
)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_number text;
  v_voyage_id bigint;
  v_bls text[];
BEGIN
  SELECT upper(btrim(c.container_number)), b.voyage_id INTO v_number, v_voyage_id
  FROM public.bl_containers AS c JOIN public.bls AS b ON b.id = c.bl_id
  WHERE c.id = p_container_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Container % nao encontrado.', p_container_id USING ERRCODE = 'P0002';
  END IF;

  WITH targets AS (
    SELECT c.id
    FROM public.bl_containers AS c
    JOIN public.bls AS b ON b.id = c.bl_id
    WHERE (c.id = p_container_id)
       OR (upper(btrim(c.container_number)) = v_number AND b.voyage_id = v_voyage_id AND b.cancelled_at IS NULL)
    ORDER BY c.id
    FOR UPDATE OF c
  ), changed AS (
    UPDATE public.bl_containers AS c
       SET discharge_date = p_discharge,
           return_date = CASE WHEN p_keep_return THEN c.return_date ELSE p_return END
      FROM targets
     WHERE c.id = targets.id
       AND (c.discharge_date IS DISTINCT FROM p_discharge
            OR (NOT p_keep_return AND c.return_date IS DISTINCT FROM p_return))
     RETURNING c.bl_id
  )
  SELECT COALESCE(array_agg(DISTINCT bl_id), ARRAY[]::text[]) INTO v_bls FROM changed;
  RETURN v_bls;
END;
$function$;

REVOKE ALL ON FUNCTION public._apply_container_dates_core(bigint, date, date, boolean) FROM PUBLIC, anon, authenticated;

-- Depois das datas: B/Ls prontos (todos os não-SOC do grupo devolvidos)
-- enfileiram a emissão; Invoices vivas alteradas são reconciliadas.
CREATE OR REPLACE FUNCTION public._after_container_dates(p_request_id uuid, p_bl_ids text[], p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl text;
  v_anchor text;
  v_enqueued text[] := ARRAY[]::text[];
BEGIN
  FOREACH v_bl IN ARRAY COALESCE(p_bl_ids, ARRAY[]::text[]) LOOP
    v_anchor := public.demurrage_group_anchor(v_bl);
    CONTINUE WHEN v_anchor = ANY(v_enqueued);
    IF NOT EXISTS (
      SELECT 1 FROM public.bl_containers
      WHERE bl_id = ANY(public.demurrage_group_bl_ids(v_anchor))
        AND ownership IS DISTINCT FROM 'SOC' AND return_date IS NULL
    ) AND NOT EXISTS (
      SELECT 1 FROM public.demurrage_invoices
      WHERE bl_id = ANY(public.demurrage_group_bl_ids(v_anchor)) AND status IN ('issued', 'overdue', 'paid')
    ) THEN
      INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id, created_by)
      VALUES (p_request_id, 'demurrage_billing', v_anchor, p_actor)
      ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
      v_enqueued := array_append(v_enqueued, v_anchor);
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'demurrage_effects', to_jsonb(v_enqueued),
    'demurrage_invoices', public._reconcile_demurrage_after_dates(p_bl_ids, p_actor)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._after_container_dates(uuid, text[], uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_container_dates_atomic(p_request_id uuid, p_bl_id text, p_rows jsonb, p_changed_by uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_bl_id text := NULLIF(btrim(COALESCE(p_bl_id, '')), '');
  v_count integer := 0;
  v_item jsonb;
  v_num text;
  v_discharge text;
  v_return text;
  v_exp_discharge text;
  v_exp_return text;
  v_updated bigint[] := ARRAY[]::bigint[];
  v_unchanged bigint[] := ARRAY[]::bigint[];
  v_touched text[] := ARRAY[]::text[];
  v_billing_state text := 'pending';
  v_after jsonb := '{}'::jsonb;
  r record;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF v_bl_id IS NULL THEN
    RAISE EXCEPTION 'B/L obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Lote de datas invalido.' USING ERRCODE = '22023';
  END IF;
  v_count := jsonb_array_length(p_rows);
  IF v_count = 0 OR v_count > 500 THEN
    RAISE EXCEPTION 'Lote deve ter entre 1 e 500 linhas.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.bls WHERE id = v_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', v_bl_id USING ERRCODE = 'P0002';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Linha de datas invalida.' USING ERRCODE = '22023';
    END IF;
    v_num := upper(btrim(COALESCE(v_item->>'container_number', '')));
    v_discharge := NULLIF(btrim(COALESCE(v_item->>'discharge_date', '')), '');
    v_return := NULLIF(btrim(COALESCE(v_item->>'return_date', '')), '');
    IF v_num = '' THEN
      RAISE EXCEPTION 'Container obrigatorio no B/L %.', v_bl_id USING ERRCODE = '22023';
    END IF;
    IF v_discharge IS NULL OR v_discharge !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v_discharge::date IS NULL THEN
      RAISE EXCEPTION 'Data de descarga invalida para % no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF v_return IS NOT NULL AND (v_return !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v_return::date IS NULL) THEN
      RAISE EXCEPTION 'Data de devolucao invalida para % no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF v_return IS NOT NULL AND v_return::date < v_discharge::date THEN
      RAISE EXCEPTION 'Devolucao anterior a descarga para % no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_rows) AS t(container_number text, discharge_date text, return_date text)
      WHERE upper(btrim(COALESCE(t.container_number, ''))) = v_num
        AND (btrim(COALESCE(t.discharge_date, '')) IS DISTINCT FROM v_discharge
             OR NULLIF(btrim(COALESCE(t.return_date, '')), '') IS DISTINCT FROM v_return)
    ) THEN
      RAISE EXCEPTION 'Container % duplicado com datas conflitantes no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_num := upper(btrim(COALESCE(v_item->>'container_number', '')));
    v_discharge := NULLIF(btrim(COALESCE(v_item->>'discharge_date', '')), '');
    v_return := NULLIF(btrim(COALESCE(v_item->>'return_date', '')), '');
    v_exp_discharge := NULLIF(btrim(COALESCE(v_item->>'expected_discharge_date', '')), '');
    v_exp_return := NULLIF(btrim(COALESCE(v_item->>'expected_return_date', '')), '');

    SELECT c.id, c.discharge_date::text, c.return_date::text INTO r
    FROM public.bl_containers AS c
    WHERE c.bl_id = v_bl_id AND upper(btrim(c.container_number)) = v_num
    ORDER BY c.id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Container % nao pertence ao B/L %.', v_num, v_bl_id USING ERRCODE = 'P0002';
    END IF;

    IF v_exp_discharge IS NOT NULL AND (r.discharge_date IS DISTINCT FROM v_exp_discharge) THEN
      RAISE EXCEPTION 'Preview obsoleto para % no B/L %: recarregue e reconfira.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF (v_item ? 'expected_return_date') AND (r.return_date IS DISTINCT FROM v_exp_return) THEN
      RAISE EXCEPTION 'Preview obsoleto para % no B/L %: recarregue e reconfira.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;

    -- Devolução vazia na planilha não mexe na data gravada (ADR 0078, item 19).
    IF r.discharge_date IS NOT DISTINCT FROM v_discharge
       AND (v_return IS NULL OR r.return_date IS NOT DISTINCT FROM v_return) THEN
      v_unchanged := array_append(v_unchanged, r.id);
      CONTINUE;
    END IF;

    v_touched := v_touched || public._apply_container_dates_core(r.id, v_discharge::date, v_return::date, v_return IS NULL);
    v_updated := array_append(v_updated, r.id);
  END LOOP;

  -- SOC não tem devolução a esperar (ADR 0014; migration 121).
  IF NOT EXISTS (
    SELECT 1 FROM public.bl_containers AS c
    WHERE c.bl_id = v_bl_id AND c.return_date IS NULL AND c.ownership IS DISTINCT FROM 'SOC'
  ) THEN
    v_billing_state := 'ready_for_billing';
  END IF;

  v_role := public.current_actor_role();

  IF cardinality(v_updated) > 0 THEN
    v_touched := ARRAY(SELECT DISTINCT unnest(v_touched || ARRAY[v_bl_id]));
    INSERT INTO public.audit_logs(
      entity_type, entity_id, field_name, old_value, new_value,
      changed_by, justification, actor_role, actor_department
    ) VALUES (
      'bl', v_bl_id, 'container_dates_import',
      jsonb_build_object('request_id', p_request_id, 'bl_id', v_bl_id)::text,
      jsonb_build_object(
        'request_id', p_request_id, 'bl_id', v_bl_id,
        'updated_ids', v_updated, 'unchanged_ids', v_unchanged,
        'billing_state', v_billing_state, 'propagated_bl_ids', v_touched
      )::text,
      v_actor, 'Importacao de datas por B/L (atomica)', v_role, v_role
    );
    v_after := public._after_container_dates(p_request_id, v_touched, v_actor);
  END IF;

  RETURN jsonb_build_object(
    'request_id', p_request_id,
    'bl_id', v_bl_id,
    'updated_ids', v_updated,
    'unchanged_ids', v_unchanged,
    'billing_state', v_billing_state,
    'propagated_bl_ids', to_jsonb(v_touched),
    'demurrage', v_after
  );
END;
$function$;

-- Edição do container: corrigir ou remover datas, com motivo para remover.
CREATE OR REPLACE FUNCTION public.set_container_dates(
  p_container_id bigint,
  p_discharge_date date,
  p_return_date date,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_old record;
  v_touched text[];
  v_request uuid := gen_random_uuid();
  v_role text := public.current_actor_role();
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  SELECT c.id, c.bl_id, c.container_number, c.discharge_date, c.return_date INTO v_old
  FROM public.bl_containers AS c WHERE c.id = p_container_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Container % nao encontrado.', p_container_id USING ERRCODE = 'P0002';
  END IF;
  IF p_return_date IS NOT NULL AND p_discharge_date IS NOT NULL AND p_return_date < p_discharge_date THEN
    RAISE EXCEPTION 'Devolução anterior à descarga.' USING ERRCODE = '22023';
  END IF;
  IF p_return_date IS NOT NULL AND p_discharge_date IS NULL THEN
    RAISE EXCEPTION 'Informe a descarga antes da devolução.' USING ERRCODE = '22023';
  END IF;
  IF ((v_old.discharge_date IS NOT NULL AND p_discharge_date IS NULL)
      OR (v_old.return_date IS NOT NULL AND p_return_date IS NULL))
     AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo para remover a data.' USING ERRCODE = '22023';
  END IF;

  v_touched := public._apply_container_dates_core(p_container_id, p_discharge_date, p_return_date, false);

  IF cardinality(v_touched) > 0 THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification, actor_role, actor_department)
    VALUES ('bl', v_old.bl_id, 'container_dates',
      jsonb_build_object('container', v_old.container_number, 'discharge_date', v_old.discharge_date, 'return_date', v_old.return_date)::text,
      jsonb_build_object('container', v_old.container_number, 'discharge_date', p_discharge_date, 'return_date', p_return_date, 'propagated_bl_ids', v_touched)::text,
      v_actor, COALESCE(v_reason, 'Edição das datas do container'), v_role, v_role);
  END IF;

  RETURN jsonb_build_object(
    'container_id', p_container_id,
    'propagated_bl_ids', to_jsonb(v_touched),
    'demurrage', CASE WHEN cardinality(v_touched) > 0 THEN public._after_container_dates(v_request, v_touched, v_actor) ELSE '{}'::jsonb END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_container_dates(bigint, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_container_dates(bigint, date, date, text) TO authenticated, service_role;

-- 9. Recebível sem fatura não trava Cancelar nem Excluir B/L.
CREATE OR REPLACE FUNCTION public.bl_open_financial_reasons(p_bl_id text)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
  -- Só o recebível ligado a fatura ou com baixa trava; o resto é anulado.
  IF EXISTS (
    SELECT 1 FROM public.bl_receivables r
    WHERE r.bl_id = p_bl_id AND r.status IN ('open', 'partially_settled')
      AND (r.settled_amount_brl > 0
           OR EXISTS (SELECT 1 FROM public.invoice_receivable_links l WHERE l.receivable_id = r.id AND COALESCE(l.status, '') <> 'obsolete')
           OR EXISTS (SELECT 1 FROM public.ledger_settlements s WHERE s.receivable_id = r.id))
  ) THEN
    v_reasons := array_append(v_reasons, 'recebível em aberto');
  END IF;
  IF EXISTS (SELECT 1 FROM public.demurrage_invoices d WHERE d.bl_id = p_bl_id AND d.status IN ('draft', 'issued', 'overdue')) THEN
    v_reasons := array_append(v_reasons, 'fatura de Demurrage em aberto');
  END IF;
  RETURN v_reasons;
END;
$function$;

CREATE OR REPLACE FUNCTION public._void_unbilled_bl_receivables(p_bl_id text, p_actor uuid, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT r.id, r.balance_brl, r.status FROM public.bl_receivables AS r
    WHERE r.bl_id = p_bl_id AND r.status IN ('open', 'partially_settled')
      AND r.settled_amount_brl = 0
      AND NOT EXISTS (SELECT 1 FROM public.invoice_receivable_links l WHERE l.receivable_id = r.id AND COALESCE(l.status, '') <> 'obsolete')
      AND NOT EXISTS (SELECT 1 FROM public.ledger_settlements s WHERE s.receivable_id = r.id)
    FOR UPDATE
  LOOP
    UPDATE public.bl_receivables SET status = 'void', balance_brl = 0, updated_at = now() WHERE id = v_row.id;
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bl', p_bl_id, 'receivable_voided',
      jsonb_build_object('receivable_id', v_row.id, 'status', v_row.status, 'balance_brl', v_row.balance_brl)::text,
      'void', p_actor, p_reason);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public._void_unbilled_bl_receivables(text, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cancel_bl(p_bl_id text, p_reason text, p_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_bl record;
  v_block text[];
  v_voided integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo cancela B/L.' USING ERRCODE = '42501';
  END IF;
  SELECT id, cancelled_at INTO v_bl FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF v_bl.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('cancelled', false, 'reasons', jsonb_build_array('B/L já cancelado'));
  END IF;
  v_block := public.bl_open_financial_reasons(p_bl_id);
  IF cardinality(v_block) > 0 OR p_dry_run THEN
    RETURN jsonb_build_object('cancelled', false, 'reasons', to_jsonb(v_block), 'dry_run', p_dry_run);
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento.' USING ERRCODE = '22023';
  END IF;

  -- Recebível sem fatura e o cálculo que o gerou são anulados (ADR 0078).
  v_voided := public._void_unbilled_bl_receivables(p_bl_id, auth.uid(), 'Cancelamento do B/L: ' || v_reason);
  DELETE FROM public.charge_calculations AS cc
  WHERE cc.bl_id = p_bl_id
    AND NOT EXISTS (SELECT 1 FROM public.invoice_items AS ii WHERE ii.charge_calculation_id = cc.id);

  PERFORM set_config('vela.allow_bl_state', 'on', true);
  UPDATE public.bls SET cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = v_reason WHERE id = p_bl_id;
  PERFORM set_config('vela.allow_bl_state', 'off', true);
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bl', p_bl_id, 'cancelled', 'false', 'true', auth.uid(), v_reason);
  RETURN jsonb_build_object('cancelled', true, 'reasons', '[]'::jsonb);
END;
$function$;

-- Excluir B/L: o recebível sem fatura sai antes (a FK o protegia).
CREATE OR REPLACE FUNCTION public.drop_unbilled_receivables_before_bl_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public._void_unbilled_bl_receivables(OLD.id, auth.uid(), 'Exclusão do B/L') > 0 THEN
    DELETE FROM public.bl_receivables WHERE bl_id = OLD.id AND status = 'void' AND settled_amount_brl = 0
      AND NOT EXISTS (SELECT 1 FROM public.invoice_receivable_links l WHERE l.receivable_id = bl_receivables.id)
      AND NOT EXISTS (SELECT 1 FROM public.ledger_settlements s WHERE s.receivable_id = bl_receivables.id);
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_drop_unbilled_receivables_before_bl_delete ON public.bls;
CREATE TRIGGER trg_drop_unbilled_receivables_before_bl_delete
  BEFORE DELETE ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public.drop_unbilled_receivables_before_bl_delete();

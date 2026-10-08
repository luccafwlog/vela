-- Portal: consolidada paga visível e individual coberta identificada.
--
-- Quando a consolidada é paga, seus vínculos com recebíveis passam de 'active'
-- para 'settled_by_this_invoice'. A lista e a visibilidade do detalhe só
-- consideravam vínculos 'active', então a consolidada paga sumia do Portal
-- (sem B/L, sem detalhe, sem recibo), enquanto as individuais cobertas, ligadas
-- por invoice_bls, apareciam como pagas e com saldo da própria fatura.
--
-- Decisão do dono (2026-10-08): a consolidada paga aparece em "Pagas" com o
-- recibo dela; a individual coberta continua no filtro "Pagas", identificada
-- como "Coberta pela <consolidada>", sem recibo próprio e com saldo zero.
--
-- Mudanças, só de leitura do Portal (nenhuma linha é reescrita):
-- 1. _portal_invoice_visible e _portal_list_invoices_core aceitam vínculos
--    'settled_by_this_invoice' além de 'active'. Vínculos 'settled_elsewhere'
--    e 'obsolete' continuam fora, como antes.
-- 2. _portal_list_invoices_core devolve saldo zero para fatura 'covered'.
-- 3. _portal_list_invoices_page_core e _portal_invoice_details_core expõem o
--    número da fatura que cobriu, só quando ela é visível para o mesmo cliente.
--
-- Rollback: reaplicar as definições anteriores (109 para a visibilidade, 097
-- para a lista, 128 para a página e 136 para o detalhe).

CREATE OR REPLACE FUNCTION public._portal_invoice_visible(p_customer_id bigint, p_invoice_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH linked AS (
    SELECT ib.bl_id FROM public.invoice_bls ib WHERE ib.invoice_id = p_invoice_id
    UNION
    SELECT irl.bl_id FROM public.invoice_receivable_links irl
    WHERE irl.invoice_id = p_invoice_id AND irl.status IN ('active', 'settled_by_this_invoice')
  )
  SELECT EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = p_invoice_id
      AND i.customer_id = p_customer_id
      AND (
        i.invoice_type = 'manual'
        OR (EXISTS (SELECT 1 FROM linked)
            AND NOT EXISTS (SELECT 1 FROM linked WHERE NOT public.bl_has_portal_release(linked.bl_id)))
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public._portal_list_invoices_core(p_customer_id bigint)
RETURNS TABLE(
  id bigint,
  invoice_number text,
  issued_at timestamptz,
  total_brl numeric,
  total_paid_brl numeric,
  balance_brl numeric,
  status text,
  invoice_type text,
  vessels text[],
  voyages text[],
  vessel_voyages text[],
  bls text[],
  pods text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  WITH linked_invoice_bls AS (
    SELECT ib.invoice_id, ib.bl_id
    FROM public.invoice_bls AS ib
    UNION
    SELECT irl.invoice_id, irl.bl_id
    FROM public.invoice_receivable_links AS irl
    WHERE irl.status IN ('active', 'settled_by_this_invoice')
  ),
  manual_context AS (
    SELECT
      i.id AS invoice_id,
      i.bl_id,
      b.pod,
      v.voyage_number,
      vs.name AS vessel_name
    FROM public.invoices AS i
    LEFT JOIN public.bls AS b ON b.id = i.bl_id
    LEFT JOIN public.voyages AS v ON v.id = COALESCE(i.voyage_id, b.voyage_id)
    LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
    WHERE i.customer_id = p_customer_id
      AND i.invoice_type = 'manual'
  ),
  eligible_invoices AS (
    SELECT i.id AS invoice_id
    FROM public.invoices AS i
    WHERE i.customer_id = p_customer_id
      AND (
        i.invoice_type = 'manual'
        OR (
          EXISTS (
            SELECT 1 FROM linked_invoice_bls AS linked
            WHERE linked.invoice_id = i.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM linked_invoice_bls AS linked
            WHERE linked.invoice_id = i.id
              AND NOT public.bl_has_portal_release(linked.bl_id)
          )
        )
      )
  ),
  bl_info AS (
    SELECT ib.invoice_id, ib.bl_id, b.pod, v.voyage_number, vs.name AS vessel_name
    FROM public.invoice_bls AS ib
    JOIN public.bls AS b ON b.id = ib.bl_id
    LEFT JOIN public.voyages AS v ON v.id = b.voyage_id
    LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
    UNION ALL
    SELECT irl.invoice_id, irl.bl_id, irl.bl_snapshot->>'pod', v.voyage_number, vs.name
    FROM public.invoice_receivable_links AS irl
    LEFT JOIN public.voyages AS v ON v.id = (irl.bl_snapshot->>'voyage_id')::bigint
    LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
    WHERE irl.status IN ('active', 'settled_by_this_invoice')
    UNION ALL
    SELECT invoice_id, bl_id, pod, voyage_number, vessel_name
    FROM manual_context
  ),
  agg AS (
    SELECT
      bl_info.invoice_id,
      array_agg(DISTINCT bl_info.vessel_name) FILTER (WHERE bl_info.vessel_name IS NOT NULL) AS vessels,
      array_agg(DISTINCT bl_info.voyage_number) FILTER (WHERE bl_info.voyage_number IS NOT NULL) AS voyages,
      array_agg(DISTINCT CASE
        WHEN bl_info.voyage_number IS NOT NULL AND bl_info.vessel_name IS NOT NULL
          THEN bl_info.vessel_name || ' / ' || bl_info.voyage_number
        ELSE bl_info.vessel_name
      END) FILTER (WHERE bl_info.vessel_name IS NOT NULL) AS vessel_voyages,
      array_agg(DISTINCT bl_info.bl_id) FILTER (WHERE bl_info.bl_id IS NOT NULL) AS bls,
      array_agg(DISTINCT bl_info.pod) FILTER (WHERE bl_info.pod IS NOT NULL) AS pods
    FROM bl_info
    GROUP BY bl_info.invoice_id
  )
  SELECT
    i.id,
    i.invoice_number,
    i.issued_at,
    i.total_brl,
    i.total_paid_brl,
    CASE
      WHEN i.status = 'covered' THEN 0::numeric
      WHEN i.invoice_type IN ('individual', 'consolidated') AND ledger.link_count > 0
        THEN ledger.balance_brl
      ELSE i.balance_brl
    END AS balance_brl,
    i.status,
    i.invoice_type,
    COALESCE(agg.vessels, '{}'::text[]),
    COALESCE(agg.voyages, '{}'::text[]),
    COALESCE(agg.vessel_voyages, '{}'::text[]),
    COALESCE(agg.bls, '{}'::text[]),
    COALESCE(agg.pods, '{}'::text[])
  FROM public.invoices AS i
  JOIN eligible_invoices AS eligible ON eligible.invoice_id = i.id
  LEFT JOIN agg ON agg.invoice_id = i.id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) AS link_count,
      COALESCE(SUM(COALESCE(br.balance_brl, 0)), 0) AS balance_brl
    FROM public.invoice_receivable_links AS irl
    JOIN public.bl_receivables AS br ON br.id = irl.receivable_id
    WHERE irl.invoice_id = i.id AND irl.status = 'active'
  ) AS ledger ON true
  WHERE i.customer_id = p_customer_id
  ORDER BY i.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public._portal_list_invoices_page_core(p_customer_id bigint, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_status text DEFAULT NULL::text, p_vessel text DEFAULT NULL::text, p_bl text DEFAULT NULL::text, p_pod text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  RETURN (
    WITH all_rows AS MATERIALIZED (
      SELECT r.*
      FROM public._portal_list_invoices_core(p_customer_id) AS r
    ),
    filtered AS MATERIALIZED (
      SELECT r.*
      FROM all_rows AS r
      WHERE (
        (NULLIF(BTRIM(p_status), '') IS NULL AND r.status NOT IN ('cancelled', 'obsolete'))
        OR (p_status = 'issued' AND r.status IN ('issued', 'partially_paid', 'draft'))
        OR (p_status = 'paid' AND r.status IN ('paid', 'covered'))
        OR (p_status = 'cancelled' AND r.status IN ('cancelled', 'obsolete'))
      )
      AND (
        NULLIF(BTRIM(p_vessel), '') IS NULL
        OR EXISTS (
          SELECT 1
          FROM unnest(COALESCE(r.vessel_voyages, '{}'::TEXT[])) AS value
          WHERE POSITION(LOWER(BTRIM(p_vessel)) IN LOWER(value)) > 0
        )
      )
      AND (
        NULLIF(BTRIM(p_bl), '') IS NULL
        OR EXISTS (
          SELECT 1
          FROM unnest(COALESCE(r.bls, '{}'::TEXT[])) AS value
          WHERE POSITION(LOWER(BTRIM(p_bl)) IN LOWER(value)) > 0
        )
      )
      AND (NULLIF(BTRIM(p_pod), '') IS NULL OR BTRIM(p_pod) = ANY(COALESCE(r.pods, '{}'::TEXT[])))
      AND (p_date_from IS NULL OR r.issued_at::DATE >= p_date_from)
      AND (p_date_to IS NULL OR r.issued_at::DATE <= p_date_to)
    ),
    page_rows AS (
      SELECT f.*, cov.invoice_number AS covered_by_invoice_number
      FROM filtered AS f
      JOIN public.invoices AS inv ON inv.id = f.id
      LEFT JOIN public.invoices AS cov ON cov.id = inv.covered_by_invoice_id
        AND f.status = 'covered'
        AND public._portal_invoice_visible(p_customer_id, cov.id)
      ORDER BY f.issued_at DESC NULLS LAST, f.id DESC
      LIMIT v_limit OFFSET v_offset
    )
    SELECT jsonb_build_object(
      'rows', COALESCE((SELECT jsonb_agg(to_jsonb(page_rows) ORDER BY page_rows.issued_at DESC NULLS LAST, page_rows.id DESC) FROM page_rows), '[]'::JSONB),
      'total_count', (SELECT COUNT(*) FROM filtered),
      'vessel_options', COALESCE((
        SELECT jsonb_agg(value ORDER BY value)
        FROM (
          SELECT DISTINCT value
          FROM all_rows AS r, unnest(COALESCE(r.vessel_voyages, '{}'::TEXT[])) AS value
          WHERE value IS NOT NULL AND value <> ''
        ) AS options
      ), '[]'::JSONB),
      'pods', COALESCE((
        SELECT jsonb_agg(value ORDER BY value)
        FROM (
          SELECT DISTINCT value
          FROM all_rows AS r, unnest(COALESCE(r.pods, '{}'::TEXT[])) AS value
          WHERE value IS NOT NULL AND value <> ''
        ) AS options
      ), '[]'::JSONB)
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._portal_invoice_details_core(p_customer_id bigint, p_invoice_id bigint)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  result jsonb;
  v_covered_by bigint;
  v_covered_by_number text;
BEGIN
  result := public._portal_invoice_details_legacy_134(p_customer_id, p_invoice_id);
  result := result || jsonb_build_object('financial_summary', public._invoice_financial_summary(p_invoice_id));

  IF result #>> '{invoice,status}' = 'covered' THEN
    SELECT cov.id, cov.invoice_number INTO v_covered_by, v_covered_by_number
    FROM public.invoices AS i
    JOIN public.invoices AS cov ON cov.id = i.covered_by_invoice_id
    WHERE i.id = p_invoice_id
      AND public._portal_invoice_visible(p_customer_id, cov.id);
    -- A coberta não cobra mais nada: o saldo do B/L foi quitado pela consolidada.
    result := jsonb_set(result, '{invoice}', (result->'invoice') || jsonb_build_object(
      'balance_brl', 0,
      'covered_by_invoice_id', v_covered_by,
      'covered_by_invoice_number', v_covered_by_number
    ));
  END IF;

  RETURN result;
END
$$;

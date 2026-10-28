-- 494: Leituras da taxa alterada à mão (lote 4 do plano
-- `2026-10-28-alterar-taxa-calculada-do-bl`; ADR 0111, D10).
--
-- Uma leitura só para a Validação (filtro **Com taxa alterada à mão**, coluna
-- da planilha e avisos de Recalcular e Emitir), a fatura consolidada e a ficha
-- do Cliente (lista **B/Ls com taxa alterada**): por B/L, as taxas alteradas ou
-- excluídas à mão, a isenção à mão e o último autor. A tela escreve a frase.
--
-- Só leitura; não muda dado.
--
-- Rollback: DROP FUNCTION public.list_bl_charge_adjustment_summaries(text[], bigint).

CREATE OR REPLACE FUNCTION public.list_bl_charge_adjustment_summaries(
  p_bl_ids text[] DEFAULT NULL, p_customer_id bigint DEFAULT NULL)
 RETURNS TABLE(bl_id text, voyage_id bigint, voyage_label text, manual_exempt boolean, exemption_justification text,
   items jsonb, last_actor_name text, last_at timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;
  IF p_bl_ids IS NULL AND p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Informe os B/Ls ou o Cliente.' USING ERRCODE = '22023';
  END IF;
  -- ponytail: a lista do Cliente varre os B/Ls dele; com volume grande, um
  -- índice parcial por B/L com alteração em vigor resolve.
  RETURN QUERY
  WITH scope AS (
    SELECT b.id, b.voyage_id FROM public.bls b
     WHERE b.cancelled_at IS NULL
       AND (p_bl_ids IS NULL OR b.id = ANY(p_bl_ids))
       AND (p_customer_id IS NULL OR b.customer_id = p_customer_id)
  ),
  lines AS (
    SELECT cc.bl_id,
           jsonb_agg(jsonb_build_object(
             'charge_name', COALESCE(a.charge_name, cti.name, '[Sistema]'),
             'source', cc.source,
             'excluded', cc.status = 'excluded',
             'kind', a.kind,
             'currency', x.currency,
             'application_basis', COALESCE(a.application_basis, cti.application_basis),
             'quantity', cc.quantity,
             'table_unit', CASE WHEN x.currency = 'USD' THEN COALESCE(cc.table_unit_value_usd, cc.unit_value_usd)
                                ELSE COALESCE(cc.table_unit_value_brl, cc.unit_value_brl) END,
             'table_total', CASE WHEN x.currency = 'USD' THEN COALESCE(cc.table_total_value_usd, cc.total_value_usd)
                                 ELSE COALESCE(cc.table_total_value_brl, cc.total_value_brl) END,
             'unit', CASE WHEN x.currency = 'USD' THEN cc.unit_value_usd ELSE cc.unit_value_brl END,
             'total', CASE WHEN x.currency = 'USD' THEN cc.total_value_usd ELSE cc.total_value_brl END,
             'adjusted_value', a.value
           ) ORDER BY COALESCE(a.charge_name, cti.name), cc.calculation_key) AS items
      FROM public.charge_calculations cc
      JOIN scope s ON s.id = cc.bl_id
      LEFT JOIN public.bl_charge_adjustments a ON a.id = cc.adjustment_id
      LEFT JOIN public.charge_table_items cti ON cti.id = cc.charge_item_id
      CROSS JOIN LATERAL (SELECT upper(COALESCE(cti.currency,
        CASE WHEN cc.unit_value_usd IS NOT NULL OR cc.total_value_usd IS NOT NULL THEN 'USD' ELSE 'BRL' END)) AS currency) x
     WHERE cc.adjustment_id IS NOT NULL OR cc.status = 'excluded'
     GROUP BY cc.bl_id
  ),
  last_event AS (
    SELECT DISTINCT ON (e.bl_id) e.bl_id, up.full_name, e.created_at
      FROM public.bl_charge_adjustment_events e
      JOIN scope s ON s.id = e.bl_id
      LEFT JOIN public.user_profiles up ON up.id = e.actor
     ORDER BY e.bl_id, e.created_at DESC, e.id DESC
  )
  SELECT s.id, s.voyage_id,
         NULLIF(concat_ws(' / ', vs.name, v.voyage_number), ''),
         ex.bl_id IS NOT NULL, ex.justification,
         COALESCE(l.items, '[]'::jsonb), le.full_name, le.created_at
    FROM scope s
    LEFT JOIN lines l ON l.bl_id = s.id
    LEFT JOIN public.bl_local_charge_exemptions ex ON ex.bl_id = s.id
    LEFT JOIN last_event le ON le.bl_id = s.id
    LEFT JOIN public.voyages v ON v.id = s.voyage_id
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
   WHERE l.bl_id IS NOT NULL OR ex.bl_id IS NOT NULL
   ORDER BY le.created_at DESC NULLS LAST, s.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_bl_charge_adjustment_summaries(text[], bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_bl_charge_adjustment_summaries(text[], bigint) TO authenticated;

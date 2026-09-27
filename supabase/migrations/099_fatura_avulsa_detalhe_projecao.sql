-- Migration 099: projetar navio e viagem no objeto invoice para faturas avulsas em list_invoice_details.
--
-- A migration 097 criou o dispatcher para faturas avulsas, mas não projetou
-- `vessel_name` e `voyage_number` no objeto principal `v_invoice` quando a fatura
-- possui viagem direta ou herdada do B/L. Esta migration projeta essas colunas
-- para que o detalhe interno e a impressão exibam o navio/viagem corretamente.

CREATE OR REPLACE FUNCTION public.list_invoice_details(p_invoice_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice_type text;
  v_invoice jsonb;
  v_bls jsonb;
  v_items jsonb;
  v_containers jsonb;
  v_payments jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  SELECT invoice_type INTO v_invoice_type
  FROM public.invoices
  WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF v_invoice_type IS DISTINCT FROM 'manual' THEN
    RETURN public._list_invoice_details_legacy_20260926(p_invoice_id);
  END IF;

  SELECT to_jsonb(i.*) || jsonb_build_object(
    'customer_name', c.name,
    'customer_cnpj_cpf', c.cnpj_cpf,
    'voyage_number', v.voyage_number,
    'vessel_name', vs.name
  )
  INTO v_invoice
  FROM public.invoices AS i
  LEFT JOIN public.customers AS c ON c.id = i.customer_id
  LEFT JOIN public.bls AS b ON b.id = i.bl_id
  LEFT JOIN public.voyages AS v ON v.id = COALESCE(i.voyage_id, b.voyage_id)
  LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
  WHERE i.id = p_invoice_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', NULL::bigint,
    'invoice_id', p_invoice_id,
    'bl_id', b.id,
    'charge_status_snapshot', b.charge_status,
    'financial_status_snapshot', b.financial_status,
    'subtotal_brl', COALESCE((SELECT SUM(ii.total_value_brl) FROM public.invoice_items AS ii WHERE ii.invoice_id = p_invoice_id AND ii.bl_id = b.id), 0),
    'subtotal_usd', 0,
    'created_at', NULL,
    'charge_status', b.charge_status,
    'financial_status', b.financial_status,
    'pol', b.pol,
    'pod', b.pod,
    'voyage_number', v.voyage_number,
    'vessel_name', vs.name
  )), '[]'::jsonb)
  INTO v_bls
  FROM public.invoices AS i
  JOIN public.bls AS b ON b.id = i.bl_id
  LEFT JOIN public.voyages AS v ON v.id = COALESCE(i.voyage_id, b.voyage_id)
  LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
  WHERE i.id = p_invoice_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(ii.*) ORDER BY ii.id), '[]'::jsonb)
  INTO v_items
  FROM public.invoice_items AS ii
  WHERE ii.invoice_id = p_invoice_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'bl_id', c.bl_id,
    'container_number', c.container_number,
    'type', c.type,
    'seal_number', c.seal_number,
    'gross_weight_kg', c.gross_weight_kg
  ) ORDER BY c.container_number), '[]'::jsonb)
  INTO v_containers
  FROM public.bl_containers AS c
  JOIN public.invoices AS i ON i.bl_id = c.bl_id
  WHERE i.id = p_invoice_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(p.*) ORDER BY p.paid_at DESC, p.id DESC), '[]'::jsonb)
  INTO v_payments
  FROM public.payments AS p
  WHERE p.invoice_id = p_invoice_id;

  RETURN jsonb_build_object(
    'invoice', v_invoice,
    'bls', v_bls,
    'items', v_items,
    'containers', v_containers,
    'payments', v_payments
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.list_invoice_details(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_invoice_details(bigint) TO authenticated;

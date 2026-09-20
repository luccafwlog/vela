-- Fecha guards internos que falhavam abertos para role NULL e reduz os
-- payloads financeiros do Portal a allowlists explícitas.

-- As implementações existentes permanecem privadas para evitar duplicar a
-- lógica de negócio consolidada. Os novos owners públicos validam autorização
-- e projetam somente o contrato externo.
ALTER FUNCTION public.add_demurrage_dispute_message(bigint, text, text)
  RENAME TO _add_demurrage_dispute_message_impl_20260920;
ALTER FUNCTION public.list_demurrage_disputes_internal(text)
  RENAME TO _list_demurrage_disputes_internal_impl_20260920;
ALTER FUNCTION public.reopen_demurrage_dispute(bigint, text)
  RENAME TO _reopen_demurrage_dispute_impl_20260920;
ALTER FUNCTION public.save_customer_communication_saved_template(text, text, text)
  RENAME TO _save_customer_communication_saved_template_impl_20260920;
ALTER FUNCTION public.set_agency_report_terminal(bigint, text, text)
  RENAME TO _set_agency_report_terminal_impl_20260920;
ALTER FUNCTION public._portal_invoice_details_core(bigint, bigint)
  RENAME TO _portal_invoice_details_core_unfiltered_20260920;
ALTER FUNCTION public._portal_get_demurrage_invoice_detail_core(bigint, bigint)
  RENAME TO _portal_get_demurrage_invoice_detail_core_unfiltered_20260920;

REVOKE ALL ON FUNCTION public._add_demurrage_dispute_message_impl_20260920(bigint, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._list_demurrage_disputes_internal_impl_20260920(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._reopen_demurrage_dispute_impl_20260920(bigint, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._save_customer_communication_saved_template_impl_20260920(text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._set_agency_report_terminal_impl_20260920(bigint, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._portal_invoice_details_core_unfiltered_20260920(bigint, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._portal_get_demurrage_invoice_detail_core_unfiltered_20260920(bigint, bigint) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.add_demurrage_dispute_message(
  p_dispute_id bigint,
  p_body text,
  p_next_responder text DEFAULT 'cliente'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF public._portal_actor_role() IS DISTINCT FROM 'equipamentos' THEN
    RAISE EXCEPTION 'Apenas Equipamentos pode responder a Dispute.' USING ERRCODE = '42501';
  END IF;
  RETURN public._add_demurrage_dispute_message_impl_20260920(p_dispute_id, p_body, p_next_responder);
END;
$$;

CREATE FUNCTION public.list_demurrage_disputes_internal(p_state text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF public._portal_actor_role() IS DISTINCT FROM 'equipamentos' THEN
    RAISE EXCEPTION 'Apenas Equipamentos pode consultar a fila de Disputes.' USING ERRCODE = '42501';
  END IF;
  RETURN public._list_demurrage_disputes_internal_impl_20260920(p_state);
END;
$$;

CREATE FUNCTION public.reopen_demurrage_dispute(p_dispute_id bigint, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF public._portal_actor_role() IS DISTINCT FROM 'equipamentos' THEN
    RAISE EXCEPTION 'Apenas Equipamentos pode reabrir a Dispute.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._reopen_demurrage_dispute_impl_20260920(p_dispute_id, p_reason);
END;
$$;

CREATE FUNCTION public.save_customer_communication_saved_template(
  p_name text,
  p_subject text,
  p_body text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_role text := public._portal_actor_role();
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('administrativo', 'documentacao', 'equipamentos') THEN
    RAISE EXCEPTION 'Sem permissão para salvar modelos.' USING ERRCODE = '42501';
  END IF;
  RETURN public._save_customer_communication_saved_template_impl_20260920(p_name, p_subject, p_body);
END;
$$;

CREATE FUNCTION public.set_agency_report_terminal(
  p_voyage_id bigint,
  p_port text,
  p_terminal text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_role text := public._portal_actor_role();
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('administrativo', 'operacoes') THEN
    RAISE EXCEPTION 'Terminal pertence ao departamento operacoes.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._set_agency_report_terminal_impl_20260920(p_voyage_id, p_port, p_terminal);
END;
$$;

CREATE FUNCTION public._portal_invoice_details_core(p_customer_id bigint, p_invoice_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_raw jsonb;
  v_invoice jsonb;
  v_bls jsonb;
  v_items jsonb;
  v_containers jsonb;
  v_payments jsonb;
BEGIN
  v_raw := public._portal_invoice_details_core_unfiltered_20260920(p_customer_id, p_invoice_id);

  v_invoice := jsonb_build_object(
    'id', v_raw #> '{invoice,id}',
    'invoice_number', v_raw #> '{invoice,invoice_number}',
    'customer_id', v_raw #> '{invoice,customer_id}',
    'bl_id', v_raw #> '{invoice,bl_id}',
    'issued_at', v_raw #> '{invoice,issued_at}',
    'total_brl', v_raw #> '{invoice,total_brl}',
    'status', v_raw #> '{invoice,status}',
    'pix_payload', v_raw #> '{invoice,pix_payload}',
    'created_at', v_raw #> '{invoice,created_at}',
    'total_paid_brl', v_raw #> '{invoice,total_paid_brl}',
    'balance_brl', v_raw #> '{invoice,balance_brl}',
    'invoice_type', v_raw #> '{invoice,invoice_type}',
    'updated_at', v_raw #> '{invoice,updated_at}',
    'customer_name', v_raw #> '{invoice,customer_name}',
    'customer_cnpj_cpf', v_raw #> '{invoice,customer_cnpj_cpf}'
  );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', row->'id',
    'invoice_id', row->'invoice_id',
    'bl_id', row->'bl_id',
    'charge_status_snapshot', row->'charge_status_snapshot',
    'financial_status_snapshot', row->'financial_status_snapshot',
    'subtotal_brl', row->'subtotal_brl',
    'subtotal_usd', row->'subtotal_usd',
    'created_at', row->'created_at',
    'charge_status', row->'charge_status',
    'financial_status', row->'financial_status',
    'pol', row->'pol',
    'pod', row->'pod',
    'voyage_number', row->'voyage_number',
    'vessel_name', row->'vessel_name'
  )), '[]'::jsonb)
  INTO v_bls
  FROM jsonb_array_elements(COALESCE(v_raw->'bls', '[]'::jsonb)) AS row;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', row->'id',
    'invoice_id', row->'invoice_id',
    'description', row->'description',
    'quantity', row->'quantity',
    'unit_value_brl', row->'unit_value_brl',
    'total_value_brl', row->'total_value_brl',
    'bl_id', row->'bl_id',
    'source', row->'source',
    'currency', row->'currency',
    'unit_value_usd', row->'unit_value_usd',
    'total_value_usd', row->'total_value_usd'
  )), '[]'::jsonb)
  INTO v_items
  FROM jsonb_array_elements(COALESCE(v_raw->'items', '[]'::jsonb)) AS row;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', row->'id',
    'bl_id', row->'bl_id',
    'container_number', row->'container_number',
    'type', row->'type',
    'seal_number', row->'seal_number',
    'gross_weight_kg', row->'gross_weight_kg'
  )), '[]'::jsonb)
  INTO v_containers
  FROM jsonb_array_elements(COALESCE(v_raw->'containers', '[]'::jsonb)) AS row;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', row->'id',
    'invoice_id', row->'invoice_id',
    'amount_brl', row->'amount_brl',
    'payment_method', row->'payment_method',
    'paid_at', row->'paid_at',
    'created_at', row->'created_at'
  )), '[]'::jsonb)
  INTO v_payments
  FROM jsonb_array_elements(COALESCE(v_raw->'payments', '[]'::jsonb)) AS row;

  RETURN jsonb_build_object(
    'invoice', v_invoice,
    'bls', v_bls,
    'items', v_items,
    'containers', v_containers,
    'payments', v_payments
  );
END;
$$;

CREATE FUNCTION public._portal_get_demurrage_invoice_detail_core(p_customer_id bigint, p_invoice_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_raw jsonb;
  v_invoice jsonb;
  v_items jsonb;
BEGIN
  v_raw := public._portal_get_demurrage_invoice_detail_core_unfiltered_20260920(p_customer_id, p_invoice_id);

  v_invoice := jsonb_build_object(
    'id', v_raw #> '{invoice,id}',
    'doc_number', v_raw #> '{invoice,doc_number}',
    'bl_id', v_raw #> '{invoice,bl_id}',
    'doc_date', v_raw #> '{invoice,doc_date}',
    'due_date', v_raw #> '{invoice,due_date}',
    'billed_at', v_raw #> '{invoice,billed_at}',
    'paid_at', v_raw #> '{invoice,paid_at}',
    'total_usd', v_raw #> '{invoice,total_usd}',
    'current_roe', v_raw #> '{invoice,current_roe}',
    'current_total_brl', v_raw #> '{invoice,current_total_brl}',
    'discount_type', v_raw #> '{invoice,discount_type}',
    'discount_value', v_raw #> '{invoice,discount_value}',
    'discount_mode', v_raw #> '{invoice,discount_mode}',
    'dispute_open', v_raw #> '{invoice,dispute_open}',
    'pix_payload', v_raw #> '{invoice,pix_payload}',
    'status', v_raw #> '{invoice,status}',
    'updated_at', v_raw #> '{invoice,updated_at}',
    'roe_source', v_raw #> '{invoice,roe_source}',
    'customer_name', v_raw #> '{invoice,customer_name}',
    'customer_cnpj_cpf', v_raw #> '{invoice,customer_cnpj_cpf}',
    'pol', v_raw #> '{invoice,pol}',
    'pod', v_raw #> '{invoice,pod}',
    'voyage_number', v_raw #> '{invoice,voyage_number}',
    'vessel_name', v_raw #> '{invoice,vessel_name}'
  );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', row->'id',
    'invoice_id', row->'invoice_id',
    'container_id', row->'container_id',
    'container_number', row->'container_number',
    'container_type', row->'container_type',
    'discharge_date', row->'discharge_date',
    'return_date', row->'return_date',
    'total_days', row->'total_days',
    'free_days', row->'free_days',
    'days_p1', row->'days_p1',
    'rate_p1_usd', row->'rate_p1_usd',
    'days_p2', row->'days_p2',
    'rate_p2_usd', row->'rate_p2_usd',
    'subtotal_usd', row->'subtotal_usd',
    'created_at', row->'created_at'
  )), '[]'::jsonb)
  INTO v_items
  FROM jsonb_array_elements(COALESCE(v_raw->'items', '[]'::jsonb)) AS row;

  RETURN jsonb_build_object('invoice', v_invoice, 'items', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.add_demurrage_dispute_message(bigint, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_demurrage_disputes_internal(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reopen_demurrage_dispute(bigint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_customer_communication_saved_template(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_agency_report_terminal(bigint, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._portal_invoice_details_core(bigint, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._portal_get_demurrage_invoice_detail_core(bigint, bigint) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.add_demurrage_dispute_message(bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_demurrage_disputes_internal(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_demurrage_dispute(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_customer_communication_saved_template(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_agency_report_terminal(bigint, text, text) TO authenticated;

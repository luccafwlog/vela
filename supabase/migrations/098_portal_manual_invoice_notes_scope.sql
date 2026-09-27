-- Migration 098: restringir a descrição da fatura avulsa no detalhe do Portal.
--
-- A migration 097 passou a incluir `invoices.notes` na allowlist pública. Para
-- faturas legadas esse campo pode conter observações internas; somente em
-- invoices `manual` ele é a descrição destinada ao cliente.

ALTER FUNCTION public._portal_invoice_details_core(bigint, bigint)
  RENAME TO _portal_invoice_details_core_20260927;

CREATE FUNCTION public._portal_invoice_details_core(p_customer_id bigint, p_invoice_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public._portal_invoice_details_core_20260927(p_customer_id, p_invoice_id);

  IF v_result #>> '{invoice,invoice_type}' IS DISTINCT FROM 'manual' THEN
    v_result := jsonb_set(
      v_result,
      '{invoice}',
      (v_result->'invoice') - 'notes',
      true
    );
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public._portal_invoice_details_core(bigint, bigint)
  FROM PUBLIC, anon, authenticated, service_role;

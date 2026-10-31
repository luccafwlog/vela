-- 555: o Portal diz por que a Invoice de Demurrage foi substituída.
--
-- Achado da revisão do Manual do Operador de 2026-10-31 (PR #1087, "Achados
-- desta revisão"). O detalhe da Invoice no Portal dizia sempre "Substitui a
-- fatura DEM-…, cancelada porque as datas dos containers mudaram". Desde as
-- migrations 522, 524 e 550 a reemissão automática também acontece quando um
-- container passa a SOC (ADR 0112, D20) ou quando muda a divisão da caixa
-- entre Clientes (D22), e o motivo gravado diz a causa ("Container passou a
-- SOC: …", "Divisão da caixa entre Clientes alterada: …", "Datas de container
-- alteradas: …"). A aba Canceladas do Vela já mostra esse motivo.
--
-- O motivo gravado é texto interno e não vai ao Cliente (530). Por isso:
-- 1. `_demurrage_replaced_cause(id da cancelada)` lê o motivo do cancelamento
--    em `audit_logs` (a mesma leitura da aba Canceladas e do gatilho da
--    Disputa) e devolve só um código: `datas`, `soc` ou `divisao`; NULL para
--    qualquer outro motivo (cancelamento à mão, troca de CNPJ). Linhas antigas
--    com "Datas de container alteradas" continuam `datas`.
--    ponytail: entre a 522 e a 550 o cancelamento por SOC ou por divisão da
--    caixa também gravava "Datas de container alteradas"; essas linhas dão
--    `datas` (texto errado no Portal). Como os dados de hoje são de teste, não
--    há reclassificação; se algum dia importar, ler a causa pela
--    `_demurrage_stale_cause` da época, que não é recuperável depois.
-- 2. `_portal_get_demurrage_invoice_detail_core` (corpo da 521) devolve
--    `replaces_cause` ao lado de `replaces_doc_number`. A frase é da tela.
--
-- Redefine uma função com a mesma assinatura e cria uma auxiliar; não
-- reescreve nem apaga linhas.
--
-- Rollback: recriar `_portal_get_demurrage_invoice_detail_core` com o corpo da
-- 521 e `DROP FUNCTION public._demurrage_replaced_cause(bigint)`.

CREATE OR REPLACE FUNCTION public._demurrage_replaced_cause(p_cancelled_invoice_id bigint)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN reason LIKE 'Datas de container alteradas: cancelada para reemissão%' THEN 'datas'
    WHEN reason LIKE 'Container passou a SOC: cancelada para reemissão%' THEN 'soc'
    WHEN reason LIKE 'Divisão da caixa entre Clientes alterada: cancelada para reemissão%' THEN 'divisao'
  END
  FROM (
    SELECT btrim(a.justification) AS reason
      FROM public.audit_logs AS a
     WHERE a.entity_type = 'demurrage_invoice' AND a.entity_id = p_cancelled_invoice_id::text
       AND a.field_name = 'status' AND a.new_value = 'cancelled'
     ORDER BY a.changed_at DESC, a.id DESC
     LIMIT 1
  ) AS last_cancel;
$function$;
REVOKE ALL ON FUNCTION public._demurrage_replaced_cause(bigint) FROM PUBLIC, anon, authenticated;

-- Corpo da 521, com `replaces_cause`.
CREATE OR REPLACE FUNCTION public._portal_get_demurrage_invoice_detail_core(p_customer_id bigint, p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_raw jsonb;
  v_invoice jsonb;
  v_items jsonb;
  v_refunds jsonb;
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
    'vessel_name', v_raw #> '{invoice,vessel_name}',
    -- 472 (DEM-D08): a Invoice reemitida diz qual cancelada ela substitui.
    'replaces_doc_number', (SELECT prev.doc_number FROM public.demurrage_invoices cur
      JOIN public.demurrage_invoices prev ON prev.id = cur.replaces_invoice_id
      WHERE cur.id = (v_raw #>> '{invoice,id}')::bigint),
    -- 555: a causa da reemissão, em código; o motivo gravado não sai (530).
    'replaces_cause', (SELECT public._demurrage_replaced_cause(cur.replaces_invoice_id)
      FROM public.demurrage_invoices cur
      WHERE cur.id = (v_raw #>> '{invoice,id}')::bigint)
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
    'box_share_count', COALESCE(row->'box_share_count', '1'::jsonb),
    'created_at', row->'created_at'
  )), '[]'::jsonb)
  INTO v_items
  FROM jsonb_array_elements(COALESCE(v_raw->'items', '[]'::jsonb)) AS row;

  -- 298: restituições da Invoice (valor, situação e data), sem as anotações
  -- internas, para o detalhe e o recibo do Portal mostrarem o que foi devolvido.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'amount_brl', f.amount_brl,
    'status', f.status,
    'purpose', f.purpose,
    'settled_at', f.settled_at,
    'notes', NULL,
    'bank_reference', NULL,
    'beneficiary', NULL
  ) ORDER BY f.id), '[]'::jsonb)
  INTO v_refunds
  FROM public.demurrage_refunds AS f
  WHERE f.invoice_id = p_invoice_id
    AND f.status <> 'cancelled'
    AND v_raw ? 'invoice'
    AND v_raw->'invoice' <> 'null'::jsonb;

  RETURN jsonb_build_object(
    'invoice', v_invoice,
    'items', v_items,
    'refund_summary', jsonb_build_object(
      'received_brl', CASE WHEN v_raw #>> '{invoice,status}' = 'paid'
        THEN COALESCE((v_raw #>> '{invoice,current_total_brl}')::numeric, 0) ELSE 0 END,
      'refunds', v_refunds
    )
  );
END;
$function$;


-- 553: o Histórico de baixas lista cada baixa, com a forma (automática pelo
-- Itaú, pelo extrato, manual ou isenção) e o valor que ela pôs em cada B/L
-- (ADR 0115, decisões 4 a 6).
--
-- Problema (staging, 2026-10-30):
--   A aba lia as faturas pagas, cobertas ou parcialmente pagas e mostrava uma
--   linha por fatura e B/L, com a data da baixa mais recente e o total pago da
--   fatura. Duas baixas manuais parciais (R$ 2.469,00 na INV-2026-0002 e
--   R$ 2.469,50 na INV-2026-0003) sumiram: as duas faturas ficaram "Coberta
--   pela consolidada", com o valor pago "—". A consolidada INV-2026-0005, paga
--   por um Pix de R$ 1,50, repetiu R$ 1,50 em cada B/L, quando R$ 1,00 foi
--   para um e R$ 0,50 para o outro. O resumo dizia "3 faturas · R$ 1,50 pagos"
--   para R$ 4.940,00 recebidos. E nada dizia se a baixa foi automática ou à mão.
--
-- Mudança:
--   `list_payment_history(p_customer_id)` devolve uma linha por baixa e B/L:
--   - Taxas Locais e avulsa: cada `payments` que existe (baixa cancelada é
--     apagada e some), em qualquer situação da fatura. O valor da linha é o que
--     a baixa liquidou naquele B/L (`ledger_settlements` pelo recebível); a
--     avulsa e a baixa sem rateio no ledger têm uma linha com o valor da baixa.
--   - Invoice de Demurrage paga: uma linha, com o valor congelado no pagamento.
--   - Forma da baixa, decidida aqui porque o navegador não lê os recebimentos
--     do Itaú: `itau` quando a baixa foi gravada pela conta da baixa automática
--     (`app_settings.itau_pix_settlement_actor`), tem origem `itau_pix` no
--     ledger ou usa o endToEndId de um Pix que a baixa automática gravou como
--     baixado; `extract` quando o ledger diz `pix_extract` ou a avulsa foi
--     conciliada por TXID (nota do sistema); `manual` no resto. Na Demurrage,
--     pelo `payment_method` (519), separando o Pix do Itaú baixado sozinho
--     (TXID da cobrança, ou endToEndId gravado como baixado) do Pix recebido
--     baixado à mão; `isencao` vira `exemption`.
--   Leitura de todo usuário interno ativo, como o resto da Conciliação PIX
--   (migration 247).
--
-- ponytail: devolve todas as baixas de uma vez e a tela filtra, ordena e pagina
-- no navegador, como a leitura anterior (lotes de 1000 faturas). Com dezenas de
-- milhares de baixas, mover filtros e página para esta função.
--
-- Só cria uma função; não reescreve nem apaga linhas.
-- Rollback: `DROP FUNCTION public.list_payment_history(bigint)`; a tela anterior
-- lia as tabelas direto.

CREATE OR REPLACE FUNCTION public.list_payment_history(p_customer_id bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor uuid;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão para consultar o histórico de baixas.' USING ERRCODE = '42501';
  END IF;
  SELECT itau_pix_settlement_actor INTO v_actor FROM public.app_settings WHERE id = 1;

  WITH pay AS (
    SELECT p.id AS payment_id, p.invoice_id, p.amount_brl, p.paid_at, nullif(btrim(p.bank_reference), '') AS bank_reference,
      CASE
        WHEN v_actor IS NOT NULL AND p.registered_by = v_actor THEN 'itau'
        WHEN EXISTS (SELECT 1 FROM public.ledger_settlements s WHERE s.payment_id = p.id AND s.source = 'itau_pix') THEN 'itau'
        WHEN EXISTS (SELECT 1 FROM public.itau_pix_receipts r
                     WHERE upper(r.end_to_end_id) = upper(btrim(coalesce(p.bank_reference, '')))
                       AND r.status = 'settled' AND NOT coalesce((r.result ->> 'already_settled')::boolean, false)) THEN 'itau'
        WHEN EXISTS (SELECT 1 FROM public.ledger_settlements s WHERE s.payment_id = p.id AND s.source = 'pix_extract') THEN 'extract'
        -- Avulsa conciliada por TXID (extrato): a nota é do sistema (migration 130).
        WHEN p.notes = 'Conciliacao automatica por TXID' THEN 'extract'
        ELSE 'manual'
      END AS method
    FROM public.payments p
    JOIN public.invoices i ON i.id = p.invoice_id
    WHERE p_customer_id IS NULL OR i.customer_id = p_customer_id
  ),
  alloc AS (
    SELECT s.payment_id, r.bl_id, sum(s.amount_brl) AS amount_brl
    FROM public.ledger_settlements s
    JOIN public.bl_receivables r ON r.id = s.receivable_id
    WHERE s.payment_id IN (SELECT payment_id FROM pay)
    GROUP BY s.payment_id, r.bl_id
  ),
  invoice_bl AS (
    -- B/Ls da fatura e o valor de cada um nela (consolidada: o subtotal do B/L).
    SELECT x.invoice_id, x.bl_id, max(x.subtotal_brl) AS subtotal_brl
    FROM (
      SELECT ib.invoice_id, ib.bl_id, ib.subtotal_brl FROM public.invoice_bls ib
      UNION ALL
      SELECT l.invoice_id, l.bl_id, l.subtotal_brl FROM public.invoice_receivable_links l
      UNION ALL
      SELECT i.id, i.bl_id, NULL::numeric FROM public.invoices i WHERE i.bl_id IS NOT NULL
    ) x
    WHERE x.invoice_id IN (SELECT invoice_id FROM pay) AND nullif(btrim(x.bl_id), '') IS NOT NULL
    GROUP BY x.invoice_id, x.bl_id
  ),
  local_rows AS (
    -- Baixa rateada no ledger: uma linha por B/L, com o que ela liquidou nele.
    SELECT p.*, a.bl_id, a.amount_brl AS line_amount_brl, 1 AS bl_count
    FROM pay p JOIN alloc a ON a.payment_id = p.payment_id
    UNION ALL
    -- Avulsa ou baixa sem rateio: uma linha com o valor da baixa.
    SELECT p.*,
      CASE WHEN (SELECT count(*) FROM invoice_bl b WHERE b.invoice_id = p.invoice_id) = 1
        THEN (SELECT b.bl_id FROM invoice_bl b WHERE b.invoice_id = p.invoice_id) END,
      p.amount_brl,
      (SELECT count(*)::integer FROM invoice_bl b WHERE b.invoice_id = p.invoice_id)
    FROM pay p
    WHERE NOT EXISTS (SELECT 1 FROM alloc a WHERE a.payment_id = p.payment_id)
  ),
  history_rows AS (
    SELECT jsonb_build_object(
      'source', 'local',
      'invoice_id', i.id,
      'doc_number', coalesce(i.invoice_number, 'INV-' || i.id),
      'invoice_type', i.invoice_type,
      'invoice_status', i.status,
      'invoice_total_brl', i.total_brl,
      'invoice_balance_brl', i.balance_brl,
      'customer_name', cu.name,
      'customer_cnpj', cu.cnpj_cpf,
      'payment_id', lr.payment_id,
      'paid_at', lr.paid_at,
      'payment_amount_brl', lr.amount_brl,
      'method', lr.method,
      'bank_reference', lr.bank_reference,
      'bl_id', lr.bl_id,
      'bl_count', lr.bl_count,
      'bl_amount_brl', CASE WHEN lr.bl_id IS NULL THEN i.total_brl
        ELSE coalesce((SELECT b.subtotal_brl FROM invoice_bl b WHERE b.invoice_id = i.id AND b.bl_id = lr.bl_id), i.total_brl) END,
      'amount_brl', lr.line_amount_brl,
      'pod', bl.pod,
      'voyage_number', coalesce(bv.voyage_number, iv.voyage_number),
      'vessel_name', coalesce(bvs.name, ivs.name)
    ) AS item
    FROM local_rows lr
    JOIN public.invoices i ON i.id = lr.invoice_id
    LEFT JOIN public.customers cu ON cu.id = i.customer_id
    LEFT JOIN public.bls bl ON bl.id = lr.bl_id
    LEFT JOIN public.voyages bv ON bv.id = bl.voyage_id
    LEFT JOIN public.vessels bvs ON bvs.id = bv.vessel_id
    LEFT JOIN public.voyages iv ON iv.id = i.voyage_id
    LEFT JOIN public.vessels ivs ON ivs.id = iv.vessel_id
    UNION ALL
    SELECT jsonb_build_object(
      'source', 'demurrage',
      'invoice_id', d.id,
      'doc_number', d.doc_number,
      'invoice_type', NULL,
      'invoice_status', d.status,
      'invoice_total_brl', d.current_total_brl,
      'invoice_balance_brl', 0,
      'customer_name', cu.name,
      'customer_cnpj', cu.cnpj_cpf,
      'payment_id', NULL,
      'paid_at', d.paid_at,
      'payment_amount_brl', d.current_total_brl,
      'method', CASE
        WHEN d.payment_method = 'extrato' THEN 'extract'
        WHEN d.payment_method = 'isencao' THEN 'exemption'
        WHEN d.payment_method = 'pix_itau' AND (
          EXISTS (SELECT 1 FROM public.itau_pix_charges c WHERE c.txid = d.pix_txid)
          OR EXISTS (SELECT 1 FROM public.itau_pix_receipts r
                     WHERE r.end_to_end_id = d.pix_txid AND r.status = 'settled'
                       AND NOT coalesce((r.result ->> 'already_settled')::boolean, false))) THEN 'itau'
        WHEN d.payment_method IS NULL AND d.conciliated_by_extract THEN 'extract'
        ELSE 'manual'
      END,
      'bank_reference', nullif(btrim(d.pix_txid), ''),
      'bl_id', d.bl_id,
      'bl_count', 1,
      'bl_amount_brl', d.current_total_brl,
      'amount_brl', d.current_total_brl,
      'pod', bl.pod,
      'voyage_number', v.voyage_number,
      'vessel_name', vs.name
    )
    FROM public.demurrage_invoices d
    LEFT JOIN public.customers cu ON cu.id = d.customer_id
    LEFT JOIN public.bls bl ON bl.id = d.bl_id
    LEFT JOIN public.voyages v ON v.id = bl.voyage_id
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    WHERE d.status = 'paid' AND d.paid_at IS NOT NULL
      AND (p_customer_id IS NULL OR d.customer_id = p_customer_id)
  )
  SELECT coalesce(jsonb_agg(item), '[]'::jsonb) INTO v_result FROM history_rows;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.list_payment_history(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_payment_history(bigint) TO authenticated;

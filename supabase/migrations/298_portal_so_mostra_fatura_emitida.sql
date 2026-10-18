-- 298: o Portal só mostra Taxas Locais de fatura emitida e liberada ao Cliente
-- (lote 4 da identidade visual, decisão do responsável de 2026-10-18).
--
-- Problema: o Portal mostrava valores que o Cliente ainda não tinha recebido
-- como fatura. "Exibir algo que não aparece para o Cliente é falha grave de
-- segurança" (responsável, 2026-10-18).
--   1. O Saldo pendente de Faturas (`_portal_customer_pending_balance`, 225)
--      somava todo recebível de Taxas Locais em aberto, inclusive o calculado
--      e ainda não faturado, o retido pela trava do Portal e o de fatura
--      cancelada; e a Demurrage sem a trava de CE que a lista do Portal usa.
--   2. A janela "Gerar fatura consolidada" (`_portal_list_consolidatable_
--      receivables_core`, 002) listava, com saldo, B/L que nunca teve fatura
--      e B/L de fatura cancelada; e `portal_create_consolidation` (109)
--      aceitava consolidá-los.
--   3. Fatura em rascunho (`draft`) contava como visível
--      (`_portal_invoice_visible` e `_portal_list_invoices_core`, 162).
--   4. O Desbloqueio de CE dizia "Taxas locais sem liquidação integral
--      confirmada" para B/L cujo valor o Cliente ainda não recebeu.
--
-- Mudança (ADR 0088):
--   1. Fatura visível no Portal = emitida (qualquer situação exceto
--      rascunho), do Cliente, e com todos os B/Ls liberados por CE (avulsa
--      continua sempre visível). Vale para a lista, o detalhe e a Dispute.
--   2. Saldo pendente = saldo das faturas visíveis em aberto (a mesma soma do
--      Painel) + Invoices de Demurrage em aberto da lista do Portal.
--   3. A consolidação do Portal só lista e só aceita recebível de B/L que tem
--      fatura visível não cancelada; motivos com acento.
--   4. A lista de B/Ls do Portal ganha `local_charges`: total e saldo das
--      faturas visíveis do B/L, ou só a situação "aguardando fatura" (sem
--      valor) quando ainda não há fatura visível.
--   5. O detalhe de Demurrage do Portal ganha `refund_summary` (restituições
--      sem anotações internas), para o detalhe e o recibo.
--   6. A visão do Portal do Desbloqueio de CE marca
--      `local_charges_awaiting_invoice` e troca o motivo para "Taxas locais
--      aguardando fatura" quando o B/L não tem fatura visível.
--
-- O Modo Inspeção usa os mesmos núcleos e acompanha tudo. O Vela interno não
-- muda.
-- Só redefine funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar `_portal_invoice_visible` e `_portal_list_invoices_core`
-- da 162, `_portal_customer_pending_balance` da 225,
-- `_portal_list_consolidatable_receivables_core` da 002,
-- `portal_create_consolidation` da 109, `_portal_list_operation_bls_core` da
-- 089, `_portal_get_demurrage_invoice_detail_core` da 068 e
-- `ce_unlock_private.portal_view` da 160; DROP FUNCTION
-- public._portal_bl_local_charges(bigint, text, jsonb).

-- 1. Visibilidade da fatura ------------------------------------------------

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
      AND i.status <> 'draft'
      AND (
        i.invoice_type = 'manual'
        OR (EXISTS (SELECT 1 FROM linked)
            AND NOT EXISTS (SELECT 1 FROM linked WHERE NOT public.bl_has_portal_release(linked.bl_id)))
      )
  );
$function$;

-- Lista e página do Portal usam este núcleo: rascunho sai.
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
      -- 298: rascunho não é fatura emitida; o Portal só vê o que foi emitido.
      AND i.status <> 'draft'
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

-- 2. Saldo pendente: só o que o Cliente vê como fatura ---------------------

CREATE OR REPLACE FUNCTION public._portal_customer_pending_balance(p_customer_id bigint) RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    COALESCE((
      SELECT SUM(GREATEST(COALESCE(inv.balance_brl, 0), 0))
      FROM public._portal_list_invoices_core(p_customer_id) AS inv
      WHERE inv.status IN ('issued', 'partially_paid', 'overdue')
    ), 0)
    + COALESCE((
      SELECT SUM(GREATEST(COALESCE((dem->>'current_total_brl')::numeric, 0), 0))
      FROM jsonb_array_elements(public._portal_list_demurrage_invoices_core(p_customer_id)) AS dem
      WHERE dem->>'status' IN ('issued', 'overdue')
    ), 0)
$$;

REVOKE ALL ON FUNCTION public._portal_customer_pending_balance(bigint) FROM PUBLIC, anon, authenticated;

-- 3. Consolidação: só B/L com fatura visível ------------------------------

CREATE OR REPLACE FUNCTION public._portal_list_consolidatable_receivables_core(p_customer_id bigint) RETURNS TABLE(receivable_id bigint, bl_id text, customer_id bigint, customer_name text, customer_cnpj_cpf text, voyage_id bigint, vessel_name text, voyage_number text, individual_invoice_id bigint, individual_invoice_number text, balance_brl numeric, original_amount_brl numeric, receivable_status text, eligibility_status text, eligibility_reason text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      br.id AS receivable_id,
      br.bl_id,
      br.customer_id,
      c.name AS customer_name,
      c.cnpj_cpf AS customer_cnpj_cpf,
      br.voyage_id,
      v.voyage_number,
      ve.name AS vessel_name,
      br.balance_brl,
      br.original_amount_brl,
      br.status AS receivable_status,
      indiv.invoice_id AS individual_invoice_id,
      inv_ind.invoice_number AS individual_invoice_number,
      EXISTS (
        SELECT 1
        FROM public.invoice_receivable_links irl
        JOIN public.invoices inv ON inv.id = irl.invoice_id
        WHERE irl.receivable_id = br.id
          AND inv.invoice_type = 'consolidated'
          AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
      ) AS has_open_consolidated
    FROM public.bl_receivables br
    JOIN public.customers c ON c.id = br.customer_id
    LEFT JOIN public.voyages v ON v.id = br.voyage_id
    LEFT JOIN public.vessels ve ON ve.id = v.vessel_id
    LEFT JOIN LATERAL (
      SELECT linked.invoice_id
      FROM (
        SELECT irl.invoice_id FROM public.invoice_receivable_links irl WHERE irl.receivable_id = br.id
        UNION
        SELECT ib.invoice_id FROM public.invoice_bls ib WHERE ib.bl_id = br.bl_id
      ) AS linked
      JOIN public.invoices inv ON inv.id = linked.invoice_id
      WHERE inv.invoice_type = 'individual'
        AND inv.customer_id = p_customer_id
        AND inv.status NOT IN ('draft', 'cancelled', 'obsolete')
      ORDER BY inv.id DESC
      LIMIT 1
    ) indiv ON TRUE
    LEFT JOIN public.invoices inv_ind ON inv_ind.id = indiv.invoice_id
    WHERE br.customer_id = p_customer_id
      AND br.source = 'local_charges'
      AND public.bl_has_portal_release(br.bl_id)
      -- 298: só entra o recebível que o Cliente já recebeu como fatura
      -- emitida, não cancelada e visível no Portal (ADR 0088).
      AND (
        EXISTS (
          SELECT 1
          FROM public.invoice_receivable_links irl
          JOIN public.invoices inv ON inv.id = irl.invoice_id
          WHERE irl.receivable_id = br.id
            AND irl.status IN ('active', 'settled_by_this_invoice')
            AND inv.status NOT IN ('draft', 'cancelled', 'obsolete')
            AND public._portal_invoice_visible(p_customer_id, inv.id)
        )
        -- Fatura anterior ao razão de recebíveis, ligada só pelo B/L.
        OR EXISTS (
          SELECT 1
          FROM public.invoice_bls ib
          JOIN public.invoices inv ON inv.id = ib.invoice_id
          WHERE ib.bl_id = br.bl_id
            AND inv.customer_id = p_customer_id
            AND inv.invoice_type IN ('individual', 'consolidated')
            AND inv.status NOT IN ('draft', 'cancelled', 'obsolete')
            AND public._portal_invoice_visible(p_customer_id, inv.id)
        )
      )
  )
  SELECT
    base.receivable_id,
    base.bl_id,
    base.customer_id,
    base.customer_name,
    base.customer_cnpj_cpf,
    base.voyage_id,
    base.vessel_name,
    base.voyage_number,
    base.individual_invoice_id,
    base.individual_invoice_number,
    base.balance_brl,
    base.original_amount_brl,
    base.receivable_status,
    CASE
      WHEN base.receivable_status = 'settled' THEN 'paid'
      WHEN base.receivable_status = 'void' THEN 'no_balance'
      WHEN base.has_open_consolidated THEN 'open_consolidated'
      WHEN base.balance_brl <= 0 THEN 'no_balance'
      ELSE 'eligible'
    END AS eligibility_status,
    CASE
      WHEN base.receivable_status = 'settled' THEN 'Já foi pago.'
      WHEN base.receivable_status = 'void' THEN 'Sem saldo de Taxas Locais.'
      WHEN base.has_open_consolidated THEN 'Já está numa consolidada em aberto.'
      WHEN base.balance_brl <= 0 THEN 'Sem saldo em aberto.'
      ELSE 'Pode entrar na consolidada.'
    END AS eligibility_reason
  FROM base
  ORDER BY base.voyage_id DESC NULLS LAST, base.bl_id ASC;
END;
$$;
REVOKE ALL ON FUNCTION public._portal_list_consolidatable_receivables_core(p_customer_id bigint) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.portal_create_consolidation(p_receivable_ids bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_ids BIGINT[];
  v_result JSONB;
BEGIN
  PERFORM public.check_portal_rate_limit('create_consolidation', 3, 10);
  SELECT ARRAY_AGG(DISTINCT id ORDER BY id) INTO v_ids
  FROM UNNEST(COALESCE(p_receivable_ids, ARRAY[]::BIGINT[])) AS u(id) WHERE id IS NOT NULL;
  IF EXISTS (SELECT 1 FROM public.bl_receivables br WHERE br.id = ANY(v_ids) AND br.customer_id <> v_customer_id) THEN
    RAISE EXCEPTION 'Seleção contém B/Ls de outro cliente.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bl_receivables br WHERE br.id = ANY(v_ids) AND NOT public.bl_has_portal_release(br.bl_id)) THEN
    RAISE EXCEPTION 'Seleção contém B/L sem CE Mercante liberado para o portal.' USING ERRCODE = '42501';
  END IF;
  -- 298: o Portal só consolida o que a janela lista como elegível: recebível
  -- com fatura emitida e visível, saldo em aberto e sem consolidada aberta.
  IF EXISTS (
    SELECT 1 FROM UNNEST(COALESCE(v_ids, ARRAY[]::BIGINT[])) AS u(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public._portal_list_consolidatable_receivables_core(v_customer_id) AS c
      WHERE c.receivable_id = u.id AND c.eligibility_status = 'eligible'
    )
  ) THEN
    RAISE EXCEPTION 'Seleção contém B/L que não pode entrar na consolidada. Atualize a lista.' USING ERRCODE = '42501';
  END IF;
  v_result := public.create_local_consolidated_invoice_core(v_customer_id, p_receivable_ids, auth.uid(), 'portal');
  INSERT INTO public.portal_notifications (customer_id, type, title, message, link)
  VALUES (v_customer_id, 'system', 'Fatura consolidada criada',
    'Sua fatura consolidada foi gerada com ' || COALESCE(array_length(v_ids, 1), 0) || ' B/L(s).', '/portal/billing');
  RETURN v_result;
END;
$function$;

-- 4. Lista de B/Ls: Taxas Locais só das faturas visíveis --------------------

-- Total e saldo de Taxas Locais do B/L a partir das faturas que o Cliente vê
-- (`p_invoices` = linhas de `_portal_list_invoices_core`, lidas uma vez por
-- chamada da lista). Sem fatura visível, só a situação, sem valor.
CREATE OR REPLACE FUNCTION public._portal_bl_local_charges(p_customer_id bigint, p_bl text, p_invoices jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH visible AS (
    SELECT (inv->>'id')::bigint AS invoice_id,
           inv->>'status' AS status,
           inv->>'invoice_type' AS invoice_type,
           COALESCE((inv->>'total_brl')::numeric, 0) AS total_brl,
           COALESCE((inv->>'balance_brl')::numeric, 0) AS balance_brl,
           jsonb_array_length(COALESCE(inv->'bls', '[]'::jsonb)) AS bl_count
    FROM jsonb_array_elements(COALESCE(p_invoices, '[]'::jsonb)) AS inv
    WHERE inv->>'invoice_type' IN ('individual', 'consolidated')
      AND inv->>'status' NOT IN ('draft', 'cancelled', 'obsolete', 'covered')
      AND COALESCE(inv->'bls', '[]'::jsonb) ? p_bl
  ),
  share AS (
    -- Fatura de um B/L só: o total e o saldo da própria fatura. Consolidada
    -- de vários B/Ls: a parte deste B/L, pelo recebível ligado a ela.
    SELECT
      CASE WHEN v.bl_count <= 1 THEN v.total_brl
        ELSE COALESCE((SELECT SUM(br.original_amount_brl - COALESCE(br.correction_amount_brl, 0))
          FROM public.invoice_receivable_links irl
          JOIN public.bl_receivables br ON br.id = irl.receivable_id
          WHERE irl.invoice_id = v.invoice_id AND irl.bl_id = p_bl
            AND irl.status IN ('active', 'settled_by_this_invoice')), 0) END AS total_brl,
      CASE WHEN v.bl_count <= 1 THEN v.balance_brl
        ELSE COALESCE((SELECT SUM(br.balance_brl)
          FROM public.invoice_receivable_links irl
          JOIN public.bl_receivables br ON br.id = irl.receivable_id
          WHERE irl.invoice_id = v.invoice_id AND irl.bl_id = p_bl
            AND irl.status = 'active'), 0) END AS balance_brl
    FROM visible AS v
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM visible) THEN jsonb_build_object(
      'status', CASE WHEN (SELECT SUM(GREATEST(balance_brl, 0)) FROM share) > 0 THEN 'open' ELSE 'paid' END,
      'total_brl', (SELECT SUM(total_brl) FROM share),
      'balance_brl', (SELECT SUM(GREATEST(balance_brl, 0)) FROM share)
    )
    WHEN EXISTS (
      SELECT 1 FROM public.bl_receivables br
      WHERE br.bl_id = p_bl AND br.customer_id = p_customer_id
        AND br.source = 'local_charges' AND br.status IN ('open', 'partially_settled')
    ) THEN jsonb_build_object('status', 'awaiting_invoice')
    ELSE jsonb_build_object('status', 'none')
  END
$$;
REVOKE ALL ON FUNCTION public._portal_bl_local_charges(bigint, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._portal_list_operation_bls_core(p_customer_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rows JSONB := public._portal_list_operation_bls_without_transshipment_core(p_customer_id);
  v_invoices JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', inv.id, 'status', inv.status, 'invoice_type', inv.invoice_type,
    'total_brl', inv.total_brl, 'balance_brl', inv.balance_brl, 'bls', to_jsonb(inv.bls)
  )), '[]'::jsonb)
  INTO v_invoices
  FROM public._portal_list_invoices_core(p_customer_id) AS inv;

  RETURN (
    SELECT COALESCE(jsonb_agg(
      item || jsonb_build_object(
        'cancelled_at', (SELECT b.cancelled_at FROM public.bls b WHERE b.id = item->>'bl_id'),
        'local_charges', public._portal_bl_local_charges(p_customer_id, item->>'bl_id', v_invoices),
        'transshipment', CASE WHEN omission.id IS NULL THEN NULL ELSE jsonb_build_object(
          'omission_id', omission.id,
          'disposition', omission.disposition,
          'omitted_pod', omission.omitted_pod,
          'discharge_pod', omission.discharge_pod,
          'reason', omission.reason,
          'onward_vessel_name', omission.onward_vessel_name,
          'onward_carrier', omission.onward_carrier,
          'onward_voyage_number', omission.onward_voyage_number,
          'onward_etd', omission.onward_etd,
          'onward_eta', omission.onward_eta
        ) END
      ) ORDER BY ordinality
    ), '[]'::jsonb)
    FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS rows(item, ordinality)
    LEFT JOIN LATERAL (
      SELECT vo.id, bt.disposition, vo.omitted_pod, vo.discharge_pod, vo.reason,
             vo.onward_vessel_name, vo.onward_carrier, vo.onward_voyage_number,
             vo.onward_etd, vo.onward_eta
      FROM public.bl_transshipments bt
      JOIN public.voyage_omissions vo ON vo.id = bt.omission_id
      WHERE bt.bl_id = item->>'bl_id'
      ORDER BY vo.omitted_at DESC, vo.id DESC
      LIMIT 1
    ) omission ON true
  );
END;
$function$;

-- 5. Demurrage: restituições no detalhe do Portal ---------------------------

CREATE OR REPLACE FUNCTION public._portal_get_demurrage_invoice_detail_core(p_customer_id bigint, p_invoice_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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
$$;

-- 6. Desbloqueio de CE: o Portal não fala de Taxas Locais sem fatura ---------

CREATE OR REPLACE FUNCTION ce_unlock_private.portal_view(j jsonb) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v jsonb := j-'export_state'-'exported_at'-'zpt_status'-'zpt_description'-'zpt_pending'-'zpt_updated_at'-'zpt_without_export';
  v_customer bigint := (j->>'customer_id')::bigint;
  v_awaiting boolean;
BEGIN
  -- Campos que só o desk vê: envio/conciliação com a ZPT. O Portal nunca os recebe.
  -- 298: B/L ainda sem fatura visível não tem "Taxas locais sem liquidação":
  -- o Cliente vê só que a fatura ainda não saiu (ADR 0088).
  v_awaiting := NOT COALESCE((j->>'paid')::boolean, false)
    AND v_customer IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.customer_id = v_customer
        AND i.invoice_type IN ('individual', 'consolidated')
        AND i.status NOT IN ('draft', 'cancelled', 'obsolete')
        AND (EXISTS (SELECT 1 FROM public.invoice_bls ib WHERE ib.invoice_id = i.id AND ib.bl_id = j->>'bl_id')
          OR EXISTS (SELECT 1 FROM public.invoice_receivable_links irl
            WHERE irl.invoice_id = i.id AND irl.bl_id = j->>'bl_id'
              AND irl.status IN ('active', 'settled_by_this_invoice')))
        AND public._portal_invoice_visible(v_customer, i.id)
    );
  v := v || jsonb_build_object('local_charges_awaiting_invoice', v_awaiting);
  IF v_awaiting THEN
    v := v || jsonb_build_object('reasons', (
      SELECT COALESCE(jsonb_agg(CASE WHEN reason = 'Taxas locais sem liquidação integral confirmada'
        THEN 'Taxas locais aguardando fatura' ELSE reason END), '[]'::jsonb)
      FROM jsonb_array_elements_text(COALESCE(j->'reasons', '[]'::jsonb)) AS reason
    ));
  END IF;
  RETURN v;
END;
$$;

-- 191: Demurrage de grupo e container compartilhado — correções da revisão da
-- PR 929 (ADR 0078, itens 11, 12, 19 e 20; ADR 0077, item 4).
--
-- C2. Container compartilhado: um B/L faturado sozinho e pago guarda para
--     sempre o rateio antigo no vínculo da fatura (fatura paga não é
--     reemitida; a diferença vira abatimento ou restituição), e o B/L irmão
--     que chegou depois nunca faturava. `guard_shared_container_invoice` passa
--     a recusar só quando a fatura do irmão com rateio antigo ainda é
--     reemitível (sem pagamento, baixa parcial, cobertura por consolidada paga
--     nem correção registrada — a mesma régua de `apply_invoice_basis_changes`).
--     O caso de 150% (irmão sem pagamento ainda não reemitido) continua
--     recusado com P0007.
-- C5. Excluir B/L sem fatura: recebível anulado ou sem fatura não é
--     "documento financeiro emitido". `bl_delete_lock_reasons` e
--     `delete_lock_reasons` (Viagem e escala) só contam recebível com fatura
--     viva vinculada ou com baixa; o gatilho de exclusão do B/L apaga também o
--     recebível que o cancelamento já tinha anulado (antes ele esbarrava na FK).
-- C6. Grupo de Demurrage que muda depois da Invoice emitida: a completude do
--     grupo só é conferida na emissão (inserção ou rascunho que vira emitida),
--     não na baixa, no estorno nem na atualização de câmbio dos itens — um
--     irmão que chega depois não trava mais a baixa da Invoice. Cancelar um
--     B/L cujo container está numa Invoice de Demurrage viva de outro B/L do
--     grupo passa a ser recusado como "fatura de Demurrage em aberto".
-- C9. B/L cancelado não é raiz de grupo de Demurrage (grupo vazio) e não
--     recebe Invoice: as datas importadas na linha do B/L cancelado não
--     enfileiram emissão para ele, e `issue_demurrage_invoice_for_bl` e
--     `create_demurrage_invoice_authoritative` recusam com o motivo (antes a
--     caixa do irmão ativo era cobrada duas vezes).
-- C11. Linha antiga com devolução gravada e `demurrage_status` sem normalizar
--     (`within_free_time`) entra no cálculo: a validade é a devolução
--     preenchida, não o status. Nenhuma linha é reescrita.
-- C12. Régua de Cobrança: a suspensão gravada em Invoice paga com datas
--     alteradas não fica para sempre. No estorno da baixa a fatura volta a
--     ser "sem pagamento" e segue o item 19 da ADR 0078: com as datas ainda
--     diferentes das faturadas, é cancelada e reemitida (ou só cancelada, se
--     o valor novo for zero); com as datas de volta às faturadas, a suspensão
--     sai e a fatura segue emitida.
-- C14. Planilha de datas com descarga nova posterior à devolução gravada e
--     devolução vazia: recusa com mensagem de negócio antes do UPDATE (antes
--     era o erro cru da CHECK `bl_containers_return_after_discharge_chk`).
--
-- Não reescreve linhas existentes.
--
-- ponytail: C6 recusa o cancelamento quando o item da Invoice aponta para o
-- container do próprio B/L, mesmo que outro B/L ativo do grupo tenha a mesma
-- caixa (a Invoice continuaria completa). Leitura conservadora: o
-- Administrativo cancela a Invoice antes. Upgrade: comparar pelo número da
-- caixa contra os B/Ls ativos que sobram no grupo.
--
-- Rollback: reaplicar as definições destas funções das migrations 066
-- (`assert_demurrage_invoice_row`, `assert_demurrage_invoice_item_row`), 088
-- (`bl_delete_lock_reasons`, `delete_lock_reasons`), 176
-- (`guard_shared_container_invoice`) e 179 (as demais); DROP TRIGGER
-- `trg_reconcile_demurrage_after_payment_reversal` e DROP FUNCTION
-- `reconcile_demurrage_invoice_after_payment_reversal()`.

-- C2. Irmão com fatura paga não bloqueia; irmão reemitível com rateio antigo, sim.
CREATE OR REPLACE FUNCTION public.guard_shared_container_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sibling record;
  v_live bigint[];
BEGIN
  -- O rateio com que o B/L entra nesta fatura.
  NEW.container_shares := public.bl_container_share_signature(NEW.bl_id);

  -- Irmão faturado em outra fatura com rateio que não é mais o atual: a
  -- fatura dele precisa ser reemitida antes (ADR 0077); faturar este B/L agora
  -- cobraria o container mais de uma vez.
  FOR v_sibling IN
    SELECT DISTINCT ON (sibling.id) sibling.id, upper(btrim(sibling_container.container_number)) AS container_number,
      link.container_shares AS billed_shares, invoice.status AS invoice_status
    FROM public.bl_containers AS own_container
    JOIN public.bls AS root ON root.id = own_container.bl_id
    JOIN public.bl_containers AS sibling_container
      ON upper(btrim(sibling_container.container_number)) = upper(btrim(own_container.container_number))
    JOIN public.bls AS sibling ON sibling.id = sibling_container.bl_id
    JOIN public.invoice_bls AS link ON link.bl_id = sibling.id
    JOIN public.invoices AS invoice ON invoice.id = link.invoice_id
    WHERE own_container.bl_id = NEW.bl_id
      AND sibling.id <> NEW.bl_id
      AND sibling.voyage_id = root.voyage_id
      AND sibling.cancelled_at IS NULL
      AND sibling.financial_status IN ('invoiced', 'paid')
      AND link.invoice_id <> NEW.invoice_id
      AND COALESCE(invoice.status, 'issued') NOT IN ('cancelled', 'obsolete', 'draft')
    ORDER BY sibling.id, link.id DESC
  LOOP
    IF v_sibling.billed_shares IS NOT NULL
       AND v_sibling.billed_shares IS DISTINCT FROM public.bl_container_share_signature(v_sibling.id) THEN
      -- Com pagamento (ou coberta por consolidada paga), a fatura do irmão não
      -- é reemitida (ADR 0077, item 4): a diferença já seguiu por abatimento ou
      -- restituição e o vínculo guarda o rateio antigo para sempre. Este B/L
      -- fatura com o rateio atual. Mesma régua de "com pagamento" de
      -- `apply_invoice_basis_changes_legacy_130`.
      v_live := public._live_local_invoice_ids_for_bl(v_sibling.id);
      CONTINUE WHEN v_sibling.invoice_status IN ('partially_paid', 'paid', 'covered')
        OR EXISTS (SELECT 1 FROM public.payments AS p WHERE p.invoice_id = ANY(v_live))
        OR EXISTS (SELECT 1 FROM public.invoices AS i WHERE i.id = ANY(v_live) AND i.status IN ('partially_paid', 'paid'))
        OR EXISTS (
          SELECT 1 FROM public.invoice_corrections AS c
          JOIN public.bl_receivables AS r ON r.id = c.receivable_id
          WHERE r.bl_id = v_sibling.id AND r.source = 'local_charges'
        );
      RAISE EXCEPTION
        'O B/L irmao % (container compartilhado %) foi faturado com outro rateio do container; a fatura dele precisa ser reemitida com o rateio atual antes de faturar o B/L %.',
        v_sibling.id, v_sibling.container_number, NEW.bl_id
        USING ERRCODE = 'P0007';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

-- C5. Só recebível com fatura viva ou com baixa trava a exclusão (ADR 0078, item 12).
CREATE OR REPLACE FUNCTION public.bl_delete_lock_reasons(p_bl_id text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reasons text[] := ARRAY[]::text[];
BEGIN
  IF p_bl_id IS NULL THEN
    RETURN v_reasons;
  END IF;
  IF EXISTS (SELECT 1 FROM public.bls b WHERE b.id = p_bl_id AND NULLIF(btrim(b.ce_mercante), '') IS NOT NULL) THEN
    v_reasons := array_append(v_reasons, 'B/L com CE Mercante');
  END IF;
  IF EXISTS (SELECT 1 FROM public.invoices i WHERE i.bl_id = p_bl_id)
     OR EXISTS (SELECT 1 FROM public.invoice_bls ib WHERE ib.bl_id = p_bl_id)
     -- Recebível sem fatura viva nem baixa não é documento emitido: a
     -- exclusão o apaga (`drop_unbilled_receivables_before_bl_delete`).
     OR EXISTS (
       SELECT 1 FROM public.bl_receivables AS r
       WHERE r.bl_id = p_bl_id
         AND (r.settled_amount_brl > 0
              OR EXISTS (SELECT 1 FROM public.ledger_settlements AS s WHERE s.receivable_id = r.id)
              OR EXISTS (
                SELECT 1 FROM public.invoice_receivable_links AS l
                JOIN public.invoices AS i ON i.id = l.invoice_id
                WHERE l.receivable_id = r.id AND COALESCE(l.status, '') <> 'obsolete'
                  AND COALESCE(i.status, 'issued') NOT IN ('cancelled', 'obsolete')
              ))
     )
     OR EXISTS (SELECT 1 FROM public.demurrage_invoices d WHERE d.bl_id = p_bl_id) THEN
    v_reasons := array_append(v_reasons, 'documento financeiro emitido');
  END IF;
  RETURN v_reasons;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_lock_reasons(p_voyage_id bigint, p_port text DEFAULT NULL::text, p_terminal_id uuid DEFAULT NULL::uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_port text := NULLIF(upper(btrim(p_port)), '');
  v_reasons text[] := ARRAY[]::text[];
  v_bls text[];
BEGIN
  v_bls := ARRAY(
    SELECT b.id FROM public.bls b
    WHERE b.voyage_id = p_voyage_id
      AND (v_port IS NULL OR upper(b.pol) = v_port OR upper(b.pod) = v_port)
      -- ponytail: B/L sem terminal gravado herda o da frente de operação
      -- (ADR 0068); sem resolver a frente aqui, ele conta para toda atracação
      -- do porto. Leitura conservadora: pode travar a mais, nunca a menos.
      -- Upgrade: usar o terminal resolvido do B/L quando houver função única.
      AND (p_terminal_id IS NULL OR b.terminal_id = p_terminal_id OR b.terminal_id IS NULL)
  );

  IF EXISTS (SELECT 1 FROM public.bls b WHERE b.id = ANY (v_bls) AND b.ce_mercante IS NOT NULL) THEN
    v_reasons := array_append(v_reasons, 'B/L com CE Mercante');
  END IF;

  IF EXISTS (SELECT 1 FROM public.invoices i WHERE i.bl_id = ANY (v_bls))
     OR EXISTS (SELECT 1 FROM public.invoice_bls ib WHERE ib.bl_id = ANY (v_bls))
     OR EXISTS (SELECT 1 FROM public.demurrage_invoices d WHERE d.bl_id = ANY (v_bls))
     -- Recebível sem fatura viva nem baixa não é documento emitido (ADR 0078, item 12).
     OR EXISTS (
       SELECT 1 FROM public.bl_receivables AS r
       WHERE (r.bl_id = ANY (v_bls) OR (v_port IS NULL AND r.voyage_id = p_voyage_id))
         AND (r.settled_amount_brl > 0
              OR EXISTS (SELECT 1 FROM public.ledger_settlements AS s WHERE s.receivable_id = r.id)
              OR EXISTS (
                SELECT 1 FROM public.invoice_receivable_links AS l
                JOIN public.invoices AS i ON i.id = l.invoice_id
                WHERE l.receivable_id = r.id AND COALESCE(l.status, '') <> 'obsolete'
                  AND COALESCE(i.status, 'issued') NOT IN ('cancelled', 'obsolete')
              ))
     ) THEN
    v_reasons := array_append(v_reasons, 'documento financeiro emitido');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.agency_departure_reports a
    WHERE a.voyage_id = p_voyage_id AND a.status = 'closed'
      AND (v_port IS NULL OR upper(a.port) = v_port)
      AND (p_terminal_id IS NULL OR a.terminal_id = p_terminal_id)
  ) THEN
    v_reasons := array_append(v_reasons, 'ADR de Saída fechado');
  END IF;

  IF v_port IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.granite_bls g
      JOIN public.granite_manifests m ON m.id = g.manifest_id
      WHERE m.voyage_id = p_voyage_id
        AND (g.ce_mercante IS NOT NULL OR EXISTS (SELECT 1 FROM public.invoice_granite_bls ig WHERE ig.granite_bl_id = g.id))
    ) THEN
      v_reasons := array_append(v_reasons, 'Granito com CE Mercante ou faturado');
    END IF;
    IF EXISTS (SELECT 1 FROM public.customer_communications c WHERE c.anchor_voyage_id = p_voyage_id) THEN
      v_reasons := array_append(v_reasons, 'comunicado enviado ao cliente');
    END IF;
  END IF;

  RETURN v_reasons;
END;
$function$;

CREATE OR REPLACE FUNCTION public.drop_unbilled_receivables_before_bl_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._void_unbilled_bl_receivables(OLD.id, auth.uid(), 'Exclusão do B/L');
  -- Sai também o recebível que o cancelamento do B/L já tinha anulado; o que
  -- tem fatura, baixa ou correção fica e a FK segura a exclusão.
  DELETE FROM public.bl_receivables AS r
  WHERE r.bl_id = OLD.id AND r.status = 'void' AND r.settled_amount_brl = 0
    AND NOT EXISTS (SELECT 1 FROM public.invoice_receivable_links l WHERE l.receivable_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM public.ledger_settlements s WHERE s.receivable_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM public.invoice_corrections c WHERE c.receivable_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM public.invoice_refunds f WHERE f.correction_receivable_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM public.invoice_customer_changes cc WHERE cc.receivable_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM public.invoice_lifecycle_events e WHERE e.receivable_id = r.id);
  RETURN OLD;
END;
$function$;

-- C6. Cancelar o B/L cujo container está em Invoice de Demurrage viva do grupo.
CREATE OR REPLACE FUNCTION public.bl_open_financial_reasons(p_bl_id text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
  -- A Invoice do grupo é emitida no B/L-âncora com as caixas dos irmãos
  -- (ADR 0078, item 20): o item que aponta para container deste B/L também
  -- trava, como a Invoice do próprio B/L.
  IF EXISTS (
    SELECT 1 FROM public.demurrage_invoices d
    WHERE d.status IN ('draft', 'issued', 'overdue')
      AND (d.bl_id = p_bl_id OR EXISTS (
        SELECT 1 FROM public.demurrage_invoice_items AS item
        JOIN public.bl_containers AS c ON c.id = item.container_id
        WHERE item.invoice_id = d.id AND c.bl_id = p_bl_id
      ))
  ) THEN
    v_reasons := array_append(v_reasons, 'fatura de Demurrage em aberto');
  END IF;
  RETURN v_reasons;
END;
$function$;

-- C6. Completude do grupo só na emissão; baixa, estorno e câmbio não recalculam o grupo vivo.
CREATE OR REPLACE FUNCTION public.assert_demurrage_invoice_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Emissão: inserção, ou rascunho/cancelada que passa a emitida. Baixa,
  -- estorno e vencimento não mudam os itens; o grupo vivo pode ter mudado
  -- depois (irmão que chega ou é cancelado) sem tornar a Invoice inválida.
  IF TG_OP = 'INSERT' OR OLD.status IS NULL OR OLD.status NOT IN ('issued', 'overdue', 'paid') THEN
    PERFORM public.assert_demurrage_invoice_complete(COALESCE(NEW.id, OLD.id));
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assert_demurrage_invoice_item_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Item novo ou que muda de caixa/datas é emissão; a atualização do valor em
  -- reais pelo câmbio (`refresh_demurrage_invoice_item_brl`) não é.
  IF TG_OP = 'INSERT'
     OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
     OR NEW.container_id IS DISTINCT FROM OLD.container_id
     OR NEW.container_number IS DISTINCT FROM OLD.container_number
     OR NEW.discharge_date IS DISTINCT FROM OLD.discharge_date
     OR NEW.return_date IS DISTINCT FROM OLD.return_date THEN
    PERFORM public.assert_demurrage_invoice_complete(COALESCE(NEW.invoice_id, OLD.invoice_id));
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

-- C9. B/L cancelado não é raiz de grupo: grupo vazio e âncora nula.
CREATE OR REPLACE FUNCTION public.demurrage_group_bl_ids(p_bl_id text)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH RECURSIVE root AS (
    SELECT id, voyage_id, customer_id, cancelled_at FROM public.bls WHERE id = p_bl_id
  ), grp(bl_id) AS (
    SELECT id FROM root WHERE cancelled_at IS NULL
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
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM root WHERE cancelled_at IS NOT NULL) THEN ARRAY[]::text[]
    ELSE COALESCE(array_agg(bl_id ORDER BY bl_id), ARRAY[p_bl_id])
  END
  FROM grp;
$function$;

-- C11 (cálculo) e C9 (grupo vazio do B/L cancelado não acha container).
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
        -- A devolução preenchida é o que vale; linha antiga pode ter
        -- `within_free_time` com devolução gravada (C11, migration 191).
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

-- C9. Emissão recusada para B/L cancelado.
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
  IF v_bl.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'O B/L % está cancelado: a Invoice de Demurrage não é emitida para B/L cancelado.', p_bl_id
      USING ERRCODE = '22023';
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

CREATE OR REPLACE FUNCTION public.issue_demurrage_invoice_for_bl(p_bl_id text, p_doc_number text DEFAULT NULL::text)
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
  IF EXISTS (SELECT 1 FROM public.bls WHERE id = p_bl_id AND cancelled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'O B/L % está cancelado: a Invoice de Demurrage não é emitida para B/L cancelado.', p_bl_id
      USING ERRCODE = '22023';
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

-- C9. Datas na linha do B/L cancelado não enfileiram emissão para ele.
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
    CONTINUE WHEN v_anchor IS NULL OR v_anchor = ANY(v_enqueued);
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

-- C9. A Invoice do próprio B/L (mesmo cancelado) continua reconciliada; sem
--     pagamento e com o B/L cancelado, só é cancelada.
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
    JOIN public.demurrage_invoices AS di
      ON di.bl_id = ANY(public.demurrage_group_bl_ids(changed.bl_id) || changed.bl_id)
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
    IF EXISTS (SELECT 1 FROM public.bls WHERE id = v_invoice.bl_id AND cancelled_at IS NOT NULL) THEN
      v_reissue := jsonb_build_object('status', 'bl_cancelled', 'bl_id', v_invoice.bl_id);
    ELSE
      PERFORM set_config('vela.demurrage_internal', 'on', true);
      v_reissue := public.issue_demurrage_invoice_for_bl(v_invoice.bl_id, NULL);
      PERFORM set_config('vela.demurrage_internal', COALESCE(v_previous, ''), true);
    END IF;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'invoice_id', v_invoice.id, 'status', 'cancelled', 'reissue', v_reissue));
  END LOOP;
  RETURN v_result;
END;
$function$;

-- C12. Estorno da baixa de Invoice suspensa por datas alteradas: sem
--      pagamento, ela segue o item 19 da ADR 0078 (cancelada e reemitida com
--      as datas atuais, ou só cancelada se o valor for zero); com as datas de
--      volta às faturadas, a suspensão da Régua sai.
CREATE OR REPLACE FUNCTION public.reconcile_demurrage_invoice_after_payment_reversal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.demurrage_invoice_items AS item
    JOIN public.bl_containers AS c ON c.id = item.container_id
    WHERE item.invoice_id = NEW.id
      AND (c.discharge_date IS DISTINCT FROM item.discharge_date OR c.return_date IS DISTINCT FROM item.return_date)
  ) THEN
    PERFORM public._reconcile_demurrage_after_dates(ARRAY[NEW.bl_id], auth.uid());
  ELSE
    UPDATE public.demurrage_invoices SET dunning_suspended_reason = NULL WHERE id = NEW.id;
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_demurrage_invoice_after_payment_reversal() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_reconcile_demurrage_after_payment_reversal ON public.demurrage_invoices;
CREATE TRIGGER trg_reconcile_demurrage_after_payment_reversal
  AFTER UPDATE OF status ON public.demurrage_invoices
  FOR EACH ROW
  WHEN (OLD.status = 'paid' AND NEW.status IN ('issued', 'overdue') AND NEW.dunning_suspended_reason IS NOT NULL)
  EXECUTE FUNCTION public.reconcile_demurrage_invoice_after_payment_reversal();

-- C14. Descarga posterior à devolução: mensagem de negócio antes do UPDATE.
CREATE OR REPLACE FUNCTION public._apply_container_dates_core(p_container_id bigint, p_discharge date, p_return date, p_keep_return boolean)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_number text;
  v_voyage_id bigint;
  v_bls text[];
  v_conflict record;
BEGIN
  SELECT upper(btrim(c.container_number)), b.voyage_id INTO v_number, v_voyage_id
  FROM public.bl_containers AS c JOIN public.bls AS b ON b.id = c.bl_id
  WHERE c.id = p_container_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Container % nao encontrado.', p_container_id USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.bl_containers AS c
  JOIN public.bls AS b ON b.id = c.bl_id
  WHERE (c.id = p_container_id)
     OR (upper(btrim(c.container_number)) = v_number AND b.voyage_id = v_voyage_id AND b.cancelled_at IS NULL)
  ORDER BY c.id
  FOR UPDATE OF c;

  -- A data que ficaria gravada não pode ter devolução antes da descarga
  -- (CHECK `bl_containers_return_after_discharge_chk`): com a devolução vazia
  -- na planilha, a gravada é mantida e a descarga nova pode passar dela.
  SELECT c.container_number, CASE WHEN p_keep_return THEN c.return_date ELSE p_return END AS return_date
    INTO v_conflict
  FROM public.bl_containers AS c
  JOIN public.bls AS b ON b.id = c.bl_id
  WHERE ((c.id = p_container_id)
         OR (upper(btrim(c.container_number)) = v_number AND b.voyage_id = v_voyage_id AND b.cancelled_at IS NULL))
    AND p_discharge IS NOT NULL
    AND CASE WHEN p_keep_return THEN c.return_date ELSE p_return END < p_discharge
    -- Só a linha que o UPDATE abaixo vai escrever.
    AND (c.discharge_date IS DISTINCT FROM p_discharge
         OR (NOT p_keep_return AND c.return_date IS DISTINCT FROM p_return))
  ORDER BY c.id
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'A descarga informada (%) do container % é posterior à devolução % (%). Informe a devolução corrigida junto com a descarga, ou remova a devolução pela edição do container, com motivo.',
      to_char(p_discharge, 'DD/MM/YYYY'), upper(btrim(v_conflict.container_number)),
      CASE WHEN p_keep_return THEN 'gravada' ELSE 'informada' END,
      to_char(v_conflict.return_date, 'DD/MM/YYYY')
      USING ERRCODE = '22023';
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

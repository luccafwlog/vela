-- 420: o antigo Cliente de um B/L não lê mais, pelo Portal, o que o novo
-- Cliente fez com ele (auditoria de segurança run-3, achados C2, C3 e C4).
--
-- Problema: depois da troca de Cliente do B/L (Troca de Consignatário,
-- correção de CNPJ, importação), leituras do Portal do Cliente anterior seguiam
-- por chaves do B/L ou do recebível sem conferir o dono atual:
--   - C2: o recebível único por B/L passa ao novo Cliente; a fatura cancelada
--     do anterior mostrava o saldo (lista), as correções e o abatimento dele;
--   - C3: o detalhe da fatura trazia contêineres (lacre, peso) e a situação de
--     cobrança e financeira vivas do B/L;
--   - C4: Minhas solicitações do Desbloqueio de CE calculava o prazo com a
--     baixa do novo Cliente.
--
-- Mudança: as leituras amarram ao Cliente da fatura ou da solicitação. Saldo da
-- lista e abatimento só de recebível e correção do Cliente da fatura;
-- contêineres e situação viva só de B/L que ainda é do Cliente da sessão (na
-- avulsa também os *_snapshot, montados do bls vivo); prazo do desbloqueio só
-- quando a solicitação é do Cliente atual do B/L. Valores, itens, pagamentos e
-- o retrato da emissão da fatura do Cliente anterior continuam.
--
-- Só redefine funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar as definições da 183 (_portal_invoice_details_core), 136
-- (_portal_invoice_details_legacy_134), 375 (_invoice_financial_summary), 376
-- (_portal_list_invoices_core) e 369 (ce_unlock_private.item).

-- C3 ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._portal_invoice_details_core(p_customer_id bigint, p_invoice_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r jsonb; v_manual boolean;
BEGIN
  r := public._apply_invoice_document_snapshot(public._portal_invoice_details_legacy_183(p_customer_id, p_invoice_id), p_invoice_id);
  -- Avulsa: o ramo da 097 monta a linha do B/L com o bls vivo, inclusive os *_snapshot.
  v_manual := r #>> '{invoice,invoice_type}' = 'manual';
  -- Dado vivo só de B/L que ainda é do Cliente da sessão.
  r := jsonb_set(r, '{containers}', COALESCE((
    SELECT jsonb_agg(c ORDER BY ord) FROM jsonb_array_elements(COALESCE(r->'containers','[]'::jsonb)) WITH ORDINALITY e(c, ord)
    WHERE EXISTS (SELECT 1 FROM public.bls b WHERE b.id = c->>'bl_id' AND b.customer_id = p_customer_id)), '[]'::jsonb));
  r := jsonb_set(r, '{bls}', COALESCE((
    SELECT jsonb_agg(CASE WHEN EXISTS (SELECT 1 FROM public.bls b WHERE b.id = x->>'bl_id' AND b.customer_id = p_customer_id)
      THEN x ELSE x || jsonb_build_object('charge_status', NULL, 'financial_status', NULL)
        || CASE WHEN v_manual THEN jsonb_build_object('charge_status_snapshot', NULL, 'financial_status_snapshot', NULL) ELSE '{}'::jsonb END
      END ORDER BY ord)
    FROM jsonb_array_elements(COALESCE(r->'bls','[]'::jsonb)) WITH ORDINALITY e(x, ord)), '[]'::jsonb));
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public._portal_invoice_details_core(bigint, bigint) FROM PUBLIC, anon, authenticated;

-- C2 ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._portal_invoice_details_legacy_134(p_customer_id bigint, p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_raw jsonb; v_corrections jsonb;
BEGIN
  v_raw := public._portal_invoice_details_before_correction_123(p_customer_id, p_invoice_id);
  -- O núcleo anterior confirma o escopo antes de qualquer leitura adicional.
  SELECT coalesce(jsonb_agg(jsonb_build_object('amount_brl', c.amount_brl, 'offset_brl', c.offset_brl,
    'refund_brl', c.refund_brl, 'bl_id', b.bl_id, 'created_at', c.created_at) ORDER BY c.id), '[]'::jsonb)
  INTO v_corrections FROM public.invoice_corrections c JOIN public.bl_receivables b ON b.id = c.receivable_id
    JOIN public.invoices ci ON ci.id = c.invoice_id
    WHERE c.receivable_id IN (SELECT receivable_id FROM public.invoice_receivable_links WHERE invoice_id = p_invoice_id)
      -- Só correções lançadas em fatura do próprio Cliente (420).
      AND ci.customer_id = p_customer_id;
  RETURN v_raw || jsonb_build_object('corrections', v_corrections);
END;
$function$;

CREATE OR REPLACE FUNCTION public._invoice_financial_summary(p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 WITH scope AS (SELECT * FROM public.invoices WHERE id = p_invoice_id), cash AS (
   SELECT coalesce(sum(p.amount_brl),0) received, max(p.paid_at) paid_at FROM public.payments p WHERE p.invoice_id = p_invoice_id
 ), covered AS (
   SELECT coalesce(sum(s.amount_brl),0) received, max(p.paid_at) paid_at FROM public.ledger_settlements s
   JOIN public.payments p ON p.id = s.payment_id JOIN scope i ON i.covered_by_invoice_id = s.invoice_id
   WHERE s.receivable_id IN (SELECT receivable_id FROM public.invoice_receivable_links WHERE invoice_id = p_invoice_id)
 ), refunds AS (
   SELECT coalesce(sum(r.amount_brl) FILTER (WHERE r.status = 'settled'),0) returned,
     coalesce(sum(r.amount_brl) FILTER (WHERE r.status = 'pending'),0) pending
   FROM public.invoice_refunds r JOIN scope i ON (r.invoice_id = i.id AND r.origin <> 'pix_duplicate') OR
    (i.status = 'covered' AND r.invoice_id = i.covered_by_invoice_id AND r.correction_receivable_id IN
      (SELECT receivable_id FROM public.invoice_receivable_links WHERE invoice_id = i.id))
 )
 SELECT jsonb_build_object('gross_received_brl', CASE WHEN i.status = 'covered' THEN covered.received + cash.received ELSE cash.received END,
  'offset_brl', coalesce((SELECT sum(c.offset_brl) FROM public.invoice_corrections c JOIN public.invoices ci ON ci.id = c.invoice_id
    WHERE ci.customer_id = i.customer_id
      AND (c.invoice_id = i.id OR c.receivable_id IN (SELECT receivable_id FROM public.invoice_receivable_links WHERE invoice_id = i.id))),0),
  'refunded_brl', refunds.returned, 'pending_refund_brl', refunds.pending,
  'net_received_brl', (CASE WHEN i.status = 'covered' THEN covered.received + cash.received ELSE cash.received END) - refunds.returned,
  'paid_at', CASE WHEN i.status = 'covered' THEN greatest(covered.paid_at, cash.paid_at) ELSE cash.paid_at END,
  'covered_by_invoice_number', (SELECT invoice_number FROM public.invoices WHERE id = i.covered_by_invoice_id))
 FROM scope i CROSS JOIN cash CROSS JOIN covered CROSS JOIN refunds;
$function$;

CREATE OR REPLACE FUNCTION public._portal_list_invoices_core(p_customer_id bigint)
 RETURNS TABLE(id bigint, invoice_number text, issued_at timestamp with time zone, total_brl numeric, total_paid_brl numeric, balance_brl numeric, status text, invoice_type text, vessels text[], voyages text[], vessel_voyages text[], bls text[], pods text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
    JOIN public.invoices AS own ON own.id = irl.invoice_id
    WHERE irl.status IN ('active', 'settled_by_this_invoice')
      -- 361: a consolidada substituída continua visível (decisão 8).
      OR (irl.status = 'obsolete' AND own.status = 'obsolete')
  ),
  manual_context AS (
    SELECT
      i.id AS invoice_id,
      i.bl_id,
      coalesce(sn.snapshot->'bls'->i.bl_id->>'pod', b.pod) AS pod,
      coalesce(sn.snapshot->'bls'->i.bl_id->>'voyage_number', sn.snapshot->>'voyage_number', v.voyage_number) AS voyage_number,
      coalesce(sn.snapshot->'bls'->i.bl_id->>'vessel_name', sn.snapshot->>'vessel_name', vs.name) AS vessel_name
    FROM public.invoices AS i
    LEFT JOIN public.invoice_document_snapshots AS sn ON sn.invoice_id = i.id
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
    -- F-45 (376): navio, Viagem e POD da emissão (snapshot), não os de hoje.
    SELECT ib.invoice_id, ib.bl_id,
      coalesce(sn.snapshot->'bls'->ib.bl_id->>'pod', b.pod) AS pod,
      coalesce(sn.snapshot->'bls'->ib.bl_id->>'voyage_number', v.voyage_number) AS voyage_number,
      coalesce(sn.snapshot->'bls'->ib.bl_id->>'vessel_name', vs.name) AS vessel_name
    FROM public.invoice_bls AS ib
    JOIN public.bls AS b ON b.id = ib.bl_id
    LEFT JOIN public.invoice_document_snapshots AS sn ON sn.invoice_id = ib.invoice_id
    LEFT JOIN public.voyages AS v ON v.id = b.voyage_id
    LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
    UNION ALL
    SELECT irl.invoice_id, irl.bl_id, irl.bl_snapshot->>'pod',
      coalesce(sn.snapshot->'bls'->irl.bl_id->>'voyage_number', v.voyage_number),
      coalesce(sn.snapshot->'bls'->irl.bl_id->>'vessel_name', vs.name)
    FROM public.invoice_receivable_links AS irl
    JOIN public.invoices AS own ON own.id = irl.invoice_id
    LEFT JOIN public.invoice_document_snapshots AS sn ON sn.invoice_id = irl.invoice_id
    LEFT JOIN public.voyages AS v ON v.id = (irl.bl_snapshot->>'voyage_id')::bigint
    LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
    WHERE irl.status IN ('active', 'settled_by_this_invoice')
      OR (irl.status = 'obsolete' AND own.status = 'obsolete')
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
      WHEN i.status IN ('covered', 'obsolete') THEN 0::numeric
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
    -- Só o recebível que ainda é do Cliente da fatura (420).
    WHERE irl.invoice_id = i.id AND irl.status = 'active' AND br.customer_id = i.customer_id
  ) AS ledger ON true
  WHERE i.customer_id = p_customer_id
  ORDER BY i.created_at DESC;
END;
$function$;

-- C4 ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ce_unlock_private.item(p_bl text, p_request uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE b public.bls; i public.ce_unlock_request_bls; r public.ce_unlock_requests; zs public.ce_unlock_zpt_status; paid boolean; td boolean; pd boolean; delivered boolean;
 local_paid boolean; exempt boolean:=false; manual_open boolean; vip boolean; reasons text[] := '{}'; eligible boolean; confirmed boolean; vs text; sla timestamptz;
BEGIN
 SELECT * INTO b FROM public.bls WHERE id=p_bl;
 SELECT * INTO i FROM public.ce_unlock_request_bls WHERE bl_id=p_bl AND (p_request IS NULL OR request_id=p_request)
 ORDER BY active DESC,confirmed_at DESC NULLS LAST,request_id LIMIT 1;
 SELECT * INTO r FROM public.ce_unlock_requests WHERE id=i.request_id;
 SELECT * INTO zs FROM public.ce_unlock_zpt_status WHERE bl_id=p_bl AND ce_mercante IS NOT DISTINCT FROM b.ce_mercante;
 SELECT coalesce(enabled,false) INTO vip FROM public.ce_unlock_vip_customers WHERE customer_id=b.customer_id; vip:=coalesce(vip,false);
 SELECT coalesce(bool_and(status='settled' AND balance_brl=0 AND original_amount_brl>0 AND settled_amount_brl>=original_amount_brl-correction_amount_brl
 AND EXISTS(SELECT 1 FROM public.ledger_settlements s WHERE s.receivable_id=x.id)),false)
 INTO local_paid FROM public.bl_receivables x WHERE x.bl_id=p_bl AND x.status<>'void'
 AND x.source='local_charges' AND x.customer_id=b.customer_id;
 -- ADR 0087, item 2: B/L com Taxas Locais isentas, sem recebível vigente, não tem o requisito.
 IF NOT local_paid AND b.charge_status='exempt' AND NOT EXISTS(SELECT 1 FROM public.bl_receivables x
 WHERE x.bl_id=p_bl AND x.status<>'void' AND x.source='local_charges') THEN local_paid:=true; exempt:=true; END IF;
 -- ADR 0087, item 3: fatura avulsa emitida que referencia o B/L precisa estar quitada. Demurrage não entra.
 manual_open:=EXISTS(SELECT 1 FROM public.invoices n WHERE n.bl_id=p_bl AND n.invoice_type='manual'
 AND n.customer_id=b.customer_id AND n.status IN('issued','partially_paid') AND n.balance_brl>0);
 paid:=local_paid AND NOT manual_open;
 IF EXISTS(SELECT 1 FROM public.invoice_customer_changes c WHERE c.bl_id=p_bl AND c.status<>'completed')
 OR EXISTS(SELECT 1 FROM public.invoice_basis_pending_changes c WHERE c.bl_id=p_bl AND c.source='customer_change') THEN
 paid:=false; reasons:=array_append(reasons,'Troca de Cliente aguarda devolução e nova cobrança'); END IF;
 -- F-19 (369): a marca de revisão do "Cancelar e reemitir" não trava para
 -- sempre: com o ajuste liquidado e a sucessora quitada, o COD está pago.
 IF EXISTS(SELECT 1 FROM public.cod_adjustments a LEFT JOIN public.invoices n ON n.id=a.resulting_document_id
 WHERE a.bl_id=p_bl AND a.status<>'cancelled' AND a.difference_brl>0
 AND (a.status='pending'
   OR (a.manual_review_required AND NOT (a.status='settled' AND n.id IS NOT NULL AND coalesce(n.balance_brl,1)<=0))
   OR (a.resulting_document_type='invoice' AND coalesce(n.balance_brl,1)>0))) THEN
 paid:=false; reasons:=array_append(reasons,'Diferença de valor a faturar'); END IF;
 -- F-20 (369, ADR 0093, decisão 20): Fatura desatualizada ativa com valor
 -- maior que o cobrado trava como o COD.
 IF EXISTS(SELECT 1 FROM public.alert_items ai JOIN public.bl_receivables x ON x.bl_id=p_bl AND x.source='local_charges' AND x.status<>'void'
 WHERE ai.item_type='fatura_desatualizada' AND ai.status='active' AND ai.metadata->>'bl_id'=p_bl
 AND (public._quote_bl_local_charges(p_bl, x.roe_frozen)->>'status')='ok'
 AND (public._quote_bl_local_charges(p_bl, x.roe_frozen)->>'total_brl')::numeric > x.original_amount_brl-x.correction_amount_brl) THEN
 IF paid THEN reasons:=array_append(reasons,'Diferença de valor a faturar'); END IF;
 paid:=false; END IF;
 SELECT coalesce(d.delivered,false) INTO delivered FROM public.ce_unlock_bl_deliveries d WHERE bl_id=p_bl; delivered:=coalesce(delivered,false);
 IF r.source='vip_annual' THEN
 td:=vip AND ce_unlock_private.valid_doc(i.termo_document_id); pd:=vip AND ce_unlock_private.valid_doc(i.procuracao_document_id);
 ELSE td:=coalesce(i.termo_approved,false); pd:=coalesce(i.procuracao_approved,false); END IF;
 confirmed:=i.confirmed_at IS NOT NULL AND i.confirmed_ce IS NOT DISTINCT FROM b.ce_mercante AND r.customer_id=b.customer_id;
 eligible:=b.cancelled_at IS NULL AND trim(coalesce(b.ce_mercante,''))<>'' AND paid;
 IF r.id IS NOT NULL AND r.state NOT IN('draft','cancelled') AND r.customer_id IS NOT DISTINCT FROM b.customer_id THEN
 -- Prazo recomeça quando o cliente resolve uma pendência dele: reenvio, entrega do original, nova liquidação.
 sla:=greatest((SELECT max(e.created_at) FROM public.ce_unlock_events e WHERE e.request_id=r.id AND e.action='submit'),
 CASE WHEN delivered THEN (SELECT d.updated_at FROM public.ce_unlock_bl_deliveries d WHERE d.bl_id=p_bl) END,
 (SELECT max(s.created_at) FROM public.ledger_settlements s JOIN public.bl_receivables x ON x.id=s.receivable_id WHERE x.bl_id=p_bl AND x.status<>'void'),
 (SELECT max(p.created_at) FROM public.payments p JOIN public.invoices n ON n.id=p.invoice_id WHERE n.bl_id=p_bl AND n.invoice_type='manual' AND n.customer_id=b.customer_id));
 END IF;
 IF r.id IS NOT NULL AND r.customer_id IS DISTINCT FROM b.customer_id THEN reasons:=array_append(reasons,'Cliente do B/L alterado: solicitação anterior inaplicável'); END IF;
 IF b.cancelled_at IS NOT NULL THEN reasons:=array_append(reasons,'B/L cancelado'); END IF;
 IF trim(coalesce(b.ce_mercante,''))='' THEN reasons:=array_append(reasons,'CE Mercante não informado'); END IF;
 IF NOT local_paid OR (NOT paid AND NOT manual_open) THEN reasons:=array_append(reasons,'Taxas locais sem liquidação integral confirmada'); END IF;
 IF manual_open THEN reasons:=array_append(reasons,'Fatura avulsa do B/L em aberto'); END IF;
 IF r.id IS NOT NULL AND NOT td THEN reasons:=array_append(reasons,'Termo de devolução pendente, vencido ou revogado'); END IF;
 IF r.id IS NOT NULL AND NOT pd THEN reasons:=array_append(reasons,'Procuração pendente, vencida ou revogada'); END IF;
 IF r.id IS NOT NULL AND NOT delivered THEN reasons:=array_append(reasons,'B/L físico aguardando entrega'); END IF;
 IF r.id IS NOT NULL AND i.ce_at_request IS DISTINCT FROM b.ce_mercante THEN reasons:=array_append(reasons,'CE alterado: reconferência necessária'); END IF;
 SELECT ve.name INTO vs FROM public.voyages v JOIN public.vessels ve ON ve.id=v.vessel_id WHERE v.id=b.voyage_id;
 RETURN jsonb_build_object('bl_id',p_bl,'ce_mercante',b.ce_mercante,'customer_id',b.customer_id,
 'customer_name',(SELECT name FROM public.customers WHERE id=b.customer_id),'cnpj_cpf',(SELECT cnpj_cpf FROM public.customers WHERE id=b.customer_id),
 'voyage_id',b.voyage_id,'voyage_number',(SELECT voyage_number FROM public.voyages WHERE id=b.voyage_id),'vessel_name',vs,'pod',b.pod,
 'request_id',r.id,'requested_at',r.created_at,'protocol',r.protocol,'state',coalesce(r.state,'no_request'),'version',r.version,'source',coalesce(r.source,'request'),
 'vip',vip,'termo',td,'procuracao',pd,'paid',paid,'paid_exempt',exempt,'delivered',delivered,'confirmed',confirmed,
 'delivery_version',coalesce((SELECT version FROM public.ce_unlock_bl_deliveries WHERE bl_id=p_bl),0),
 -- 299: B/L ativo em solicitação ainda não validada, do mesmo Cliente e não
 -- enviado à ZPT, pode mudar para uma solicitação nova (caminho A).
 'can_submit',eligible AND NOT confirmed AND (NOT coalesce(i.active,false)
 OR (r.state IN('draft','submitted','in_review','changes_requested') AND r.customer_id=b.customer_id
 AND i.exported_at IS NULL AND i.export_id IS NULL AND i.confirmed_at IS NULL)),
 'can_export',eligible AND r.customer_id=b.customer_id AND td AND pd AND delivered AND r.state IN('submitted','in_review','changes_requested','completed') AND i.active AND i.ce_at_request=b.ce_mercante AND NOT confirmed,
 'export_state',CASE WHEN confirmed THEN 'confirmed' WHEN i.exported_at IS NOT NULL THEN 'exported' ELSE 'not_exported' END,
 'exported_at',i.exported_at,'sla_started_at',sla,
 'zpt_status',zs.status,'zpt_description',zs.description,'zpt_pending',to_jsonb(zs.pending),'zpt_updated_at',zs.zpt_updated_at,'zpt_without_export',zs.without_export,
 'reasons',to_jsonb(reasons));
END $function$;

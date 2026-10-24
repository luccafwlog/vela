-- 448: prazo do desbloqueio só com os quatro requisitos cumpridos (ponto 10
-- das observações de 2026-10-23).
--
-- Problema: o prazo (SLA) partia do envio da solicitação. Com a entrega do
-- B/L original desmarcada e o termo e a procuração ainda não aprovados pela
-- equipe, o Portal já mostrava "Prazo para desbloqueio", e o Vela também.
--
-- Os quatro requisitos (`ce_unlock_private.item`, migration 420):
--   1. taxas locais liquidadas (`paid`: recebíveis liquidados ou isentos,
--      sem avulsa em aberto, troca de Cliente ou diferença a faturar);
--   2. termo de devolução aprovado (`termo`);
--   3. procuração aprovada (`procuracao`);
--   4. B/L original entregue (`delivered`, o "BL de Entrega").
--
-- Mudança:
--   1. `ce_unlock_private.item`: `sla_started_at` fica nulo enquanto faltar
--      um requisito; com os quatro, vale o último fato que completou o
--      conjunto (envio, entrega do original, liquidação, pagamento da avulsa
--      ou aprovação do termo ou da procuração). O restante é a 420.
--   2. `ce_unlock_private.request_sla_start`: o prazo da solicitação só
--      existe com todos os B/Ls ativos prontos; vale o início mais recente.
--   3. `ce_unlock_private.list` (Minhas solicitações do Portal, 427),
--      `ce_unlock_private.review_queue` (fila Solicitações do Vela, 160) e
--      `ce_unlock_customer_requests` (ficha do Cliente, 228) usam a regra 2;
--      a fila, que só tem documentos a analisar, passa a ordenar e mostrar
--      a hora do envio (`submitted_at`).
--   O aviso "documentação validada" (sino e e-mail, `refresh_completion`,
--   161) já saía só com os quatro requisitos e usa o mesmo início: não muda.
--   O aviso de recusa não fala de prazo.
--
-- Só redefine funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar `item` da 420, `list` da 427, `review_queue` da 160 e
-- `ce_unlock_customer_requests` da 228; DROP FUNCTION
-- ce_unlock_private.request_sla_start(uuid).

-- 1 -------------------------------------------------------------------------
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
 -- 448 (ponto 10 de 2026-10-23): o prazo só começa com os quatro requisitos
 -- cumpridos (taxas locais liquidadas, termo de devolução aprovado, procuração
 -- aprovada e B/L original entregue) e parte do último que se cumpriu: o envio,
 -- a entrega do original, a liquidação, o pagamento da avulsa ou a aprovação
 -- de um dos documentos. Faltando um, não há prazo.
 IF r.id IS NOT NULL AND r.state NOT IN('draft','cancelled') AND r.customer_id IS NOT DISTINCT FROM b.customer_id
 AND paid AND td AND pd AND delivered THEN
 sla:=greatest((SELECT max(e.created_at) FROM public.ce_unlock_events e WHERE e.request_id=r.id AND e.action='submit'),
 (SELECT d.updated_at FROM public.ce_unlock_bl_deliveries d WHERE d.bl_id=p_bl),
 (SELECT max(s.created_at) FROM public.ledger_settlements s JOIN public.bl_receivables x ON x.id=s.receivable_id WHERE x.bl_id=p_bl AND x.status<>'void'),
 (SELECT max(p.created_at) FROM public.payments p JOIN public.invoices n ON n.id=p.invoice_id WHERE n.bl_id=p_bl AND n.invoice_type='manual' AND n.customer_id=b.customer_id),
 (SELECT d.reviewed_at FROM public.ce_unlock_documents d WHERE d.id=i.termo_document_id),
 (SELECT d.reviewed_at FROM public.ce_unlock_documents d WHERE d.id=i.procuracao_document_id));
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

-- 2 -------------------------------------------------------------------------
-- Prazo da solicitação: só quando todo B/L ativo tem os quatro requisitos (o
-- prazo de cada um começou); vale o início mais recente. Um B/L faltando
-- requisito deixa a solicitação sem prazo.
CREATE OR REPLACE FUNCTION ce_unlock_private.request_sla_start(p_request uuid)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT CASE WHEN count(*)>0 AND bool_and(z.start IS NOT NULL) THEN max(z.start) END
 FROM (SELECT (ce_unlock_private.item(i.bl_id,p_request)->>'sla_started_at')::timestamptz AS start
       FROM public.ce_unlock_request_bls i WHERE i.request_id=p_request AND i.active) z;
$function$;

REVOKE ALL ON FUNCTION ce_unlock_private.request_sla_start(uuid) FROM PUBLIC, anon, authenticated;

-- 3 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ce_unlock_private.list(p_customer bigint, p_filters jsonb, p_page integer, p_requests boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE all_rows jsonb; BEGIN
 -- Cliente nulo é a visão da equipe: exige perfil interno (o Portal sempre
 -- passa o Cliente da sessão).
 IF p_customer IS NULL THEN PERFORM ce_unlock_private.actor(false); END IF;
 IF p_page<1 THEN RAISE EXCEPTION 'Página inválida'; END IF;
 IF p_requests THEN
 -- 299: Minhas solicitações mostra os B/Ls e o prazo para desbloqueio
 -- (448: só com os quatro requisitos em todos os B/Ls ativos).
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'protocol',r.protocol,'state',r.state,'version',r.version,'source',r.source,'created_at',r.created_at,
 'bl_ids',coalesce((SELECT jsonb_agg(i.bl_id ORDER BY i.bl_id) FROM public.ce_unlock_request_bls i WHERE i.request_id=r.id AND (NOT EXISTS(SELECT 1 FROM public.ce_unlock_events moved WHERE moved.request_id=r.id AND moved.bl_id=i.bl_id AND moved.action='bl_moved'))),'[]'::jsonb),
 'sla_started_at',ce_unlock_private.request_sla_start(r.id)) ORDER BY r.created_at DESC),'[]') INTO all_rows
 FROM public.ce_unlock_requests r WHERE (p_customer IS NULL OR r.customer_id=p_customer);
 ELSE
 SELECT coalesce(jsonb_agg(j ORDER BY j->>'bl_id'),'[]') INTO all_rows FROM (
 SELECT ce_unlock_private.visible_item(b.id,p_customer) j FROM public.bls b WHERE trim(coalesce(b.ce_mercante,''))<>''
 AND (p_customer IS NULL OR (b.customer_id=p_customer AND public.bl_has_portal_release(b.id)))
 ) x WHERE (coalesce(p_filters->>'search','')='' OR (j->>'bl_id') ILIKE '%'||(p_filters->>'search')||'%' OR (j->>'ce_mercante') ILIKE '%'||(p_filters->>'search')||'%' OR (j->>'customer_name') ILIKE '%'||(p_filters->>'search')||'%')
 AND (coalesce(p_filters->>'customer_id','')='' OR j->>'customer_id'=p_filters->>'customer_id')
 AND (coalesce(p_filters->>'voyage_id','')='' OR j->>'voyage_id'=p_filters->>'voyage_id')
 AND (coalesce(p_filters->>'pod','')='' OR j->>'pod'=p_filters->>'pod')
 AND (coalesce(p_filters->>'situation','')='' OR j->>'state'=p_filters->>'situation'
 OR (p_filters->>'situation'='ready' AND (j->>'can_export')::boolean)
 OR (p_filters->>'situation'='ready_not_exported' AND (j->>'can_export')::boolean AND j->>'export_state'='not_exported' AND j->>'zpt_status' IS DISTINCT FROM 'unlocked')
 OR (p_filters->>'situation'='exported' AND j->>'export_state'='exported' AND j->>'zpt_status' IS NULL)
 OR (p_filters->>'situation'='unlocked' AND j->>'zpt_status'='unlocked')
 OR (p_filters->>'situation'='divergent' AND j->>'zpt_status'='divergent'))
 AND (coalesce(p_filters->>'pending_requirement','')='' OR NOT coalesce((j->>(CASE p_filters->>'pending_requirement' WHEN 'taxas' THEN 'paid' WHEN 'bl_fisico' THEN 'delivered' ELSE p_filters->>'pending_requirement' END))::boolean,false));
 END IF;
 RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(value) FROM (SELECT value FROM jsonb_array_elements(all_rows) WITH ORDINALITY a(value,n) WHERE n>(p_page-1)*25 AND n<=p_page*25) p),'[]'),'total',jsonb_array_length(all_rows),'page',p_page,'page_size',25);
END $function$;

CREATE OR REPLACE FUNCTION ce_unlock_private.review_queue(p_page integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE rows_ jsonb; BEGIN
 IF p_page<1 THEN RAISE EXCEPTION 'Página inválida'; END IF;
 SELECT coalesce(jsonb_agg(q ORDER BY q->>'submitted_at',q->>'protocol'),'[]') INTO rows_ FROM (
 SELECT jsonb_build_object('id',r.id,'protocol',r.protocol,'state',r.state,'version',r.version,'created_at',r.created_at,
 'customer_name',c.name,'cnpj_cpf',c.cnpj_cpf,
 -- 448: a fila é de documentos ainda não aprovados, então ainda não há
 -- prazo; ela segue pela hora do envio (`submitted_at`).
 'submitted_at',(SELECT max(e.created_at) FROM public.ce_unlock_events e WHERE e.request_id=r.id AND e.action='submit'),
 'sla_started_at',ce_unlock_private.request_sla_start(r.id),
 'bl_ids',(SELECT jsonb_agg(i.bl_id ORDER BY i.bl_id) FROM public.ce_unlock_request_bls i WHERE i.request_id=r.id AND i.active),
 'termo_status',(SELECT d.status FROM public.ce_unlock_documents d WHERE d.request_id=r.id AND d.type='termo' AND d.hash IS NOT NULL AND d.status<>'uploading' ORDER BY d.created_at DESC LIMIT 1),
 'procuracao_status',(SELECT d.status FROM public.ce_unlock_documents d WHERE d.request_id=r.id AND d.type='procuracao' AND d.hash IS NOT NULL AND d.status<>'uploading' ORDER BY d.created_at DESC LIMIT 1)) q
 FROM public.ce_unlock_requests r JOIN public.customers c ON c.id=r.customer_id
 WHERE r.source='request' AND r.state IN('submitted','in_review','changes_requested')
 AND EXISTS(SELECT 1 FROM public.ce_unlock_request_bls i WHERE i.request_id=r.id AND i.active AND NOT (i.termo_approved AND i.procuracao_approved))
 ) x;
 RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(value) FROM (SELECT value FROM jsonb_array_elements(rows_) WITH ORDINALITY a(value,n) WHERE n>(p_page-1)*25 AND n<=p_page*25) p),'[]'),'total',jsonb_array_length(rows_),'page',p_page,'page_size',25);
END $function$;

CREATE OR REPLACE FUNCTION public.ce_unlock_customer_requests(p_customer_id bigint, p_bl_search text DEFAULT NULL::text, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rows jsonb;
  v_term text := nullif(upper(btrim(coalesce(p_bl_search, ''))), '');
  v_page integer := coalesce(p_page, 1);
BEGIN
  PERFORM ce_unlock_private.actor();
  IF v_page < 1 THEN RAISE EXCEPTION 'Página inválida'; END IF;

  SELECT coalesce(jsonb_agg(q ORDER BY (q->>'state') IN ('completed', 'cancelled'), q->>'created_at' DESC, q->>'protocol' DESC), '[]') INTO v_rows FROM (
    SELECT jsonb_build_object(
      'id', r.id, 'protocol', r.protocol, 'state', r.state, 'version', r.version, 'created_at', r.created_at,
      'customer_name', c.name, 'cnpj_cpf', c.cnpj_cpf,
      -- 448: o prazo só existe com os quatro requisitos em todos os B/Ls.
      'sla_started_at', ce_unlock_private.request_sla_start(r.id),
      'bl_ids', coalesce((SELECT jsonb_agg(i.bl_id ORDER BY i.bl_id) FROM public.ce_unlock_request_bls i WHERE i.request_id = r.id), '[]'),
      'termo_status', (SELECT d.status FROM public.ce_unlock_documents d WHERE d.request_id = r.id AND d.type = 'termo' AND d.hash IS NOT NULL AND d.status <> 'uploading' ORDER BY d.created_at DESC LIMIT 1),
      'procuracao_status', (SELECT d.status FROM public.ce_unlock_documents d WHERE d.request_id = r.id AND d.type = 'procuracao' AND d.hash IS NOT NULL AND d.status <> 'uploading' ORDER BY d.created_at DESC LIMIT 1)
    ) AS q
    FROM public.ce_unlock_requests r
    JOIN public.customers c ON c.id = r.customer_id
    WHERE r.customer_id = p_customer_id
      AND r.source = 'request'
      AND (v_term IS NULL OR EXISTS (
        SELECT 1 FROM public.ce_unlock_request_bls i
        WHERE i.request_id = r.id AND upper(i.bl_id) LIKE '%' || v_term || '%'
      ))
  ) x;

  RETURN jsonb_build_object(
    'items', coalesce((SELECT jsonb_agg(value ORDER BY n) FROM (
      SELECT value, n FROM jsonb_array_elements(v_rows) WITH ORDINALITY a(value, n)
      WHERE n > (v_page - 1) * 20 AND n <= v_page * 20
    ) p), '[]'),
    'total', jsonb_array_length(v_rows),
    'page', v_page,
    'page_size', 20
  );
END;
$function$;

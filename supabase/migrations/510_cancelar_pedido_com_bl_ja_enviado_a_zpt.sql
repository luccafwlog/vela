-- 510: "Cancelar pedido" do Desbloqueio de CE apagado também depois de
-- Reconferir CE. Conferência do Manual do Operador (2026-10-29): o banco recusa
-- o cancelamento quando algum B/L do pedido já foi à ZPT (`export_id` ou
-- `exported_at`, `ce_unlock_private.command`, 449), mas `reconfirm_ce` limpa
-- `exported_at` e guarda `export_id`. A tela só via `exported_at`: depois de
-- Reconferir CE o botão voltava ligado e o clique terminava na recusa "Pedido
-- com B/L já exportado para a ZPT".
--
-- `ce_unlock_private.item` (449, com os remendos da 450, 456 e 460) passa a devolver `sent_to_zpt` (o B/L já foi
-- enviado à ZPT neste pedido, mesmo que tenha voltado à fila), a mesma condição
-- da trava do cancelamento. `ce_unlock_private.portal_view` (301) tira o campo
-- da projeção do Portal, como os demais dados de envio à ZPT.
--
-- Só redefine funções (mesma assinatura; `CREATE OR REPLACE` preserva dono e
-- grants); não reescreve nem apaga linhas.
-- Rollback: reaplicar `item` como na 449 e `portal_view` como na 301.

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
 -- 456: o anual cobre o B/L com o CE vinculado dentro da vigência dele (covers).
 IF r.source='vip_annual' THEN
 td:=vip AND ce_unlock_private.covers(i.termo_document_id,p_bl); pd:=vip AND ce_unlock_private.covers(i.procuracao_document_id,p_bl);
 ELSE td:=coalesce(i.termo_approved,false); pd:=coalesce(i.procuracao_approved,false); END IF;
 confirmed:=i.confirmed_at IS NOT NULL AND i.confirmed_ce IS NOT DISTINCT FROM b.ce_mercante AND r.customer_id=b.customer_id;
 eligible:=b.cancelled_at IS NULL AND trim(coalesce(b.ce_mercante,''))<>'' AND paid;
 -- 448 (ponto 10 de 2026-10-23): o prazo só começa com os quatro requisitos
 -- cumpridos (taxas locais liquidadas, termo de devolução aprovado, procuração
 -- aprovada e B/L original entregue) e parte do último que se cumpriu: o envio,
 -- a entrega do original, a liquidação, o pagamento da avulsa ou a aprovação
 -- de um dos documentos. Faltando um, não há prazo.
 IF r.id IS NOT NULL AND r.state NOT IN('draft','cancelled') AND r.customer_id IS NOT DISTINCT FROM b.customer_id
 AND ((paid AND td AND pd AND delivered) OR i.exported_at IS NOT NULL) THEN
 -- 450: exportado, o prazo fica, mesmo que um requisito caia depois; e a
 -- validação da solicitação (evento complete) também é fato, até a exportação.
 sla:=greatest((SELECT max(e.created_at) FROM public.ce_unlock_events e WHERE e.request_id=r.id AND e.action='submit'
  -- 460: exportado, cada fato do prazo só conta até a exportação.
  AND (i.exported_at IS NULL OR e.created_at<=i.exported_at)),
 (SELECT d.updated_at FROM public.ce_unlock_bl_deliveries d WHERE d.bl_id=p_bl
  AND (i.exported_at IS NULL OR d.updated_at<=i.exported_at)),
 (SELECT max(s.created_at) FROM public.ledger_settlements s JOIN public.bl_receivables x ON x.id=s.receivable_id WHERE x.bl_id=p_bl AND x.status<>'void'
  AND (i.exported_at IS NULL OR s.created_at<=i.exported_at)),
 (SELECT max(p.created_at) FROM public.payments p JOIN public.invoices n ON n.id=p.invoice_id WHERE n.bl_id=p_bl AND n.invoice_type='manual' AND n.customer_id=b.customer_id
  AND (i.exported_at IS NULL OR p.created_at<=i.exported_at)),
 (SELECT d.reviewed_at FROM public.ce_unlock_documents d WHERE d.id=i.termo_document_id
  AND (i.exported_at IS NULL OR d.reviewed_at<=i.exported_at)),
 (SELECT d.reviewed_at FROM public.ce_unlock_documents d WHERE d.id=i.procuracao_document_id
  AND (i.exported_at IS NULL OR d.reviewed_at<=i.exported_at)),
 (SELECT max(e.created_at) FROM public.ce_unlock_events e WHERE e.request_id=r.id AND e.action='complete'
  AND (i.exported_at IS NULL OR e.created_at<=i.exported_at)));
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
 'vip',vip,'vip_covered',vip AND ce_unlock_private.annual_for_bl(b.customer_id,'termo',p_bl) IS NOT NULL AND ce_unlock_private.annual_for_bl(b.customer_id,'procuracao',p_bl) IS NOT NULL,'termo',td,'procuracao',pd,'paid',paid,'paid_exempt',exempt,'delivered',delivered,'confirmed',confirmed,
 'delivery_version',coalesce((SELECT version FROM public.ce_unlock_bl_deliveries WHERE bl_id=p_bl),0),
 -- 299: B/L ativo em solicitação ainda não validada, do mesmo Cliente e não
 -- enviado à ZPT, pode mudar para uma solicitação nova (caminho A).
 'can_submit',eligible AND NOT confirmed AND (NOT coalesce(i.active,false)
 OR (r.state IN('draft','submitted','in_review','changes_requested') AND r.customer_id=b.customer_id
 AND i.exported_at IS NULL AND i.export_id IS NULL AND i.confirmed_at IS NULL)),
 'can_export',eligible AND r.customer_id=b.customer_id AND td AND pd AND delivered AND r.state IN('submitted','in_review','changes_requested','completed') AND i.active AND i.ce_at_request=b.ce_mercante AND NOT confirmed,
 'export_state',CASE WHEN confirmed THEN 'confirmed' WHEN i.exported_at IS NOT NULL THEN 'exported' ELSE 'not_exported' END,
 'exported_at',i.exported_at,'sla_started_at',sla,
 -- 510: já enviado à ZPT neste pedido, mesmo de volta à fila (trava do cancelamento).
 'sent_to_zpt',coalesce(i.exported_at IS NOT NULL OR i.export_id IS NOT NULL,false),
 'zpt_status',zs.status,'zpt_description',zs.description,'zpt_pending',to_jsonb(zs.pending),'zpt_updated_at',zs.zpt_updated_at,'zpt_without_export',zs.without_export,
 'reasons',to_jsonb(reasons));
END $function$;

CREATE OR REPLACE FUNCTION ce_unlock_private.portal_view(j jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v jsonb := j-'export_state'-'exported_at'-'zpt_status'-'zpt_description'-'zpt_pending'-'zpt_updated_at'-'zpt_without_export'-'sent_to_zpt';
  v_customer bigint := (j->>'customer_id')::bigint;
  v_awaiting boolean;
BEGIN
  -- Campos que só o desk vê: envio/conciliação com a ZPT. O Portal nunca os recebe.
  -- 298: B/L ainda sem fatura visível não tem "Taxas locais sem liquidação":
  -- o Cliente vê só que a fatura ainda não saiu (ADR 0088).
  -- 301: só a pendência de Taxas Locais conta; avulsa em aberto não é
  -- "aguardando fatura" (a fatura dela já está no Portal).
  v_awaiting := COALESCE(j->'reasons', '[]'::jsonb) ? 'Taxas locais sem liquidação integral confirmada'
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
$function$;

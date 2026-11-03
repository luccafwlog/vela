-- 581: Desbloqueio de CE do Cliente VIP sem solicitação (decisão do dono de
-- 2026-11-03, ADR 0119).
--
-- Antes, o Cliente VIP só deixava de anexar termo e procuração: ainda pedia o
-- desbloqueio no Portal, e sem a solicitação o B/L não ia para a ZPT nem tinha
-- prazo (576 e 579 só mostravam os anuais cobrindo). Agora, como o veículo
-- LCL isento (575, ADR 0118), o B/L coberto pelos dois anuais VIP segue sem
-- solicitação: pagas as Taxas Locais e entregue o B/L original, ele fica apto,
-- o desk exporta e o prazo corre.
--
-- 1. Vigência. Sem solicitação, o dia que o anual precisa cobrir é o do último
--    destes fatos: entrega do original, baixa das Taxas Locais e pagamento da
--    avulsa (`ce_unlock_private.direct_day`, no calendário de Brasília; depois
--    da exportação, só os fatos até ela). Antes de pago e entregue, o de hoje.
--    `ce_unlock_private.annual_on` acha o anual aprovado, de ano inteiro, que
--    cobre o dia. Só um anual cobrindo não basta: os dois, como no pedido VIP.
-- 2. `ce_unlock_private.item` (576 + 579): o B/L sem solicitação que segura
--    (nenhuma, rascunho ou cancelada; a enviada continua sendo o caminho dele,
--    como na 575) segue direto quando é veículo LCL isento, quando os anuais
--    VIP o cobrem (`vip_direct`) ou quando já foi enviado direto à ZPT com o
--    CE atual. Novo campo `vip_direct`. `can_submit` falso para o B/L VIP
--    coberto e para o já enviado direto. Prazo do VIP direto: só depois da
--    validação (abaixo) ou da exportação, a partir do último fato (entrega,
--    baixa, avulsa, aprovação dos anuais, habilitação do VIP, validação).
-- 3. Validação e aviso por B/L. `public.ce_unlock_direct_validations` guarda a
--    primeira vez que o B/L VIP direto ficou apto, uma por B/L e Cliente;
--    `ce_unlock_private.validate_direct` grava a validação, o evento
--    `direct_validated` e o aviso "documentação validada" do B/L no sino do
--    Portal e na fila de e-mails (`ce_unlock_email_outbox` aceita linha sem
--    solicitação, com `bl_id`). Roda na entrega do original (comando
--    `delivery`) e na varredura de 5 minutos (`ce_unlock_refresh_open`), que
--    pega a baixa feita fora do módulo, a aprovação do anual e a habilitação
--    do VIP.
-- 4. `ce_unlock_private.command` (575 + 578): o rascunho recusa o B/L VIP
--    coberto e o envio de rascunho antigo também, com a explicação.
-- 5. `public.ce_unlock_email_pending` (458) devolve `bl_id`;
--    `ce_unlock_private.bl_history` (577) mostra a validação;
--    `delete_record_block_reason` (575) nomeia a tabela nova.
--
-- ponytail: a varredura chama `item()` para cada B/L de Cliente VIP com o
-- original entregue, sem validação, sem solicitação enviada e não desbloqueado
-- na ZPT — O(B/Ls VIP entregues e não pagos) a cada 5 minutos. Upgrade: fila
-- por gatilho na baixa, como a conclusão das solicitações.
--
-- Plano de preservação: a migration não reescreve nem apaga linha existente.
-- Cria duas tabelas vazias (`ce_unlock_direct_validations` nova; nenhuma
-- linha antiga é tocada), solta o NOT NULL de `ce_unlock_email_outbox.request_id`
-- e acrescenta a coluna `bl_id` (nula nas linhas antigas, que seguem com a
-- solicitação delas) e redefine funções. Rascunhos VIP abertos continuam
-- gravados como estão; o Cliente os cancela. Conferir: as linhas antigas da
-- fila mantêm `request_id` (`SELECT count(*) FROM ce_unlock_email_outbox
-- WHERE request_id IS NULL AND bl_id IS NULL` = 0). Desfazer: reaplicar `item`
-- pela 576 com o patch da 579, `command` pela 575 com o patch da 578,
-- `ce_unlock_refresh_open` pela 161, `ce_unlock_email_pending` pela 458,
-- `bl_history` pela 577 e `delete_record_block_reason` pela 575; depois remover
-- as funções novas, o CHECK e a coluna `bl_id` da fila (só se nenhuma linha
-- sem solicitação foi gravada) e a tabela `ce_unlock_direct_validations`.

-- 1. Vigência pelo dia do pagamento e da entrega ----------------------------

CREATE OR REPLACE FUNCTION ce_unlock_private.direct_day(p_bl text, p_until timestamptz DEFAULT NULL)
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 -- O último ato do Cliente que deixa o B/L pronto: a entrega do original, a
 -- baixa das Taxas Locais ou o pagamento da avulsa. Exportado, só até a
 -- exportação. Sem nenhum, hoje.
 SELECT coalesce((greatest(
   (SELECT d.updated_at FROM public.ce_unlock_bl_deliveries d WHERE d.bl_id=p_bl AND d.delivered
     AND (p_until IS NULL OR d.updated_at<=p_until)),
   (SELECT max(s.created_at) FROM public.ledger_settlements s JOIN public.bl_receivables x ON x.id=s.receivable_id
     WHERE x.bl_id=p_bl AND x.status<>'void' AND x.source='local_charges' AND (p_until IS NULL OR s.created_at<=p_until)),
   (SELECT max(p.created_at) FROM public.payments p JOIN public.invoices n ON n.id=p.invoice_id JOIN public.bls b ON b.id=n.bl_id
     WHERE n.bl_id=p_bl AND n.invoice_type='manual' AND n.customer_id=b.customer_id AND (p_until IS NULL OR p.created_at<=p_until))
 ) AT TIME ZONE 'America/Sao_Paulo')::date, ce_unlock_private.today())
$function$;
REVOKE ALL ON FUNCTION ce_unlock_private.direct_day(text, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION ce_unlock_private.annual_on(p_customer bigint, p_type text, p_day date)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 -- Mesma condição de `covers` (aprovado, de ano inteiro), com o dia dado.
 SELECT d.id FROM public.ce_unlock_documents d
 WHERE d.customer_id=p_customer AND d.type=p_type AND d.source='vip_annual' AND d.status='approved'
   AND d.valid_until=make_date(d.coverage_year,12,31) AND p_day BETWEEN d.valid_from AND d.valid_until
 ORDER BY d.created_at DESC,d.id LIMIT 1
$function$;
REVOKE ALL ON FUNCTION ce_unlock_private.annual_on(bigint, text, date) FROM PUBLIC, anon, authenticated;

-- 3. Validação do B/L VIP direto (tabela antes de `item`, que a lê) ----------

CREATE TABLE public.ce_unlock_direct_validations (
 bl_id text NOT NULL REFERENCES public.bls(id),
 customer_id bigint NOT NULL REFERENCES public.customers(id),
 validated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (bl_id, customer_id)
);
CREATE INDEX ce_unlock_direct_validations_customer_id ON public.ce_unlock_direct_validations(customer_id);
COMMENT ON TABLE public.ce_unlock_direct_validations IS
 'Primeira validação do B/L VIP sem solicitação (anuais cobrindo, taxas pagas e original entregue), uma por B/L e Cliente: dispara o aviso e entra no prazo (migration 581).';
ALTER TABLE public.ce_unlock_direct_validations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ce_unlock_direct_validations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ce_unlock_direct_validations TO service_role;

ALTER TABLE public.ce_unlock_email_outbox ALTER COLUMN request_id DROP NOT NULL;
ALTER TABLE public.ce_unlock_email_outbox ADD COLUMN bl_id text REFERENCES public.bls(id);
ALTER TABLE public.ce_unlock_email_outbox ADD CONSTRAINT ce_unlock_email_outbox_request_or_bl
 CHECK (request_id IS NOT NULL OR bl_id IS NOT NULL);
CREATE INDEX ce_unlock_email_outbox_bl_id ON public.ce_unlock_email_outbox(bl_id) WHERE bl_id IS NOT NULL;
COMMENT ON COLUMN public.ce_unlock_email_outbox.bl_id IS
 'B/L do aviso sem solicitação (Cliente VIP, migration 581); nas linhas com solicitação, nulo.';

-- 2. Item ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ce_unlock_private.item(p_bl text, p_request uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE b public.bls; i public.ce_unlock_request_bls; r public.ce_unlock_requests; zs public.ce_unlock_zpt_status; paid boolean; td boolean; pd boolean; delivered boolean;
 local_paid boolean; exempt boolean:=false; dispensed boolean; direct boolean:=false; free boolean; dx public.ce_unlock_direct_exports; xa timestamptz; manual_open boolean; vip boolean; vip_covered boolean;
 vday date; vt uuid; vp uuid; vip_now boolean:=false; dv public.ce_unlock_direct_validations; reasons text[] := '{}'; eligible boolean; confirmed boolean; vs text; sla timestamptz;
BEGIN
 SELECT * INTO b FROM public.bls WHERE id=p_bl;
 SELECT * INTO i FROM public.ce_unlock_request_bls WHERE bl_id=p_bl AND (p_request IS NULL OR request_id=p_request)
 ORDER BY active DESC,confirmed_at DESC NULLS LAST,request_id LIMIT 1;
 SELECT * INTO r FROM public.ce_unlock_requests WHERE id=i.request_id;
 SELECT * INTO zs FROM public.ce_unlock_zpt_status WHERE bl_id=p_bl AND ce_mercante IS NOT DISTINCT FROM b.ce_mercante;
 dispensed:=ce_unlock_private.documents_dispensed(p_bl);
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
 -- 575 e 581: sem solicitação que segure o B/L (nenhuma, rascunho ou
 -- cancelada), ele pode seguir direto. A enviada continua sendo o caminho
 -- dele. Com p_request (detalhe de uma solicitação), o B/L fica nela.
 free:=p_request IS NULL AND (r.id IS NULL OR NOT coalesce(i.active,false) OR r.state IN('draft','cancelled'));
 IF free THEN SELECT * INTO dx FROM public.ce_unlock_direct_exports WHERE bl_id=p_bl AND ce_mercante IS NOT DISTINCT FROM b.ce_mercante; END IF;
 -- 581: o VIP coberto pelos dois anuais não precisa de solicitação. O dia que
 -- o anual cobre é o do último ato do Cliente (pagamento ou entrega); antes de
 -- pago e entregue, hoje (ADR 0119).
 IF vip AND b.customer_id IS NOT NULL THEN
 vday:=CASE WHEN (paid AND delivered) OR dx.exported_at IS NOT NULL THEN ce_unlock_private.direct_day(p_bl,dx.exported_at) ELSE ce_unlock_private.today() END;
 vt:=ce_unlock_private.annual_on(b.customer_id,'termo',vday); vp:=ce_unlock_private.annual_on(b.customer_id,'procuracao',vday);
 vip_now:=vt IS NOT NULL AND vp IS NOT NULL;
 END IF;
 IF free AND (dispensed OR (vip_now AND NOT dispensed) OR dx.bl_id IS NOT NULL) THEN direct:=true; r:=NULL; i:=NULL; END IF;
 -- 576: anuais cobrindo; sem solicitação que segure o B/L, pelo dia acima.
 vip_covered:=CASE WHEN free THEN vip_now
   ELSE vip AND ce_unlock_private.annual_for_bl(b.customer_id,'termo',p_bl) IS NOT NULL AND ce_unlock_private.annual_for_bl(b.customer_id,'procuracao',p_bl) IS NOT NULL END;
 IF dispensed THEN td:=true; pd:=true;
 -- 581: direto pelo VIP (ou já enviado direto), termo e procuração são os anuais que cobrem o dia.
 ELSIF direct THEN td:=vip_now; pd:=vip_now;
 -- 579: rascunho VIP segue a regra do B/L sem solicitação (os anuais entram no envio).
 ELSIF r.source='vip_annual' AND r.state='draft' THEN td:=vip_covered; pd:=vip_covered;
 ELSIF r.source='vip_annual' THEN
 td:=vip AND ce_unlock_private.covers(i.termo_document_id,p_bl); pd:=vip AND ce_unlock_private.covers(i.procuracao_document_id,p_bl);
 ELSIF r.id IS NULL THEN td:=vip_covered; pd:=vip_covered;
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
 -- 575: B/L dispensado de solicitação: o prazo parte da entrega do original
 -- (ou do pagamento da avulsa, se veio depois), até a exportação.
 -- 581: no VIP direto, só depois da validação (ou da exportação), e entram
 -- também a baixa, a aprovação dos anuais, a habilitação do VIP e a validação.
 IF direct AND NOT dispensed THEN SELECT * INTO dv FROM public.ce_unlock_direct_validations WHERE bl_id=p_bl AND customer_id=b.customer_id; END IF;
 IF direct AND ((eligible AND delivered AND td AND pd) OR dx.exported_at IS NOT NULL)
 AND (dispensed OR dv.validated_at IS NOT NULL OR dx.exported_at IS NOT NULL) THEN
 sla:=greatest((SELECT d.updated_at FROM public.ce_unlock_bl_deliveries d WHERE d.bl_id=p_bl
  AND (dx.exported_at IS NULL OR d.updated_at<=dx.exported_at)),
 (SELECT max(p.created_at) FROM public.payments p JOIN public.invoices n ON n.id=p.invoice_id WHERE n.bl_id=p_bl AND n.invoice_type='manual' AND n.customer_id=b.customer_id
  AND (dx.exported_at IS NULL OR p.created_at<=dx.exported_at)),
 CASE WHEN NOT dispensed THEN (SELECT max(s.created_at) FROM public.ledger_settlements s JOIN public.bl_receivables x ON x.id=s.receivable_id WHERE x.bl_id=p_bl AND x.status<>'void'
  AND (dx.exported_at IS NULL OR s.created_at<=dx.exported_at)) END,
 CASE WHEN NOT dispensed THEN (SELECT max(d.reviewed_at) FROM public.ce_unlock_documents d WHERE d.id IN(vt,vp)
  AND (dx.exported_at IS NULL OR d.reviewed_at<=dx.exported_at)) END,
 CASE WHEN NOT dispensed AND vip THEN (SELECT v.updated_at FROM public.ce_unlock_vip_customers v WHERE v.customer_id=b.customer_id
  AND (dx.exported_at IS NULL OR v.updated_at<=dx.exported_at)) END,
 CASE WHEN dx.exported_at IS NULL OR dv.validated_at<=dx.exported_at THEN dv.validated_at END);
 END IF;
 xa:=CASE WHEN direct THEN dx.exported_at ELSE i.exported_at END;
 IF r.id IS NOT NULL AND r.customer_id IS DISTINCT FROM b.customer_id THEN reasons:=array_append(reasons,'Cliente do B/L alterado: solicitação anterior inaplicável'); END IF;
 IF b.cancelled_at IS NOT NULL THEN reasons:=array_append(reasons,'B/L cancelado'); END IF;
 IF trim(coalesce(b.ce_mercante,''))='' THEN reasons:=array_append(reasons,'CE Mercante não informado'); END IF;
 IF NOT local_paid OR (NOT paid AND NOT manual_open) THEN reasons:=array_append(reasons,'Taxas locais sem liquidação integral confirmada'); END IF;
 IF manual_open THEN reasons:=array_append(reasons,'Fatura avulsa do B/L em aberto'); END IF;
 IF (r.id IS NOT NULL OR direct) AND NOT td THEN reasons:=array_append(reasons,'Termo de devolução pendente, vencido ou revogado'); END IF;
 IF (r.id IS NOT NULL OR direct) AND NOT pd THEN reasons:=array_append(reasons,'Procuração pendente, vencida ou revogada'); END IF;
 IF (r.id IS NOT NULL OR direct) AND NOT delivered THEN reasons:=array_append(reasons,'B/L físico aguardando entrega'); END IF;
 IF r.id IS NOT NULL AND i.ce_at_request IS DISTINCT FROM b.ce_mercante THEN reasons:=array_append(reasons,'CE alterado: reconferência necessária'); END IF;
 SELECT ve.name INTO vs FROM public.voyages v JOIN public.vessels ve ON ve.id=v.vessel_id WHERE v.id=b.voyage_id;
 RETURN jsonb_build_object('bl_id',p_bl,'ce_mercante',b.ce_mercante,'customer_id',b.customer_id,
 'customer_name',(SELECT name FROM public.customers WHERE id=b.customer_id),'cnpj_cpf',(SELECT cnpj_cpf FROM public.customers WHERE id=b.customer_id),
 'voyage_id',b.voyage_id,'voyage_number',(SELECT voyage_number FROM public.voyages WHERE id=b.voyage_id),'vessel_name',vs,'pod',b.pod,
 'request_id',r.id,'requested_at',r.created_at,'protocol',r.protocol,'state',coalesce(r.state,'no_request'),'version',r.version,'source',coalesce(r.source,'request'),
 'vip',vip,'vip_covered',vip_covered,'vip_direct',vip_now AND NOT dispensed,'termo',td,'procuracao',pd,'paid',paid,'paid_exempt',exempt,'documents_dispensed',dispensed,'direct',direct,'delivered',delivered,'confirmed',confirmed,
 'delivery_version',coalesce((SELECT version FROM public.ce_unlock_bl_deliveries WHERE bl_id=p_bl),0),
 -- 299: B/L ativo em solicitação ainda não validada, do mesmo Cliente e não
 -- enviado à ZPT, pode mudar para uma solicitação nova (caminho A).
 -- 581: nem o B/L VIP coberto, nem o já enviado direto à ZPT.
 'can_submit',eligible AND NOT dispensed AND NOT vip_now AND dx.bl_id IS NULL AND NOT confirmed AND (NOT coalesce(i.active,false)
 OR (r.state IN('draft','submitted','in_review','changes_requested') AND r.customer_id=b.customer_id
 AND i.exported_at IS NULL AND i.export_id IS NULL AND i.confirmed_at IS NULL)),
 'can_export',coalesce(eligible AND r.customer_id=b.customer_id AND td AND pd AND delivered AND r.state IN('submitted','in_review','changes_requested','completed') AND i.active AND i.ce_at_request=b.ce_mercante AND NOT confirmed,false)
 -- 575: dispensado de solicitação, basta a entrega do original; 581: VIP direto, com os anuais cobrindo.
 OR (direct AND eligible AND delivered AND td AND pd),
 'export_state',CASE WHEN confirmed THEN 'confirmed' WHEN xa IS NOT NULL THEN 'exported' ELSE 'not_exported' END,
 'exported_at',xa,'sla_started_at',sla,
 -- 510: já enviado à ZPT neste pedido, mesmo de volta à fila (trava do cancelamento).
 'sent_to_zpt',CASE WHEN direct THEN xa IS NOT NULL ELSE coalesce(i.exported_at IS NOT NULL OR i.export_id IS NOT NULL,false) END,
 'zpt_status',zs.status,'zpt_description',zs.description,'zpt_pending',to_jsonb(zs.pending),'zpt_updated_at',zs.zpt_updated_at,'zpt_without_export',zs.without_export,
 'reasons',to_jsonb(reasons));
END $function$;

-- 3. Validação e aviso -----------------------------------------------------

CREATE OR REPLACE FUNCTION ce_unlock_private.validate_direct(p_bl text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE it jsonb; c bigint; title text; msg text;
BEGIN
 it:=ce_unlock_private.item(p_bl);
 IF NOT coalesce((it->>'direct')::boolean,false) OR NOT coalesce((it->>'vip_direct')::boolean,false)
 OR NOT coalesce((it->>'can_export')::boolean,false) THEN RETURN false; END IF;
 c:=(it->>'customer_id')::bigint;
 INSERT INTO public.ce_unlock_direct_validations(bl_id,customer_id) VALUES(p_bl,c) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO public.ce_unlock_events(customer_id,bl_id,action,actor_id,payload)
 VALUES(c,p_bl,'direct_validated',coalesce(auth.uid(),'00000000-0000-0000-0000-000000000000'),jsonb_build_object('ce_mercante',it->>'ce_mercante'));
 -- O prazo do aviso é o que o Portal e o Vela mostram, lido depois de gravar a validação.
 it:=ce_unlock_private.item(p_bl);
 title:='Desbloqueio de CE: documentação validada';
 msg:='A documentação do B/L '||p_bl||' (CE '||coalesce(it->>'ce_mercante','')||') foi validada pela sua condição VIP: termo de devolução e procuração anuais, Taxas Locais pagas e B/L original entregue. Prazo para o desbloqueio: até '
   ||to_char(ce_unlock_private.sla_deadline(coalesce((it->>'sla_started_at')::timestamptz,now())) AT TIME ZONE 'America/Sao_Paulo','DD/MM "às" HH24:MI')
   ||'. Consulte o SISCARGA para verificar o desbloqueio.';
 INSERT INTO public.portal_notifications(customer_id,type,title,message,link,bl_id) VALUES(c,'system',title,msg,'/portal/desbloqueio-ce',p_bl);
 INSERT INTO public.ce_unlock_email_outbox(customer_id,bl_id,kind,subject,body) VALUES(c,p_bl,'documentation_validated',title,msg);
 RETURN true;
END $function$;
REVOKE ALL ON FUNCTION ce_unlock_private.validate_direct(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ce_unlock_refresh_open()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE rid uuid; bid text; n integer:=0; BEGIN
 FOR rid IN SELECT id FROM public.ce_unlock_requests WHERE state IN('submitted','in_review','changes_requested','completed') ORDER BY id LOOP
 PERFORM ce_unlock_private.refresh_completion(rid); n:=n+1;
 END LOOP;
 -- 581: B/L VIP sem solicitação que ficou apto fora de um comando do módulo
 -- (baixa, aprovação do anual, habilitação do VIP): valida e avisa.
 FOR bid IN SELECT b.id FROM public.bls b
   JOIN public.ce_unlock_vip_customers v ON v.customer_id=b.customer_id AND v.enabled
   JOIN public.ce_unlock_bl_deliveries d ON d.bl_id=b.id AND d.delivered
   WHERE b.cancelled_at IS NULL AND trim(coalesce(b.ce_mercante,''))<>''
     AND NOT EXISTS(SELECT 1 FROM public.ce_unlock_direct_validations x WHERE x.bl_id=b.id AND x.customer_id=b.customer_id)
     AND NOT EXISTS(SELECT 1 FROM public.ce_unlock_request_bls i JOIN public.ce_unlock_requests r ON r.id=i.request_id
       WHERE i.bl_id=b.id AND i.active AND r.state NOT IN('draft','cancelled'))
     AND NOT EXISTS(SELECT 1 FROM public.ce_unlock_zpt_status z WHERE z.bl_id=b.id AND z.status='unlocked')
   ORDER BY b.id LOOP
 IF ce_unlock_private.validate_direct(bid) THEN n:=n+1; END IF;
 END LOOP;
 RETURN n;
END $function$;
REVOKE ALL ON FUNCTION public.ce_unlock_refresh_open() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ce_unlock_refresh_open() TO service_role;

CREATE OR REPLACE FUNCTION public.ce_unlock_email_pending(p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 WITH candidates AS (
   SELECT o.id FROM public.ce_unlock_email_outbox o
   WHERE o.status='pending' AND o.attempts<5
     AND (o.claimed_until IS NULL OR o.claimed_until<=now())
     -- Cliente desativado não recebe aviso operacional (como o Comunicado e o resumo).
     AND NOT EXISTS(SELECT 1 FROM public.customers c WHERE c.id=o.customer_id AND c.deactivated_at IS NOT NULL)
   ORDER BY o.id LIMIT greatest(1,least(p_limit,100))
   FOR UPDATE OF o SKIP LOCKED
 ), claimed AS (
   UPDATE public.ce_unlock_email_outbox o SET claimed_until=now()+interval '10 minutes'
   FROM candidates c WHERE o.id=c.id
   -- 581: bl_id no aviso do B/L VIP sem solicitação.
   RETURNING o.id,o.customer_id,o.request_id,o.bl_id,o.kind,o.subject,o.body,o.done_recipients,o.attempts
 )
 SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') FROM claimed c $function$;
REVOKE ALL ON FUNCTION public.ce_unlock_email_pending(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ce_unlock_email_pending(integer) TO service_role;

-- 4 e 5. Patches no lugar (`pg_get_functiondef` + `replace`, como a 578) ---

DO $patch$
DECLARE
  v_patch record;
  v_def text;
BEGIN
  FOR v_patch IN
    SELECT * FROM (VALUES
      (
        'ce_unlock_private.command(text,jsonb,boolean)'::regprocedure,
        -- Rascunho: recusa o B/L VIP coberto, como o veículo LCL isento.
        $s$ IF NOT (item->>'can_submit')::boolean THEN RAISE EXCEPTION 'B/L % não pode ser solicitado: %',bid,item->'reasons'; END IF;
$s$,
        $s$ -- 581: Cliente VIP com os anuais cobrindo o B/L não precisa de solicitação.
 IF coalesce((item->>'vip_direct')::boolean,false) THEN RAISE EXCEPTION 'B/L % não precisa de solicitação: pela condição VIP, o termo de devolução e a procuração anuais cobrem este B/L, e o desbloqueio segue com as Taxas Locais pagas e o B/L original entregue na agência.',bid; END IF;
 IF NOT (item->>'can_submit')::boolean THEN RAISE EXCEPTION 'B/L % não pode ser solicitado: %',bid,item->'reasons'; END IF;
$s$
      ),
      (
        'ce_unlock_private.command(text,jsonb,boolean)'::regprocedure,
        -- Envio de rascunho antigo: mesma recusa (como a 578).
        $s$ -- 578: rascunho antigo não leva o veículo LCL isento (a 575 o recusa ao rascunhar).
$s$,
        $s$ -- 581: nem o B/L VIP coberto pelos anuais.
 IF r.state='draft' AND coalesce((item->>'vip_direct')::boolean,false) THEN RAISE EXCEPTION 'B/L % não precisa de solicitação: pela condição VIP, o termo de devolução e a procuração anuais cobrem este B/L, e o desbloqueio segue com as Taxas Locais pagas e o B/L original entregue na agência. Cancele este rascunho e peça os demais B/Ls em outro.',bid; END IF;
 -- 578: rascunho antigo não leva o veículo LCL isento (a 575 o recusa ao rascunhar).
$s$
      ),
      (
        'ce_unlock_private.command(text,jsonb,boolean)'::regprocedure,
        -- Entrega do original: o B/L VIP direto que fica apto é validado na hora.
        $s$ IF rid IS NOT NULL THEN PERFORM ce_unlock_private.refresh_completion(rid); END IF;
$s$,
        $s$ IF rid IS NOT NULL THEN PERFORM ce_unlock_private.refresh_completion(rid); END IF;
 -- 581: B/L VIP sem solicitação que ficou apto com a entrega: valida e avisa.
 PERFORM ce_unlock_private.validate_direct(bid);
$s$
      ),
      (
        'ce_unlock_private.bl_history(text)'::regprocedure,
        $s$   UNION ALL
   -- Contexto: envio à ZPT
$s$,
        $s$   UNION ALL
   -- 581: validação do B/L VIP sem solicitação (dispara o aviso ao Cliente)
   SELECT e.created_at, 'solicitacao', 'vip_validated', NULL, NULL, e.actor_id, NULL, e.id
   FROM public.ce_unlock_events e WHERE e.action='direct_validated' AND e.bl_id=p_bl
   UNION ALL
   -- Contexto: envio à ZPT
$s$
      ),
      (
        'public.delete_record_block_reason(text,text,text)'::regprocedure,
        $s$          WHEN 'ce_unlock_direct_exports' THEN 'envio à ZPT do Desbloqueio de CE'
$s$,
        $s$          WHEN 'ce_unlock_direct_exports' THEN 'envio à ZPT do Desbloqueio de CE'
          WHEN 'ce_unlock_direct_validations' THEN 'validação do Desbloqueio de CE'
$s$
      )
    ) AS t(fn, old_clause, new_clause)
  LOOP
    v_def := pg_get_functiondef(v_patch.fn);
    IF (length(v_def) - length(replace(v_def, v_patch.old_clause, ''))) / length(v_patch.old_clause) <> 1 THEN
      RAISE EXCEPTION '581: cláusula não encontrada uma única vez em %: %', v_patch.fn, left(v_patch.old_clause, 60);
    END IF;
    EXECUTE replace(v_def, v_patch.old_clause, v_patch.new_clause);
  END LOOP;
END;
$patch$;

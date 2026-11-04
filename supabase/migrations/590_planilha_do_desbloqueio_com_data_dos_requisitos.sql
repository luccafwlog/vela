-- 590: planilha comum do Desbloqueio de CE (aba Andamento dos B/Ls) com a data
-- e a hora de cada requisito atendido, no lugar de só "Atendido" (pedido do
-- dono de 2026-11-04).
--
-- 1. `ce_unlock_private.requirement_dates(text)` (nova): quando cada requisito
--    do B/L se cumpriu, montado só do que já é gravado (as mesmas fontes do
--    prazo, migration 448, e do histórico do B/L, migration 577):
--    - termo de devolução e procuração: `reviewed_at` do documento aprovado que
--      conta para o B/L. Com solicitação enviada e ativa, os documentos dela
--      (na solicitação VIP enviada antes da 581, os anuais que ela referencia);
--      sem ela (rascunho, cancelada, nenhuma, VIP direto), o par de anuais VIP
--      que `ce_unlock_private.item` usa (582): `annuals_between` do dia do
--      último ato do Cliente (`direct_day`, com pago e entregue ou exportado;
--      antes, hoje) até a exportação (antes dela, hoje). Assim o B/L pago e
--      entregue em dezembro e exportado em janeiro mostra a aprovação do anual
--      de dezembro, não a do ano novo.
--    - Taxas Locais: a última baixa (`ledger_settlements`) dos recebíveis de
--      Taxas Locais vigentes do B/L ou o último pagamento de fatura avulsa do
--      B/L, o que vier depois (o fato que completou o pagamento).
--    - B/L original: `ce_unlock_bl_deliveries.updated_at` com a entrega marcada.
--    A tela decide se o requisito está atendido (`ce_unlock_private.item`); a
--    data só aparece com ele atendido.
--    ponytail: a data é a do último fato da fonte, não a do instante em que o
--    item passou a atendido (baixa estornada e refeita mostra a refeita; troca
--    de Cliente concluída mostra a baixa nova). Upgrade: gravar o instante em
--    que cada requisito vira atendido, se o desk pedir a trilha exata.
-- 2. `public.ce_unlock_read` (redefinida da 577) ganha a leitura
--    `requirement_dates`, com `bl_ids` (até 500 por chamada), para todos os
--    setores, como `bls` e `bl_history`.
--
-- Só cria e redefine funções; não lê fora do Desbloqueio nem reescreve,
-- apaga ou cria linhas.
-- Rollback: reaplicar `public.ce_unlock_read` pela 577 e
-- DROP FUNCTION ce_unlock_private.requirement_dates(text).

CREATE OR REPLACE FUNCTION ce_unlock_private.requirement_dates(p_bl text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE b public.bls; i public.ce_unlock_request_bls; r public.ce_unlock_requests; v_termo uuid; v_procuracao uuid;
 dx public.ce_unlock_direct_exports; v_item jsonb; v_day date;
BEGIN
 SELECT * INTO b FROM public.bls WHERE id=p_bl;
 IF b.id IS NULL THEN RETURN NULL; END IF;
 -- A mesma solicitação que `ce_unlock_private.item` lê para o B/L.
 SELECT * INTO i FROM public.ce_unlock_request_bls WHERE bl_id=p_bl
 ORDER BY active DESC,confirmed_at DESC NULLS LAST,request_id LIMIT 1;
 SELECT * INTO r FROM public.ce_unlock_requests WHERE id=i.request_id;
 IF r.id IS NOT NULL AND coalesce(i.active,false) AND r.state NOT IN('draft','cancelled') THEN
   v_termo:=i.termo_document_id; v_procuracao:=i.procuracao_document_id;
 ELSIF b.customer_id IS NOT NULL THEN
   -- O mesmo intervalo e a mesma escolha do par de `ce_unlock_private.item` (581/582).
   -- ponytail: relê o item para saber se está pago e entregue (O(item) por B/L).
   -- Upgrade: o item expor os anuais que usou, se a planilha ficar lenta.
   SELECT * INTO dx FROM public.ce_unlock_direct_exports WHERE bl_id=p_bl AND ce_mercante IS NOT DISTINCT FROM b.ce_mercante;
   v_item:=ce_unlock_private.item(p_bl);
   v_day:=CASE WHEN (coalesce((v_item->>'paid')::boolean,false) AND coalesce((v_item->>'delivered')::boolean,false)) OR dx.exported_at IS NOT NULL
     THEN ce_unlock_private.direct_day(p_bl,dx.exported_at) ELSE ce_unlock_private.today() END;
   SELECT a.termo,a.procuracao INTO v_termo,v_procuracao FROM ce_unlock_private.annuals_between(b.customer_id,v_day,
     coalesce((dx.exported_at AT TIME ZONE 'America/Sao_Paulo')::date,ce_unlock_private.today())) a;
 END IF;
 RETURN jsonb_build_object(
   'bl_id',p_bl,
   'termo_at',(SELECT d.reviewed_at FROM public.ce_unlock_documents d WHERE d.id=v_termo AND d.status='approved'),
   'procuracao_at',(SELECT d.reviewed_at FROM public.ce_unlock_documents d WHERE d.id=v_procuracao AND d.status='approved'),
   'paid_at',greatest(
     (SELECT max(s.created_at) FROM public.ledger_settlements s JOIN public.bl_receivables x ON x.id=s.receivable_id
      WHERE x.bl_id=p_bl AND x.status<>'void' AND x.source='local_charges' AND x.customer_id IS NOT DISTINCT FROM b.customer_id),
     (SELECT max(pm.created_at) FROM public.payments pm JOIN public.invoices n ON n.id=pm.invoice_id
      WHERE n.bl_id=p_bl AND n.invoice_type='manual' AND n.customer_id IS NOT DISTINCT FROM b.customer_id)),
   'delivered_at',(SELECT d.updated_at FROM public.ce_unlock_bl_deliveries d WHERE d.bl_id=p_bl AND d.delivered));
END $function$;
REVOKE ALL ON FUNCTION ce_unlock_private.requirement_dates(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ce_unlock_read(p_kind text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ DECLARE role_name text; BEGIN
 role_name:=ce_unlock_private.actor();
 CASE p_kind WHEN 'bls' THEN RETURN ce_unlock_private.list(NULL,p_payload->'filters',coalesce((p_payload->>'page')::int,1));
 WHEN 'review_queue' THEN RETURN ce_unlock_private.review_queue(coalesce((p_payload->>'page')::int,1));
 WHEN 'request' THEN
   -- Documentos para todos; a referência externa da confirmação segue do desk.
   IF role_name IN('administrativo','documentacao') THEN
     RETURN ce_unlock_private.request_json((p_payload->>'request_id')::uuid,NULL,true);
   END IF;
   RETURN ce_unlock_private.request_json((p_payload->>'request_id')::uuid,NULL,false)
     || jsonb_build_object('documents', ce_unlock_private.request_json((p_payload->>'request_id')::uuid,NULL,true)->'documents');
 WHEN 'vip' THEN RETURN ce_unlock_private.vip_json((p_payload->>'customer_id')::bigint,true);
 WHEN 'exports' THEN PERFORM ce_unlock_private.actor(true); RETURN coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY created_at DESC) FROM public.ce_unlock_exports e),'[]');
 WHEN 'model' THEN RETURN (SELECT ce_unlock_private.doc_json(id) FROM public.ce_unlock_documents WHERE source='model' AND status='approved' ORDER BY created_at DESC LIMIT 1);
 -- 577: histórico do B/L na aba Andamento dos B/Ls, para todos os setores (como o da solicitação).
 WHEN 'bl_history' THEN RETURN ce_unlock_private.bl_history(p_payload->>'bl_id');
 -- 590: data e hora de cada requisito, para a planilha comum da aba Andamento dos B/Ls.
 WHEN 'requirement_dates' THEN
   IF jsonb_typeof(p_payload->'bl_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'bl_ids')>500 THEN
     RAISE EXCEPTION 'Seleção inválida' USING ERRCODE='22023';
   END IF;
   RETURN coalesce((SELECT jsonb_agg(d) FROM (SELECT DISTINCT x.bl FROM jsonb_array_elements_text(p_payload->'bl_ids') AS x(bl)) ids
     CROSS JOIN LATERAL ce_unlock_private.requirement_dates(ids.bl) AS d WHERE d IS NOT NULL),'[]'::jsonb);
 ELSE RAISE EXCEPTION 'Leitura inválida'; END CASE;
END $function$;

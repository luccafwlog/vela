-- 338: o aviso de correção do Desbloqueio de CE diz de qual documento é o
-- motivo (lote 6b dos e-mails, Frente A).
--
-- Problema:
--   `review_ce_unlock_document` (migrations `299`/`301`) chama
--   `ce_unlock_private.notify` com `p_text` = 'Procuração: <motivo>' ou
--   'Termo de devolução: <motivo>'. A `notify` vigente (`299`) montava
--   "Motivo: Procuração: <motivo>.", com dois rótulos seguidos, no sino do
--   Portal e no e-mail (`ce_unlock_email_outbox`).
--
-- Mudança:
--   Só a `notify` é redefinida (assinatura, segurança e grants iguais aos da
--   `299`). Quando o texto começa por "Procuração:" ou "Termo de devolução:",
--   o motivo sai como "Motivo (procuração): <texto>." ou
--   "Motivo (termo de devolução): <texto>."; outro texto segue como
--   "Motivo: <texto>.". O ponto final digitado continua sem se repetir. O
--   aviso de documentação validada não muda. Vale para a notificação do
--   Portal e para a fila de e-mail (mesmo texto).
--
-- Não reescreve nem apaga linhas: avisos já gravados ficam com o texto antigo.
--
-- Rollback: recriar a função com o corpo da migration `299`.

CREATE OR REPLACE FUNCTION ce_unlock_private.notify(p_request uuid, p_kind text, p_text text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r public.ce_unlock_requests; title text; msg text; reason text; doc text[]; BEGIN
 SELECT * INTO r FROM public.ce_unlock_requests WHERE id=p_request;
 IF r.id IS NULL THEN RETURN; END IF;
 IF p_kind='changes_requested' THEN
 title:='Desbloqueio de CE: correção solicitada';
 reason:=regexp_replace(coalesce(p_text,'não informado'),'[.[:space:]]+$','');
 doc:=regexp_match(reason,'^(Procuração|Termo de devolução):[[:space:]]*(.*)$');
 msg:='A solicitação '||r.protocol||' precisa de correção. '
   ||CASE WHEN doc IS NULL THEN 'Motivo: '||reason
          ELSE 'Motivo ('||lower(doc[1])||'): '||coalesce(nullif(doc[2],''),'não informado') END
   ||'. Reenvie os documentos pelo Portal.';
 ELSE
 title:='Desbloqueio de CE: documentação validada';
 msg:='A documentação da solicitação '||r.protocol||' foi validada. Prazo para o desbloqueio: até '||p_text||'. Consulte o Mercante para verificar o desbloqueio.';
 END IF;
 INSERT INTO public.portal_notifications(customer_id,type,title,message,link) VALUES(r.customer_id,'system',title,msg,'/portal/desbloqueio-ce?pedido='||r.id);
 INSERT INTO public.ce_unlock_email_outbox(customer_id,request_id,kind,subject,body) VALUES(r.customer_id,r.id,p_kind,title,msg);
END $function$;

REVOKE ALL ON FUNCTION ce_unlock_private.notify(uuid, text, text) FROM PUBLIC, anon, authenticated;

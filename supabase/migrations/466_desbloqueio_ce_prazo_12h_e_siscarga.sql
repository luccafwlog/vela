-- 466: prazo do Desbloqueio de CE às 12:00 do próximo dia útil e "Consulte o
-- SISCARGA" no aviso de documentação validada (reunião de testes de
-- 2026-10-26, decisões do dono de 2026-10-27;
-- docs/plans/2026-10-27-lote-da-reuniao-de-testes-de-26-10.md, bloco 1).
--
-- Problema:
--   1. `ce_unlock_private.sla_deadline` (161) dava 12:30 do próximo dia útil
--      quando os quatro requisitos se cumprem a partir das 12:00. O SLA com o
--      mercado é 12:00.
--   2. O aviso "documentação validada" (`ce_unlock_private.notify`, 338) manda
--      o cliente consultar "o Mercante"; o desbloqueio é conferido no SISCARGA.
--
-- Mudança:
--   1. `sla_deadline`: a janela da tarde vence às 12:00 do próximo dia útil.
--      Antes das 12:00 (inclusive antes das 8h) continua 17:00 do mesmo dia
--      útil; sábado e domingo continuam segunda às 12:00; sem feriados. A tela
--      (`src/services/ceUnlockSla.ts`) muda junto; o teste local-pg confere os
--      dois com os mesmos casos. Mantém `SET search_path = ''` da 320, que o
--      `CREATE OR REPLACE` apagaria se ficasse de fora.
--   2. `notify`: só a frase final do aviso de documentação validada muda;
--      assinatura, segurança e grants iguais aos da 338.
--
-- O prazo é calculado na leitura, não gravado: as solicitações abertas e a
-- medição das exportações passadas passam a usar 12:00. Nenhuma linha é
-- reescrita; avisos já gravados ficam com o texto antigo.
--
-- Rollback: recriar `sla_deadline` pela 161 (com o `search_path` da 320) e
-- `notify` pela 338.

CREATE OR REPLACE FUNCTION ce_unlock_private.sla_deadline(p_start timestamptz) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE l timestamp := p_start AT TIME ZONE 'America/Sao_Paulo'; d date := (p_start AT TIME ZONE 'America/Sao_Paulo')::date;
 dow integer := extract(isodow FROM (p_start AT TIME ZONE 'America/Sao_Paulo'))::integer; slot time := time '17:00';
BEGIN
 IF dow IN(6,7) THEN d:=d+(8-dow); slot:=time '12:00';
 ELSIF l::time>=time '12:00' THEN d:=d+CASE WHEN dow=5 THEN 3 ELSE 1 END; slot:=time '12:00'; END IF;
 RETURN (d+slot) AT TIME ZONE 'America/Sao_Paulo';
END $$;

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
 msg:='A documentação da solicitação '||r.protocol||' foi validada. Prazo para o desbloqueio: até '||p_text||'. Consulte o SISCARGA para verificar o desbloqueio.';
 END IF;
 INSERT INTO public.portal_notifications(customer_id,type,title,message,link) VALUES(r.customer_id,'system',title,msg,'/portal/desbloqueio-ce?pedido='||r.id);
 INSERT INTO public.ce_unlock_email_outbox(customer_id,request_id,kind,subject,body) VALUES(r.customer_id,r.id,p_kind,title,msg);
END $function$;

REVOKE ALL ON FUNCTION ce_unlock_private.notify(uuid, text, text) FROM PUBLIC, anon, authenticated;

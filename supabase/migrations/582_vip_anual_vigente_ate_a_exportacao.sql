-- 582: Desbloqueio de CE do Cliente VIP sem solicitação — o anual cobre o B/L
-- se estiver vigente em algum dia entre o pagamento e a entrega e a exportação
-- (decisão do dono de 2026-11-03, ADR 0119, decisão 2).
--
-- A 581 exigia o anual vigente no dia do último ato do Cliente (entrega do
-- original, baixa das Taxas Locais, pagamento da avulsa). O Cliente que vira
-- VIP, ou tem o anual aprovado, depois de já ter pago e entregue ficava de fora
-- e precisava de solicitação comum, com termo e procuração anexados. Agora o
-- intervalo vai desse dia até a exportação (antes dela, hoje): basta o termo e
-- a procuração anuais aprovados estarem vigentes num mesmo dia dentro dele. O
-- B/L pago e entregue em dezembro e exportado em janeiro continua coberto pelo
-- anual de dezembro, como na 581.
--
-- `ce_unlock_private.annuals_between` acha o par mais recente de anuais
-- aprovados, de ano inteiro, com um dia em comum dentro do intervalo.
-- `ce_unlock_private.item` (581) passa a usá-lo no lugar de `annual_on`, no
-- lugar (`pg_get_functiondef` + `replace`, como a 578 e a 579). O prazo já
-- conta a aprovação dos anuais e a validação, então o B/L coberto por um anual
-- aprovado depois do pagamento ganha prazo a partir da aprovação (ou da
-- validação, na varredura de 5 minutos).
--
-- Plano de preservação: a migration não reescreve nem apaga linha existente:
-- cria uma função e redefine `ce_unlock_private.item`. Conferir:
-- `SELECT ce_unlock_private.item(id) FROM bls WHERE ...` antes e depois para os
-- B/Ls VIP sem solicitação. Desfazer: reaplicar `ce_unlock_private.item` pela
-- 581 e remover `ce_unlock_private.annuals_between`.

CREATE OR REPLACE FUNCTION ce_unlock_private.annuals_between(p_customer bigint, p_from date, p_to date, OUT termo uuid, OUT procuracao uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 -- Mesma condição de `annual_on` (aprovado, de ano inteiro), com um dia em
 -- comum entre os dois anuais e o intervalo [p_from, p_to].
 SELECT t.id, p.id
 FROM public.ce_unlock_documents t
 JOIN public.ce_unlock_documents p ON p.customer_id=t.customer_id AND p.type='procuracao' AND p.source='vip_annual' AND p.status='approved'
   AND p.valid_until=make_date(p.coverage_year,12,31)
 WHERE t.customer_id=p_customer AND t.type='termo' AND t.source='vip_annual' AND t.status='approved'
   AND t.valid_until=make_date(t.coverage_year,12,31)
   AND greatest(t.valid_from,p.valid_from,p_from) <= least(t.valid_until,p.valid_until,greatest(p_to,p_from))
 ORDER BY greatest(t.created_at,p.created_at) DESC,t.created_at DESC,p.created_at DESC,t.id,p.id
 LIMIT 1
$function$;
REVOKE ALL ON FUNCTION ce_unlock_private.annuals_between(bigint, date, date) FROM PUBLIC, anon, authenticated;

DO $patch$
DECLARE
  v_old text := $s$ vt:=ce_unlock_private.annual_on(b.customer_id,'termo',vday); vp:=ce_unlock_private.annual_on(b.customer_id,'procuracao',vday);
$s$;
  v_new text := $s$ -- 582: basta os dois anuais vigentes num mesmo dia entre esse dia e a exportação (antes dela, hoje).
 SELECT a.termo,a.procuracao INTO vt,vp FROM ce_unlock_private.annuals_between(b.customer_id,vday,
   coalesce((dx.exported_at AT TIME ZONE 'America/Sao_Paulo')::date,ce_unlock_private.today())) a;
$s$;
  v_def text := pg_get_functiondef('ce_unlock_private.item(text,uuid)'::regprocedure);
BEGIN
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION '582: cobertura VIP não encontrada uma única vez em ce_unlock_private.item';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch$;

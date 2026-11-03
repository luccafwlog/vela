-- 579: Andamento dos B/Ls mostra o termo e a procuração do Cliente VIP como
-- cobertos pelo anual também quando o B/L está num rascunho VIP (decisão do
-- dono de 2026-11-03, na revisão da PR 1191).
--
-- A 576 mostrava "coberto pelo anual VIP" só no B/L sem solicitação. Ao abrir o
-- rascunho, o B/L passava a "pendente" (o rascunho VIP ainda não aponta os
-- anuais; eles entram no envio) e voltava a "atendido" depois do envio. Agora o
-- rascunho VIP (`source = 'vip_annual'`, que só nasce quando os dois anuais
-- cobrem todos os B/Ls) usa a mesma regra do B/L sem solicitação:
-- `vip_covered`. O rascunho comum (`source = 'request'`) continua exigindo
-- termo e procuração anexados a ele, porque é isso que o envio vai pedir; a
-- solicitação cancelada segue igual.
--
-- Só exibição: rascunho não é exportado nem conta prazo (`can_export` e o prazo
-- exigem solicitação enviada) e `refresh_completion` ignora rascunho.
--
-- Ajusta `ce_unlock_private.item` no lugar (`pg_get_functiondef` + `replace`,
-- como a 454, a 577 e a 578): uma cláusula, sem sobrescrever o resto.
-- Não reescreve nem apaga linhas.
-- Rollback: reaplicar `ce_unlock_private.item` pela 576.

DO $patch$
DECLARE
  v_old text := $s$ ELSIF r.source='vip_annual' THEN
$s$;
  v_new text := $s$ -- 579: rascunho VIP segue a regra do B/L sem solicitação (os anuais entram no envio).
 ELSIF r.source='vip_annual' AND r.state='draft' THEN td:=vip_covered; pd:=vip_covered;
 ELSIF r.source='vip_annual' THEN
$s$;
  v_def text := pg_get_functiondef('ce_unlock_private.item(text,uuid)'::regprocedure);
BEGIN
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION '579: ramo do VIP não encontrado uma única vez em ce_unlock_private.item';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch$;

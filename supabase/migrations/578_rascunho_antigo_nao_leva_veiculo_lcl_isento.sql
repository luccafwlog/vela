-- 578: o envio de um rascunho antigo não leva o veículo LCL isento para a
-- solicitação (revisão da PR 1191, release de 2026-11-03).
--
-- A 575 recusa o B/L dispensado de solicitação (veículo LCL com Taxas Locais
-- isentas) ao criar o rascunho, e trata rascunho e solicitação cancelada como
-- fora do caminho do B/L: o desk registra a entrega do original e exporta o
-- B/L direto, guardando o envio em `ce_unlock_direct_exports`. O envio
-- (`submit`) não repetia a recusa. Um rascunho criado antes de o B/L virar
-- dispensado (rascunho de antes da 575, ou Movement To/isenção que mudou
-- depois) podia ser enviado com ele: a solicitação enviada passava a ser o
-- caminho do B/L, o envio direto deixava de contar e o B/L já mandado à ZPT
-- voltava a "Não exportado", apto para ser exportado de novo.
--
-- Agora o envio de um rascunho recusa o B/L dispensado com a mesma explicação
-- da 575 e diz o que fazer (cancelar o rascunho e pedir os demais em outro).
-- Solicitação que já foi enviada (inclusive devolvida para ajuste) continua
-- sendo o caminho do B/L, como na 575.
--
-- Ajusta `ce_unlock_private.command` no lugar (`pg_get_functiondef` +
-- `replace`, como a 454 e a 577): uma cláusula, sem sobrescrever o resto.
-- Não reescreve nem apaga linhas.
-- Rollback: reaplicar `ce_unlock_private.command` pela 575.

DO $patch$
DECLARE
  v_old text := $s$ item:=ce_unlock_private.item(bid,r.id);
$s$;
  v_new text := $s$ item:=ce_unlock_private.item(bid,r.id);
 -- 578: rascunho antigo não leva o veículo LCL isento (a 575 o recusa ao rascunhar).
 IF r.state='draft' AND coalesce((item->>'documents_dispensed')::boolean,false) THEN RAISE EXCEPTION 'B/L % não precisa de solicitação: veículo LCL com Taxas Locais isentas é desbloqueado só com a entrega do B/L original na agência. Cancele este rascunho e peça os demais B/Ls em outro.',bid; END IF;
$s$;
  v_def text := pg_get_functiondef('ce_unlock_private.command(text,jsonb,boolean)'::regprocedure);
BEGIN
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION '578: cláusula do envio não encontrada uma única vez em ce_unlock_private.command';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch$;

-- 459: a Régua de Cobrança volta a sair só pela rotina de 5 minutos.
--
-- Decisão do dono de 2026-10-25 (ADR 0103, revisão da PR da 458): a 458 fazia
-- a emissão da Invoice de Demurrage chamar `demurrage-dunning` na hora (gatilhos
-- em `demurrage_invoices`, intervalo de 60 s, só com a janela aberta). A
-- emissão quase sempre vem da fila de efeitos de importação
-- (`demurrage_billing`, `import-effects-runner`), que emite as Invoices de uma
-- planilha de devoluções uma a uma, cada uma na sua transação. A primeira
-- chamava a rodada, que cobrava só o que já estava gravado naquele segundo; o
-- resto saía na rodada seguinte. Resultado: o mesmo Cliente recebia o lote em
-- dois e-mails, dividido ao acaso. Só com a rotina de 5 minutos
-- (`3-59/5 * * * *`, da 458, mantido), as Invoices do lote saem juntas, até
-- 5 min depois da emissão (antes da 458, até 1 h).
--
-- Mudanças:
--   1. Remove os gatilhos `trg_kick_demurrage_dunning_on_issue` e
--      `trg_kick_demurrage_dunning_on_first_billing` e a função
--      `_kick_demurrage_dunning_trigger`.
--   2. Apaga a linha `demurrage-dunning` de `ops.edge_job_kicks` (operacional,
--      criada pela 458 no mesmo deploy, sem dado de negócio), para a consulta de
--      verificação listar só as rotinas que têm chamada pelo evento.
--
-- Data status: a única linha apagada é a do item 2, que não é dado de negócio.
-- O check de migrations destrutivas pede a declaração para todo DELETE; esta
-- migration cita a afirmação "Data status" do AGENTS.md por essa exigência, e
-- não dependeria dela se a afirmação fosse revogada.
--
-- Nota sobre o cabeçalho da 458: desde esta revisão, a chamada pelo evento
-- (`{"source":"trigger"}`) manda ao Better Stack só a falha (`/fail`), nunca
-- o sucesso, que continua só com a execução do cron
-- (`runCronWithBetterStackHeartbeat`, ADR 0103).
--
-- Rollback: reaplicar a seção 6 da 458 (função e os dois gatilhos) e
-- `INSERT INTO ops.edge_job_kicks (function) VALUES ('demurrage-dunning')
-- ON CONFLICT DO NOTHING`.

DROP TRIGGER IF EXISTS trg_kick_demurrage_dunning_on_issue ON public.demurrage_invoices;
DROP TRIGGER IF EXISTS trg_kick_demurrage_dunning_on_first_billing ON public.demurrage_invoices;
DROP FUNCTION IF EXISTS public._kick_demurrage_dunning_trigger();

DELETE FROM ops.edge_job_kicks WHERE function = 'demurrage-dunning';

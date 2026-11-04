-- 586: limpeza diária do histórico de execução do pg_cron (`cron.job_run_details`).
--
-- Contexto (produção, 2026-11-04): o disco do banco (~309 MB) inchou com
-- tabelas internas, não com dados do Vela. `cron.job_run_details` tinha ~182 mil
-- linhas (~47 MB) desde abr/2026 e não tinha limpeza: com quatro rotinas por
-- minuto, cresce sem parar. `net._http_response` (~200 MB) já é expurgada pelo
-- próprio pg_net (`pg_net.ttl` = 6 hours) e fica de fora; o espaço dela só
-- volta com o VACUUM FULL avulso descrito em docs/operations/servicos-externos.md,
-- que não roda dentro da transação de uma migration.
--
-- Mudança: agenda `cleanup-cron-run-details` às 06:45 UTC (03:45 de Brasília),
-- 15 minutos depois de `data-retention`, apagando execuções terminadas há mais
-- de 14 dias. 14 dias cobrem a maior janela que a documentação manda conferir
-- no histórico (`billing-release-expiry-review` parado por mais de 7 dias) com
-- folga de uma semana. Linhas sem `end_time` (execução em andamento ou
-- interrompida) ficam.
--
-- Idempotente: `cron.schedule(nome, ...)` do pg_cron atualiza o job do mesmo
-- nome e usuário em vez de criar outro (o shim local de setup-local-pg.sh faz o
-- mesmo); reaplicar só regrava horário e comando. Sem pg_cron, avisa e não
-- agenda. Não toca nos demais jobs, em `pg_net.ttl` nem em `run_retention()`.
--
-- Plano de preservação: a migration não lê nem altera linhas; agenda um job.
-- O job apaga, todo dia, só linhas de `cron.job_run_details` (registro interno
-- do pg_cron: jobid, horário, situação e mensagem de cada execução) com
-- `end_time` de mais de 14 dias. Nenhuma tabela de negócio (B/L, Viagem, Pix,
-- CE, Demurrage, Portal, `audit_logs`) nem Storage é tocada. São telemetria de
-- execução, sem valor de negócio; o resultado de cada rotina continua no próprio
-- efeito dela (Alertas, `audit_logs`, tabelas de fila).
-- Onde ficam os valores anteriores: em lugar nenhum, por decisão do dono. Em
-- 2026-11-04 o dono aceitou perder o acumulado (~182 mil linhas, desde
-- 2026-04-18) sem export, na revisão da PR desta migration; uma cópia dentro do
-- banco anularia o ganho de disco que motivou a limpeza. Daqui em diante, quem
-- precisar de uma execução antiga copia a linha antes do 14º dia.
-- Conferir no dia seguinte ao deploy:
--   SELECT status, return_message, start_time FROM cron.job_run_details
--    WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'cleanup-cron-run-details')
--    ORDER BY start_time DESC LIMIT 1;  -- succeeded
--   SELECT min(start_time) FROM cron.job_run_details;  -- ~ now() - 14 days
-- Desfazer (para a limpeza; o que já foi apagado não volta, perda aceita acima):
--   SELECT cron.unschedule('cleanup-cron-run-details');

DO $schedule_586$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE WARNING '586: pg_cron ausente; cleanup-cron-run-details não agendado.';
    RETURN;
  END IF;

  PERFORM cron.schedule(
    'cleanup-cron-run-details',
    '45 6 * * *',
    $job_586$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '14 days'$job_586$
  );
END;
$schedule_586$;

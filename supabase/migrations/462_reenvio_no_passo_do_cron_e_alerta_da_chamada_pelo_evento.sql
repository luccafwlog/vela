-- 462: o reenvio do aviso do Desbloqueio de CE segue o passo do cron de 5
-- minutos, e o alerta de rotina HTTP diz onde achar a chamada pelo evento
-- (revisão da PR de release luccafwlog/vela#1061, migration 458).
--
-- Problema:
--   1. A 458 reserva por 4 minutos a linha que volta para nova tentativa
--      (`ce_unlock_email_finish`), "para o reenvio seguir o passo do cron". O cron
--      roda nos minutos múltiplos de 5 e lê a fila 1 a 2 s depois. A falha numa
--      rodada do gatilho às 10:06:05 reservava a linha até 10:10:05; a rodada das
--      10:10 a encontrava reservada e o reenvio saía às 10:15, nove minutos depois.
--   2. Desde a 458, `net._http_response` também guarda as chamadas pelo evento
--      (`ops.kick_edge_job`), que o alerta `rotina_http_falhou` conta. A mensagem
--      ainda mandava procurar só em `cron.job_run_details`, onde essas chamadas
--      não aparecem.
--
-- Mudança (no lugar, `pg_get_functiondef` + `replace`, como as 450 e 454):
--   1. `ce_unlock_email_finish`: nova tentativa reservada por 3 minutos. A falha
--      até 2 minutos antes de uma rodada do cron é reenviada nela; a reserva
--      ainda impede que cada aviso novo na fila (gatilho) reenvie na hora.
--   2. `reconcile_http_job_failures_alert_core_425`: a mensagem cita as chamadas
--      pelo evento e `ops.edge_job_kicks.last_request_id`.
--
-- Só redefine funções; não reescreve nem apaga linhas. A mensagem dos alertas
-- já abertos muda na próxima rodada do detector (15 minutos), pelo upsert.
-- Rollback: reaplicar as duas funções como estavam depois da 459 (o
-- `pg_get_functiondef` delas antes desta migration).

DO $patch$
DECLARE
  v_patch record;
  v_def text;
BEGIN
  FOR v_patch IN
    SELECT * FROM (VALUES
      (
        'public.ce_unlock_email_finish(bigint,text,text[],text)'::regprocedure,
        $s$claimed_until = CASE WHEN p_status = 'pending' THEN now() + interval '4 minutes' END$s$,
        $s$claimed_until = CASE WHEN p_status = 'pending' THEN now() + interval '3 minutes' END$s$
      ),
      (
        'public.reconcile_http_job_failures_alert_core_425(interval)'::regprocedure,
        $s$chamada(s) das rotinas agendadas à Edge Function na última hora não terminaram com sucesso (%s)%s. Confira a rotina pelo horário em cron.job_run_details e o segredo dela no Vault e na Edge Function.$s$,
        $s$chamada(s) das rotinas à Edge Function (agendadas ou pelo evento) na última hora não terminaram com sucesso (%s)%s. Confira a rotina pelo horário em cron.job_run_details ou, na chamada pelo evento, pelo id do pedido em ops.edge_job_kicks (last_request_id), e o segredo dela no Vault e na Edge Function.$s$
      )
    ) AS p(fn, old_clause, new_clause)
  LOOP
    v_def := pg_get_functiondef(v_patch.fn);
    IF position(v_patch.old_clause IN v_def) = 0 THEN
      RAISE EXCEPTION '462: trecho não encontrado em %', v_patch.fn;
    END IF;
    IF position(v_patch.old_clause IN substr(v_def, position(v_patch.old_clause IN v_def) + 1)) > 0 THEN
      RAISE EXCEPTION '462: trecho repetido em %', v_patch.fn;
    END IF;
    EXECUTE replace(v_def, v_patch.old_clause, v_patch.new_clause);
  END LOOP;
END;
$patch$;

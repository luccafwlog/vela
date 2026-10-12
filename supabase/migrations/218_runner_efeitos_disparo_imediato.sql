-- Migration 218: a fila de efeitos de importação anda em segundos, não em
-- até 5 minutos.
--
-- Evidência (produção, 2026-10-12, primeira hora do `import-effects-runner`
-- ligado): 20 efeitos por ciclo a cada 5 min (240/h). Tempo por efeito medido
-- em `import_pending_effects.updated_at`: `local_billing` ~0,07 s; marcações
-- físicas mediana 0,1 s e pior caso 8,6 s (recalculam a Viagem inteira). Uma
-- importação de 600 B/Ls levaria ~2h30 para faturar.
--
-- Mudanças (a terceira, o orçamento de tempo por ciclo, está na Edge Function):
--   1. `ops.kick_import_effects_runner()` dispara o runner uma vez por
--      transação que grava efeito pendente. O pg_net só envia depois do
--      COMMIT, então o runner já enxerga os efeitos da importação. Sem o
--      segredo no Vault (Preview), não dispara nem avisa; falha no disparo
--      (pg_net fora do ar) vira WARNING. Nunca derruba a importação.
--   2. O job `import-effects-runner` passa de `3-59/5 * * * *` para
--      `* * * * *`: rede de segurança para retentativas, disparos perdidos e
--      efeitos com `next_attempt_at` futuro.
--
-- Dois runners simultâneos (disparo + job) não processam o mesmo efeito: o
-- claim reserva por lease (`claim_import_effects`, FOR UPDATE SKIP LOCKED).
-- ponytail: disparo sem debounce entre transações. Teto: muitas importações
-- pequenas simultâneas abrem uma chamada cada; as que não acharem efeito
-- livre terminam vazias. Caminho de upgrade: carimbo do último disparo em
-- `ops` e janela mínima entre disparos.
--
-- Não reescreve nem apaga linhas de negócio.
--
-- Rollback:
--   DROP TRIGGER trg_kick_import_effects_runner ON public.import_pending_effects;
--   DROP FUNCTION public._kick_import_effects_runner_trigger();
--   DROP FUNCTION ops.kick_import_effects_runner();
--   SELECT cron.alter_job(jobid, schedule := '3-59/5 * * * *') FROM cron.job WHERE jobname = 'import-effects-runner';

CREATE OR REPLACE FUNCTION ops.kick_import_effects_runner()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $kick$
BEGIN
  -- Uma chamada por transação: a importação grava muitos efeitos.
  IF current_setting('vela.import_effects_kicked', true) = 'on' THEN
    RETURN;
  END IF;
  PERFORM set_config('vela.import_effects_kicked', 'on', true);
  -- Sem o par no Vault (banco novo, Preview), o runner nem chega a ser
  -- chamável: pula em silêncio, sem o WARNING do dispatcher a cada importação.
  IF (SELECT count(*) FROM vault.decrypted_secrets
       WHERE name IN ('SUPABASE_URL', 'IMPORT_EFFECTS_CRON_SECRET')
         AND NULLIF(decrypted_secret, '') IS NOT NULL) < 2 THEN
    RETURN;
  END IF;
  BEGIN
    PERFORM ops.dispatch_edge_job('import-effects-runner', 'IMPORT_EFFECTS_CRON_SECRET');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'ops.kick_import_effects_runner: disparo falhou (%); o job de 1 min processa.', SQLERRM;
  END;
END;
$kick$;

COMMENT ON FUNCTION ops.kick_import_effects_runner() IS
  'Dispara o import-effects-runner uma vez por transação (pg_net envia após o COMMIT). Falha vira WARNING. Migration 218.';

REVOKE ALL ON FUNCTION ops.kick_import_effects_runner() FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.kick_import_effects_runner() FROM anon, authenticated;

-- O gatilho roda com o papel de quem importa; a função do gatilho (dona
-- postgres, SECURITY DEFINER) é a única ponte para o dispatcher.
CREATE OR REPLACE FUNCTION public._kick_import_effects_runner_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $kick_trg$
BEGIN
  PERFORM ops.kick_import_effects_runner();
  RETURN NULL;
END;
$kick_trg$;

REVOKE ALL ON FUNCTION public._kick_import_effects_runner_trigger() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._kick_import_effects_runner_trigger() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_kick_import_effects_runner ON public.import_pending_effects;
CREATE TRIGGER trg_kick_import_effects_runner
  AFTER INSERT ON public.import_pending_effects
  FOR EACH STATEMENT
  EXECUTE FUNCTION public._kick_import_effects_runner_trigger();

DO $schedule_218$
DECLARE
  v_jobid bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE WARNING '218: pg_cron ausente; agendamento do import-effects-runner não alterado.';
    RETURN;
  END IF;
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'import-effects-runner';
  IF v_jobid IS NULL THEN
    RAISE WARNING '218: job import-effects-runner ausente; nada a reagendar.';
    RETURN;
  END IF;
  PERFORM cron.alter_job(v_jobid, schedule := '* * * * *');
END;
$schedule_218$;

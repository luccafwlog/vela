-- Migration 218: a fila de efeitos de importação anda em segundos, não em
-- até 5 minutos.
--
-- Evidência (produção, 2026-10-12, primeira hora do `import-effects-runner`
-- ligado): 20 efeitos por ciclo a cada 5 min (240/h). Tempo por efeito medido
-- em `import_pending_effects.updated_at`: `local_billing` ~0,07 s; marcações
-- físicas mediana 0,1 s e pior caso 8,6 s (recalculam a Viagem inteira). Uma
-- importação de 600 B/Ls levaria ~2h30 para faturar.
--
-- Mudanças (a quarta, o orçamento de tempo por ciclo, está na Edge Function):
--   1. `ops.kick_import_effects_runner()` dispara o runner uma vez por
--      transação que grava efeito pendente (uma gravação que não insere linha,
--      como a duplicata suprimida pela 051, não dispara). O pg_net só envia depois do
--      COMMIT, então o runner já enxerga os efeitos da importação. Sem o
--      segredo no Vault (Preview), não dispara nem avisa; falha no disparo
--      (pg_net fora do ar) vira WARNING. Nunca derruba a importação.
--   2. O job `import-effects-runner` passa de `3-59/5 * * * *` para
--      `* * * * *`: rede de segurança para retentativas, disparos perdidos,
--      efeitos devolvidos à fila por UPDATE (reativar Viagem) e efeitos com
--      `next_attempt_at` futuro.
--   3. Vez única do runner (`ops.import_effects_runner_lease`): com job por
--      minuto e disparo por importação, dois runners podiam rodar juntos.
--      O claim já impedia processar o mesmo efeito duas vezes, mas efeitos da
--      mesma Viagem disputavam travas; impasse vira `retry_wait` e, na quinta
--      tentativa, `blocked` com Alerta crítico. Agora só um runner trabalha:
--      ele renova a vez antes de cada bloco, e a chamada que não a obtém sai
--      sem processar. A vez dura 120 s, acima do pior bloco medido (10
--      efeitos de ~9 s); se o runner morrer, ela vence sozinha.
-- ponytail: um runner por vez. Teto: ~25 s de trabalho por chamada, várias
-- chamadas por minuto só quando há disparos. Caminho de upgrade: vez por
-- Viagem em vez de global, com runners paralelos.
--
-- Não reescreve nem apaga linhas de negócio.
--
-- Rollback:
--   DROP TRIGGER trg_kick_import_effects_runner ON public.import_pending_effects;
--   DROP FUNCTION public.acquire_import_effects_runner(text, integer);
--   DROP FUNCTION public.release_import_effects_runner(text);
--   DROP TABLE ops.import_effects_runner_lease;
--   DROP FUNCTION public._kick_import_effects_runner_trigger();
--   DROP FUNCTION ops.kick_import_effects_runner();
--   SELECT cron.alter_job(jobid, schedule := '3-59/5 * * * *') FROM cron.job WHERE jobname = 'import-effects-runner';

-- ===========================================================================
-- 1. Vez única do runner
-- ===========================================================================

CREATE TABLE IF NOT EXISTS ops.import_effects_runner_lease (
  singleton   boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  holder      text,
  lease_until timestamptz
);
INSERT INTO ops.import_effects_runner_lease (singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;
REVOKE ALL ON TABLE ops.import_effects_runner_lease FROM PUBLIC, anon, authenticated, service_role;
-- RLS sem policy: só as funções abaixo (SECURITY DEFINER, donas da tabela)
-- leem e escrevem a vez.
ALTER TABLE ops.import_effects_runner_lease ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE ops.import_effects_runner_lease IS
  'Vez única do import-effects-runner (migration 218): um runner por vez, renovada antes de cada bloco.';

-- Obtém ou renova a vez. Verdadeiro quando quem chama fica com ela.
CREATE OR REPLACE FUNCTION public.acquire_import_effects_runner(p_worker_id text, p_lease_seconds integer DEFAULT 120)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $acquire$
DECLARE
  v_worker text := NULLIF(btrim(COALESCE(p_worker_id, '')), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF v_worker IS NULL OR char_length(v_worker) > 128 THEN
    RAISE EXCEPTION 'Worker invalido.' USING ERRCODE = '22023';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 600 THEN
    RAISE EXCEPTION 'Lease invalido.' USING ERRCODE = '22023';
  END IF;

  UPDATE ops.import_effects_runner_lease
     SET holder = v_worker,
         lease_until = now() + make_interval(secs => p_lease_seconds)
   WHERE singleton
     AND (holder = v_worker OR lease_until IS NULL OR lease_until <= now());
  RETURN FOUND;
END;
$acquire$;

-- Devolve a vez; só quem a tem pode devolver.
CREATE OR REPLACE FUNCTION public.release_import_effects_runner(p_worker_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $release$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  UPDATE ops.import_effects_runner_lease
     SET holder = NULL, lease_until = NULL
   WHERE singleton AND holder = p_worker_id;
END;
$release$;

REVOKE ALL ON FUNCTION public.acquire_import_effects_runner(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_import_effects_runner(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_import_effects_runner(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_import_effects_runner(text) TO service_role;

-- ===========================================================================
-- 2. Disparo pela transação que grava efeito
-- ===========================================================================

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
-- postgres, SECURITY DEFINER) é a única ponte para o dispatcher. Só dispara
-- quando a instrução inseriu efeito a processar: o gatilho BEFORE da 051
-- suprime duplicatas, e a instrução termina sem linha.
CREATE OR REPLACE FUNCTION public._kick_import_effects_runner_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $kick_trg$
BEGIN
  IF EXISTS (SELECT 1 FROM new_effects WHERE status IN ('pending', 'retry_wait')) THEN
    PERFORM ops.kick_import_effects_runner();
  END IF;
  RETURN NULL;
END;
$kick_trg$;

REVOKE ALL ON FUNCTION public._kick_import_effects_runner_trigger() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._kick_import_effects_runner_trigger() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_kick_import_effects_runner ON public.import_pending_effects;
CREATE TRIGGER trg_kick_import_effects_runner
  AFTER INSERT ON public.import_pending_effects
  REFERENCING NEW TABLE AS new_effects
  FOR EACH STATEMENT
  EXECUTE FUNCTION public._kick_import_effects_runner_trigger();

-- ===========================================================================
-- 3. Job de rede de segurança a cada minuto
-- ===========================================================================

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

-- 429: um segredo por rotina nos disparos do banco (auditoria de segurança
-- run-3, decisão do dono em 2026-10-22).
--
-- `ITAU_PIX_ADMIN_SECRET` servia ao cron da fila Itaú, ao disparo imediato
-- (`ops.kick_itau_pix_runner`) e ao diagnóstico manual da equipe técnica;
-- `CE_UNLOCK_CLEANUP_SECRET` servia ao expurgo e aos avisos do Desbloqueio de
-- CE. Quem tivesse um podia acionar a outra rotina. Os novos segredos são
-- `ITAU_PIX_CRON_SECRET` (rotina Itaú), `ITAU_PIX_DIAGNOSTIC_SECRET`
-- (diagnóstico, só na Edge) e `CE_UNLOCK_NOTIFY_SECRET` (avisos).
--
-- `ops.preferred_vault_secret(próprio, compartilhado)` devolve o nome do
-- próprio quando ele está no Vault e o compartilhado enquanto não está. O job
-- `itau-pix-queue`, o disparo imediato e, se existir, o job
-- `ce-unlock-notify-email` (agendado à mão em produção, jobid 23) passam a
-- usá-la. Assim a troca não depende de outra migration: o dono cadastra o
-- segredo novo na Edge e depois no Vault (ordem em
-- docs/operations/segredos-cron.md).
--
-- Só redefine funções e reagenda jobs com o mesmo nome e horário; não
-- reescreve nem apaga linhas de dados.
-- Rollback: reagendar os jobs com os nomes fixos antigos e reaplicar
-- `ops.kick_itau_pix_runner` da 219.

CREATE OR REPLACE FUNCTION ops.preferred_vault_secret(p_own text, p_shared text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $preferred$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = p_own AND NULLIF(decrypted_secret, '') IS NOT NULL)
      THEN p_own
    ELSE p_shared
  END
$preferred$;

COMMENT ON FUNCTION ops.preferred_vault_secret(text, text) IS
  'Nome do segredo próprio da rotina quando está no Vault; senão o compartilhado antigo. Migration 429.';

REVOKE ALL ON FUNCTION ops.preferred_vault_secret(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION ops.kick_itau_pix_runner()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $kick$
DECLARE
  v_base   text;
  v_secret text;
BEGIN
  -- Uma chamada por transação: uma emissão em lote mexe em várias cobranças.
  IF current_setting('vela.itau_pix_kicked', true) = 'on' THEN
    RETURN;
  END IF;
  PERFORM set_config('vela.itau_pix_kicked', 'on', true);

  SELECT decrypted_secret INTO v_base FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL';
  -- 429: o segredo próprio da rotina, quando cadastrado; senão o antigo.
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets
   WHERE name = ops.preferred_vault_secret('ITAU_PIX_CRON_SECRET', 'ITAU_PIX_ADMIN_SECRET');
  -- Sem o par no Vault (banco novo, Preview): pula em silêncio.
  IF NULLIF(v_base, '') IS NULL OR NULLIF(v_secret, '') IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    -- 30 s, como o dispatcher da 165. O pg_net envia após o COMMIT.
    PERFORM net.http_post(
      url                  := v_base || '/functions/v1/itau-pix',
      headers              := jsonb_build_object('Authorization', 'Bearer ' || v_secret,
                                                 'Content-Type', 'application/json'),
      body                 := '{"action":"process_charges"}'::jsonb,
      timeout_milliseconds := 30000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'ops.kick_itau_pix_runner: disparo falhou (%); o job de 1 min processa.', SQLERRM;
  END;
END;
$kick$;

COMMENT ON FUNCTION ops.kick_itau_pix_runner() IS
  'Dispara a fila da função itau-pix uma vez por transação (pg_net envia após o COMMIT). Falha vira WARNING. Migrations 219 e 429 (segredo próprio da rotina).';

REVOKE ALL ON FUNCTION ops.kick_itau_pix_runner() FROM PUBLIC, anon, authenticated;

DO $schedule_429$
DECLARE
  v_schedule text;
BEGIN
  IF to_regclass('cron.job') IS NULL OR to_regprocedure('ops.dispatch_edge_job(text,text,text,text)') IS NULL THEN
    RAISE WARNING '429: pg_cron ou ops.dispatch_edge_job ausente; agende itau-pix-queue com ops.preferred_vault_secret no ambiente de produção.';
    RETURN;
  END IF;
  SELECT schedule INTO v_schedule FROM cron.job WHERE jobname = 'itau-pix-queue';
  IF FOUND THEN
    PERFORM cron.unschedule('itau-pix-queue');
  END IF;
  PERFORM cron.schedule('itau-pix-queue', coalesce(v_schedule, '* * * * *'),
    $job_429a$SELECT ops.dispatch_edge_job('itau-pix', ops.preferred_vault_secret('ITAU_PIX_CRON_SECRET', 'ITAU_PIX_ADMIN_SECRET'));$job_429a$);

  -- O job dos avisos do Desbloqueio de CE foi criado à mão; só é reagendado se existir.
  SELECT schedule INTO v_schedule FROM cron.job WHERE jobname = 'ce-unlock-notify-email';
  IF FOUND THEN
    PERFORM cron.unschedule('ce-unlock-notify-email');
    PERFORM cron.schedule('ce-unlock-notify-email', v_schedule,
      $job_429b$SELECT ops.dispatch_edge_job('ce-unlock-notify-email', ops.preferred_vault_secret('CE_UNLOCK_NOTIFY_SECRET', 'CE_UNLOCK_CLEANUP_SECRET'), 'Authorization', 'Bearer ');$job_429b$);
  END IF;
END;
$schedule_429$;

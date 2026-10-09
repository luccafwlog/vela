-- Migration 165: os jobs HTTP do pg_cron deixam de perder a rodada nos horários
-- cheios.
--
-- Evidência (produção, 2026-10-08, `net._http_response`): respostas com
-- `status_code` nulo, `timed_out = true` e "Timeout of 5000 ms reached" às
-- :00/:15/:30/:45, quando alerts-foundation-detectors e
-- customer-communication-auto-runner (15 min), demurrage-dunning (hora),
-- ce-unlock-notify-email (5 min), portal-email-events-runner e itau-pix-queue
-- (minuto) disparam juntos. Na maioria, ~5000 ms foram gastos em DNS; em
-- algumas, o DNS foi rápido e a própria Function passou de 5 s.
--
-- Causa: `ops.dispatch_edge_job` (007) chamava `net.http_post` sem
-- `timeout_milliseconds`, então valia o padrão de 5000 ms do pg_net — e esse
-- orçamento inclui a resolução de nome. Uma consulta DNS que não volta na
-- primeira tentativa só é refeita pelo resolvedor depois de ~5 s; com 5 s de
-- orçamento total, a requisição morre exatamente quando a nova tentativa
-- responderia. Rajadas simultâneas tornam essa perda mais provável. Sem retry,
-- a rodada só volta no próximo ciclo (uma hora para a Régua de Cobrança).
-- (O mecanismo interno do DNS é inferido do padrão "DNS time ~5000 ms"; a
-- plataforma não expõe o resolvedor do worker do pg_net.)
--
-- Correção, em duas partes:
--   1. o dispatcher passa `timeout_milliseconds := 30000`. Cobre a segunda
--      tentativa de DNS e as Functions lentas, e vale para todo job que chama
--      o dispatcher, inclusive os agendados manualmente (itau-pix-queue,
--      ce-unlock-*, recalc-demurrage-ptax). Assinatura, SECURITY INVOKER,
--      search_path e ACL ficam iguais;
--   2. os jobs que as migrations criam e que caíam nos minutos cheios saem
--      deles, cada um num minuto próprio:
--        alerts-foundation-detectors        :02/:17/:32/:47
--        import-effects-runner              :03/:08/.../:58 (a cada 5 min)
--        customer-communication-auto-runner :04/:19/:34/:49
--        demurrage-dunning                  :07 de cada hora
--      `cron.alter_job` muda só o horário: preserva jobid, comando e o estado
--      ativo/pausado de cada job. portal-daily-digest (11:00 UTC, horário
--      combinado com o cliente) e os jobs por minuto não mudam.
--
-- Não reescreve nem apaga linhas de negócio; só redefine a função e o horário
-- de jobs do pg_cron.
--
-- Rollback: reaplicar a função da 007 (sem timeout_milliseconds) e
--   SELECT cron.alter_job(jobid, schedule := '*/15 * * * *') FROM cron.job
--    WHERE jobname IN ('alerts-foundation-detectors', 'customer-communication-auto-runner');
--   SELECT cron.alter_job(jobid, schedule := '0 * * * *')   FROM cron.job WHERE jobname = 'demurrage-dunning';
--   SELECT cron.alter_job(jobid, schedule := '*/5 * * * *') FROM cron.job WHERE jobname = 'import-effects-runner';

-- ===========================================================================
-- 1. Dispatcher com orçamento de tempo explícito
-- ===========================================================================
-- ponytail: um timeout fixo e nenhum retry. Teto: uma falha que dure mais de
-- 30 s (DNS fora do ar, Function travada) ainda perde a rodada até o próximo
-- ciclo. Caminho de upgrade: um job de reconciliação que leia
-- `net._http_response` (timed_out/5xx) e redispare uma vez, no padrão
-- `request_tracker` do README do pg_net.

CREATE OR REPLACE FUNCTION ops.dispatch_edge_job(
  p_function      text,
  p_secret_name   text,
  p_header_name   text DEFAULT 'Authorization',
  p_header_prefix text DEFAULT 'Bearer '
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $dispatch_edge_job$
DECLARE
  v_base   text;
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_base
    FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL';
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = p_secret_name;

  -- Banco novo / branch de Preview nasce com o Vault vazio. Avisar e nao
  -- disparar e melhor do que um POST para host invalido a cada ciclo.
  IF NULLIF(v_base, '') IS NULL OR NULLIF(v_secret, '') IS NULL THEN
    RAISE WARNING 'ops.dispatch_edge_job: Vault sem SUPABASE_URL e/ou %; job % nao disparado.',
      p_secret_name, p_function;
    RETURN NULL;
  END IF;

  -- 30 s: o padrão do pg_net (5 s) inclui DNS e acabava antes da segunda
  -- tentativa do resolvedor nos minutos de rajada (migration 165).
  RETURN net.http_post(
    url                  := v_base || '/functions/v1/' || p_function,
    headers              := jsonb_build_object(
                              p_header_name, p_header_prefix || v_secret,
                              'Content-Type', 'application/json'
                            ),
    body                 := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
END;
$dispatch_edge_job$;

COMMENT ON FUNCTION ops.dispatch_edge_job(text, text, text, text) IS
  'Dispara uma Edge Function pelo pg_net (timeout de 30 s) lendo base e segredo do Vault. Chamada pelos jobs pg_cron, que rodam como postgres. SECURITY INVOKER: nao concede alcance ao Vault a quem nao tem.';

REVOKE ALL ON FUNCTION ops.dispatch_edge_job(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.dispatch_edge_job(text, text, text, text) FROM anon, authenticated;

-- ===========================================================================
-- 2. Escalonamento dos jobs que as migrations criam
-- ===========================================================================

DO $stagger_165$
DECLARE
  r       RECORD;
  v_jobid bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE WARNING '165: pg_cron ausente; escalonamento dos jobs nao aplicado.';
    RETURN;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('alerts-foundation-detectors',        '2-59/15 * * * *'),
      ('import-effects-runner',              '3-59/5 * * * *'),
      ('customer-communication-auto-runner', '4-59/15 * * * *'),
      ('demurrage-dunning',                  '7 * * * *')
    ) AS t(jobname, schedule)
  LOOP
    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = r.jobname;
    IF v_jobid IS NULL THEN
      RAISE WARNING '165: job % ausente; nada a escalonar.', r.jobname;
      CONTINUE;
    END IF;
    PERFORM cron.alter_job(v_jobid, schedule := r.schedule);
  END LOOP;
END;
$stagger_165$;

import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 218: gravar efeito pendente dispara o import-effects-runner uma
// vez por transação (o pg_net envia após o COMMIT), e o job de rede de
// segurança passa a rodar a cada minuto. Falha no disparo nunca derruba a
// importação.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl], {
    input: sql,
    encoding: 'utf8',
  }).trim()
}

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_kick_import_effects_runner';`) === '1'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migrationApplied')

const captureHttpPost = `
  CREATE TEMP TABLE captured_post (url text) ON COMMIT DROP;
  CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
  RETURNS bigint LANGUAGE plpgsql AS $f$
  BEGIN
    INSERT INTO pg_temp.captured_post VALUES (url);
    RETURN 1;
  END $f$;
`

const insertEffect = (entity: string) => `
  INSERT INTO public.import_pending_effects (source_action_id, effect_kind, entity_id)
  VALUES (gen_random_uuid(), 'local_billing', '${entity}');
`

describeLocal('218 — runner de efeitos disparado pela importação', () => {
  it('dispara uma única vez por transação, mesmo com vários efeitos gravados', () => {
    const out = psql(`
      BEGIN;
      ${captureHttpPost}
      DELETE FROM vault.secrets WHERE name IN ('SUPABASE_URL', 'IMPORT_EFFECTS_CRON_SECRET');
      SELECT vault.create_secret('https://exemplo.supabase.co', 'SUPABASE_URL', '');
      SELECT vault.create_secret('segredo-218', 'IMPORT_EFFECTS_CRON_SECRET', '');
      ${insertEffect('A218-KICK1')}
      ${insertEffect('A218-KICK2')}
      ${insertEffect('A218-KICK3')}
      SELECT count(*) || '|' || min(url) FROM pg_temp.captured_post;
      ROLLBACK;
    `)
    expect(out.split('\n').at(-1)).toBe('1|https://exemplo.supabase.co/functions/v1/import-effects-runner')
  })

  it('gravação que não insere efeito não dispara', () => {
    const out = psql(`
      BEGIN;
      ${captureHttpPost}
      DELETE FROM vault.secrets WHERE name IN ('SUPABASE_URL', 'IMPORT_EFFECTS_CRON_SECRET');
      SELECT vault.create_secret('https://exemplo.supabase.co', 'SUPABASE_URL', '');
      SELECT vault.create_secret('segredo-218', 'IMPORT_EFFECTS_CRON_SECRET', '');
      INSERT INTO public.import_pending_effects (source_action_id, effect_kind, entity_id)
      SELECT gen_random_uuid(), 'local_billing', 'A218-NADA' WHERE false;
      SELECT count(*) FROM pg_temp.captured_post;
      ROLLBACK;
    `)
    expect(out.split('\n').at(-1)).toBe('0')
  })

  it('um runner por vez: a vez é renovada por quem a tem, recusada a outro e devolvida', () => {
    const out = psql(`
      BEGIN;
      SET LOCAL request.jwt.claim.role = 'service_role';
      UPDATE ops.import_effects_runner_lease SET holder = NULL, lease_until = NULL;
      SELECT public.acquire_import_effects_runner('runner-a', 120)
        || '|' || public.acquire_import_effects_runner('runner-b', 120)
        || '|' || public.acquire_import_effects_runner('runner-a', 120);
      SELECT public.release_import_effects_runner('runner-b');
      SELECT public.acquire_import_effects_runner('runner-b', 120)::text;
      SELECT public.release_import_effects_runner('runner-a');
      SELECT public.acquire_import_effects_runner('runner-b', 120)::text;
      UPDATE ops.import_effects_runner_lease SET lease_until = now() - interval '1 second';
      SELECT public.acquire_import_effects_runner('runner-c', 120)::text;
      ROLLBACK;
    `)
    // a obtém e renova; b é recusado; b não devolve a vez de a; depois que a
    // devolve, b a obtém; vencida, c a obtém.
    expect(out.split('\n').filter((line) => line !== '')).toEqual(['true|false|true', 'false', 'true', 'true'])
  })

  it('a vez do runner é só do servidor', () => {
    const out = execFileSync('psql', ['-X', '-At', '-q', '-d', databaseUrl], {
      input: `
        BEGIN;
        SET LOCAL request.jwt.claim.role = 'authenticated';
        SELECT public.acquire_import_effects_runner('intruso', 120);
        ROLLBACK;
      `,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    expect(out).not.toContain('t')
  })

  it('falha no disparo vira aviso e o efeito continua gravado', () => {
    const out = psql(`
      BEGIN;
      CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
      RETURNS bigint LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'pg_net fora do ar'; END $f$;
      DELETE FROM vault.secrets WHERE name IN ('SUPABASE_URL', 'IMPORT_EFFECTS_CRON_SECRET');
      SELECT vault.create_secret('https://exemplo.supabase.co', 'SUPABASE_URL', '');
      SELECT vault.create_secret('segredo-218', 'IMPORT_EFFECTS_CRON_SECRET', '');
      ${insertEffect('A218-FAIL1')}
      SELECT count(*) FROM public.import_pending_effects WHERE entity_id = 'A218-FAIL1' AND status = 'pending';
      ROLLBACK;
    `)
    expect(out.split('\n').at(-1)).toBe('1')
  })

  it('sem o segredo no Vault (Preview), não dispara nem avisa', () => {
    const out = execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl], {
      input: `
        BEGIN;
        ${captureHttpPost}
        DELETE FROM vault.secrets WHERE name = 'IMPORT_EFFECTS_CRON_SECRET';
        ${insertEffect('A218-SEM1')}
        SELECT count(*) FROM pg_temp.captured_post;
        ROLLBACK;
      `,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    expect(out.trim().split('\n').at(-1)).toBe('0')
  })

  it('o job de rede de segurança roda a cada minuto, com o mesmo comando', () => {
    const job = psql(`
      SELECT schedule || '|' || active || '|' || command
        FROM cron.job WHERE jobname = 'import-effects-runner';
    `)
    expect(job).toBe(
      "* * * * *|true|SELECT ops.dispatch_edge_job('import-effects-runner', 'IMPORT_EFFECTS_CRON_SECRET');",
    )
  })

  it('quem importa não alcança o dispatcher diretamente', () => {
    const grants = psql(`
      SELECT has_function_privilege('authenticated', 'ops.kick_import_effects_runner()', 'EXECUTE')
          || '|' || has_function_privilege('authenticated', 'public._kick_import_effects_runner_trigger()', 'EXECUTE')
          || '|' || has_function_privilege('authenticated', 'public.acquire_import_effects_runner(text, integer)', 'EXECUTE')
          || '|' || has_function_privilege('anon', 'public.release_import_effects_runner(text)', 'EXECUTE');
    `)
    expect(grants).toBe('false|false|false|false')
  })
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { appliedCheckConfig, changesMigrations, decide, migrationVersions, main, missingVersions, needsAppliedCheck } from './wait-supabase-migrations.mjs'

const run = (id, status, conclusion, slug = 'supabase') => ({ id, status, conclusion, app: { slug }, output: { title: null } })

test('check verde publica', () => {
  assert.equal(decide({ checkRuns: [run(1, 'completed', 'success')], migrationsChanged: true, timedOut: false }).action, 'publish')
})

test('check vermelho, cancelado ou estourado recusa', () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'action_required']) {
    assert.equal(decide({ checkRuns: [run(1, 'completed', conclusion)], migrationsChanged: false, timedOut: false }).action, 'fail')
  }
})

test('check pulado sem conferência das migrations aplicadas publica só sem migration no push', () => {
  const checkRuns = [run(1, 'completed', 'skipped')]
  assert.equal(decide({ checkRuns, migrationsChanged: false, timedOut: false }).action, 'publish')
  const refused = decide({ checkRuns, migrationsChanged: true, timedOut: false })
  assert.equal(refused.action, 'fail')
  assert.match(refused.message, /workflow_dispatch/)
})

test('sem check espera e, no prazo, decide pelas migrations', () => {
  assert.equal(decide({ checkRuns: [], migrationsChanged: true, timedOut: false }).action, 'wait')
  assert.equal(decide({ checkRuns: [], migrationsChanged: false, timedOut: true }).action, 'publish')
  assert.equal(decide({ checkRuns: [], migrationsChanged: true, timedOut: true }).action, 'fail')
  assert.equal(decide({ checkRuns: [run(1, 'in_progress', null)], migrationsChanged: true, timedOut: false }).action, 'wait')
})

test('ignora checks de outros apps e usa o mais recente do Supabase', () => {
  const checkRuns = [run(9, 'completed', 'failure', 'github-actions'), run(2, 'completed', 'failure'), run(3, 'completed', 'success')]
  assert.equal(decide({ checkRuns, migrationsChanged: true, timedOut: false }).action, 'publish')
})

test('migration no diff, ou diff truncado, conta como mudança', () => {
  assert.equal(changesMigrations(['supabase/migrations/221_x.sql'], false), true)
  assert.equal(changesMigrations(['supabase/functions/_shared/email.ts', 'src/App.tsx'], false), false)
  assert.equal(changesMigrations([], true), true)
})

const STAGING_REF = 'uvgqfpleiyfythkhutlj'
const pr988 = ['333', '334', '335', '336']
const file = (filename, status = 'added') => ({ filename, status })

test('push da #988: check pulado e as quatro migrations aplicadas publica e lista as versões', () => {
  for (const conclusion of ['skipped', 'neutral']) {
    const decision = decide({
      checkRuns: [run(1, 'completed', conclusion)],
      migrationsChanged: true,
      timedOut: false,
      applied: { status: 'checked', versions: pr988, missing: [] },
    })
    assert.equal(decision.action, 'publish')
    assert.match(decision.message, /333, 334, 335, 336/)
  }
})

test('check pulado com migration faltando espera e, no prazo, recusa dizendo qual falta', () => {
  const input = { checkRuns: [run(1, 'completed', 'skipped')], migrationsChanged: true, applied: { status: 'checked', versions: pr988, missing: ['336'] } }
  assert.equal(decide({ ...input, timedOut: false }).action, 'wait')
  const refused = decide({ ...input, timedOut: true })
  assert.equal(refused.action, 'fail')
  assert.match(refused.message, /faltam .* 336/)
})

test('check pulado sem token ou ref recusa como hoje e diz que a conferência está desligada', () => {
  const applied = appliedCheckConfig({ SUPABASE_PROJECT_REF: STAGING_REF }, pr988)
  assert.equal(applied.status, 'unavailable')
  assert.equal(appliedCheckConfig({ SUPABASE_ACCESS_TOKEN: 'sbp_x' }, pr988).status, 'unavailable')
  const refused = decide({ checkRuns: [run(1, 'completed', 'skipped')], migrationsChanged: true, timedOut: false, applied })
  assert.equal(refused.action, 'fail')
  assert.match(refused.message, /workflow_dispatch/)
  assert.match(refused.message, /SUPABASE_STAGING_ACCESS_TOKEN/)
})

test('ref de produção é recusado de cara e o token nunca entra na mensagem', () => {
  const token = 'sbp_segredo_que_nao_aparece'
  const applied = appliedCheckConfig({ SUPABASE_ACCESS_TOKEN: token, SUPABASE_PROJECT_REF: 'fgmkhbzhaeebrsizwccx' }, pr988)
  assert.equal(applied.status, 'refused')
  const refused = decide({ checkRuns: [run(1, 'completed', 'skipped')], migrationsChanged: true, timedOut: false, applied })
  assert.equal(refused.action, 'fail')
  assert.match(refused.message, /produção/)
  assert.doesNotMatch(JSON.stringify([applied, refused]), new RegExp(token))
  assert.equal(appliedCheckConfig({ SUPABASE_ACCESS_TOKEN: token, SUPABASE_PROJECT_REF: 'ref inválido' }, pr988).status, 'refused')
  const ready = appliedCheckConfig({ SUPABASE_ACCESS_TOKEN: token, SUPABASE_PROJECT_REF: STAGING_REF }, pr988)
  assert.deepEqual(ready, { status: 'ready', token, ref: STAGING_REF })
})

test('falha da Management API tenta de novo e, no prazo, recusa como hoje', () => {
  const input = { checkRuns: [run(1, 'completed', 'skipped')], migrationsChanged: true, applied: { status: 'error', reason: 'Management API respondeu 503' } }
  assert.equal(decide({ ...input, timedOut: false }).action, 'wait')
  const refused = decide({ ...input, timedOut: true })
  assert.equal(refused.action, 'fail')
  assert.match(refused.message, /503.*workflow_dispatch/)
})

test('check vermelho recusa mesmo com as migrations aplicadas', () => {
  const applied = { status: 'checked', versions: pr988, missing: [] }
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'action_required']) {
    assert.equal(decide({ checkRuns: [run(1, 'completed', conclusion)], migrationsChanged: true, timedOut: false, applied }).action, 'fail')
  }
  assert.equal(needsAppliedCheck([run(1, 'completed', 'failure')], true), false)
})

test('a Management API só é consultada para check pulado ou neutro num push com migration', () => {
  assert.equal(needsAppliedCheck([run(1, 'completed', 'skipped')], true), true)
  assert.equal(needsAppliedCheck([run(1, 'completed', 'neutral')], true), true)
  assert.equal(needsAppliedCheck([run(1, 'completed', 'skipped')], false), false)
  assert.equal(needsAppliedCheck([run(1, 'completed', 'success')], true), false)
  assert.equal(needsAppliedCheck([run(1, 'in_progress', null)], true), false)
  assert.equal(needsAppliedCheck([], true), false)
})

test('versões do push vêm dos NNN_*.sql adicionados ou alterados', () => {
  const files = [
    file('supabase/migrations/333_datas_de_container_lote_unico.sql'),
    file('supabase/migrations/336_baplie_sem_vazios.sql', 'modified'),
    file('supabase/migrations/334_x.sql', 'renamed'),
    file('supabase/migrations/335_y.sql'),
    file('supabase/migrations/200_antiga.sql', 'removed'),
    file('src/App.tsx', 'modified'),
  ]
  assert.deepEqual(migrationVersions(files, false), pr988)
  assert.deepEqual(migrationVersions([file('src/App.tsx')], false), [])
})

test('compare truncado ou pasta de migrations sem NNN_*.sql novo não lista versões e recusa como hoje', () => {
  assert.equal(migrationVersions([file('supabase/migrations/333_x.sql')], true), null)
  assert.equal(migrationVersions([file('supabase/migrations/200_antiga.sql', 'removed')], false), null)
  const applied = appliedCheckConfig({ SUPABASE_ACCESS_TOKEN: 'sbp_x', SUPABASE_PROJECT_REF: STAGING_REF }, null)
  assert.equal(applied.status, 'unavailable')
  const refused = decide({ checkRuns: [run(1, 'completed', 'skipped')], migrationsChanged: changesMigrations([], true), timedOut: false, applied })
  assert.equal(refused.action, 'fail')
  assert.match(refused.message, /truncado.*workflow_dispatch/)
})

test('compara versões da Management API sem depender de zeros à esquerda', () => {
  const rows = [{ version: '007', name: 'x' }, { version: '333' }, { version: '334' }]
  assert.deepEqual(missingVersions(['7', '333', '334', '335'], rows), ['335'])
  assert.deepEqual(missingVersions(pr988, [...pr988.map((version) => ({ version }))]), [])
})

test('push sem migration ou check verde não dependem da conferência', () => {
  const unavailable = appliedCheckConfig({}, [])
  assert.equal(decide({ checkRuns: [run(1, 'completed', 'skipped')], migrationsChanged: false, timedOut: false, applied: unavailable }).action, 'publish')
  assert.equal(decide({ checkRuns: [run(1, 'completed', 'success')], migrationsChanged: true, timedOut: false }).action, 'publish')
  assert.equal(decide({ checkRuns: [], migrationsChanged: false, timedOut: true }).action, 'publish')
})

async function runMain({ env, compareFiles, conclusion, appliedRows }) {
  const saved = { fetch: globalThis.fetch, log: console.log, env: { ...process.env } }
  const calls = []
  const logs = []
  Object.assign(process.env, { GITHUB_REPOSITORY: 'luccafwlog/vela', GITHUB_TOKEN: 'gh', COMMIT_SHA: '324875e', BEFORE_SHA: 'aaaaaaa', WAIT_SECONDS: '0' }, env)
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), authorization: init?.headers?.Authorization })
    const body = String(url).includes('/compare/') ? { files: compareFiles }
      : String(url).includes('/check-runs') ? { check_runs: [run(1, 'completed', conclusion)] }
        : appliedRows
    return { ok: true, status: 200, json: async () => body }
  }
  console.log = (line) => logs.push(line)
  try {
    return { code: await main(), calls, logs }
  } finally {
    globalThis.fetch = saved.fetch
    console.log = saved.log
    for (const key of Object.keys(process.env)) if (!(key in saved.env)) delete process.env[key]
    Object.assign(process.env, saved.env)
  }
}

test('main: push da #988 com o check pulado publica depois de ler a branch staging na Management API', async () => {
  const token = 'sbp_nao_aparece_no_log'
  const { code, calls, logs } = await runMain({
    env: { SUPABASE_ACCESS_TOKEN: token, SUPABASE_PROJECT_REF: STAGING_REF },
    compareFiles: pr988.map((version) => file(`supabase/migrations/${version}_x.sql`)),
    conclusion: 'skipped',
    appliedRows: ['332', ...pr988].map((version) => ({ version, name: 'x' })),
  })
  assert.equal(code, 0)
  const supabase = calls.find((call) => call.url.startsWith('https://api.supabase.com/'))
  assert.equal(supabase.url, `https://api.supabase.com/v1/projects/${STAGING_REF}/database/migrations`)
  assert.equal(supabase.authorization, `Bearer ${token}`)
  assert.match(logs.join('\n'), /aplicadas na branch Supabase: 333, 334, 335, 336/)
  assert.doesNotMatch(logs.join('\n'), new RegExp(token))
})

test('main: sem token recusa como hoje e não chama a Management API', async () => {
  const { code, calls, logs } = await runMain({
    env: { SUPABASE_ACCESS_TOKEN: '', SUPABASE_PROJECT_REF: '' },
    compareFiles: [file('supabase/migrations/333_x.sql')],
    conclusion: 'skipped',
  })
  assert.equal(code, 1)
  assert.ok(calls.every((call) => !call.url.startsWith('https://api.supabase.com/')))
  assert.match(logs.join('\n'), /desligada.*workflow_dispatch/)
})

test('main: check failure recusa sem chamar a Management API', async () => {
  const { code, calls } = await runMain({
    env: { SUPABASE_ACCESS_TOKEN: 'sbp_x', SUPABASE_PROJECT_REF: STAGING_REF },
    compareFiles: [file('supabase/migrations/333_x.sql')],
    conclusion: 'failure',
  })
  assert.equal(code, 1)
  assert.ok(calls.every((call) => !call.url.startsWith('https://api.supabase.com/')))
})

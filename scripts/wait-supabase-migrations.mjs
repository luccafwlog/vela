// Espera a integração do Supabase aplicar as migrations do commit antes de a
// produção publicar o código que as usa (D1 do plano de compactação do CI,
// docs/archive/plans/2026-10-15-compactacao-do-ci.md, item 1.2). O CI não roda mais
// depois do merge; este passo substitui a espera que o `workflow_run` fazia.
//
// Uso no workflow: GITHUB_TOKEN, GITHUB_REPOSITORY, COMMIT_SHA e BEFORE_SHA.
// Opcionais, só no staging: SUPABASE_ACCESS_TOKEN e SUPABASE_PROJECT_REF. Com
// eles, um check pulado ou neutro num push com migration não recusa de cara: o
// script confere na Management API se as versões do push já estão aplicadas
// na branch Supabase (a branch persistente aplica pela sincronização e marca o
// check do commit como pulado).
// Sai 0 para publicar e 1 para recusar, com a razão no log.

export const SUPABASE_APP_SLUG = 'supabase'
export const MIGRATIONS_PREFIX = 'supabase/migrations/'
export const PRODUCTION_SUPABASE_PROJECT_REF = 'fgmkhbzhaeebrsizwccx'
const UNFINISHED = new Set(['skipped', 'neutral'])
const MIGRATION_FILE = /^supabase\/migrations\/(\d+)_[^/]*\.sql$/

/** O check mais recente do app `supabase` no commit. */
export function latestSupabaseRun(checkRuns) {
  return checkRuns
    .filter((run) => run.app?.slug === SUPABASE_APP_SLUG)
    .sort((a, b) => b.id - a.id)[0]
}

/** A conferência das migrations aplicadas só vale para check pulado ou neutro com migration no push. */
export function needsAppliedCheck(checkRuns, migrationsChanged) {
  const latest = latestSupabaseRun(checkRuns)
  return migrationsChanged && latest?.status === 'completed' && UNFINISHED.has(latest.conclusion)
}

/**
 * Decide a partir dos check runs do app `supabase` no commit.
 * `applied` é o resultado de conferir as versões do push na branch Supabase,
 * feito fora daqui (`checkApplied`); ausente, vale a regra sem conferência.
 * @param {{ checkRuns: Array<{ id: number, status: string, conclusion: string | null, app?: { slug?: string }, output?: { title?: string | null } }>, migrationsChanged: boolean, timedOut: boolean, applied?: { status: 'unavailable' | 'refused', reason: string } | { status: 'error', reason: string } | { status: 'checked', versions: string[], missing: string[] } }} input
 * @returns {{ action: 'publish' | 'fail' | 'wait', message: string }}
 */
export function decide({ checkRuns, migrationsChanged, timedOut, applied }) {
  const latest = latestSupabaseRun(checkRuns)
  const withoutCheck = (reason) => migrationsChanged
    ? {
        action: 'fail',
        message: `${reason} e o push muda ${MIGRATIONS_PREFIX}. Confira no painel do Supabase se as migrations foram aplicadas e publique pelo disparo manual (workflow_dispatch).`,
      }
    : { action: 'publish', message: `${reason}; o push não muda ${MIGRATIONS_PREFIX}, publica.` }

  if (!latest) {
    return timedOut ? withoutCheck('Nenhum check do Supabase em 10 min') : { action: 'wait', message: 'Aguardando o check do Supabase.' }
  }
  if (latest.status !== 'completed') {
    return timedOut ? withoutCheck(`Check do Supabase ainda ${latest.status} em 10 min`) : { action: 'wait', message: `Check do Supabase ${latest.status}.` }
  }
  const title = latest.output?.title ? ` (${latest.output.title})` : ''
  switch (latest.conclusion) {
    case 'success':
      return { action: 'publish', message: `Check do Supabase verde${title}.` }
    case 'skipped':
    case 'neutral':
      return migrationsChanged
        ? decideByApplied(`Check do Supabase ${latest.conclusion}${title}`, applied, timedOut, withoutCheck)
        : withoutCheck(`Check do Supabase ${latest.conclusion}${title}`)
    default:
      return { action: 'fail', message: `Check do Supabase terminou ${latest.conclusion}${title}; produção não publica.` }
  }
}

function decideByApplied(reason, applied, timedOut, withoutCheck) {
  if (!applied || applied.status === 'unavailable') {
    return withoutCheck(`${reason}${applied ? `; ${applied.reason}` : ''}`)
  }
  if (applied.status === 'refused') return { action: 'fail', message: `${reason}; ${applied.reason}` }
  if (applied.status === 'error') {
    return timedOut
      ? withoutCheck(`${reason}; a conferência das migrations aplicadas falhou até o prazo (${applied.reason})`)
      : { action: 'wait', message: `${reason}; conferência das migrations aplicadas falhou (${applied.reason}), tenta de novo.` }
  }
  const versions = applied.versions.join(', ')
  if (applied.missing.length === 0) {
    return { action: 'publish', message: `${reason}; migrations do push já aplicadas na branch Supabase: ${versions}. Publica.` }
  }
  const missing = applied.missing.join(', ')
  return timedOut
    ? { action: 'fail', message: `${reason}; no fim do prazo faltam na branch Supabase as migrations ${missing} (conferidas: ${versions}). Não publica.` }
    : { action: 'wait', message: `${reason}; aguardando a branch Supabase aplicar ${missing}.` }
}

/**
 * Versões das migrations adicionadas ou alteradas no compare (`NNN_*.sql`).
 * Devolve null quando não dá para listá-las: compare truncado, ou o push muda
 * `supabase/migrations/` sem nenhum arquivo `NNN_*.sql` novo ou alterado.
 * @param {Array<{ filename: string, status?: string }>} files
 */
export function migrationVersions(files, truncated) {
  if (truncated) return null
  const touched = files.filter((file) => file.filename.startsWith(MIGRATIONS_PREFIX))
  const versions = touched
    .filter((file) => file.status !== 'removed' && file.status !== 'unchanged')
    .map((file) => MIGRATION_FILE.exec(file.filename)?.[1])
    .filter(Boolean)
  if (touched.length > 0 && versions.length === 0) return null
  return [...new Set(versions)].sort((a, b) => Number(a) - Number(b))
}

const normalizeVersion = (version) => String(version).replace(/^0+(?=\d)/, '')

/** Versões do push que ainda não constam na lista aplicada da Management API. */
export function missingVersions(versions, appliedRows) {
  const applied = new Set(appliedRows.map((row) => normalizeVersion(row.version)))
  return versions.filter((version) => !applied.has(normalizeVersion(version)))
}

/**
 * Lê token e ref do ambiente sem nunca devolver o token numa mensagem.
 * @returns {{ status: 'ready', token: string, ref: string } | { status: 'unavailable' | 'refused', reason: string }}
 */
export function appliedCheckConfig(env, versions) {
  const token = env.SUPABASE_ACCESS_TOKEN?.trim()
  const ref = env.SUPABASE_PROJECT_REF?.trim()
  if (ref === PRODUCTION_SUPABASE_PROJECT_REF) {
    return { status: 'refused', reason: `SUPABASE_PROJECT_REF é o projeto de produção (${PRODUCTION_SUPABASE_PROJECT_REF}); a conferência só lê a branch Supabase do staging. Não publica.` }
  }
  if (!token || !ref) {
    return { status: 'unavailable', reason: 'conferência das migrations aplicadas desligada: SUPABASE_ACCESS_TOKEN ou SUPABASE_PROJECT_REF ausente (no staging, secret SUPABASE_STAGING_ACCESS_TOKEN e var SUPABASE_STAGING_PROJECT_REF do environment)' }
  }
  if (!/^[a-z0-9]{20}$/.test(ref)) {
    return { status: 'refused', reason: 'SUPABASE_PROJECT_REF não tem o formato de ref do Supabase (20 letras minúsculas ou dígitos). Não publica.' }
  }
  if (!versions) {
    return { status: 'unavailable', reason: `sem a lista de migrations do push (compare truncado, ou ${MIGRATIONS_PREFIX} muda sem arquivo NNN_*.sql novo ou alterado)` }
  }
  return { status: 'ready', token, ref }
}

/** Arquivos fora da lista (compare truncado) contam como migration mudada. */
export function changesMigrations(files, truncated) {
  return truncated || files.some((file) => file.startsWith(MIGRATIONS_PREFIX))
}

async function api(path) {
  const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/${path}`, {
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
  })
  if (!response.ok) throw new Error(`GitHub API ${path}: ${response.status}`)
  return response.json()
}

/** Confere as versões na Management API; a mensagem de erro leva só o status HTTP, nunca o token. */
async function checkApplied(config, versions) {
  if (config.status !== 'ready') return config
  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${config.ref}/database/migrations`, {
      headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json' },
    })
    if (!response.ok) return { status: 'error', reason: `Management API respondeu ${response.status}` }
    const rows = await response.json()
    if (!Array.isArray(rows)) return { status: 'error', reason: 'Management API devolveu formato inesperado' }
    return { status: 'checked', versions, missing: missingVersions(versions, rows) }
  } catch (error) {
    return { status: 'error', reason: `Management API inacessível (${error.name})` }
  }
}

export async function main() {
  const sha = process.env.COMMIT_SHA
  const before = process.env.BEFORE_SHA
  if (!sha) throw new Error('COMMIT_SHA ausente')
  let migrationsChanged = true
  let versions = null
  if (before && !/^0+$/.test(before)) {
    const compare = await api(`compare/${before}...${sha}`)
    const files = compare.files ?? []
    const truncated = files.length >= 300
    migrationsChanged = changesMigrations(files.map((file) => file.filename), truncated)
    versions = migrationVersions(files, truncated)
  }
  console.log(`Push ${migrationsChanged ? 'muda' : 'não muda'} ${MIGRATIONS_PREFIX}${versions?.length ? ` (versões ${versions.join(', ')})` : ''}.`)
  const config = appliedCheckConfig(process.env, versions)
  const deadline = Date.now() + Number(process.env.WAIT_SECONDS ?? 600) * 1000
  for (;;) {
    const { check_runs: checkRuns } = await api(`commits/${sha}/check-runs?per_page=100`)
    const timedOut = Date.now() >= deadline
    const applied = needsAppliedCheck(checkRuns, migrationsChanged) ? await checkApplied(config, versions) : undefined
    const decision = decide({ checkRuns, migrationsChanged, timedOut, applied })
    console.log(decision.message)
    if (decision.action === 'publish') return 0
    if (decision.action === 'fail') {
      console.log(`::error::${decision.message}`)
      return 1
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000))
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code), (error) => {
    console.error(`::error::${error.message}`)
    process.exit(1)
  })
}

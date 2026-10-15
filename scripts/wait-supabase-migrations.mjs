// Espera a integração do Supabase aplicar as migrations do commit antes de a
// produção publicar o código que as usa (D1 do plano de compactação do CI,
// docs/plans/2026-10-15-compactacao-do-ci.md, item 1.2). O CI não roda mais
// depois do merge; este passo substitui a espera que o `workflow_run` fazia.
//
// Uso no workflow: GITHUB_TOKEN, GITHUB_REPOSITORY, COMMIT_SHA e BEFORE_SHA.
// Sai 0 para publicar e 1 para recusar, com a razão no log.

export const SUPABASE_APP_SLUG = 'supabase'
export const MIGRATIONS_PREFIX = 'supabase/migrations/'

/**
 * Decide a partir dos check runs do app `supabase` no commit.
 * @param {{ checkRuns: Array<{ id: number, status: string, conclusion: string | null, app?: { slug?: string }, output?: { title?: string | null } }>, migrationsChanged: boolean, timedOut: boolean }} input
 * @returns {{ action: 'publish' | 'fail' | 'wait', message: string }}
 */
export function decide({ checkRuns, migrationsChanged, timedOut }) {
  const runs = checkRuns
    .filter((run) => run.app?.slug === SUPABASE_APP_SLUG)
    .sort((a, b) => b.id - a.id)
  const latest = runs[0]
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
      return withoutCheck(`Check do Supabase ${latest.conclusion}${title}`)
    default:
      return { action: 'fail', message: `Check do Supabase terminou ${latest.conclusion}${title}; produção não publica.` }
  }
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

async function main() {
  const sha = process.env.COMMIT_SHA
  const before = process.env.BEFORE_SHA
  if (!sha) throw new Error('COMMIT_SHA ausente')
  let migrationsChanged = true
  if (before && !/^0+$/.test(before)) {
    const compare = await api(`compare/${before}...${sha}`)
    const files = (compare.files ?? []).map((file) => file.filename)
    migrationsChanged = changesMigrations(files, files.length >= 300)
  }
  console.log(`Push ${migrationsChanged ? 'muda' : 'não muda'} ${MIGRATIONS_PREFIX}.`)
  const deadline = Date.now() + Number(process.env.WAIT_SECONDS ?? 600) * 1000
  for (;;) {
    const { check_runs: checkRuns } = await api(`commits/${sha}/check-runs?per_page=100`)
    const decision = decide({ checkRuns, migrationsChanged, timedOut: Date.now() >= deadline })
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

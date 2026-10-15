// Decide se a PR roda as suítes SQL (`*.local-pg.test.ts`) e a bateria
// financeira (item 1.3 do plano docs/archive/plans/2026-10-15-compactacao-do-ci.md,
// ADR 0086). Lê `git diff --name-only` no stdin e escreve `suites=true|false`
// no stdout (para $GITHUB_OUTPUT); a razão vai para o stderr (log do passo).
//
// O replay do schema, as invariantes, o catálogo de RPCs e o seed rodam em
// toda PR; só as suítes dependem desta lista. Mudar o workflow ou este
// classificador força as suítes: o código da PR decide aqui, então quem altera
// a regra paga a conferência completa.
import { readFileSync } from 'node:fs'

export const DB_PATHS = [
  /^supabase\//,
  /^src\/integration\//,
  /^scripts\/local-pg-suites\.(txt|mjs)$/,
  /^scripts\/run-local-pg-suites\.mjs$/,
  /^scripts\/setup-local-pg\.sh$/,
  /^scripts\/check-[^/]+\.sql$/,
  /^scripts\/check-rpc-catalog\.mjs$/,
  /^vite\.config\.ts$/,
  /^package(-lock)?\.json$/,
  /^\.github\/workflows\/ci\.yml$/,
  /^scripts\/ci-db-paths(\.test)?\.mjs$/,
]

/** @param {string[]} files */
export function classify(files) {
  const hit = files.find((file) => DB_PATHS.some((pattern) => pattern.test(file)))
  return hit
    ? { suites: true, reason: `suítes SQL rodam: ${hit} está no diff` }
    : { suites: false, reason: 'suítes SQL puladas: nenhum caminho de banco no diff' }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = readFileSync(0, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const { suites, reason } = classify(files)
  console.error(reason)
  console.log(`suites=${suites}`)
}

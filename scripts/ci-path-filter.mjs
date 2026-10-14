#!/usr/bin/env node
// Classifica um diff (um caminho por linha no stdin) para o CI barato.
// `code=false` pula lint/build/test: só Markdown ou docs/.
// `migrations=true` liga o replay local (scripts/replay-local-pg.sh).
// Saída estável para $GITHUB_OUTPUT: duas linhas code= e migrations=.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const MIGRATION_FILES = new Set([
  'scripts/setup-local-pg.sh',
  'scripts/check-squash-replay.sql',
  'scripts/check-comunicados-caixas-nob.sql',
  'scripts/local-pg-suites.txt',
  'scripts/run-local-pg-suites.mjs',
  'scripts/local-pg-suites.mjs',
  'scripts/check-rpc-catalog.mjs',
  'scripts/replay-local-pg.sh',
])

export function classifyPaths(files) {
  let code = false
  let migrations = false
  for (const file of files) {
    if (!file.endsWith('.md') && !file.startsWith('docs/')) code = true
    if (
      file.startsWith('supabase/')
      || file.startsWith('src/integration/')
      || MIGRATION_FILES.has(file)
    ) migrations = true
  }
  return { code, migrations }
}

function linesOf(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, migrations } = classifyPaths(linesOf(readFileSync(0, 'utf8')))
  process.stdout.write(`code=${code}\nmigrations=${migrations}\n`)
}

#!/usr/bin/env node
// Falha quando um `src/integration/*.local-pg.test.ts` não está na lista do
// job local-pg do CI (scripts/local-pg-suites.txt) nem num passo próprio do
// workflow (Etapa 12 do plano de correção das importações): suíte fora da
// lista era `describe.skip` no CI e só provava algo na máquina de quem a
// escreveu. Também acusa caminho listado que não existe mais ou repetido.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOCAL_PG_SUITES_FILE, readLocalPgSuites } from './local-pg-suites.mjs'

const root = process.cwd()
const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
// Só conta o que o CI executa: linhas comentadas do YAML não listam suíte.
const executed = workflow.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n')
const suites = readLocalPgSuites(root)
const listed = new Set([
  ...suites,
  ...(executed.match(/src\/integration\/[A-Za-z0-9]+\.local-pg\.test\.ts/g) ?? []),
])
const repeated = suites.filter((path, index) => suites.indexOf(path) !== index)
// A lista só vale se o job a executar nas duas ordens.
const missingRuns = [
  ['ordem natural', /run: npm run test:local-pg\s*$/m],
  ['ordem invertida', /run: npm run test:local-pg -- --reverse\s*$/m],
].filter(([, pattern]) => !pattern.test(executed)).map(([label]) => label)
const present = new Set(
  readdirSync(join(root, 'src/integration'))
    .filter((name) => name.endsWith('.local-pg.test.ts'))
    .map((name) => `src/integration/${name}`),
)

const missing = [...present].filter((path) => !listed.has(path)).sort()
const stale = [...listed].filter((path) => !present.has(path)).sort()

if (missing.length || stale.length || repeated.length || missingRuns.length) {
  if (missing.length) console.error(`Suítes local-pg fora do CI (${LOCAL_PG_SUITES_FILE} ou .github/workflows/ci.yml):\n  ${missing.join('\n  ')}`)
  if (stale.length) console.error(`Caminhos no CI sem arquivo:\n  ${stale.join('\n  ')}`)
  if (repeated.length) console.error(`Suítes repetidas em ${LOCAL_PG_SUITES_FILE}:\n  ${repeated.join('\n  ')}`)
  if (missingRuns.length) console.error(`O CI não roda ${LOCAL_PG_SUITES_FILE} em: ${missingRuns.join(', ')}`)
  process.exit(1)
}
console.log(`Local-pg CI list passed: ${present.size} suites listed.`)

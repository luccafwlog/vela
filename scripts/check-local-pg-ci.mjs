#!/usr/bin/env node
// Falha quando um `src/integration/*.local-pg.test.ts` não está na lista do
// replay local (scripts/local-pg-suites.txt) nem num passo do script
// scripts/replay-local-pg.sh. Suíte fora da lista era `describe.skip` e só
// provava algo na máquina de quem a escreveu. Também acusa caminho listado
// que não existe mais, suíte repetida, ou o hook deixando de chamar o replay.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOCAL_PG_SUITES_FILE, readLocalPgSuites } from './local-pg-suites.mjs'

const root = process.cwd()
const replay = readFileSync(join(root, 'scripts/replay-local-pg.sh'), 'utf8')
const hook = readFileSync(join(root, '.claude/hooks/pre-push-gate.sh'), 'utf8')
// Linha comentada não lista suíte nem conta como execução.
const executed = replay.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n')
const suites = readLocalPgSuites(root)
const listed = new Set([
  ...suites,
  ...(executed.match(/src\/integration\/[A-Za-z0-9]+\.local-pg\.test\.ts/g) ?? []),
])
const repeated = suites.filter((path, index) => suites.indexOf(path) !== index)
const hookCallsReplay = hook.split('\n').some((line) => {
  const trimmed = line.trim()
  return !trimmed.startsWith('#') && trimmed.includes('scripts/replay-local-pg.sh')
})
// A lista só vale se o replay a executar nas duas ordens.
const missingRuns = [
  ['ordem natural', /^\s*npm run test:local-pg\s*$/m],
  ['ordem invertida', /^\s*npm run test:local-pg -- --reverse\s*$/m],
].filter(([, pattern]) => !pattern.test(executed)).map(([label]) => label)
if (!hookCallsReplay) missingRuns.push('chamada no hook pre-push-gate.sh')
const present = new Set(
  readdirSync(join(root, 'src/integration'))
    .filter((name) => name.endsWith('.local-pg.test.ts'))
    .map((name) => `src/integration/${name}`),
)

const missing = [...present].filter((path) => !listed.has(path)).sort()
const stale = [...listed].filter((path) => !present.has(path)).sort()

if (missing.length || stale.length || repeated.length || missingRuns.length) {
  if (missing.length) console.error(`Suítes local-pg fora do replay local (${LOCAL_PG_SUITES_FILE} ou scripts/replay-local-pg.sh):\n  ${missing.join('\n  ')}`)
  if (stale.length) console.error(`Caminhos no replay local sem arquivo:\n  ${stale.join('\n  ')}`)
  if (repeated.length) console.error(`Suítes repetidas em ${LOCAL_PG_SUITES_FILE}:\n  ${repeated.join('\n  ')}`)
  if (missingRuns.length) console.error(`O replay local não cobre ${LOCAL_PG_SUITES_FILE} em: ${missingRuns.join(', ')}`)
  process.exit(1)
}
console.log(`Local-pg replay list passed: ${present.size} suites listed.`)

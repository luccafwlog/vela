#!/usr/bin/env node
// Falha quando um `src/integration/*.local-pg.test.ts` não está nas listas do
// job local-pg do CI (Etapa 12 do plano de correção das importações): suíte
// fora da lista era `describe.skip` no CI e só provava algo na máquina de quem
// a escreveu. Também acusa caminho listado que não existe mais.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
const listed = new Set(workflow.match(/src\/integration\/[A-Za-z0-9]+\.local-pg\.test\.ts/g) ?? [])
const present = new Set(
  readdirSync(join(root, 'src/integration'))
    .filter((name) => name.endsWith('.local-pg.test.ts'))
    .map((name) => `src/integration/${name}`),
)

const missing = [...present].filter((path) => !listed.has(path)).sort()
const stale = [...listed].filter((path) => !present.has(path)).sort()

if (missing.length || stale.length) {
  if (missing.length) console.error(`Suítes local-pg fora do CI (.github/workflows/ci.yml):\n  ${missing.join('\n  ')}`)
  if (stale.length) console.error(`Caminhos no CI sem arquivo:\n  ${stale.join('\n  ')}`)
  process.exit(1)
}
console.log(`Local-pg CI list passed: ${present.size} suites listed.`)

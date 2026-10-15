#!/usr/bin/env node
// Falha quando um `src/integration/*.local-pg.test.ts` não está na lista do
// job db do CI (scripts/local-pg-suites.txt) nem num passo próprio do
// workflow (Etapa 12 do plano de correção das importações): suíte fora da
// lista era `describe.skip` no CI e só provava algo na máquina de quem a
// escreveu. Também acusa caminho listado que não existe mais ou repetido,
// exige a ordem natural no CI e a invertida no workflow semanal (ADR 0086) e
// recusa `execFileSync('psql'`/`spawnSync('psql'` nas suítes: cada chamada
// abria um processo e uma conexão; use `execPsql`/`spawnPsql` de
// src/integration/localPsql.ts. `spawn('psql')` assíncrono continua aceito
// para abrir outra sessão em paralelo.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOCAL_PG_SUITES_FILE, readLocalPgSuites } from './local-pg-suites.mjs'

const CI = '.github/workflows/ci.yml'
const WEEKLY = '.github/workflows/local-pg-order.yml'
const NATURAL = /run: npm run test:local-pg\s*$/m
const REVERSE = /run: npm run test:local-pg -- --reverse\s*$/m
const PSQL_PROCESS = /\b(execFileSync|spawnSync)\(\s*['"]psql['"]/
// Exceção explícita: o teste do helper compara a saída com o binário psql.
export const PSQL_PROCESS_ALLOWED = new Set(['src/integration/localPsql.local-pg.test.ts'])

// Só conta o que o workflow executa: linhas comentadas do YAML não listam suíte.
const executed = (text) => text.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n')

/** @param {string} root @returns {string[]} erros */
export function checkLocalPgCi(root) {
  const ci = executed(readFileSync(join(root, CI), 'utf8'))
  const weekly = executed(readFileSync(join(root, WEEKLY), 'utf8'))
  const suites = readLocalPgSuites(root)
  const listed = new Set([
    ...suites,
    ...(ci.match(/src\/integration\/[A-Za-z0-9]+\.local-pg\.test\.ts/g) ?? []),
  ])
  const repeated = suites.filter((path, index) => suites.indexOf(path) !== index)
  const missingRuns = [
    [`ordem natural em ${CI}`, NATURAL.test(ci)],
    [`ordem natural em ${WEEKLY}`, NATURAL.test(weekly)],
    [`ordem invertida em ${WEEKLY}`, REVERSE.test(weekly)],
  ].filter(([, ok]) => !ok).map(([label]) => label)
  const present = new Set(
    readdirSync(join(root, 'src/integration'))
      .filter((name) => name.endsWith('.local-pg.test.ts'))
      .map((name) => `src/integration/${name}`),
  )
  // Passo próprio no CI (ex.: bateria financeira) também precisa rodar no semanal.
  const ciOnly = [...(ci.match(/src\/integration\/[A-Za-z0-9]+\.local-pg\.test\.ts/g) ?? [])]
    .filter((path) => !weekly.includes(path))

  const psqlProcesses = [...present]
    .filter((path) => !PSQL_PROCESS_ALLOWED.has(path) && PSQL_PROCESS.test(readFileSync(join(root, path), 'utf8')))
    .sort()

  const errors = []
  const missing = [...present].filter((path) => !listed.has(path)).sort()
  const stale = [...listed].filter((path) => !present.has(path)).sort()
  if (missing.length) errors.push(`Suítes local-pg fora do CI (${LOCAL_PG_SUITES_FILE} ou ${CI}):\n  ${missing.join('\n  ')}`)
  if (stale.length) errors.push(`Caminhos no CI sem arquivo:\n  ${stale.join('\n  ')}`)
  if (repeated.length) errors.push(`Suítes repetidas em ${LOCAL_PG_SUITES_FILE}:\n  ${repeated.join('\n  ')}`)
  if (missingRuns.length) errors.push(`${LOCAL_PG_SUITES_FILE} não roda em: ${missingRuns.join(', ')}`)
  if (psqlProcesses.length) errors.push(`Suítes com psql síncrono (use execPsql/spawnPsql de src/integration/localPsql.ts):\n  ${psqlProcesses.join('\n  ')}`)
  if (ciOnly.length) errors.push(`Passos do CI ausentes em ${WEEKLY}:\n  ${ciOnly.join('\n  ')}`)
  return { errors, count: present.size }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { errors, count } = checkLocalPgCi(process.cwd())
  if (errors.length) {
    for (const error of errors) console.error(error)
    process.exit(1)
  }
  console.log(`Local-pg CI list passed: ${count} suites listed.`)
}

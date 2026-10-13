#!/usr/bin/env node
// Roda as suítes de scripts/local-pg-suites.txt em série, na ordem da lista ou,
// com --reverse, de trás para frente. O Vitest reordena os arquivos por conta
// própria (cache de duração, tamanho); LOCAL_PG_SUITE_ORDER faz o sequenciador
// do vite.config.ts seguir a ordem pedida.
//
//   Uso: LOCAL_PG_INTEGRATION=1 LOCAL_DATABASE_URL=... npm run test:local-pg [-- --reverse]
import { spawnSync } from 'node:child_process'
import { readLocalPgSuites } from './local-pg-suites.mjs'

const reverse = process.argv.includes('--reverse')
const suites = readLocalPgSuites()
if (reverse) suites.reverse()

console.log(`Suítes local-pg em ordem ${reverse ? 'invertida' : 'natural'}: ${suites.length}.`)
const result = spawnSync('npx', ['vitest', 'run', '--no-file-parallelism', ...suites], {
  stdio: 'inherit',
  env: { ...process.env, LOCAL_PG_SUITE_ORDER: suites.join('\n') },
})
process.exit(result.status ?? 1)

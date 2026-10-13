// Leitura única de scripts/local-pg-suites.txt (runner e checagem do CI).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const LOCAL_PG_SUITES_FILE = 'scripts/local-pg-suites.txt'

export function readLocalPgSuites(root = process.cwd()) {
  return readFileSync(join(root, LOCAL_PG_SUITES_FILE), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

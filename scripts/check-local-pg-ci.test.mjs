import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { checkLocalPgCi } from './check-local-pg-ci.mjs'

const BATTERY = 'src/integration/financialBattery.local-pg.test.ts'
const ci = `steps:\n  - run: npm run test:local-pg\n  - run: npx vitest run ${BATTERY}\n`
const weekly = `steps:\n  - run: npm run test:local-pg\n  - run: npm run test:local-pg -- --reverse\n  - run: npx vitest run ${BATTERY}\n`

function fixture({ ciText = ci, weeklyText = weekly } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'localpg-check-'))
  mkdirSync(join(root, '.github/workflows'), { recursive: true })
  mkdirSync(join(root, 'scripts'))
  mkdirSync(join(root, 'src/integration'), { recursive: true })
  writeFileSync(join(root, '.github/workflows/ci.yml'), ciText)
  writeFileSync(join(root, '.github/workflows/local-pg-order.yml'), weeklyText)
  writeFileSync(join(root, 'scripts/local-pg-suites.txt'), 'src/integration/a.local-pg.test.ts\n')
  writeFileSync(join(root, 'src/integration/a.local-pg.test.ts'), '')
  writeFileSync(join(root, BATTERY), '')
  return root
}

test('recusa psql síncrono numa suíte, salvo a exceção do helper', () => {
  const root = fixture()
  writeFileSync(join(root, 'src/integration/a.local-pg.test.ts'), "const out = execFileSync(\n  'psql', ['-c', 'SELECT 1'])\n")
  assert.match(checkLocalPgCi(root).errors.join('\n'), /psql síncrono[\s\S]*a\.local-pg/)
  writeFileSync(join(root, 'src/integration/a.local-pg.test.ts'), "const out = execPsql(['-c', 'SELECT 1'])\nspawn('psql', [])\n")
  assert.deepEqual(checkLocalPgCi(root).errors, [])
  writeFileSync(join(root, 'scripts/local-pg-suites.txt'), 'src/integration/a.local-pg.test.ts\nsrc/integration/localPsql.local-pg.test.ts\n')
  writeFileSync(join(root, 'src/integration/localPsql.local-pg.test.ts'), "spawnSync('psql', args)\n")
  assert.deepEqual(checkLocalPgCi(root).errors, [])
})

test('aceita ordem natural no CI e as duas ordens no semanal', () => {
  assert.deepEqual(checkLocalPgCi(fixture()).errors, [])
})

test('falha sem a ordem invertida no semanal', () => {
  const { errors } = checkLocalPgCi(fixture({ weeklyText: weekly.replace('  - run: npm run test:local-pg -- --reverse\n', '') }))
  assert.match(errors.join('\n'), /ordem invertida em .*local-pg-order/)
})

test('falha sem a ordem natural no CI, mesmo comentada', () => {
  const { errors } = checkLocalPgCi(fixture({ ciText: ci.replace('  - run: npm run test:local-pg\n', '  # - run: npm run test:local-pg\n') }))
  assert.match(errors.join('\n'), /ordem natural em .*ci\.yml/)
})

test('falha quando passo próprio do CI não roda no semanal', () => {
  const { errors } = checkLocalPgCi(fixture({ weeklyText: weekly.replace(`  - run: npx vitest run ${BATTERY}\n`, '') }))
  assert.match(errors.join('\n'), /ausentes em .*financialBattery/s)
})

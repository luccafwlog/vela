import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { classify } from './ci-db-paths.mjs'

test('PR só de tela pula as suítes', () => {
  const result = classify(['src/pages/BLs.tsx', 'src/components/ui/Button.tsx', 'docs/README.md'])
  assert.equal(result.suites, false)
  assert.match(result.reason, /nenhum caminho de banco/)
})

test('migration, suíte SQL ou script do banco roda as suítes', () => {
  for (const file of [
    'supabase/migrations/221_novo.sql',
    'supabase/functions/_shared/email.ts',
    'src/integration/ceUnlock.local-pg.test.ts',
    'scripts/local-pg-suites.txt',
    'scripts/setup-local-pg.sh',
    'scripts/check-squash-replay.sql',
    'scripts/check-rpc-catalog.mjs',
    'vite.config.ts',
    'package-lock.json',
  ]) {
    assert.equal(classify(['src/App.tsx', file]).suites, true, file)
  }
})

test('mudar o workflow ou o classificador força as suítes', () => {
  assert.equal(classify(['.github/workflows/ci.yml']).suites, true)
  assert.equal(classify(['scripts/ci-db-paths.mjs']).suites, true)
  assert.equal(classify(['.github/workflows/cloudflare-pages-preview.yml']).suites, false)
})

test('diff vazio pula as suítes', () => {
  assert.equal(classify([]).suites, false)
})

test('CLI escreve a saída para $GITHUB_OUTPUT', () => {
  const output = execFileSync('node', [new URL('./ci-db-paths.mjs', import.meta.url).pathname], {
    input: 'src/pages/BLs.tsx\nsupabase/migrations/221_x.sql\n',
    stdio: ['pipe', 'pipe', 'ignore'],
  }).toString()
  assert.equal(output.trim(), 'suites=true')
})

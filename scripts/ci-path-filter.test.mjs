import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { classifyPaths } from './ci-path-filter.mjs'

const script = fileURLToPath(new URL('./ci-path-filter.mjs', import.meta.url))

assert.deepEqual(classifyPaths([]), { code: false, migrations: false })
assert.deepEqual(classifyPaths(['README.md', 'docs/setup/deploy.md', 'docs/figura.png']), {
  code: false,
  migrations: false,
})
assert.deepEqual(classifyPaths(['src/pages/Home.tsx']), { code: true, migrations: false })
assert.deepEqual(classifyPaths(['supabase/migrations/220_example.sql']), { code: true, migrations: true })
assert.deepEqual(classifyPaths(['src/integration/foo.local-pg.test.ts']), { code: true, migrations: true })
assert.deepEqual(classifyPaths(['scripts/setup-local-pg.sh', 'AGENTS.md']), { code: true, migrations: true })
assert.deepEqual(classifyPaths(['scripts/replay-local-pg.sh']), { code: true, migrations: true })
assert.deepEqual(classifyPaths(['.github/workflows/ci.yml']), { code: true, migrations: false })

const cli = spawnSync(process.execPath, [script], { input: 'docs/a.md\nsrc/App.tsx\n', encoding: 'utf8' })
assert.equal(cli.status, 0)
assert.equal(cli.stdout, 'code=true\nmigrations=false\n')

console.log('ci-path-filter: docs, code and migration classification passed.')

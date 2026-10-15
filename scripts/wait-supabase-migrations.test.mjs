import assert from 'node:assert/strict'
import test from 'node:test'
import { changesMigrations, decide } from './wait-supabase-migrations.mjs'

const run = (id, status, conclusion, slug = 'supabase') => ({ id, status, conclusion, app: { slug }, output: { title: null } })

test('check verde publica', () => {
  assert.equal(decide({ checkRuns: [run(1, 'completed', 'success')], migrationsChanged: true, timedOut: false }).action, 'publish')
})

test('check vermelho, cancelado ou estourado recusa', () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'action_required']) {
    assert.equal(decide({ checkRuns: [run(1, 'completed', conclusion)], migrationsChanged: false, timedOut: false }).action, 'fail')
  }
})

test('check pulado publica só sem migration no push', () => {
  const checkRuns = [run(1, 'completed', 'skipped')]
  assert.equal(decide({ checkRuns, migrationsChanged: false, timedOut: false }).action, 'publish')
  const refused = decide({ checkRuns, migrationsChanged: true, timedOut: false })
  assert.equal(refused.action, 'fail')
  assert.match(refused.message, /workflow_dispatch/)
})

test('sem check espera e, no prazo, decide pelas migrations', () => {
  assert.equal(decide({ checkRuns: [], migrationsChanged: true, timedOut: false }).action, 'wait')
  assert.equal(decide({ checkRuns: [], migrationsChanged: false, timedOut: true }).action, 'publish')
  assert.equal(decide({ checkRuns: [], migrationsChanged: true, timedOut: true }).action, 'fail')
  assert.equal(decide({ checkRuns: [run(1, 'in_progress', null)], migrationsChanged: true, timedOut: false }).action, 'wait')
})

test('ignora checks de outros apps e usa o mais recente do Supabase', () => {
  const checkRuns = [run(9, 'completed', 'failure', 'github-actions'), run(2, 'completed', 'failure'), run(3, 'completed', 'success')]
  assert.equal(decide({ checkRuns, migrationsChanged: true, timedOut: false }).action, 'publish')
})

test('migration no diff, ou diff truncado, conta como mudança', () => {
  assert.equal(changesMigrations(['supabase/migrations/221_x.sql'], false), true)
  assert.equal(changesMigrations(['supabase/functions/_shared/email.ts', 'src/App.tsx'], false), false)
  assert.equal(changesMigrations([], true), true)
})

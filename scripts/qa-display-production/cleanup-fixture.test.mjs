import test from 'node:test'
import assert from 'node:assert/strict'

const base = () => ({ prefix: 'QA-DISPLAY-2026', customers: [{ id: 'QAD26-CUSTOMER-1' }], bls: [{ id: 'QAD26-BL-001' }], bl_containers: [{ id: 'QAD26-CONTAINER-1' }] })

test('rejects an empty catalog, a mismatched prefix and an outside identifier', async () => {
  const { cleanupFixture } = await import('./cleanup-fixture.mjs')
  await assert.rejects(() => cleanupFixture({}, {}, { dryRun: true }), /catalog/i)
  await assert.rejects(() => cleanupFixture({}, { ...base(), prefix: 'OTHER' }, { dryRun: true }), /prefix/i)
  await assert.rejects(() => cleanupFixture({}, { ...base(), bls: [{ id: 'foreign-id' }] }, { dryRun: true }), /outside|fixture/i)
})

test('dry-run returns dependency order without deleting anything', async () => {
  const { cleanupFixture } = await import('./cleanup-fixture.mjs')
  const calls = []
  const result = await cleanupFixture({ from: (...args) => { calls.push(args); return {} } }, base(), { dryRun: true })
  assert.equal(result.dryRun, true)
  assert.ok(result.operations.findIndex((item) => item.table === 'bls') > result.operations.findIndex((item) => item.table === 'bl_containers'))
  assert.deepEqual(calls, [])
})

test('destructive mode refuses before any delete: the API no longer deletes fixture tables (ADR 0085)', async () => {
  const { cleanupFixture } = await import('./cleanup-fixture.mjs')
  const calls = []
  const catalog = { ...base(), customers: [{ id: 'QAD26-CUSTOMER-1', created: true }] }
  await assert.rejects(() => cleanupFixture({ from: (...args) => { calls.push(args); return {} } }, catalog, { dryRun: false }), /reset-ambiente/)
  assert.deepEqual(calls, [])
})

test('accepts only textual synthetic ids or non-text ids explicitly present in the loaded catalog', async () => {
  const { isSyntheticId } = await import('./cleanup-fixture.mjs')
  assert.equal(isSyntheticId('QAD26-BL-001'), true)
  assert.equal(isSyntheticId(123, new Set([123])), true)
  assert.equal(isSyntheticId(123, new Set([456])), false)
  assert.equal(isSyntheticId('a8bcee21-18e1-4a13-a2fe-ed46a80bb3ae', new Set(['a8bcee21-18e1-4a13-a2fe-ed46a80bb3ae'])), true)
})

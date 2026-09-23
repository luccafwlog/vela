import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanupPreviewDeployments } from './cloudflare-pages-cleanup.mjs'

const TEST_ACCOUNT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

test('deletes only preview deployments for the exact closed branch on both sites', async () => {
  const requests = []
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input)
    requests.push({ url, init })
    if (init.method === 'DELETE') return Response.json({ success: true, result: {} })

    const page = url.searchParams.get('page')
    const project = url.pathname.split('/')[7]
    const deployments = project === 'vela-internal'
      ? page === '1'
        ? [
            { id: 'internal-match-1', created_on: '2026-09-20T12:00:00Z', environment: 'preview', deployment_trigger: { metadata: { branch: 'pr-123' } } },
            { id: 'internal-production', environment: 'production', deployment_trigger: { metadata: { branch: 'pr-123' } } },
          ]
        : [{ id: 'internal-match-2', created_on: '2026-09-21T12:00:00Z', environment: 'preview', deployment_trigger: { metadata: { branch: 'pr-123' } } }]
      : [{ id: 'portal-other-branch', environment: 'preview', deployment_trigger: { metadata: { branch: 'pr-124' } } }]
    return Response.json({
      success: true,
      result: deployments,
      result_info: { page: Number(page), total_pages: project === 'vela-internal' ? 2 : 1 },
    })
  }

  const result = await cleanupPreviewDeployments({
    apiToken: 'test-token',
    accountId: TEST_ACCOUNT_ID,
    branch: 'pr-123',
    fetchImpl,
  })

  assert.deepEqual(result, {
    removed: { 'vela-internal': 1, 'vela-portal': 0 },
    retained: { 'vela-internal': 1, 'vela-portal': 0 },
  })
  const deleted = requests.filter(({ init }) => init.method === 'DELETE').map(({ url }) => url.pathname)
  assert.deepEqual(deleted, [
    `/client/v4/accounts/${TEST_ACCOUNT_ID}/pages/projects/vela-internal/deployments/internal-match-1`,
  ])
  assert.ok(requests.filter(({ init }) => init.method === 'DELETE').every(({ url }) => url.searchParams.get('force') === 'true'))
  assert.ok(requests.filter(({ init }) => init.method !== 'DELETE').every(({ url }) => url.searchParams.get('env') === 'preview'))
})

test('retains the sole preview deployment because Cloudflare forbids deleting the latest branch deployment', async () => {
  const methods = []
  const fetchImpl = async (input, init = {}) => {
    methods.push(init.method || 'GET')
    const project = new URL(input).pathname.split('/')[7]
    return Response.json({
      success: true,
      result: project === 'vela-internal'
        ? [{ id: 'only-latest', created_on: '2026-09-21T12:00:00Z', environment: 'preview', deployment_trigger: { metadata: { branch: 'pr-123' } } }]
        : [],
      result_info: { page: 1, total_pages: 1 },
    })
  }

  const result = await cleanupPreviewDeployments({
    apiToken: 'test-token',
    accountId: TEST_ACCOUNT_ID,
    branch: 'pr-123',
    fetchImpl,
  })
  assert.deepEqual(result, {
    removed: { 'vela-internal': 0, 'vela-portal': 0 },
    retained: { 'vela-internal': 1, 'vela-portal': 0 },
  })
  assert.deepEqual(methods, ['GET', 'GET'])
})

test('rejects an invalid account ID before making Cloudflare requests', async () => {
  let called = false
  await assert.rejects(
    cleanupPreviewDeployments({ apiToken: 'test-token', accountId: 'not-an-account', branch: 'feature/fix', fetchImpl: async () => { called = true } }),
    /account id/i,
  )
  assert.equal(called, false)
})

test('does not delete anything when listing one site fails', async () => {
  const methods = []
  const fetchImpl = async (input, init = {}) => {
    methods.push(init.method || 'GET')
    const isPortal = new URL(input).pathname.includes('/projects/vela-portal/')
    if (!isPortal) {
      return Response.json({ success: true, result: [], result_info: { page: 1, total_pages: 1 } })
    }
    return Response.json({ success: false, errors: [{ message: 'denied' }], result: [] }, { status: 403 })
  }
  await assert.rejects(
    cleanupPreviewDeployments({ apiToken: 'test-token', accountId: TEST_ACCOUNT_ID, branch: 'pr-123', fetchImpl }),
    /api GET failed/i,
  )
  assert.deepEqual(methods, ['GET', 'GET'])
})

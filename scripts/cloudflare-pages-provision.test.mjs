import assert from 'node:assert/strict'
import test from 'node:test'
import { createPagesProvisioner } from './cloudflare-pages-provision.mjs'

const ACCOUNT_ID = 'a'.repeat(32)
const TOKEN = 'cfut_dummy_test_token_not_real'

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body },
  }
}

test('checks projects by name and creates only those confirmed missing', async () => {
  const calls = []
  const ensure = createPagesProvisioner({
    accountId: ACCOUNT_ID,
    apiToken: TOKEN,
    projects: ['vela-internal', 'vela-portal'],
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      if (options.method === 'GET') {
        const name = new URL(url).pathname.split('/').at(-1)
        if (name === 'vela-internal') return response({ success: true, result: { name } })
        return response({ success: false, errors: [{ code: 8000007, message: 'not found' }] }, 404)
      }
      return response({ success: true, result: { name: JSON.parse(options.body).name } })
    },
  })

  assert.deepEqual(await ensure(), { created: ['vela-portal'], existing: ['vela-internal'] })
  assert.equal(calls.length, 3)
  assert.deepEqual(calls.map(({ url, options }) => [options.method, new URL(url).pathname]), [
    ['GET', `/client/v4/accounts/${ACCOUNT_ID}/pages/projects/vela-internal`],
    ['GET', `/client/v4/accounts/${ACCOUNT_ID}/pages/projects/vela-portal`],
    ['POST', `/client/v4/accounts/${ACCOUNT_ID}/pages/projects`],
  ])
  assert.equal(calls.some(({ url }) => new URL(url).search), false)
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    name: 'vela-portal',
    production_branch: 'main',
  })
  assert.equal(calls[2].options.headers.Authorization, `Bearer ${TOKEN}`)
})

test('leaves both existing projects unchanged', async () => {
  let writes = 0
  const ensure = createPagesProvisioner({
    accountId: ACCOUNT_ID,
    apiToken: TOKEN,
    fetchImpl: async (url, options) => {
      if (options.method === 'POST') writes += 1
      return response({ success: true, result: { name: new URL(url).pathname.split('/').at(-1) } })
    },
  })

  assert.deepEqual(await ensure(), { created: [], existing: ['vela-internal', 'vela-portal'] })
  assert.equal(writes, 0)
})

test('recovers from a concurrent create by fetching that named project', async () => {
  const calls = []
  const ensure = createPagesProvisioner({
    accountId: ACCOUNT_ID,
    apiToken: TOKEN,
    projects: ['vela-portal'],
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      if (options.method === 'POST') {
        return response({ success: false, errors: [{ code: 8000000, message: 'already exists' }] }, 409)
      }
      if (calls.filter((call) => call.options.method === 'GET').length === 1) {
        return response({ success: false, errors: [{ code: 8000007, message: 'not found' }] }, 404)
      }
      return response({ success: true, result: { name: 'vela-portal' } })
    },
  })

  assert.deepEqual(await ensure(), { created: [], existing: ['vela-portal'] })
  assert.deepEqual(calls.map(({ options }) => options.method), ['GET', 'POST', 'GET'])
})

test('rejects invalid configuration before making a request', async () => {
  let requests = 0
  assert.throws(() => createPagesProvisioner({
    accountId: 'not-an-account-id',
    apiToken: TOKEN,
    fetchImpl: async () => { requests += 1 },
  }), /CLOUDFLARE_ACCOUNT_ID/)
  assert.equal(requests, 0)
})

test('reports Cloudflare diagnostics while redacting token and account ID', async () => {
  const ensure = createPagesProvisioner({
    accountId: ACCOUNT_ID,
    apiToken: TOKEN,
    fetchImpl: async () => response({
      success: false,
      errors: [{ code: 80000024, message: `Rejected token ${TOKEN}; account ${ACCOUNT_ID}` }],
    }, 400),
  })

  await assert.rejects(ensure(), (error) => {
    assert.match(error.message, /HTTP 400/)
    assert.match(error.message, /Cloudflare error codes: 80000024/)
    assert.match(error.message, /Cloudflare error messages: Rejected token \[redacted-token\]; account \[redacted-account-id\]/)
    assert.doesNotMatch(error.message, new RegExp(TOKEN))
    assert.doesNotMatch(error.message, new RegExp(ACCOUNT_ID))
    return true
  })
})

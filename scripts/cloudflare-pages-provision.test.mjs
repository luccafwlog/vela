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

test('creates only missing Pages projects as Direct Upload projects on main', async () => {
  const calls = []
  const ensure = createPagesProvisioner({
    accountId: ACCOUNT_ID,
    apiToken: TOKEN,
    projects: ['vela-internal', 'vela-portal'],
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      if (options.method === 'GET') {
        return response({ success: true, result: [{ name: 'vela-internal' }], result_info: { total_pages: 1 } })
      }
      return response({ success: true, result: { name: JSON.parse(options.body).name } })
    },
  })

  assert.deepEqual(await ensure(), { created: ['vela-portal'], existing: ['vela-internal'] })
  assert.equal(calls.length, 2)
  assert.equal(calls[1].options.method, 'POST')
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    name: 'vela-portal',
    production_branch: 'main',
  })
  assert.equal(calls[1].options.headers.Authorization, `Bearer ${TOKEN}`)
})

test('leaves both existing projects unchanged', async () => {
  let writes = 0
  const ensure = createPagesProvisioner({
    accountId: ACCOUNT_ID,
    apiToken: TOKEN,
    fetchImpl: async (_url, options) => {
      if (options.method === 'POST') writes += 1
      return response({
        success: true,
        result: [{ name: 'vela-internal' }, { name: 'vela-portal' }],
        result_info: { total_pages: 1 },
      })
    },
  })

  assert.deepEqual(await ensure(), { created: [], existing: ['vela-internal', 'vela-portal'] })
  assert.equal(writes, 0)
})

test('paginates the account project inventory before creating anything', async () => {
  const calls = []
  const ensure = createPagesProvisioner({
    accountId: ACCOUNT_ID,
    apiToken: TOKEN,
    projects: ['vela-portal'],
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      if (options.method === 'POST') return response({ success: true, result: { name: 'vela-portal' } })
      const page = new URL(url).searchParams.get('page')
      return page === '1'
        ? response({ success: true, result: [{ name: 'other-project' }], result_info: { total_pages: 2 } })
        : response({ success: true, result: [{ name: 'vela-portal' }], result_info: { total_pages: 2 } })
    },
  })

  assert.deepEqual(await ensure(), { created: [], existing: ['vela-portal'] })
  assert.deepEqual(calls.map(({ url }) => new URL(url).searchParams.get('page')), ['1', '2'])
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

test('does not include the token or API response body in failures', async () => {
  const ensure = createPagesProvisioner({
    accountId: ACCOUNT_ID,
    apiToken: TOKEN,
    fetchImpl: async (_url, options) => options.method === 'GET'
      ? response({ success: true, result: [], result_info: { total_pages: 1 } })
      : response({ success: false, errors: [{ message: `secret=${TOKEN}` }] }, 403),
  })

  await assert.rejects(ensure(), (error) => {
    assert.match(error.message, /HTTP 403/)
    assert.doesNotMatch(error.message, new RegExp(TOKEN))
    assert.doesNotMatch(error.message, /secret=/)
    return true
  })
})

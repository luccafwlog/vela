import assert from 'node:assert/strict'
import http from 'node:http'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { isAllowedHost, server } = require('./sb-shim.cjs')

test('sb-shim aceita só o próprio endereço local no Host', () => {
  for (const host of ['localhost:54321', '127.0.0.1:54321', '[::1]:54321', 'LOCALHOST:54321']) {
    assert.equal(isAllowedHost(host), true, host)
  }
  for (const host of ['atacante.example:54321', 'localhost', '127.0.0.1:5173', 'localhost.atacante.example:54321', '', undefined]) {
    assert.equal(isAllowedHost(host), false, String(host))
  }
})

// DNS rebinding: o navegador manda o Host do domínio do atacante. A recusa vem
// antes de qualquer consulta, então o teste não precisa de Postgres.
test('sb-shim recusa com 403 um Host de fora antes de tocar o banco', async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address()
    const response = await new Promise((resolve, reject) => {
      const request = http.request({ host: '127.0.0.1', port, path: '/rest/v1/users', headers: { host: 'atacante.example:54321' } }, (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => resolve({ status: res.statusCode, body }))
      })
      request.on('error', reject)
      request.end()
    })
    assert.equal(response.status, 403)
    assert.match(response.body, /host not allowed/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

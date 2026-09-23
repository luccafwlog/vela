import {
  instrumentHttpHandler,
  redactTelemetryUrl,
  scrubTelemetryText,
  scrubTelemetryValue,
} from '../../../src/lib/telemetryContract.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

Deno.test('shared telemetry contract scrubs identifiers and opaque URL queries', () => {
  assert(
    scrubTelemetryText('12.345.678/0001-95 lucca@example.com') === '[cnpj] [email]',
    'expected identifiers to be scrubbed',
  )
  assert(
    redactTelemetryUrl('/portal/ativar?token=opaque') === '/portal/ativar',
    'expected opaque query string to be removed',
  )
  const scrubbed = scrubTelemetryValue({ nested: { message: '12345678909' } }) as { nested: { message: string } }
  assert(scrubbed.nested.message === '[digits11]', 'expected nested CPF to be scrubbed')
})

Deno.test('edge telemetry reports server errors without changing responses', async () => {
  const reports: Array<{ error: unknown; context: unknown }> = []
  const handler = instrumentHttpHandler(
    'synthetic',
    async () => new Response('private payload', { status: 503 }),
    async (error, context) => { reports.push({ error, context }) },
  )

  const response = await handler(new Request('https://example.test'))
  assert(response.status === 503, 'expected original status')
  assert((await response.text()) === 'private payload', 'expected original response body')
  assert(reports.length === 1, 'expected one telemetry report')
  assert(JSON.stringify(reports).indexOf('private payload') === -1, 'telemetry must not receive response body')
})

Deno.test('edge telemetry failure never masks the endpoint exception', async () => {
  const original = new Error('operation failed')
  const handler = instrumentHttpHandler(
    'synthetic',
    async () => { throw original },
    async () => { throw new Error('telemetry unavailable') },
  )

  try {
    await handler(new Request('https://example.test'))
    throw new Error('expected original error to escape')
  } catch (error) {
    assert(error === original, 'expected the original endpoint error')
  }
})

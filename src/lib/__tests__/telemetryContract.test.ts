import { describe, expect, it, vi } from 'vitest'
import {
  instrumentHttpHandler,
  redactTelemetryUrl,
  scrubTelemetryText,
  scrubTelemetryValue,
} from '../telemetryContract'

describe('shared telemetry privacy contract', () => {
  it('redacts Brazilian identifiers and email in browser and edge strings', () => {
    expect(scrubTelemetryText('12.345.678/0001-95 123.456.789-09 lucca@example.com'))
      .toBe('[cnpj] [cpf] [email]')
  })

  it('removes whole query strings so opaque recovery tokens cannot escape', () => {
    expect(redactTelemetryUrl('/portal/ativar?token=opaque-secret&email=lucca@example.com'))
      .toBe('/portal/ativar')
  })

  it('scrubs nested plain values and omits values past the depth limit', () => {
    expect(scrubTelemetryValue({
      message: 'contato lucca@example.com',
      nested: { document: '12345678909' },
      tooDeep: { one: { two: { three: { four: 'do-not-preserve@example.com' } } } },
    })).toEqual({
      message: 'contato [email]',
      nested: { document: '[digits11]' },
      tooDeep: { one: { two: { three: '[nested-value-omitted]' } } },
    })
  })

  it('does not serialize class instances whose fields may contain unreviewed data', () => {
    expect(scrubTelemetryValue(new Error('secret@example.com'))).toBe('[non-plain-value-omitted]')
  })

  it('leaves successful HTTP responses untouched and unreported', async () => {
    const report = vi.fn().mockResolvedValue(undefined)
    const response = new Response('ok', { status: 200 })
    const handler = instrumentHttpHandler('synthetic', async () => response, report)

    await expect(handler(new Request('https://example.test'))).resolves.toBe(response)
    expect(report).not.toHaveBeenCalled()
  })

  it('reports a 5xx without reading or forwarding the response body', async () => {
    const report = vi.fn().mockResolvedValue(undefined)
    const handler = instrumentHttpHandler(
      'synthetic',
      async () => new Response('private response payload', { status: 503 }),
      report,
    )

    const response = await handler(new Request('https://example.test'))
    expect(response.status).toBe(503)
    expect(report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      functionName: 'synthetic',
      status: 'http_503',
      category: 'server_error',
    }))
    expect(JSON.stringify(report.mock.calls)).not.toContain('private response payload')
  })

  it('preserves thrown errors even if the telemetry provider fails', async () => {
    const failure = new Error('operation failed')
    const report = vi.fn().mockRejectedValue(new Error('provider offline'))
    const handler = instrumentHttpHandler('synthetic', async () => { throw failure }, report)

    await expect(handler(new Request('https://example.test'))).rejects.toBe(failure)
    expect(report).toHaveBeenCalledWith(failure, expect.objectContaining({
      functionName: 'synthetic',
      status: 'uncaught',
      category: 'uncaught_exception',
    }))
  })
})

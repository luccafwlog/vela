import { describe, expect, it, vi } from 'vitest'
import {
  instrumentEdgeJob,
  instrumentHttpHandler,
  redactTelemetryUrl,
  scrubTelemetryText,
  scrubTelemetryValue,
  summarizeEdgeJobResponse,
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

  it('does not report an explicitly expected paused 503', async () => {
    const report = vi.fn().mockResolvedValue(undefined)
    const handler = instrumentHttpHandler(
      'synthetic',
      async () => new Response(JSON.stringify({ status: 'paused' }), { status: 503 }),
      report,
      async (response) => {
        const body = await response.clone().json() as { status?: string }
        return body.status !== 'paused'
      },
    )

    const response = await handler(new Request('https://example.test'))
    expect(response.status).toBe(503)
    expect(report).not.toHaveBeenCalled()
  })

  it('reports an authorized cron lifecycle with only allowlisted aggregate fields', async () => {
    const report = vi.fn().mockResolvedValue(undefined)
    const now = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(1_250)
    const response = new Response(JSON.stringify({ customerId: 123, email: 'private@example.com' }), { status: 200 })

    await expect(instrumentEdgeJob(
      'portal-daily-digest',
      'digest_recipients_attempted',
      async () => response,
      () => ({ result: 'partial', processedCount: 2 }),
      report,
      { now },
    )).resolves.toBe(response)

    expect(report).toHaveBeenNthCalledWith(1, {
      jobName: 'portal-daily-digest',
      countKind: 'digest_recipients_attempted',
      stage: 'started',
    })
    expect(report).toHaveBeenNthCalledWith(2, {
      jobName: 'portal-daily-digest',
      countKind: 'digest_recipients_attempted',
      stage: 'finished',
      result: 'partial',
      durationMs: 250,
      processedCount: 2,
    })
    expect(JSON.stringify(report.mock.calls)).not.toMatch(/customerId|private@example\.com/)
  })

  it('summarizes only explicit numeric response fields without consuming or forwarding the body', async () => {
    const response = new Response(JSON.stringify({
      candidates: 2,
      failed: 1,
      sent: [{ customerId: 42, email: 'private@example.com' }],
    }), { status: 200 })
    const summary = await summarizeEdgeJobResponse(
      response,
      (body) => typeof body.candidates === 'number' ? body.candidates : 0,
      (body) => typeof body.failed === 'number' && body.failed > 0,
    )

    expect(summary).toEqual({ result: 'partial', processedCount: 2 })
    expect(JSON.stringify(summary)).not.toContain('private@example.com')
    expect((await response.json()).sent).toHaveLength(1)
  })

  it('skips lifecycle events for unauthorized invocations and preserves job exceptions', async () => {
    const report = vi.fn().mockResolvedValue(undefined)
    const summarize = vi.fn()
    const unauthorizedResponse = new Response(null, { status: 401 })
    await expect(instrumentEdgeJob(
      'alerts-detector',
      'detectors_completed',
      async () => unauthorizedResponse,
      summarize,
      report,
      { enabled: false },
    )).resolves.toBe(unauthorizedResponse)
    expect(report).not.toHaveBeenCalled()
    expect(summarize).not.toHaveBeenCalled()

    const failure = new Error('private backend details')
    await expect(instrumentEdgeJob(
      'alerts-detector',
      'detectors_completed',
      async () => { throw failure },
      summarize,
      report,
      { now: () => 500 },
    )).rejects.toBe(failure)
    expect(report).toHaveBeenLastCalledWith({
      jobName: 'alerts-detector',
      countKind: 'detectors_completed',
      stage: 'finished',
      result: 'failure',
      durationMs: 0,
      processedCount: 0,
    })
    expect(JSON.stringify(report.mock.calls)).not.toContain('private backend details')
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

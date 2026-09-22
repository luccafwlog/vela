import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { logPortalEmailEvent } from '../../../supabase/functions/_shared/logger'

describe('structured logging de eventos de email do Portal', () => {
  afterEach(() => vi.restoreAllMocks())

  it('emite somente função, job, status e código de erro allowlisted', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    logPortalEmailEvent({
      job: 'event_processing',
      status: 'error',
      errorCode: 'event_processing_failed',
    })

    expect(error).toHaveBeenCalledOnce()
    const entry = JSON.parse(String(error.mock.calls[0][0]))
    expect(entry).toEqual({
      function: 'portal-email-events-runner',
      job: 'event_processing',
      status: 'error',
      error_code: 'event_processing_failed',
    })
    expect(Object.keys(entry).sort()).toEqual(['error_code', 'function', 'job', 'status'])
  })

  it('não deixa os módulos de processamento emitir logs diretos', () => {
    const root = process.cwd()
    const processor = readFileSync(resolve(root, 'supabase/functions/_shared/portalEmailEventProcessor.ts'), 'utf8')
    const runner = readFileSync(resolve(root, 'supabase/functions/portal-email-events-runner/index.ts'), 'utf8')

    expect(processor).not.toMatch(/console\.(?:log|info|warn|error)\s*\(/)
    expect(runner).not.toMatch(/console\.(?:log|info|warn|error)\s*\(/)
  })
})

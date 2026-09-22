import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { logEdgeFailure, logEmailDryRun, type EdgeFailureLog } from '../../../supabase/functions/_shared/logger'

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return listTypeScriptFiles(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

describe('logs estruturados das Edge Functions críticas', () => {
  afterEach(() => vi.restoreAllMocks())

  it('emite apenas campos fixos e allowlisted', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    logEdgeFailure({
      functionName: 'demurrage-dunning',
      job: 'email_dispatch',
      errorCode: 'email_send_failed',
    })

    expect(error).toHaveBeenCalledOnce()
    const entry = JSON.parse(String(error.mock.calls[0][0]))
    expect(entry).toEqual({
      function: 'demurrage-dunning',
      job: 'email_dispatch',
      status: 'error',
      error_code: 'email_send_failed',
    })
    expect(Object.keys(entry).sort()).toEqual(['error_code', 'function', 'job', 'status'])
  })

  it('descarta valores fora da allowlist também em runtime', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hostileEntry = {
      functionName: 'client@example.test',
      job: 'invoice 12345',
      errorCode: 'bearer-secret-value',
    } as unknown as EdgeFailureLog

    logEdgeFailure(hostileEntry)

    expect(error).not.toHaveBeenCalled()
  })

  it('registra dry-run de email sem destinatário ou ID de tentativa', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    logEmailDryRun()

    expect(JSON.parse(String(info.mock.calls[0][0]))).toEqual({
      function: 'email',
      job: 'dry_run',
      status: 'success',
    })
  })

  it('não permite log direto de erros nas funções cobertas', () => {
    const root = resolve(process.cwd(), 'supabase/functions')
    const sources = listTypeScriptFiles(root).filter((path) => !path.endsWith(resolve(root, '_shared/logger.ts').slice(root.length + 1)))
    for (const path of sources) {
      const source = readFileSync(path, 'utf8')
      expect(source, path.slice(root.length + 1)).not.toMatch(/console\.(?:log|info|warn|error)\s*\(/)
    }
  })
})

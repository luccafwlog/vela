import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyEdgeTelemetryScope } from '../../../supabase/functions/_shared/telemetryScope.ts'

// Plano dos e-mails, 2.2 (INF-02): cada evento de Edge Function tem fingerprint
// por função e status, e as Edges de e-mail do Portal passam pelo Sentry.
function fakeScope() {
  const tags: Record<string, string> = {}
  let fingerprint: string[] | null = null
  return {
    scope: {
      setTag: (key: string, value: string) => { tags[key] = value },
      setFingerprint: (value: string[]) => { fingerprint = value },
    },
    tags,
    fingerprint: () => fingerprint,
  }
}

describe('escopo do Sentry nas Edge Functions', () => {
  it('agrupa por função e status, não pela mensagem genérica', () => {
    const first = fakeScope()
    applyEdgeTelemetryScope(first.scope, { functionName: 'portal-password-recovery', status: 'http_500', category: 'server_error', durationMs: 12 })
    expect(first.fingerprint()).toEqual(['edge', 'portal-password-recovery', 'http_500'])
    expect(first.tags).toMatchObject({ surface: 'edge', function_name: 'portal-password-recovery', status: 'http_500', categoria_falha: 'server_error', duration_ms: '12' })

    const second = fakeScope()
    applyEdgeTelemetryScope(second.scope, { functionName: 'portal-invite-send', status: 'uncaught' })
    expect(second.fingerprint()).toEqual(['edge', 'portal-invite-send', 'uncaught'])
  })

  it('código SQLSTATE e RPC da falha viram tags, sem mudar o agrupamento', () => {
    const scope = fakeScope()
    applyEdgeTelemetryScope(scope.scope, { functionName: 'alerts-detector', status: 'http_500', errorCode: '22023', failedRpc: 'run_alert_detectors' })
    expect(scope.tags).toMatchObject({ codigo_erro: '22023', rpc: 'run_alert_detectors' })
    expect(scope.fingerprint()).toEqual(['edge', 'alerts-detector', 'http_500'])
  })

  it('sem status, agrupa em "unknown" em vez de juntar com outros status', () => {
    const scope = fakeScope()
    applyEdgeTelemetryScope(scope.scope, { functionName: 'portal-invite-send' })
    expect(scope.fingerprint()).toEqual(['edge', 'portal-invite-send', 'unknown'])
  })

  it('as Edges de e-mail do Portal passam pelo wrapper do Sentry', () => {
    for (const name of ['portal-password-recovery', 'portal-recovery-email-change', 'portal-invite-send']) {
      const source = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8')
      expect(source).toContain(`instrumentEdgeHandler('${name}'`)
    }
    // O envio da recuperação roda depois da resposta: a falha vai ao Sentry pelo capture direto.
    expect(readFileSync('supabase/functions/portal-password-recovery/index.ts', 'utf8')).toContain('captureEdgeException(')
  })
})

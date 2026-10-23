import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const config = readFileSync('supabase/config.toml', 'utf8')
const deno = JSON.parse(readFileSync('supabase/functions/deno.json', 'utf8')) as {
  imports?: Record<string, string>
}
const instrumentedFunctions = [
  'alerts-detector',
  'portal-daily-digest',
  'portal-email-webhook',
  'portal-email-events-runner',
  'portal-invite-send',
  'ce-unlock-notify-email',
  'portal-password-recovery',
  'portal-recovery-email-change',
  'send-customer-communication',
  'demurrage-dunning',
  'customer-communication-auto-runner',
  'import-effects-runner',
  'recalc-demurrage-ptax',
  'itau-pix',
]

describe('Edge telemetry configuration', () => {
  it('points every instrumented function at the shared Deno dependency manifest', () => {
    for (const functionName of instrumentedFunctions) {
      expect(config).toContain(`[functions.${functionName}]\nverify_jwt = false\nimport_map = "./functions/deno.json"`)
    }
    expect(deno.imports?.['@sentry/deno']).toMatch(/^npm:@sentry\/deno@\d+\.\d+\.\d+$/)
  })

  // A integração do Supabase só publica no merge a função declarada aqui;
  // admin-users ficou de fora e parou numa versão antiga em produção.
  it('declares every Edge Function of the repository in config.toml', () => {
    const functions = readdirSync('supabase/functions', { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
      .map((entry) => entry.name)
    expect(functions.length).toBeGreaterThan(0)
    expect(functions.filter((name) => !config.includes(`[functions.${name}]`))).toEqual([])
  })
})

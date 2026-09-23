import { readFileSync } from 'node:fs'
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
  'send-customer-communication',
  'demurrage-dunning',
  'customer-communication-auto-runner',
  'import-effects-runner',
  'recalc-demurrage-ptax',
]

describe('Edge telemetry configuration', () => {
  it('points every instrumented function at the shared Deno dependency manifest', () => {
    for (const functionName of instrumentedFunctions) {
      expect(config).toContain(`[functions.${functionName}]\nverify_jwt = false\nimport_map = "./functions/deno.json"`)
    }
    expect(deno.imports?.['@sentry/deno']).toBe('npm:@sentry/deno@10.73.0')
  })
})

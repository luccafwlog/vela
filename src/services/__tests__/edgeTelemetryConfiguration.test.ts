import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const config = readFileSync('supabase/config.toml', 'utf8')
const deno = JSON.parse(readFileSync('supabase/functions/deno.json', 'utf8')) as {
  imports?: Record<string, string>
}
// Lista derivada do código, não escrita à mão: a função nova com o wrapper
// entra sozinha na conferência (as duas públicas da ADR 0114 ficaram sem o
// import map porque a lista fixa não as tinha; revisão da PR #1119).
const instrumentedFunctions = readdirSync('supabase/functions', { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
  .map((entry) => entry.name)
  .filter((name) => {
    try {
      return readFileSync(`supabase/functions/${name}/index.ts`, 'utf8').includes('instrumentEdgeHandler(')
    } catch {
      return false
    }
  })
  .sort()

describe('Edge telemetry configuration', () => {
  it('points every instrumented function at the shared Deno dependency manifest', () => {
    // Piso contra uma busca que não acha nada e passa vazia.
    expect(instrumentedFunctions).toEqual(expect.arrayContaining(['itau-pix', 'portal-password-recovery', 'public-container-lookup', 'public-ship-schedule']))
    for (const functionName of instrumentedFunctions) {
      expect(config, functionName).toContain(`[functions.${functionName}]\nverify_jwt = false\nimport_map = "./functions/deno.json"`)
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

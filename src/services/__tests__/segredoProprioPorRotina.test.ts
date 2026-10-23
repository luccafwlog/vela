import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validDedicatedAuthorization } from '../../../supabase/functions/_shared/ceUnlockCleanupAuth'

// Um segredo por rotina (auditoria run-3, decisão do dono de 2026-10-22).
describe('validDedicatedAuthorization', () => {
  it('sem o segredo próprio cadastrado, vale o compartilhado', () => {
    expect(validDedicatedAuthorization('Bearer compartilhado', undefined, 'compartilhado')).toBe(true)
    expect(validDedicatedAuthorization('Bearer outro', undefined, 'compartilhado')).toBe(false)
  })

  it('com o próprio cadastrado, só ele vale: o compartilhado é de outra rotina', () => {
    expect(validDedicatedAuthorization('Bearer proprio', 'proprio', 'compartilhado')).toBe(true)
    expect(validDedicatedAuthorization('Bearer compartilhado', 'proprio', 'compartilhado')).toBe(false)
    expect(validDedicatedAuthorization(null, 'proprio', 'compartilhado')).toBe(false)
  })
})

describe('Edges com segredo próprio', () => {
  it('avisos do Desbloqueio de CE usam CE_UNLOCK_NOTIFY_SECRET e, sem ele, o do expurgo', () => {
    const notify = readFileSync('supabase/functions/ce-unlock-notify-email/index.ts', 'utf8')
    expect(notify).toContain('validDedicatedAuthorization(header, Deno.env.get("CE_UNLOCK_NOTIFY_SECRET"), Deno.env.get("CE_UNLOCK_CLEANUP_SECRET"))')
    expect(notify).not.toContain('validCleanupAuthorization(')
    // O expurgo continua só com o próprio.
    const cleanup = readFileSync('supabase/functions/ce-unlock-cleanup/index.ts', 'utf8')
    expect(cleanup).toContain('Deno.env.get("CE_UNLOCK_CLEANUP_SECRET")')
    expect(cleanup).not.toContain('CE_UNLOCK_NOTIFY_SECRET')
  })

  it('itau-pix separa a rotina do diagnóstico e só aceita o segredo antigo na transição', () => {
    const itau = readFileSync('supabase/functions/itau-pix/index.ts', 'utf8')
    expect(itau).toContain('const routine = legacy || validBearer(authorization, Deno.env.get("ITAU_PIX_CRON_SECRET"));')
    expect(itau).toContain('const diagnostic = legacy || validBearer(authorization, Deno.env.get("ITAU_PIX_DIAGNOSTIC_SECRET"));')
    expect(itau).toContain('if (routineAction ? !routine : !diagnostic) return new Response("Acesso negado", { status: 403 });')
    // A recusa sem nenhum segredo válido vem antes de ler o corpo.
    expect(itau.indexOf('!(routine || diagnostic)')).toBeLessThan(itau.indexOf('await req.json()'))
  })
})

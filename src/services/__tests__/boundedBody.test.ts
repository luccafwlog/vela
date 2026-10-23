import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  SMALL_JSON_MAX_BYTES,
  readBoundedJsonBody,
  readBoundedText,
} from '../../../supabase/functions/_shared/boundedBody'

// Corpo em streaming sem Content-Length: conta quantos bytes a leitora puxou.
function streamingRequest(totalBytes: number, chunkBytes = 1024) {
  let pulled = 0
  const chunk = new Uint8Array(chunkBytes).fill(32)
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled += chunk.length
      controller.enqueue(chunk)
      if (pulled >= totalBytes) controller.close()
    },
  })
  const request = new Request('http://localhost/fn', { method: 'POST', body, duplex: 'half' } as RequestInit)
  return { request, pulled: () => pulled }
}

describe('leitura do corpo com teto (auditoria run-3)', () => {
  it('JSON pequeno passa; inválido ou ausente vira {} como o req.json().catch(() => ({}))', async () => {
    const ok = await readBoundedJsonBody(new Request('http://localhost/fn', { method: 'POST', body: JSON.stringify({ token: 'abc' }) }), SMALL_JSON_MAX_BYTES)
    expect(ok).toEqual({ tooLarge: false, value: { token: 'abc' } })
    expect(await readBoundedJsonBody(new Request('http://localhost/fn', { method: 'POST', body: '{nao' }), SMALL_JSON_MAX_BYTES)).toEqual({ tooLarge: false, value: {} })
    expect(await readBoundedJsonBody(new Request('http://localhost/fn', { method: 'POST' }), SMALL_JSON_MAX_BYTES)).toEqual({ tooLarge: false, value: {} })
  })

  it('corpo em streaming acima do teto para cedo, sem Content-Length', async () => {
    const { request, pulled } = streamingRequest(8 * 1024 * 1024)
    expect(await readBoundedJsonBody(request, SMALL_JSON_MAX_BYTES)).toEqual({ tooLarge: true })
    expect(pulled()).toBeLessThan(64 * 1024)
  })

  it('Content-Length declarado acima do teto recusa antes de ler', async () => {
    const request = new Request('http://localhost/fn', { method: 'POST', headers: { 'Content-Length': String(SMALL_JSON_MAX_BYTES + 1) }, body: '{}' })
    expect(await readBoundedJsonBody(request, SMALL_JSON_MAX_BYTES)).toEqual({ tooLarge: true })
  })

  it('texto no limite exato passa e um byte a mais é recusado', async () => {
    expect(await readBoundedText(new Request('http://localhost/fn', { method: 'POST', body: 'x'.repeat(100) }), 100)).toHaveLength(100)
    await expect(readBoundedText(new Request('http://localhost/fn', { method: 'POST', body: 'x'.repeat(101) }), 100)).rejects.toThrow('acima do limite')
  })
})

describe('Edges com JSON pequeno usam a leitora com teto', () => {
  const fn = (name: string) => readFileSync(`supabase/functions/${name}/index.ts`, 'utf8')
  const all = ['admin-users', 'portal-invite-send', 'portal-account-suspend', 'portal-login', 'portal-password-recovery', 'portal-password-reset', 'portal-invite-activate']

  it.each(all)('%s lê o corpo pela leitora e responde 413 acima do teto', (name) => {
    const source = fn(name)
    expect(source).toContain('readBoundedJsonBody(req, SMALL_JSON_MAX_BYTES)')
    expect(source).toMatch(/parsed\.tooLarge\) return [^\n]*413/)
    expect(source).not.toContain('req.json()')
  })

  it('admin-users, convite e suspensão só leem o corpo depois do papel e da sessão de quem chama', () => {
    const admin = fn('admin-users')
    expect(admin.indexOf("caller.rpc('is_admin')")).toBeLessThan(admin.indexOf('readBoundedJsonBody(req'))
    expect(admin.indexOf('if (!actorId)')).toBeLessThan(admin.indexOf('readBoundedJsonBody(req'))
    for (const name of ['portal-invite-send', 'portal-account-suspend']) {
      const source = fn(name)
      expect(source.indexOf("caller.rpc('portal_current_role')")).toBeLessThan(source.indexOf('readBoundedJsonBody(req'))
      expect(source.indexOf('if (callerError || !actorId)')).toBeLessThan(source.indexOf('readBoundedJsonBody(req'))
    }
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { IMMUTABLE, onRequest } from '../../functions/assets/[[path]]'

const assets = (response: Response) => ({ ASSETS: { fetch: async () => response } })
const request = new Request('https://vela.app.br/assets/x.js')

describe('Pages Function /assets/*', () => {
  it('turns the SPA fallback into an uncached 404', async () => {
    const fallback = new Response('<html></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })
    const response = await onRequest({ request, env: assets(fallback) })
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('keeps real assets immutable', async () => {
    const js = new Response('export {}', { headers: { 'content-type': 'application/javascript' } })
    const response = await onRequest({ request, env: assets(js) })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe(IMMUTABLE)
    expect(await response.text()).toBe('export {}')
  })
})

describe('public/chunk-recovery.js', () => {
  function boot() {
    const listeners: Record<string, (event: unknown) => void> = {}
    const store = new Map<string, string>()
    const w = {
      sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
      location: { reload: vi.fn() },
      fetch: vi.fn(async () => new Response('')),
      document: { addEventListener: (type: string, fn: (event: unknown) => void) => { listeners[`doc:${type}`] = fn } },
      addEventListener: (type: string, fn: (event: unknown) => void) => { listeners[type] = fn },
    }
    new Function('window', readFileSync('public/chunk-recovery.js', 'utf8'))(w)
    return { w, listeners }
  }

  it('refetches a failed entry chunk bypassing cache and reloads once per file', async () => {
    const { w, listeners } = boot()
    const script = { tagName: 'SCRIPT', type: 'module', src: 'https://vela.app.br/assets/featureFlags-EpJVn8oD.js' }
    listeners['doc:error']({ target: script })
    listeners['doc:error']({ target: script })
    await vi.waitFor(() => expect(w.location.reload).toHaveBeenCalledTimes(1))
    expect(w.fetch).toHaveBeenCalledTimes(1)
    expect(w.fetch).toHaveBeenCalledWith(script.src, { cache: 'reload' })
  })

  it('handles vite:preloadError', async () => {
    const { w, listeners } = boot()
    const event = { payload: new Error('Unable to preload CSS for https://vela.app.br/assets/Page-abc.css'), preventDefault: vi.fn() }
    listeners['vite:preloadError'](event)
    expect(event.preventDefault).toHaveBeenCalled()
    await vi.waitFor(() => expect(w.location.reload).toHaveBeenCalledTimes(1))
  })
})

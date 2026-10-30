import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { onRequest, parseEmbedHeaders } from '../../functions/portal/publico/[[path]]'
import {
  PUBLIC_EMBED_HEADERS_FILE,
  PUBLIC_EMBED_PATHS,
  STATIC_SECURITY_HEADERS,
  publicEmbedSecurityHeaders,
  securityHeaders,
} from '../../scripts/cloudflare-security-headers.mjs'

// ADR 0114: só as duas páginas de /portal/publico/ podem ir para iframe, e só
// no fwlog.com.br.
const PAGE = '<html>portal</html>'
const html = (body = PAGE) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY' } })
const jsonFile = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

function site(embedFile: Response | null) {
  const requested: string[] = []
  return {
    requested,
    env: {
      ASSETS: {
        fetch: async (request: Request) => {
          const { pathname } = new URL(request.url)
          requested.push(pathname)
          if (pathname === `/${PUBLIC_EMBED_HEADERS_FILE}`) return embedFile ?? html()
          return html()
        },
      },
    },
  }
}

const request = (method = 'GET', path = '/portal/publico/chegadas-saidas') => new Request(`https://portalfwlog.com.br${path}`, { method })

function expectDeniesFraming(response: Response) {
  expect(response.status).toBe(404)
  expect(response.headers.get('X-Frame-Options')).toBe('DENY')
  expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
}

describe('Pages Function /portal/publico/*', () => {
  it('no site do Portal, serve a SPA com frame-ancestors só do fwlog.com.br e sem X-Frame-Options', async () => {
    const portal = site(jsonFile(publicEmbedSecurityHeaders('https://abcd.supabase.co')))
    const response = await onRequest({ request: request(), env: portal.env })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(PAGE)
    expect(response.headers.get('X-Frame-Options')).toBeNull()
    const csp = response.headers.get('Content-Security-Policy') ?? ''
    expect(csp).toContain('frame-ancestors https://fwlog.com.br https://www.fwlog.com.br;')
    expect(csp).toContain('https://abcd.supabase.co')
    for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
      if (name !== 'X-Frame-Options') expect(response.headers.get(name)).toBe(value)
    }
    // Sempre a entrada da SPA, nunca o caminho pedido.
    expect(portal.requested).toEqual([`/${PUBLIC_EMBED_HEADERS_FILE}`, '/portal'])
  })

  it('sem o arquivo do stage (site interno), 404 que nega iframe', async () => {
    expectDeniesFraming(await onRequest({ request: request(), env: site(null).env }))
  })

  it('arquivo com frame-ancestors aberto, com X-Frame-Options ou malformado: 404 que nega iframe', async () => {
    const open = { ...publicEmbedSecurityHeaders(null), 'Content-Security-Policy': securityHeaders(null)['Content-Security-Policy'].replace("frame-ancestors 'none'", 'frame-ancestors *') }
    for (const file of [
      jsonFile(open),
      jsonFile({ ...publicEmbedSecurityHeaders(null), 'X-Frame-Options': 'ALLOWALL' }),
      jsonFile({ 'Content-Security-Policy': 42 }),
      jsonFile([]),
      new Response('{', { headers: { 'content-type': 'application/json' } }),
    ]) {
      expectDeniesFraming(await onRequest({ request: request(), env: site(file).env }))
    }
    expect(parseEmbedHeaders(publicEmbedSecurityHeaders(null))).not.toBeNull()
  })

  it('só os dois caminhos exatos (com ou sem barra final) saem embedáveis; outro caminho público é 404 que nega iframe', async () => {
    for (const path of ['/portal/publico/chegadas-saidas', '/portal/publico/consulta-container', '/portal/publico/consulta-container/']) {
      // Um site por pedido: o corpo do arquivo falso só pode ser lido uma vez.
      const portal = site(jsonFile(publicEmbedSecurityHeaders('https://abcd.supabase.co')))
      const response = await onRequest({ request: request('GET', path), env: portal.env })
      expect(response.status, path).toBe(200)
      expect(response.headers.get('X-Frame-Options'), path).toBeNull()
    }
    // Abertos pela SPA, cairiam no `*` do Portal e no login, dentro do iframe.
    const denied = site(jsonFile(publicEmbedSecurityHeaders('https://abcd.supabase.co')))
    for (const path of [
      '/portal/publico',
      '/portal/publico/',
      '/portal/publico/xyz',
      '/portal/publico/chegadas-e-saidas',
      '/portal/publico/chegadas-saidas/outra',
      '/portal/publico/chegadas-saidas//',
      '/portal/publico/CHEGADAS-SAIDAS',
      '/portal/publico/chegadas%2Dsaidas',
    ]) {
      expectDeniesFraming(await onRequest({ request: request('GET', path), env: denied.env }))
    }
    expect(denied.requested).toEqual([])
  })

  it('a lista exata da Function é a das rotas públicas da SPA (AppPortal)', () => {
    const source = readFileSync(join(process.cwd(), 'src/AppPortal.tsx'), 'utf8')
    const routes = [...source.matchAll(/<Route path="(\/portal\/publico\/[^"]*)"/g)].map((match) => match[1])
    expect(routes.filter((path) => path !== '/portal/publico/*').sort()).toEqual([...PUBLIC_EMBED_PATHS].sort())
    // O resto de /portal/publico/ fica numa página própria, nunca no `*` do Portal.
    expect(routes).toContain('/portal/publico/*')
  })

  it('só GET e HEAD', async () => {
    const env = site(jsonFile(publicEmbedSecurityHeaders(null))).env
    expectDeniesFraming(await onRequest({ request: request('POST'), env }))
    const head = await onRequest({ request: request('HEAD'), env })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
  })

  it('nenhuma outra Function nem o `_headers` libera iframe', () => {
    const root = join(process.cwd(), 'functions')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else files.push(relative(root, path).replaceAll('\\', '/'))
      }
    }
    walk(root)
    expect(files.sort()).toEqual(['assets/[[path]].ts', 'portal/publico/[[path]].ts'])
    expect(readFileSync(join(root, 'assets/[[path]].ts'), 'utf8')).not.toMatch(/PUBLIC_EMBED|frame-ancestors|X-Frame-Options/)
    expect(securityHeaders('https://abcd.supabase.co')['X-Frame-Options']).toBe('DENY')
    expect(securityHeaders('https://abcd.supabase.co')['Content-Security-Policy']).toContain("frame-ancestors 'none'")
  })
})

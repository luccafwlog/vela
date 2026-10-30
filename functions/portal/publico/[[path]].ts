// Pages Function das páginas públicas embedáveis (ADR 0114): o quadro
// "Chegadas e saídas" e a Consulta de container que o fwlog.com.br põe em
// iframe. `_headers` mandaria `X-Frame-Options: DENY` e `frame-ancestors
// 'none'` (como em todo o site) e não se aplica a respostas de Function, então
// os headers saem daqui: os do site, sem `X-Frame-Options` e com
// `frame-ancestors` só do fwlog.com.br.
//
// Os headers vêm do arquivo que o stage grava só no site do Portal (com a
// origem do Supabase do build no connect-src). Sem ele (site interno, build
// sem stage) ou com ele fora do esperado, a resposta é 404 com os headers que
// negam iframe: nunca há página embedável por engano.
import {
  PUBLIC_EMBED_FRAME_ANCESTORS,
  PUBLIC_EMBED_HEADERS_FILE,
  securityHeaders,
} from '../../../scripts/cloudflare-security-headers.mjs'

type Context = { request: Request; env: { ASSETS: { fetch: (request: Request) => Promise<Response> } } }

const DENY_HEADERS: Readonly<Record<string, string>> = securityHeaders(null)
const EXPECTED_FRAME_ANCESTORS = `frame-ancestors ${PUBLIC_EMBED_FRAME_ANCESTORS.join(' ')}`

function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { ...DENY_HEADERS, 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

/** Headers do arquivo do stage, conferidos; `null` quando faltam ou fogem do contrato. */
export function parseEmbedHeaders(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const entries = Object.entries(raw as Record<string, unknown>)
  if (!entries.every(([, value]) => typeof value === 'string')) return null
  const headers = Object.fromEntries(entries) as Record<string, string>
  const csp = headers['Content-Security-Policy'] ?? ''
  const directives = csp.split(';').map((directive) => directive.trim())
  const ancestors = directives.filter((directive) => directive.startsWith('frame-ancestors'))
  if (ancestors.length !== 1 || ancestors[0] !== EXPECTED_FRAME_ANCESTORS) return null
  if (Object.keys(headers).some((name) => name.toLowerCase() === 'x-frame-options')) return null
  return headers
}

async function embedHeaders(request: Request, env: Context['env']): Promise<Record<string, string> | null> {
  const file = await env.ASSETS.fetch(new Request(new URL(`/${PUBLIC_EMBED_HEADERS_FILE}`, request.url)))
  // Sem o arquivo, o fallback da SPA devolve HTML: não é o site do Portal.
  if (!file.ok || !(file.headers.get('content-type') ?? '').includes('json')) return null
  try {
    return parseEmbedHeaders(await file.json())
  } catch {
    return null
  }
}

export async function onRequest({ request, env }: Context): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return notFound()
  const headers = await embedHeaders(request, env)
  if (!headers) return notFound()
  // A entrada da SPA do Portal; o roteador do navegador abre a página pública.
  const page = await env.ASSETS.fetch(new Request(new URL('/portal', request.url)))
  if (!page.ok || !(page.headers.get('content-type') ?? '').startsWith('text/html')) return notFound()
  const response = new Response(request.method === 'HEAD' ? null : page.body, page)
  response.headers.delete('X-Frame-Options')
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value)
  response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
  return response
}

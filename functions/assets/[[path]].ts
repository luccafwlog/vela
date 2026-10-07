// Pages Function para /assets/*. Sem ela, um chunk inexistente cai no fallback
// SPA (index.html, 200) e herda o `immutable` de `_headers`: o navegador guarda
// HTML no nome do chunk por um ano e o app abre em branco (incidente
// 2026-10-07). `_headers` não se aplica a respostas de Functions, então os
// headers dos assets reais são definidos aqui.
// ponytail: toda requisição de /assets/* passa por uma invocação de Function
// (cota do plano Pages Functions); se o volume pesar, migrar para Workers
// Static Assets com `not_found_handling = "none"` no diretório de assets.
type Context = { request: Request; env: { ASSETS: { fetch: (request: Request) => Promise<Response> } } }

export const IMMUTABLE = 'public, max-age=31536000, immutable'

export async function onRequest({ request, env }: Context): Promise<Response> {
  const asset = await env.ASSETS.fetch(request)
  const contentType = asset.headers.get('content-type') ?? ''
  // Nenhum arquivo de build em /assets é HTML; HTML aqui é o fallback SPA.
  if (asset.status === 404 || contentType.startsWith('text/html')) {
    return new Response('Not found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
    })
  }
  const response = new Response(asset.body, asset)
  if (asset.ok || asset.status === 304) response.headers.set('Cache-Control', IMMUTABLE)
  response.headers.set('X-Content-Type-Options', 'nosniff')
  return response
}

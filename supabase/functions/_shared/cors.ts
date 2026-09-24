// Allowlist única de origens do navegador para as Edge Functions.
// O app interno e o Portal têm builds e domínios próprios, mas compartilham
// este backend Supabase.
const FIXED_ALLOWED_ORIGINS = [
  'https://vela.app.br',
  'https://portalfwlog.com.br',
  'https://vela.vercel.app',
  'https://fwlog-portal.vercel.app',
  // Mantidos durante a janela de transição/cutover de DNS (ADR 0066)
  'https://transhippingdesk.com.br',
  'https://portal.transhippingdesk.com.br',
  'https://transhippingdesk.web.app',
  'https://transhippingdesk.firebaseapp.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]

// Preview URLs são efêmeras. O Vercel/Supabase Branching gera aliases dentro
// do projeto e da equipe abaixo; o padrão é restrito a essa combinação, nunca
// a um wildcard amplo de `vercel.app`. Origens adicionais continuam podendo
// ser configuradas como uma lista de URLs exatas.
const VERCEL_PREVIEW_ORIGINS = [
  /^https:\/\/vela(?:-[a-z0-9-]+)?-luccafwlogs-projects\.vercel\.app$/,
  /^https:\/\/fwlog-portal(?:-[a-z0-9-]+)?-luccafwlogs-projects\.vercel\.app$/,
  /^https:\/\/transhippingdesk(?:-[a-z0-9-]+)?-luccafwlogs-projects\.vercel\.app$/,
  // Cloudflare Pages: domínio de produção do projeto e aliases de Preview
  // (`pr-<n>.` ou hash do deployment). Nomes de projeto `pages.dev` são únicos
  // na Cloudflare, então o padrão fica restrito aos dois projetos do Vela.
  /^https:\/\/(?:[a-z0-9-]+\.)?vela-(?:internal|portal)\.pages\.dev$/,
]

export function parseConfiguredOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((value) => {
      try {
        const url = new URL(value)
        return url.protocol === 'https:' && url.origin === value ? [url.origin] : []
      } catch {
        return []
      }
    })
}

const denoRuntime = (globalThis as typeof globalThis & {
  Deno?: { env: { get(name: string): string | undefined } }
}).Deno
const configuredPreviewOrigins = parseConfiguredOrigins(denoRuntime?.env.get('VERCEL_PREVIEW_ORIGINS'))

export const ALLOWED_ORIGINS = new Set([...FIXED_ALLOWED_ORIGINS, ...configuredPreviewOrigins])

export function isAllowedOrigin(origin: string): boolean {
  return ALLOWED_ORIGINS.has(origin) || VERCEL_PREVIEW_ORIGINS.some((pattern) => pattern.test(origin))
}

// Origem fora da allowlist recebe a AUSÊNCIA do header, que é a negação correta
// em CORS. Devolver a string 'null' não nega: `null` é uma origem real — a que o
// navegador apresenta em iframe `sandbox`, documento `data:` e alguns
// redirecionamentos — e `Access-Control-Allow-Origin: null` casa com ela,
// liberando justamente o contexto mais anônimo. `Vary: Origin` acompanha porque a
// resposta passa a depender da origem, e cache compartilhado sem ele serviria o
// header de uma origem para outra.
export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
  if (origin && isAllowedOrigin(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

// Envolve um handler: responde o preflight OPTIONS e injeta os headers CORS em
// toda resposta (inclusive erros), sem precisar tocar em cada `new Response`.
export function withCors(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    const origin = req.headers.get('Origin')
    const headers = corsHeaders(origin)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    try {
      const res = await handler(req)
      const merged = new Headers(res.headers)
      for (const [key, value] of Object.entries(headers)) merged.set(key, value)
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: merged })
    } catch {
      return new Response(JSON.stringify({ error: 'Erro interno.' }), { status: 500, headers: { 'Content-Type': 'application/json', ...headers } })
    }
  }
}

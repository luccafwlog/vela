// Fonte única dos headers de segurança dos dois sites Pages. O `_headers`
// gerado por cloudflare-pages-stage.mjs e a Pages Function de /assets
// (functions/assets/[[path]].ts), à qual o `_headers` não se aplica, leem daqui.

export const STATIC_SECURITY_HEADERS = Object.freeze({
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
})

// Únicas páginas que outro site pode pôr em iframe (ADR 0112): o quadro e a
// consulta de container públicos, só dentro do fwlog.com.br. Todo o resto dos
// dois sites continua com `X-Frame-Options: DENY` e `frame-ancestors 'none'`.
export const PUBLIC_EMBED_PATH_PREFIX = '/portal/publico/'
export const PUBLIC_EMBED_FRAME_ANCESTORS = Object.freeze(['https://fwlog.com.br', 'https://www.fwlog.com.br'])
// Arquivo que o stage grava só no site do Portal; a Pages Function de
// /portal/publico/* lê os headers dele e, sem ele, recusa.
export const PUBLIC_EMBED_HEADERS_FILE = 'public-embed-headers.json'

// Sem `supabaseOrigin`, connect-src fica sem o projeto Supabase: é a política
// das respostas de /assets, que não fazem chamada ao Supabase.
export function contentSecurityPolicy(supabaseOrigin, frameAncestors = "'none'") {
  const supabase = supabaseOrigin ? ` ${supabaseOrigin} ${supabaseOrigin.replace('https://', 'wss://')}` : ''
  return [
    "default-src 'self'",
    "script-src 'self' https://challenges.cloudflare.com https://eu-assets.i.posthog.com",
    'frame-src https://challenges.cloudflare.com',
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `connect-src 'self'${supabase} https://olinda.bcb.gov.br https://*.ingest.us.sentry.io https://eu.i.posthog.com https://eu-assets.i.posthog.com https://challenges.cloudflare.com`,
    "img-src 'self' data:",
    "font-src 'self' https://fonts.gstatic.com",
    `frame-ancestors ${frameAncestors}`,
    "form-action 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ')
}

export function securityHeaders(supabaseOrigin) {
  return { ...STATIC_SECURITY_HEADERS, 'Content-Security-Policy': contentSecurityPolicy(supabaseOrigin) }
}

// Headers das páginas públicas embedáveis: os mesmos do site, sem
// `X-Frame-Options` (que não tem lista de origens) e com `frame-ancestors`
// restrito ao fwlog.com.br.
export function publicEmbedSecurityHeaders(supabaseOrigin) {
  const headers = { ...STATIC_SECURITY_HEADERS }
  delete headers['X-Frame-Options']
  return { ...headers, 'Content-Security-Policy': contentSecurityPolicy(supabaseOrigin, PUBLIC_EMBED_FRAME_ANCESTORS.join(' ')) }
}

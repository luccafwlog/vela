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

// Sem `supabaseOrigin`, connect-src fica sem o projeto Supabase: é a política
// das respostas de /assets, que não fazem chamada ao Supabase.
export function contentSecurityPolicy(supabaseOrigin) {
  const supabase = supabaseOrigin ? ` ${supabaseOrigin} ${supabaseOrigin.replace('https://', 'wss://')}` : ''
  return [
    "default-src 'self'",
    "script-src 'self' https://challenges.cloudflare.com https://eu-assets.i.posthog.com",
    'frame-src https://challenges.cloudflare.com',
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `connect-src 'self'${supabase} https://olinda.bcb.gov.br https://*.ingest.us.sentry.io https://eu.i.posthog.com https://eu-assets.i.posthog.com https://challenges.cloudflare.com`,
    "img-src 'self' data:",
    "font-src 'self' https://fonts.gstatic.com",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ')
}

export function securityHeaders(supabaseOrigin) {
  return { ...STATIC_SECURITY_HEADERS, 'Content-Security-Policy': contentSecurityPolicy(supabaseOrigin) }
}

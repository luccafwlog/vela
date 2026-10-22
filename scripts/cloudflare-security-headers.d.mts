// Tipos de cloudflare-security-headers.mjs para a Pages Function de /assets.
export const STATIC_SECURITY_HEADERS: Readonly<Record<string, string>>
export function contentSecurityPolicy(supabaseOrigin?: string | null): string
export function securityHeaders(supabaseOrigin?: string | null): Record<string, string>

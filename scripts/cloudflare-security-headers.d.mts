// Tipos de cloudflare-security-headers.mjs para a Pages Function de /assets.
export const STATIC_SECURITY_HEADERS: Readonly<Record<string, string>>
export function contentSecurityPolicy(supabaseOrigin?: string | null, frameAncestors?: string): string
export function securityHeaders(supabaseOrigin?: string | null): Record<string, string>
export const PUBLIC_EMBED_PATH_PREFIX: string
export const PUBLIC_EMBED_FRAME_ANCESTORS: readonly string[]
export const PUBLIC_EMBED_HEADERS_FILE: string
export function publicEmbedSecurityHeaders(supabaseOrigin?: string | null): Record<string, string>

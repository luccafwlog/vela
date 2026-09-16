export const DEFAULT_PORTAL_URL = 'https://portalfwlog.com.br'
export const DEFAULT_PORTAL_SUPPORT_EMAIL = 'suporte@portalfwlog.com.br'
const LEGACY_PORTAL_HOSTS = new Set(['transhippingdesk.com.br', 'www.transhippingdesk.com.br', 'portal.transhippingdesk.com.br'])
const LEGACY_PORTAL_SUPPORT_EMAIL = 'suporte@transhippingdesk.com.br'

interface DenoGlobal {
  env: {
    get(key: string): string | undefined
  }
}

function getDenoEnv(key: string): string | undefined {
  const deno = (globalThis as unknown as { Deno?: DenoGlobal }).Deno
  return deno?.env?.get(key)
}

/**
 * Retorna a origem canônica do Portal Fwlog (esquema + host, sem /portal nem barra final),
 * apropriada para carregar assets estáticos (ex: /branding/tr-logo.png) ou compor URLs base.
 */
export function canonicalPortalOrigin(): string {
  const envUrl = getDenoEnv('PORTAL_URL')
  const raw = (envUrl ?? DEFAULT_PORTAL_URL).trim().replace(/\/+$/, '')
  const base = raw || DEFAULT_PORTAL_URL
  const origin = base.replace(/\/portal(?:\/.*)?$/, '')
  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(origin) ? origin : `https://${origin}`)
    if (LEGACY_PORTAL_HOSTS.has(parsed.hostname.toLowerCase())) return DEFAULT_PORTAL_URL
  } catch {
    // Preserve the existing behavior for an explicitly configured custom URL;
    // deployment validation remains responsible for rejecting malformed values.
  }
  return origin
}

/**
 * Normaliza e constrói URLs canônicas para o Portal Fwlog.
 * Garante que caminhos nunca fiquem relativos (o que quebraria links em clientes de e-mail),
 * remove barras duplicadas e garante o prefixo canônico /portal.
 */
export function canonicalPortalUrl(subpath = ''): string {
  const domain = canonicalPortalOrigin()
  const cleanSub = subpath.replace(/^\/portal/, '').replace(/^\//, '')
  return cleanSub ? `${domain}/portal/${cleanSub}` : `${domain}/portal`
}

export function portalSupportEmail(): string {
  const email = getDenoEnv('PORTAL_SUPPORT_EMAIL')
  const normalized = (email ?? DEFAULT_PORTAL_SUPPORT_EMAIL).trim()
  return normalized.toLowerCase() === LEGACY_PORTAL_SUPPORT_EMAIL ? DEFAULT_PORTAL_SUPPORT_EMAIL : normalized || DEFAULT_PORTAL_SUPPORT_EMAIL
}

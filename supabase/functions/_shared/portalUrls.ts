import { PORTAL_ORIGIN, PORTAL_SUPPORT_EMAIL, portalContactEmail, portalOrigin, portalPageUrl } from '../../../src/config/portalUrl.ts'

// O endereço do Portal mora em src/config/portalUrl.ts (configuração única dos
// links dos e-mails, ponto 4 de 2026-10-23); aqui só se lê o PORTAL_URL.
export const DEFAULT_PORTAL_URL = PORTAL_ORIGIN
export const DEFAULT_PORTAL_SUPPORT_EMAIL = PORTAL_SUPPORT_EMAIL

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
  return portalOrigin(getDenoEnv('PORTAL_URL'))
}

/**
 * Normaliza e constrói URLs canônicas para o Portal Fwlog.
 * Garante que caminhos nunca fiquem relativos (o que quebraria links em clientes de e-mail),
 * remove barras duplicadas e garante o prefixo canônico /portal.
 */
export function canonicalPortalUrl(subpath = ''): string {
  return portalPageUrl(subpath, getDenoEnv('PORTAL_URL'))
}

export function portalSupportEmail(): string {
  return portalContactEmail(getDenoEnv('PORTAL_SUPPORT_EMAIL'))
}

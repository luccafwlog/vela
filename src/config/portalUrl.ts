// Endereço do Portal Fwlog: a configuração única dos links dos e-mails (ponto 4
// das observações de 2026-10-23). Módulo puro, usado pelo frontend e pelas Edge
// Functions (`supabase/functions/_shared/portalUrls.ts` importa daqui); quem
// lê a variável de ambiente (`PORTAL_URL` nas Edge Functions, `VITE_PORTAL_URL`
// no Vite) passa o valor para estas funções.

/** Origem do Portal em produção, também o padrão quando nada está configurado. */
export const PORTAL_ORIGIN = 'https://portalfwlog.com.br'

/**
 * Domínio do portal antigo (Transhipping Desk). Um `PORTAL_URL` antigo, ainda
 * configurado num ambiente, não pode levar o cliente para lá: a página abre
 * quebrada.
 */
export const LEGACY_PORTAL_DOMAIN = 'transhippingdesk.com.br'

function isLegacyHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === LEGACY_PORTAL_DOMAIN || host.endsWith(`.${LEGACY_PORTAL_DOMAIN}`)
}

/**
 * Origem (esquema e host, sem `/portal` nem barra final) a partir do valor
 * configurado, que pode vir com `/portal`, `/portal/billing`, `/billing` ou sem esquema.
 * Vazio ou domínio antigo dão a origem de produção.
 */
export function portalOrigin(configured?: string | null): string {
  const raw = (configured ?? '').trim().replace(/\/+$/, '')
  if (!raw) return PORTAL_ORIGIN
  // Configuração antiga terminava em `/billing` (com ou sem `/portal` antes):
  // os normalizadores que este módulo substituiu tiravam esse sufixo.
  const origin = raw.replace(/\/portal(?:\/.*)?$/, '').replace(/\/billing$/, '').replace(/\/+$/, '') || PORTAL_ORIGIN
  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(origin) ? origin : `https://${origin}`)
    if (isLegacyHost(parsed.hostname)) return PORTAL_ORIGIN
    // Sempre absoluta: o valor sem esquema ("portalfwlog.com.br") virava link relativo no e-mail.
    return parsed.origin
  } catch {
    // Valor malformado e explícito fica como veio; a validação do deploy o recusa.
  }
  return origin
}

/** Endereço de uma tela do Portal (`billing`, `ativar?token=…`), sempre absoluto e sob `/portal`. */
export function portalPageUrl(path = '', configured?: string | null): string {
  const origin = portalOrigin(configured)
  const clean = path.replace(/^\/+/, '').replace(/^portal(?:\/|$)/, '').replace(/^\/+/, '')
  return clean ? `${origin}/portal/${clean}` : `${origin}/portal`
}

/** Suporte do Portal; o endereço do domínio antigo vira o atual. */
export const PORTAL_SUPPORT_EMAIL = 'suporte@portalfwlog.com.br'

/** Contato que vai no rodapé e no "Fale com": e-mail do domínio antigo vira o suporte do Portal. */
export function portalContactEmail(email?: string | null): string {
  const value = (email ?? '').trim()
  if (!value) return PORTAL_SUPPORT_EMAIL
  const domain = value.split('@').pop()?.toLowerCase() ?? ''
  return domain === LEGACY_PORTAL_DOMAIN || domain.endsWith(`.${LEGACY_PORTAL_DOMAIN}`) ? PORTAL_SUPPORT_EMAIL : value
}

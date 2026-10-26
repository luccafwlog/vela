// Ponto 4 das observações de 2026-10-23: nenhum e-mail do Portal ou do Vela
// leva ao portal antigo (Transhipping Desk), e todo link aponta para uma tela
// que existe no Portal. A URL base do Portal mora numa configuração única
// (src/config/portalUrl.ts); aqui os e-mails são gerados com o PORTAL_URL do
// domínio antigo, como ainda pode estar configurado num ambiente.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LEGACY_PORTAL_DOMAIN, PORTAL_ORIGIN, portalContactEmail, portalOrigin, portalPageUrl } from '../../config/portalUrl'
import {
  renderCeMercanteTaxasTemplate,
  renderDemurrageGroupTemplate,
  renderDemurrageTemplate,
  renderInstitutionalTemplate,
  renderNoaTemplate,
  renderNobTemplate,
  renderNorTemplate,
  type CustomerCommunicationTemplateInput,
} from '../customerCommunicationTemplates'
import {
  bounceNotificationTemplate,
  ceUnlockNoticeTemplate,
  emailChangeAlertTemplate,
  emailChangeAssistedAlertTemplate,
  emailChangeConfirmTemplate,
  inviteTemplate,
  passwordChangedTemplate,
  recoveryTemplate,
  resendTemplate,
} from '../../../supabase/functions/_shared/portalEmailTemplates.ts'
import { dailyDigestTemplate } from '../../../supabase/functions/_shared/dailyDigestEmail.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const LEGACY_URLS = [
  'https://portal.transhippingdesk.com.br',
  'https://transhippingdesk.com.br/portal/billing',
  'www.transhippingdesk.com.br/portal',
  'http://desk.transhippingdesk.com.br/portal/',
]
const LEGACY_SUPPORT = 'suporte@transhippingdesk.com.br'

// Rotas do Portal, lidas do roteador (src/AppPortal.tsx).
const PORTAL_ROUTES = [...readFileSync(path.join(root, 'src/AppPortal.tsx'), 'utf8').matchAll(/path="(\/portal[^"]*)"/g)].map((m) => m[1])

function routeExists(pathname: string) {
  return PORTAL_ROUTES.some((route) => new RegExp(`^${route.replace(/:[^/]+/g, '[^/]+')}/?$`).test(pathname))
}

function input(portalUrl: string): CustomerCommunicationTemplateInput {
  return {
    customerId: 10,
    customerName: 'ACME Importação',
    vesselName: 'COSCO SHIPPING XING WANG',
    voyageNumber: '2401E',
    port: 'Santos (BRSSZ)',
    terminalName: 'BTP Santos',
    terminalId: 'term-1',
    milestoneAt: '2026-09-10T14:00:00Z',
    bls: [{ id: 'CSC45360805C00', customerId: 10, terminalId: 'term-1' }],
    portalUrl,
    ceMercanteRows: [{ blId: 'CSC45360805C00', ceMercante: '123456789012345', totalBrl: 1500.5 }],
    demurrage: { docNumber: 'DEM-2026-001', totalUsd: 500, totalBrl: 2750, roe: 5.5, roeReferenceDate: '2026-09-01' },
    subject: '',
    body: 'Informamos manutenção programada nos sistemas.',
  }
}

/** Todo e-mail que o Portal e o Vela geram, com o endereço configurado do Portal. */
function everyEmail(portalUrl: string) {
  const supportEmail = LEGACY_SUPPORT
  const line = { docNumber: 'DEM-1', blId: 'BL1', vesselName: 'NAVIO', voyageNumber: '1', totalUsd: 10, totalBrl: 55, roe: 5.5, roeReferenceDate: '2026-09-01' }
  return {
    'CE Mercante e Taxas Locais': renderCeMercanteTaxasTemplate(input(portalUrl)),
    'Cobrança de Demurrage': renderDemurrageTemplate(input(portalUrl)),
    'Cobrança de Demurrage agrupada': renderDemurrageGroupTemplate({ customerId: 10, customerName: 'ACME', lines: [line, { ...line, docNumber: 'DEM-2', blId: 'BL2' }], portalUrl }),
    NOA: renderNoaTemplate(input(portalUrl)),
    NOR: renderNorTemplate(input(portalUrl)),
    NOB: renderNobTemplate(input(portalUrl)),
    'Institucional sem assunto': renderInstitutionalTemplate({ ...input(portalUrl), bls: [] }, 'institucional'),
    Livre: renderInstitutionalTemplate(input(portalUrl), 'livre'),
    Convite: inviteTemplate({ companyName: 'ACME', cnpjMasked: '***', activationUrl: portalPageUrl('ativar?token=t', portalUrl), portalUrl, supportEmail }),
    'Reenvio do convite': resendTemplate({ companyName: 'ACME', cnpjMasked: '***', activationUrl: portalPageUrl('ativar?token=t', portalUrl), portalUrl, supportEmail }),
    'Recuperação de senha': recoveryTemplate({ companyName: 'ACME', cnpjMasked: '***', recoveryUrl: portalPageUrl('recuperar-senha?token=t', portalUrl), portalUrl, supportEmail }),
    'Confirmação do Email de Recuperação': emailChangeConfirmTemplate({ companyName: 'ACME', confirmUrl: portalPageUrl('confirmar-email?token=t', portalUrl), portalUrl, supportEmail }),
    'Alerta de troca de e-mail': emailChangeAlertTemplate({ portalUrl, supportEmail }),
    'Alerta de troca assistida': emailChangeAssistedAlertTemplate({ portalUrl, supportEmail }),
    'Senha alterada': passwordChangedTemplate({ companyName: 'ACME', cnpjMasked: '***', portalUrl, supportEmail }),
    'E-mail devolvido': bounceNotificationTemplate({ bouncedEmailMasked: 'c***@acme.com', portalUrl, supportEmail }),
    'Aviso do Desbloqueio de CE': ceUnlockNoticeTemplate({ title: 'Documentação validada', message: 'Prazo até 24/10 às 17:00.', portalUrl, supportEmail, request: { protocol: 'CE-1', bls: ['BL1'] } }),
    'Resumo diário': dailyDigestTemplate({ date: '2026-07-15', failures: 1, activity: 2, pending: 3, criticalOpened: 0, criticalClosed: 0, portalUrl, supportEmail }),
  }
}

describe('e-mails sem o domínio do portal antigo (ponto 4)', () => {
  for (const legacy of LEGACY_URLS) {
    it(`com PORTAL_URL ${legacy}, nenhum e-mail cita o domínio antigo`, () => {
      for (const [name, email] of Object.entries(everyEmail(legacy))) {
        const all = `${email.subject}\n${email.html}\n${email.text}`
        expect(all, name).not.toContain(LEGACY_PORTAL_DOMAIN)
        expect(all, name).not.toMatch(/Transhipping Desk/i)
      }
    })
  }

  it('todo link dos e-mails leva ao Portal atual, numa tela que existe', () => {
    expect(PORTAL_ROUTES).toContain('/portal/billing')
    const links = new Set<string>()
    for (const [name, email] of Object.entries(everyEmail(LEGACY_URLS[1]))) {
      for (const [, href] of email.html.matchAll(/href="([^"]+)"/g)) {
        if (href.startsWith('mailto:')) continue
        const url = new URL(href.replaceAll('&amp;', '&'))
        expect(url.origin, `${name}: ${href}`).toBe(PORTAL_ORIGIN)
        expect(routeExists(url.pathname), `${name}: ${url.pathname} não é tela do Portal`).toBe(true)
        links.add(url.pathname)
      }
      for (const [, src] of email.html.matchAll(/src="([^"]+)"/g)) expect(new URL(src).origin, `${name}: ${src}`).toBe(PORTAL_ORIGIN)
    }
    // O botão das Taxas do CE Mercante (o e-mail do pedido) e os demais destinos que existem hoje.
    expect([...links].sort()).toEqual(['/portal/ativar', '/portal/billing', '/portal/confirmar-email', '/portal/desbloqueio-ce', '/portal/perfil', '/portal/recuperar-senha'])
  })

  it('o e-mail das Taxas do CE Mercante leva às faturas do Portal atual', () => {
    const email = renderCeMercanteTaxasTemplate(input('https://portal.transhippingdesk.com.br/portal/billing'))
    expect(email.html).toContain('href="https://portalfwlog.com.br/portal/billing"')
    expect(email.text).toContain('Ver faturas e formas de pagamento: https://portalfwlog.com.br/portal/billing')
  })

  it('a configuração única normaliza o endereço do Portal', () => {
    expect(portalOrigin()).toBe('https://portalfwlog.com.br')
    expect(portalOrigin('  ')).toBe('https://portalfwlog.com.br')
    expect(portalOrigin('https://portal.transhippingdesk.com.br/portal/billing')).toBe('https://portalfwlog.com.br')
    expect(portalOrigin('https://staging.vela-portal.pages.dev/portal/')).toBe('https://staging.vela-portal.pages.dev')
    expect(portalPageUrl('billing', 'https://staging.vela-portal.pages.dev/portal/billing')).toBe('https://staging.vela-portal.pages.dev/portal/billing')
    expect(portalPageUrl('/portal/ativar?token=x')).toBe('https://portalfwlog.com.br/portal/ativar?token=x')
    expect(portalPageUrl()).toBe('https://portalfwlog.com.br/portal')
    // Configurado sem esquema: o link do e-mail continua absoluto.
    expect(portalPageUrl('billing', 'portalfwlog.com.br')).toBe('https://portalfwlog.com.br/portal/billing')
    expect(portalOrigin('staging.vela-portal.pages.dev/portal')).toBe('https://staging.vela-portal.pages.dev')
    expect(portalContactEmail(LEGACY_SUPPORT)).toBe('suporte@portalfwlog.com.br')
    expect(portalContactEmail('importacao@fwlog.com.br')).toBe('importacao@fwlog.com.br')
  })

  // Nenhum gerador de e-mail volta a escrever o domínio antigo direto no código.
  it('o domínio antigo só aparece na configuração que o troca pelo atual', () => {
    const allowed = new Set([
      'src/config/portalUrl.ts',
      // Domínio técnico `.invalid` do usuário de Auth interno do convite; nunca recebe e-mail.
      'supabase/functions/portal-invite-activate/index.ts',
    ])
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(path.join(root, dir))) {
        const rel = `${dir}/${entry}`
        if (entry === '__tests__' || entry === 'node_modules' || /\.test\.tsx?$/.test(entry)) continue
        if (statSync(path.join(root, rel)).isDirectory()) walk(rel)
        else if (/\.(ts|tsx|sql)$/.test(entry) && !allowed.has(rel) && readFileSync(path.join(root, rel), 'utf8').includes(LEGACY_PORTAL_DOMAIN)) offenders.push(rel)
      }
    }
    for (const dir of ['src', 'supabase/functions', 'supabase/migrations']) walk(dir)
    expect(offenders).toEqual([])
  })
})

// Revisão do PR: configuração antiga terminando em `/billing` continua gerando
// o link certo, como faziam os normalizadores que o módulo substituiu.
it('URL configurada com /billing ou /portal/billing leva a /portal/billing', () => {
  for (const configured of ['https://portalfwlog.com.br/billing', 'https://portalfwlog.com.br/portal/billing', 'https://portalfwlog.com.br/billing/']) {
    expect(portalPageUrl('billing', configured)).toBe('https://portalfwlog.com.br/portal/billing')
  }
})

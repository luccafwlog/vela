import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dailyDigestTemplate } from '../../../supabase/functions/_shared/dailyDigestEmail.ts'
import {
  bounceNotificationTemplate,
  emailChangeAlertTemplate,
  emailChangeAssistedAlertTemplate,
  emailChangeConfirmTemplate,
  inviteTemplate,
  passwordChangedTemplate,
  recoveryTemplate,
  resendTemplate,
} from '../../../supabase/functions/_shared/portalEmailTemplates.ts'
import { renderEmailLayout } from '../emailLayout'

// PORTAL_URL do portal antigo, como ainda pode estar num ambiente: os e-mails
// saem com o Portal atual (ponto 4 de 2026-10-23).
const portalUrl = 'https://portal.transhippingdesk.com.br'
const supportEmail = 'suporte@portalfwlog.com.br'

describe('Identidade visual dos emails do Portal', () => {
  it('inclui a logo real da Fwlog, hospedada a partir do PORTAL_URL, nunca no domínio do portal antigo', () => {
    const { html } = inviteTemplate({ companyName: 'ACME LTDA', cnpjMasked: '12.***.***/0001-90', activationUrl: 'https://x/ativar', portalUrl, supportEmail })
    // Ponto 4 de 2026-10-23: PORTAL_URL antigo (Transhipping Desk) vira o Portal atual.
    expect(html).toContain('<img src="https://portalfwlog.com.br/branding/fwlog-logo-white.png"')
    expect(html).not.toContain('transhippingdesk')
    // O suporte do domínio antigo também vira o atual no rodapé.
    const legacySupport = inviteTemplate({ companyName: 'ACME LTDA', cnpjMasked: '***', activationUrl: 'https://x/ativar', portalUrl, supportEmail: 'suporte@transhippingdesk.com.br' })
    expect(legacySupport.html).toContain('mailto:suporte@portalfwlog.com.br')
    expect(legacySupport.html + legacySupport.text).not.toContain('transhippingdesk')
    const custom = inviteTemplate({ companyName: 'ACME LTDA', cnpjMasked: '***', activationUrl: 'https://x/ativar', portalUrl: 'https://staging.vela-portal.pages.dev', supportEmail })
    expect(custom.html).toContain('<img src="https://staging.vela-portal.pages.dev/branding/fwlog-logo-white.png"')
  })

  it('normaliza a logo para a raiz do domínio mesmo quando portalUrl inclui /portal', () => {
    const urlWithPortal = 'https://portalfwlog.com.br/portal'
    const { html } = inviteTemplate({ companyName: 'ACME LTDA', cnpjMasked: '12.***.***/0001-90', activationUrl: 'https://x/ativar', portalUrl: urlWithPortal, supportEmail })
    expect(html).toContain('<img src="https://portalfwlog.com.br/branding/fwlog-logo-white.png"')
    expect(html).not.toContain('/portal/branding/fwlog-logo-white.png')
  })

  it('bounceNotificationTemplate normaliza tanto o logo quanto o botão de acesso', () => {
    const bounce = bounceNotificationTemplate({
      bouncedEmailMasked: 'c***@acme.com',
      portalUrl: 'https://portalfwlog.com.br/portal',
      supportEmail: 'suporte@portalfwlog.com.br',
    })
    expect(bounce.html).toContain('https://portalfwlog.com.br/branding/fwlog-logo-white.png')
    expect(bounce.html).not.toContain('/portal/branding/fwlog-logo-white.png')
    expect(bounce.html).toContain('href="https://portalfwlog.com.br/portal/perfil"')
    expect(bounce.html).toContain('Abrir Meu perfil')
  })

  it('aviso de bounce mostra o endereço mascarado sem marcação HTML literal', () => {
    const bounce = bounceNotificationTemplate({ bouncedEmailMasked: 'c***@acme.com', portalUrl: 'https://portalfwlog.com.br', supportEmail: 'suporte@portalfwlog.com.br' })
    expect(bounce.html).toMatch(/O endereço <span style="font-family:[^"]+">c\*\*\*@acme\.com<\/span> não recebeu um comunicado recente: o servidor de e-mail do destinatário recusou a entrega\./)
    expect(bounce.text).toContain('O endereço c***@acme.com não recebeu um comunicado recente')
    expect(bounce.html).toContain('Um comunicado não foi entregue')
    expect(bounce.html).not.toContain('&lt;strong&gt;')
  })

  it('mostra um quadro de identificação com empresa e CNPJ mascarado quando fornecido', () => {
    const { html } = inviteTemplate({ companyName: 'ACME LTDA', cnpjMasked: '12.***.***/0001-90', activationUrl: 'https://x/ativar', portalUrl, supportEmail })
    expect(html).toContain('ACME LTDA')
    expect(html).toContain('12.***.***/0001-90')
  })

  it('escapa HTML no nome da empresa (evita injeção via razão social)', () => {
    const { html } = inviteTemplate({ companyName: '<script>alert(1)</script>', cnpjMasked: '12.***.***/0001-90', activationUrl: 'https://x/ativar', portalUrl, supportEmail })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('inclui botão de ação com a URL correta em convite, reenvio e recuperação', () => {
    const invite = inviteTemplate({ companyName: 'ACME', cnpjMasked: '***', activationUrl: 'https://x/ativar?token=abc', portalUrl, supportEmail })
    expect(invite.html).toContain('https://x/ativar?token=abc')
    const resend = resendTemplate({ companyName: 'ACME', cnpjMasked: '***', activationUrl: 'https://x/ativar?token=def', portalUrl, supportEmail })
    expect(resend.html).toContain('https://x/ativar?token=def')
    const recovery = recoveryTemplate({ companyName: 'ACME', cnpjMasked: '***', recoveryUrl: 'https://x/recuperar?token=ghi', portalUrl, supportEmail })
    expect(recovery.html).toContain('https://x/recuperar?token=ghi')
  })

  it('template de confirmação de troca de email não expõe quadro de identidade (sem CNPJ nesse contexto)', () => {
    const { html } = emailChangeConfirmTemplate({ companyName: 'ACME LTDA', confirmUrl: 'https://x/confirmar', portalUrl, supportEmail })
    expect(html).toContain('https://x/confirmar')
    expect(html).toContain('ACME LTDA')
  })

  it('template de alerta de troca de email não tem botão de ação nem dado sensível', () => {
    const { html, text } = emailChangeAlertTemplate({ portalUrl, supportEmail })
    expect(html).not.toContain('Confirmar novo e-mail')
    expect(html).not.toContain('background:#1d67b3')
    expect(text).not.toMatch(/https?:\/\//)
  })

  it('aviso da troca assistida não promete que o endereço antigo segue valendo', () => {
    const { text } = emailChangeAssistedAlertTemplate({ portalUrl, supportEmail })
    expect(text).not.toContain('continua válido')
    expect(text).toContain('deixou de receber')
    expect(text).not.toMatch(/https?:\/\//)
  })

  it('acesso e recuperação levam o rodapé padrão com o suporte; o convite não repete o pedido no corpo', () => {
    for (const { html, text } of [
      inviteTemplate({ companyName: 'ACME', cnpjMasked: '***', activationUrl: 'https://x', portalUrl, supportEmail }),
      resendTemplate({ companyName: 'ACME', cnpjMasked: '***', activationUrl: 'https://x', portalUrl, supportEmail }),
      recoveryTemplate({ companyName: 'ACME', cnpjMasked: '***', recoveryUrl: 'https://x', portalUrl, supportEmail }),
      bounceNotificationTemplate({ bouncedEmailMasked: 'c***@acme.com', portalUrl, supportEmail }),
    ]) {
      expect(html).toContain(`Portal do Cliente · Fwlog. Dúvidas ou não reconhece esta mensagem? Fale com <a href="mailto:${supportEmail}"`)
      expect(text).toContain(`Fale com ${supportEmail}.`)
      expect(html).not.toContain('Se você não é a pessoa autorizada')
    }
    const recovery = recoveryTemplate({ companyName: 'ACME', cnpjMasked: '***', recoveryUrl: 'https://x', portalUrl, supportEmail })
    expect(recovery.html.indexOf('Recuperar acesso')).toBeLessThan(recovery.html.indexOf('Se você não fez este pedido, ignore esta mensagem: nada muda na sua conta.'))
  })

  it('troca do Email de Recuperação e senha alterada levam o rodapé de segurança, sem pedir suporte no corpo', () => {
    for (const { html, text } of [
      emailChangeConfirmTemplate({ companyName: 'ACME', confirmUrl: 'https://x', portalUrl, supportEmail }),
      emailChangeAlertTemplate({ portalUrl, supportEmail }),
      emailChangeAssistedAlertTemplate({ portalUrl, supportEmail }),
      passwordChangedTemplate({ companyName: 'ACME', cnpjMasked: '***', portalUrl, supportEmail }),
    ]) {
      expect(html).toContain(`Portal do Cliente · Fwlog. Não foi você? Fale com <a href="mailto:${supportEmail}"`)
      expect(text).toContain(`Não foi você? Fale com ${supportEmail} imediatamente.`)
      expect(html.match(new RegExp(`mailto:${supportEmail}`, 'g'))).toHaveLength(1)
      expect(text.split(supportEmail)).toHaveLength(2)
    }
    expect(emailChangeAlertTemplate({ portalUrl, supportEmail }).subject).toBe('Pedido de troca do Email de Recuperação')
    expect(emailChangeAlertTemplate({ portalUrl, supportEmail }).html).toContain('>Pedido de troca do Email de Recuperação</h1>')
  })

  it('usa a base única com as cores do Portal: topo #0d2b5e sem filete dourado, faixa #edf3fa, botão #1d67b3', () => {
    const { html } = inviteTemplate({ companyName: 'ACME', cnpjMasked: '12.***', activationUrl: 'https://x', portalUrl, supportEmail })
    expect(html).toContain('background:#0d2b5e')
    expect(html).toContain('background:#edf3fa')
    expect(html).toContain('background:#1d67b3')
    expect(html).not.toMatch(/#d4882e|#152238|text-transform:uppercase/i)
    expect(html).toMatch(/<h1 style="[^"]*text-align:center/)
    expect(html).toMatch(/CNPJ <span style="font-family:'IBM Plex Mono'/)
    expect(html).toContain('>Acesso para<')
    const fontSizes = [...html.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]))
    expect(Math.min(...fontSizes)).toBeGreaterThanOrEqual(12)
    const source = readFileSync('supabase/functions/_shared/portalEmailTemplates.ts', 'utf8')
    expect(source).toContain("from '../../../src/services/emailLayout.ts'")
    expect(source).not.toContain('<!doctype')
  })

  it('resumo diário: marca Vela, data em DD/MM/AAAA, Pede ação em âmbar e Para acompanhar, sem botão', () => {
    const digest = dailyDigestTemplate({ date: '2026-07-15', failures: 2, activity: 14, pending: 5, criticalOpened: 3, criticalClosed: 1, portalUrl, supportEmail })
    expect(digest.subject).toBe('Resumo do Portal — 15/07/2026')
    expect(digest.html).toContain('>Resumo do Portal de 15/07/2026</h1>')
    expect(digest.html).toContain('Últimas 24 horas do provisionamento do Portal do Cliente')
    expect(digest.html).toContain('https://portalfwlog.com.br/branding/vela-icon-192.png')
    expect(digest.html).toContain('background:#152238')
    expect(digest.html).toContain('background:#eef2f7')
    expect(digest.html.indexOf('Pede ação')).toBeLessThan(digest.html.indexOf('Para acompanhar'))
    expect(digest.html).toContain('Falhas de entrega e supressões</td>')
    expect(digest.html).toContain('<span style="color:#8f4d08;font-weight:700">2</span>')
    expect(digest.html).toContain('<span style="color:#8f4d08;font-weight:700">3</span>')
    expect(digest.html).toContain('<span style="color:#8f4d08;font-weight:700">5</span>')
    expect(digest.html).not.toContain('<span style="color:#8f4d08;font-weight:700">14</span>')
    expect(digest.html).not.toContain('<a href=')
    expect(digest.html).not.toContain('CNPJ')
    expect(digest.html).toContain('Resumo diário do Vela, enviado a quem é do Administrativo ou da Documentação.')
    expect(digest.text).toContain('Exceções críticas de fatura abertas: 3')
    expect(digest.text).toContain('Exceções críticas de fatura fechadas: 1')
    expect(digest.text).toContain('Convites aguardando ativação: 5')
    const zero = dailyDigestTemplate({ date: '2026-07-15', failures: 0, activity: 0, pending: 0, criticalOpened: 0, criticalClosed: 0, portalUrl, supportEmail })
    expect(zero.html).not.toContain('color:#8f4d08')
  })

  it('a função do resumo não procura o papel admin, que não existe mais (migration 093)', () => {
    const source = readFileSync('supabase/functions/portal-daily-digest/index.ts', 'utf8')
    expect(source).toContain(".in('role', ['administrativo', 'documentacao'])")
    expect(source).not.toContain("'admin'")
  })
})

describe('renderEmailLayout — origem da logo', () => {
  it('escapa a origem no src da logo, nas duas marcas', () => {
    // Valor que não é URL válida (porta fora do intervalo) chega como veio e é escapado.
    const siteUrl = 'https://x.example:99999/"><script>alert(1)</script>'
    for (const brand of ['portal', 'vela'] as const) {
      const html = renderEmailLayout({ brand, siteUrl, title: 'T', body: '', footer: '' })
      expect(html).not.toContain('<script>')
      expect(html).not.toContain('"><script')
      expect(html).toContain('<img src="https://x.example:99999/&quot;&gt;&lt;script&gt;')
    }
    // URL válida vira só a origem: o caminho não chega ao src.
    const html = renderEmailLayout({ brand: 'portal', siteUrl: 'https://x.example/"><script>alert(1)</script>', title: 'T', body: '', footer: '' })
    expect(html).not.toContain('script')
    expect(html).toContain('<img src="https://x.example/')
  })
})

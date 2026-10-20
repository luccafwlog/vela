import { describe, expect, it } from 'vitest'
import {
  renderCeMercanteTaxasTemplate,
  renderDemurrageTemplate,
  renderInstitutionalTemplate,
  renderNoaTemplate,
  renderNobTemplate,
  renderNorTemplate,
  type CustomerCommunicationTemplateInput,
} from '../customerCommunicationTemplates'
import { bounceNotificationTemplate } from '../../../supabase/functions/_shared/portalEmailTemplates.ts'

const sampleInput: CustomerCommunicationTemplateInput = {
  customerId: 10,
  customerName: 'ACME Logística & Importação',
  vesselName: 'COSCO SHIPPING XING WANG',
  voyageNumber: '2401E',
  port: 'Santos (BRSSZ)',
  terminalName: 'BTP Santos',
  terminalId: 'term-1',
  milestoneAt: '2026-09-10T14:00:00Z',
  bls: [{ id: 'CSC45360805C00', customerId: 10, terminalId: 'term-1' }],
  portalUrl: 'https://portal.transhippingdesk.com.br',
  ceMercanteRows: [
    { blId: 'CSC45360805C00', ceMercante: '123456789012345', totalBrl: 1500.5 },
  ],
  demurrage: {
    docNumber: 'DEM-2026-001',
    totalUsd: 500,
    totalBrl: 2750,
    roe: 5.5,
    roeReferenceDate: '2026-09-01',
  },
  subject: 'Comunicado Operacional Especial',
  body: 'Informamos manutenção programada nos sistemas.',
}

describe('Identidade visual dos e-mails de Comunicação com o Cliente', () => {
  const templates = [
    { name: 'NOA', fn: (input = sampleInput) => renderNoaTemplate(input) },
    { name: 'NOR', fn: (input = sampleInput) => renderNorTemplate(input) },
    { name: 'NOB', fn: (input = sampleInput) => renderNobTemplate(input) },
    { name: 'CE Mercante & Taxas', fn: (input = sampleInput) => renderCeMercanteTaxasTemplate(input) },
    { name: 'Demurrage', fn: (input = sampleInput) => renderDemurrageTemplate(input) },
    { name: 'Institucional', fn: (input = sampleInput) => renderInstitutionalTemplate({ ...input, bls: [] }, 'institucional') },
    { name: 'Livre', fn: (input = sampleInput) => renderInstitutionalTemplate(input, 'livre') },
  ]

  it.each(templates)('o template $name usa a base única: topo do Portal (#0d2b5e) com a logo oficial da Fwlog', ({ fn }) => {
    const rendered = fn()
    expect(rendered.html).toContain('background:#0d2b5e;padding:22px 28px')
    expect(rendered.html).not.toContain('#152238')
    expect(rendered.html).toContain('/branding/fwlog-logo-white.png')
    expect(rendered.html).toContain('alt="Fwlog"')
  })

  // Os envios passam o endereço das faturas; `/portal/branding/…` devolve a
  // página do Portal (HTML) e a logo chegava quebrada.
  it.each(templates)('o template $name busca a logo na origem do site quando recebe o endereço das faturas', ({ fn }) => {
    const rendered = fn({ ...sampleInput, portalUrl: 'https://portalfwlog.com.br/portal/billing' })
    expect(rendered.html).toContain('<img src="https://portalfwlog.com.br/branding/fwlog-logo-white.png"')
    expect(rendered.html).not.toContain('/portal/branding/')
  })

  it.each(templates)('o template $name não tem filete dourado, verde-azulado, caixa alta nem texto abaixo de 12px', ({ fn }) => {
    const rendered = fn()
    expect(rendered.html).not.toMatch(/#d4882e|#0f766e|#ecfdf5|text-transform:uppercase/i)
    expect(rendered.html).toMatch(/<h1 style="[^"]*text-align:center/)
    const fontSizes = [...rendered.html.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]))
    expect(Math.min(...fontSizes)).toBeGreaterThanOrEqual(12)
  })

  it.each(templates)('o template $name adota a tipografia do sistema e estrutura em tabela com largura segura (600px)', ({ fn }) => {
    const rendered = fn()
    expect(rendered.html).toContain('-apple-system,BlinkMacSystemFont')
    expect(rendered.html).toContain('width="600"')
    expect(rendered.html).toContain('role="presentation"')
    expect(rendered.html).toContain('background:#ffffff')
  })

  // D20 (plano dos e-mails, 3.6): o rodapé leva o mesmo endereço do reply-to dos Comunicados.
  const communications = templates.filter((template) => template.name !== 'Demurrage')
  it.each(communications)('o template $name contém o rodapé oficial com importacao@fwlog.com.br', ({ fn }) => {
    const rendered = fn()
    expect(rendered.html).toContain('Portal do Cliente · Fwlog. Dúvidas ou não reconhece esta mensagem? Fale com <a href="mailto:importacao@fwlog.com.br"')
    expect(rendered.text).toContain('Portal do Cliente · Fwlog. Dúvidas ou não reconhece esta mensagem? Fale com importacao@fwlog.com.br.')
    expect(rendered.html).not.toContain('suporte@portalfwlog.com.br')
  })

  // Lote 6b: a Cobrança de Demurrage leva no rodapé a equipe que cuida dela.
  it('a Cobrança de Demurrage leva eqp@fwlog.com.br no rodapé', () => {
    const rendered = renderDemurrageTemplate(sampleInput)
    expect(rendered.html).toContain('Fale com <a href="mailto:eqp@fwlog.com.br"')
    expect(rendered.text).toContain('Fale com eqp@fwlog.com.br.')
    expect(rendered.html).not.toContain('importacao@fwlog.com.br')
  })

  it('renderiza botão de ação (CTA) para o Portal do Cliente em CE Mercante e Demurrage', () => {
    const ce = renderCeMercanteTaxasTemplate(sampleInput)
    const dem = renderDemurrageTemplate(sampleInput)

    expect(ce.html).toContain('>Ver faturas e formas de pagamento</a>')
    expect(ce.html).toContain('<td style="border-radius:6px;background:#1d67b3">')
    expect(ce.html).toContain('<td align="center"><table role="presentation"')
    expect(dem.html).toContain('>Ver a cobrança no Portal</a>')
    expect(dem.html).toContain('<td style="border-radius:6px;background:#1d67b3">')
  })

  it('notificação de falha de entrega (bounce) segue a mesma identidade visual do Portal', () => {
    const bounce = bounceNotificationTemplate({
      bouncedEmailMasked: 'op***@cliente.com.br',
      portalUrl: 'https://portal.transhippingdesk.com.br',
      supportEmail: 'suporte@transhippingdesk.com.br',
    })

    expect(bounce.html).toContain('background:#0d2b5e')
    expect(bounce.html).not.toContain('#d4882e')
    expect(bounce.html).toContain('https://portal.transhippingdesk.com.br/branding/fwlog-logo-white.png')
    expect(bounce.html).toContain('op***@cliente.com.br')
    expect(bounce.html).toContain('Abrir Meu perfil')
    expect(bounce.html).toContain('href="https://portal.transhippingdesk.com.br/portal/perfil"')
    expect(bounce.text).toContain('op***@cliente.com.br')
  })
})

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

  it.each(templates)('o template $name possui o cabeçalho marinho institucional (#152238) e a logo oficial da Fwlog', ({ fn }) => {
    const rendered = fn()
    expect(rendered.html).toContain('background:#152238')
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

  it.each(templates)('o template $name inclui o filete dourado (#d4882e) com 3px de altura', ({ fn }) => {
    const rendered = fn()
    expect(rendered.html).toContain('height:3px;line-height:3px;font-size:0;background:#d4882e')
  })

  it.each(templates)('o template $name adota a tipografia do sistema e estrutura em tabela com largura segura (600px)', ({ fn }) => {
    const rendered = fn()
    expect(rendered.html).toContain('-apple-system,BlinkMacSystemFont')
    expect(rendered.html).toContain('width="600"')
    expect(rendered.html).toContain('role="presentation"')
    expect(rendered.html).toContain('background:#ffffff')
  })

  // D20 (plano dos e-mails, 3.6): o rodapé leva o mesmo endereço do reply-to dos Comunicados.
  it.each(templates)('o template $name contém o rodapé oficial com importacao@fwlog.com.br', ({ fn }) => {
    const rendered = fn()
    expect(rendered.html).toContain('Portal do Cliente — Fwlog. Dúvidas ou não reconhece esta mensagem? Fale com <a href="mailto:importacao@fwlog.com.br"')
    expect(rendered.text).toContain('Portal do Cliente — Fwlog. Dúvidas ou não reconhece esta mensagem? Fale com importacao@fwlog.com.br.')
    expect(rendered.html).not.toContain('suporte@portalfwlog.com.br')
  })

  it('renderiza botão de ação (CTA) para o Portal do Cliente em CE Mercante e Demurrage', () => {
    const ce = renderCeMercanteTaxasTemplate(sampleInput)
    const dem = renderDemurrageTemplate(sampleInput)

    expect(ce.html).toContain('Consultar faturas e formas de pagamento no Portal do Cliente')
    expect(ce.html).toContain('background:#152238;color:#ffffff')
    expect(dem.html).toContain('Consultar detalhes no Portal do Cliente')
    expect(dem.html).toContain('background:#152238;color:#ffffff')
  })

  it('notificação de falha de entrega (bounce) segue a mesma identidade visual do Portal', () => {
    const bounce = bounceNotificationTemplate({
      bouncedEmailMasked: 'op***@cliente.com.br',
      portalUrl: 'https://portal.transhippingdesk.com.br',
      supportEmail: 'suporte@transhippingdesk.com.br',
    })

    expect(bounce.html).toContain('background:#152238')
    expect(bounce.html).toContain('background:#d4882e')
    expect(bounce.html).toContain('https://portal.transhippingdesk.com.br/branding/fwlog-logo-white.png')
    expect(bounce.html).toContain('op***@cliente.com.br')
    expect(bounce.html).toContain('Acessar Portal do Cliente')
    expect(bounce.text).toContain('op***@cliente.com.br')
  })
})

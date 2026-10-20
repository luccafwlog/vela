import { describe, expect, it } from 'vitest'
import {
  formatCommunicationDateTime,
  renderInstitutionalTemplate,
  renderCeMercanteTaxasTemplate,
  renderDemurrageGroupTemplate,
  demurrageGroupLineMissing,
  renderDemurrageTemplate,
  renderNoaTemplate,
  renderNobTemplate,
  renderNorTemplate,
  validateCommunicationAttachments,
  type CustomerCommunicationTemplateInput,
} from '../customerCommunicationTemplates'

function input(overrides: Partial<CustomerCommunicationTemplateInput> = {}): CustomerCommunicationTemplateInput {
  return {
    customerId: 10,
    customerName: 'Cliente <Importador>',
    vesselName: 'Navio <A>',
    voyageNumber: 'V001',
    port: 'BRSSZ',
    terminalName: 'Terminal Leste',
    terminalId: 'terminal-1',
    milestoneAt: '2026-09-01T15:00:00Z',
    bls: [{ id: 'BL-10', customerId: 10, terminalId: 'terminal-1' }],
    ...overrides,
  }
}

describe('templates de Comunicados', () => {
  it('formata timestamps no horário de Brasília', () => {
    expect(formatCommunicationDateTime('2026-09-01T15:00:00Z'))
      .toBe('01/09/2026 às 12:00 (horário de Brasília)')
  })

  it('renderiza NOA em português, com assunto bilíngue e escape por cliente', () => {
    const rendered = renderNoaTemplate(input())

    expect(rendered.subject).toContain('Notice of Arrival / Chegada Próxima')
    expect(rendered.text).toContain('01/09/2026 às 12:00 (horário de Brasília)')
    expect(rendered.html).toContain('Cliente &lt;Importador&gt;')
    expect(rendered.html).toContain('BL-10')
    expect(rendered.html).not.toContain('BL-11')
  })

  it('mantém ATA no NOR e ATB/terminal no NOB', () => {
    const nor = renderNorTemplate(input({ milestoneAt: '2026-09-02T16:30:00Z' }))
    const nob = renderNobTemplate(input({ milestoneAt: '2026-09-03T17:45:00Z' }))

    expect(nor.subject).toContain('Notice of Readiness / Aviso de Chegada')
    expect(nor.text).toContain('02/09/2026 às 13:30 (horário de Brasília)')
    expect(nob.subject).toContain('Notice of Berthing / Aviso de Atracação')
    expect(nob.subject).toContain('BRSSZ (Terminal Leste)')
    expect(nob.text).toContain('03/09/2026 às 14:45 (horário de Brasília)')
  })

  it('recusa mistura de terminais no NOB', () => {
    expect(() => renderNobTemplate(input({
      bls: [
        { id: 'BL-10', customerId: 10, terminalId: 'terminal-1' },
        { id: 'BL-11', customerId: 10, terminalId: 'terminal-2' },
      ],
    }))).toThrow('outro terminal')
  })

  it('usa a UUID da linha do terminal para isolar o NOB', () => {
    expect(() => renderNobTemplate(input({
      terminalStateId: 'state-1',
      bls: [{ id: 'BL-10', customerId: 10, terminalId: 'terminal-1', terminalStateId: 'state-2' }],
    }))).toThrow('outro terminal')
  })

  it('recusa NOB sem terminal legível, em vez de enviar sem nome', () => {
    expect(() => renderNobTemplate(input({ terminalName: null }))).toThrow('Terminal ausente para o NOB.')
  })

  it('não aceita B/L em comunicado institucional', () => {
    expect(() => renderInstitutionalTemplate(input({ subject: 'Aviso', body: 'Mensagem' })))
      .toThrow('não pode conter B/Ls')
  })

  it('renderiza CE Mercante com resumo BRL, link do Portal e sem PIX/anexo', () => {
    const rendered = renderCeMercanteTaxasTemplate(input({
      ceMercanteRows: [
        { blId: 'BL-10', ceMercante: '123456789012345', totalBrl: 100.5 },
        { blId: 'BL-11', ceMercante: '987654321098765', totalBrl: 49.5 },
      ],
      totalBrl: 150,
      portalUrl: 'https://portal.example/billing',
    }))

    expect(rendered.subject).toBe('CE Mercante e Taxas Locais disponíveis — Navio <A> / V001 — Porto de BRSSZ')
    expect(rendered.html).toContain('>CE Mercante e Taxas Locais disponíveis</h1>')
    expect(rendered.html).toContain('Navio &lt;A&gt; / V001 · Porto de BRSSZ')
    expect(rendered.html).toContain('Os CEs Mercantes abaixo já podem ser consultados no sistema Mercante, e as Taxas Locais da viagem podem ser pagas no Portal do Cliente.')
    expect(rendered.html).toMatch(/<span style="font-family:'IBM Plex Mono'[^"]*">123456789012345<\/span>/)
    expect(rendered.html).toContain('B/L BL-10')
    expect(rendered.html).toContain('Total da viagem')
    expect(rendered.html).toContain('>Ver faturas e formas de pagamento</a>')
    expect(rendered.html).not.toMatch(/#0f766e|#ecfdf5/)
    expect(rendered.html).toContain('123456789012345')
    expect(rendered.html).toContain('BL-11')
    expect(rendered.text).toContain('Total da viagem:')
    expect(rendered.html).toContain('https://portal.example/billing')
    expect(rendered.html).not.toMatch(/PIX|vencimento|anexo/i)
  })

  it('renderiza Demurrage com USD, BRL informativo, ROE e recálculo no pagamento', () => {
    const rendered = renderDemurrageTemplate(input({
      demurrage: {
        docNumber: 'DEM-2026-001',
        totalUsd: 400,
        totalBrl: 2200,
        roe: 5.5,
        roeReferenceDate: '2026-09-01',
      },
    }))

    expect(rendered.subject).toContain('Cobrança de Demurrage — DEM-2026-001')
    expect(rendered.html).toContain('DEM-2026-001 · Navio &lt;A&gt; / V001')
    expect(rendered.html).toContain('>Invoice DEM-2026-001<')
    expect(rendered.html).toContain('>US$ 400,00</div><div style="margin-top:2px;font-size:13px;line-height:18px;color:#4f5868">valor da cobrança</div>')
    expect(rendered.html).toContain('5,5000 em 01/09/2026')
    expect(rendered.html).toContain('Em reais (informativo)')
    expect(rendered.html).toContain('>Ver a cobrança no Portal</a>')
    expect(rendered.text).toContain('Invoice DEM-2026-001: US$ 400,00 (valor da cobrança)')
    expect(rendered.text).toContain('ROE: 5,5000 em 01/09/2026')
    expect(rendered.text).toContain('O valor em reais é recalculado no dia do pagamento.')
    expect(`${rendered.html}${rendered.text}`).not.toMatch(/\$400\.00|5\.5000/)
    expect(rendered.html).not.toMatch(/PIX|anexo/i)
  })
})

describe('validação de anexos de Comunicados', () => {
  const pdf = (size: number) => ({
    filename: `arquivo-${size}.pdf`,
    contentType: 'application/pdf',
    size,
  })

  it('aceita NOA/NOR/NOB e institucional, mas limita a três arquivos e 10 MB', () => {
    expect(validateCommunicationAttachments('aviso_chegada_noa', [pdf(1)])).toMatchObject({ valid: true, totalBytes: 1 })
    expect(validateCommunicationAttachments('institucional', [pdf(1)])).toMatchObject({ valid: true, totalBytes: 1 })
    expect(validateCommunicationAttachments('aviso_prontidao_nor', [pdf(1), pdf(1), pdf(1), pdf(1)]).valid).toBe(false)
    expect(validateCommunicationAttachments('aviso_atracacao_nob', [pdf(10 * 1024 * 1024), pdf(1)]).valid).toBe(false)
  })

  it('proíbe anexos por kind em cobrança local e demurrage', () => {
    expect(validateCommunicationAttachments('ce_mercante_taxas', [pdf(1)]).errors.join(' ')).toContain('cobrança local')
    expect(validateCommunicationAttachments('cobranca_demurrage', [pdf(1)]).errors.join(' ')).toContain('demurrage')
  })

  it('aceita cobrança local e demurrage sem anexos', () => {
    expect(validateCommunicationAttachments('ce_mercante_taxas', [])).toMatchObject({ valid: true, totalBytes: 0 })
    expect(validateCommunicationAttachments('ce_mercante_taxas', undefined).valid).toBe(true)
    expect(validateCommunicationAttachments('cobranca_demurrage', []).valid).toBe(true)
    expect(validateCommunicationAttachments('ce_mercante_taxas', [pdf(1)]).valid).toBe(false)
  })

  it('recusa tipos MIME não permitidos', () => {
    const result = validateCommunicationAttachments('livre', [{ filename: 'arquivo.zip', contentType: 'application/zip', size: 10 }])
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toContain('Tipo não permitido')
  })
})

describe('cobrança agrupada de Demurrage (plano dos e-mails, 4.1)', () => {
  const line = (doc: string, vessel: string, voyage: string, roeReferenceDate = '2026-09-08') => ({
    docNumber: doc, blId: `BL-${doc}`, vesselName: vessel, voyageNumber: voyage, totalUsd: 1200.5, totalBrl: 6602.75, roe: 5.5, roeReferenceDate,
  })

  it('assunto com o número de Invoices e navio/viagem em cada linha quando diferem', () => {
    const rendered = renderDemurrageGroupTemplate({
      customerId: 7,
      customerName: 'Cliente Teste',
      lines: [line('DEM-1', 'NAVIO A', 'V1'), line('DEM-2', 'NAVIO B', 'V2', '2026-09-09'), line('DEM-3', 'NAVIO A', 'V1')],
    })
    expect(rendered.subject).toBe('Cobrança de Demurrage — 3 Invoices')
    expect(rendered.html).toContain('>3 Invoices</div>')
    expect(rendered.text).toContain('- DEM-2, B/L BL-DEM-2, NAVIO B / V2: US$ 1.200,50 (R$')
    expect(rendered.text).toContain('Em reais pelos ROEs 5,5000 de 08/09/2026 e 5,5000 de 09/09/2026, só para informação: o valor em reais é recalculado no dia do pagamento.')
    expect(rendered.html).toContain('B/L BL-DEM-2 · NAVIO B / V2')
    expect(rendered.html).toContain('>Ver as cobranças no Portal</a>')
    expect(rendered.html).not.toMatch(/#d4882e/)
    // Layout comum dos Comunicados.
    expect(rendered.html).toContain('fwlog-logo-white.png')
    expect(rendered.blIds).toEqual(['BL-DEM-1', 'BL-DEM-2', 'BL-DEM-3'])
    // D8: valores por Invoice, sem soma.
    expect(rendered.text).toContain('Há 3 cobranças de Demurrage disponíveis. Os valores são por Invoice, sem soma.')
    expect(rendered.text).not.toContain('Soma')
    expect(rendered.html).not.toContain('Soma')
    expect(rendered.html).not.toContain('<tfoot>')
  })

  it('mesma viagem e mesmo ROE: Navio / Viagem na faixa do bloco e uma nota só', () => {
    const rendered = renderDemurrageGroupTemplate({ customerId: 7, customerName: 'Cliente', lines: [line('DEM-1', 'NAVIO A', 'V1'), line('DEM-2', 'NAVIO A', 'V1')] })
    expect(rendered.subject).toBe('Cobrança de Demurrage — 2 Invoices')
    expect(rendered.html).toContain('<td align="right" style="font-size:13px;color:#4f5868">NAVIO A / V1</td>')
    expect(rendered.html).not.toContain('B/L BL-DEM-1 ·')
    expect(rendered.text).toContain('Em reais pelo ROE 5,5000 de 08/09/2026, só para informação')
  })

  it('uma linha sai como a cobrança de uma Invoice', () => {
    const rendered = renderDemurrageGroupTemplate({ customerId: 7, customerName: 'Cliente', lines: [line('DEM-1', 'NAVIO A', 'V1')] })
    expect(rendered.subject).toBe('Cobrança de Demurrage — DEM-1 — NAVIO A / V1')
    expect(rendered.html).toContain('>Invoice DEM-1<')
    expect(rendered.html).toContain('DEM-1 · NAVIO A / V1')
  })

  it('recusa linha sem valor líquido, sem ROE ou sem data da cotação', () => {
    expect(() => renderDemurrageGroupTemplate({ customerId: 7, customerName: 'C', lines: [{ ...line('D', 'N', 'V'), totalUsd: 0 }] })).toThrow('Dados incompletos')
    expect(() => renderDemurrageGroupTemplate({ customerId: 7, customerName: 'C', lines: [{ ...line('D', 'N', 'V'), roe: 0 }] })).toThrow('Dados incompletos')
    expect(() => renderDemurrageGroupTemplate({ customerId: 7, customerName: 'C', lines: [line('D', 'N', 'V', ' ')] })).toThrow('Dados incompletos')
    expect(() => renderDemurrageGroupTemplate({ customerId: 7, customerName: 'C', lines: [] })).toThrow()
  })

  it('aponta o que falta em cada linha, para a Régua tirar só a Invoice incompleta', () => {
    expect(demurrageGroupLineMissing(line('D', 'N', 'V'))).toBeNull()
    expect(demurrageGroupLineMissing({ ...line('D', ' ', ''), roe: Number.NaN })).toBe('navio, viagem, ROE')
  })
})

describe('avisos de navio (NOA / NOR / NOB) na base única', () => {
  const bl = { id: 'MEDU1', customerId: 1, terminalId: 'T1' }
  const base = {
    customerId: 1, customerName: 'Granja <Exemplo>', vesselName: 'MSC ARIANE', voyageNumber: 'NX642R', port: 'Vitória',
    terminalName: 'TVV', terminalId: 'T1', milestoneAt: '2026-10-22T14:30:00Z', bls: [bl],
  }

  it('NOA: título sem linha de apoio, frase curta e a data em destaque no bloco', () => {
    const rendered = renderNoaTemplate(base)
    expect(rendered.subject).toBe('Notice of Arrival / Chegada Próxima — MSC ARIANE / NX642R — Porto de Vitória')
    expect(rendered.html).toContain('>Notice of Arrival / Chegada Próxima</h1>\n      \n')
    expect(rendered.html).toContain('Olá, Granja &lt;Exemplo&gt;.')
    expect(rendered.html).toContain('A chegada do seu navio está prevista conforme abaixo.')
    expect(rendered.html).toContain('>Chegada prevista<')
    expect(rendered.html).toContain('>22/10/2026 às 11:30</div><div style="margin-top:2px;font-size:13px;line-height:18px;color:#4f5868">horário de Brasília</div>')
    expect(rendered.text).toContain('Chegada prevista: 22/10/2026 às 11:30 (horário de Brasília)')
    expect(rendered.text).toContain('Navio / Viagem: MSC ARIANE / NX642R')
    expect(rendered.text).toContain('Porto: Vitória')
  })

  it('NOB: bloco Atracação com Terminal e porto juntos', () => {
    const rendered = renderNobTemplate(base)
    expect(rendered.html).toContain('O seu navio atracou conforme abaixo.')
    expect(rendered.html).toContain('>Atracação<')
    expect(rendered.html).toContain('TVV, Porto de Vitória')
    expect(rendered.text).toContain('Terminal: TVV, Porto de Vitória')
  })

  it('CE Mercante e Taxas sem porto omite o porto no assunto e na linha de apoio', () => {
    const rendered = renderCeMercanteTaxasTemplate({ ...base, port: '', ceMercanteRows: [{ blId: 'MEDU1', ceMercante: '1526', totalBrl: 10 }] })
    expect(rendered.subject).toBe('CE Mercante e Taxas Locais disponíveis — MSC ARIANE / NX642R')
    expect(rendered.html).toContain('>MSC ARIANE / NX642R</div>')
  })
})

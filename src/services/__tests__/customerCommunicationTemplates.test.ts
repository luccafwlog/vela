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

    expect(rendered.subject).toBe('CE Mercante Disponível e Resumo de Taxas Locais — Navio <A> / V001')
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
    expect(rendered.text).toContain('Valor da cobrança:')
    expect(rendered.text).toContain('ROE 5.5000')
    expect(rendered.text).toContain('O valor em reais será recalculado no dia do pagamento.')
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

  it('assunto geral com o número de faturas e navio/viagem em cada linha', () => {
    const rendered = renderDemurrageGroupTemplate({
      customerId: 7,
      customerName: 'Cliente Teste',
      lines: [line('DEM-1', 'NAVIO A', 'V1'), line('DEM-2', 'NAVIO B', 'V2', '2026-09-09'), line('DEM-3', 'NAVIO A', 'V1')],
    })
    expect(rendered.subject).toBe('Cobrança de Demurrage — 3 faturas')
    expect(rendered.text).toContain('DEM-2 — B/L BL-DEM-2 — NAVIO B / V2')
    expect(rendered.text).toContain('pelo ROE 5.5000 com referência em 09/09/2026')
    expect(rendered.text).toContain('O valor em reais será recalculado no dia do pagamento.')
    expect(rendered.html).toContain('NAVIO B / V2')
    expect(rendered.html).toContain('ROE 5.5000, referência 08/09/2026')
    // Layout comum dos Comunicados.
    expect(rendered.html).toContain('fwlog-logo-white.png')
    expect(rendered.blIds).toEqual(['BL-DEM-1', 'BL-DEM-2', 'BL-DEM-3'])
    // D8: valores por Invoice, sem soma.
    expect(rendered.text).toContain('Os valores são por Invoice, sem consolidação.')
    expect(rendered.text).not.toContain('Soma')
    expect(rendered.html).not.toContain('Soma')
    expect(rendered.html).not.toContain('<tfoot>')
  })

  it('uma linha mantém o assunto da cobrança unitária', () => {
    const rendered = renderDemurrageGroupTemplate({ customerId: 7, customerName: 'Cliente', lines: [line('DEM-1', 'NAVIO A', 'V1')] })
    expect(rendered.subject).toBe('Cobrança de Demurrage — DEM-1 — NAVIO A / V1')
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

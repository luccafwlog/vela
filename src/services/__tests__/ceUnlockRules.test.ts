import { describe, expect, it } from 'vitest'
import { annualDocumentValid, proposedVipStart, vipStartError, zptRows } from '../ceUnlockRules'

describe('documentos anuais VIP e planilha ZPT', () => {
  it('inclui todo o dia 31/12 em São Paulo e expira em 01/01', () => {
    const doc = { status: 'approved', valid_from: '2026-01-01', valid_until: '2026-12-31', coverage_year: 2026 }
    expect(annualDocumentValid(doc, new Date('2027-01-01T02:59:59Z'))).toBe(true)
    expect(annualDocumentValid(doc, new Date('2027-01-01T03:00:00Z'))).toBe(false)
    expect(annualDocumentValid({ ...doc, status: 'pending' }, new Date('2026-10-04T12:00:00Z'))).toBe(false)
  })
  it('recusa prazo anual que não termina em 31/12 do ano declarado', () => {
    expect(annualDocumentValid({ status:'approved', valid_from:'2026-01-01', valid_until:'2027-12-31', coverage_year:2026 }, new Date('2026-10-04'))).toBe(false)
  })
  it('início proposto: o mais tarde entre o envio e 01/01 do ano da cobertura (anual de dezembro analisado em janeiro)', () => {
    expect(proposedVipStart('2026-12-20', 2027)).toBe('2027-01-01')
    expect(proposedVipStart('2026-12-20', 2026)).toBe('2026-12-20')
    expect(proposedVipStart('2026-10-16', 2026)).toBe('2026-10-16')
  })
  it('avisa em português quando o início não está no ano da cobertura', () => {
    expect(vipStartError('2027-01-01', 2027)).toBe('')
    expect(vipStartError('2026-12-20', 2027)).toBe('O início da vigência precisa estar em 2027, o ano da cobertura.')
    expect(vipStartError('', 2027)).toBe('O início da vigência precisa estar em 2027, o ano da cobertura.')
    expect(vipStartError('2027-01-01', 0)).toBe('Informe o ano da cobertura.')
  })
  it('exporta cinco colunas com os cabeçalhos da ZPT, preserva BL como texto e neutraliza fórmula', () => {
    expect(zptRows([{ bl_id:'00123', termo:true, procuracao:true, delivered:true, paid:true }, {bl_id:'=SUM(A1)', termo:false, procuracao:false, delivered:false, paid:false}])).toEqual([
      { BL:'00123', Financeiro:'Sim', 'Term. Devolucao':'Sim', Procuracao:'Sim', 'BL Entrega':'Sim' },
      { BL:"'=SUM(A1)", Financeiro:'Não', 'Term. Devolucao':'Não', Procuracao:'Não', 'BL Entrega':'Não' },
    ])
  })
  it('lote antigo (zpt-5-v1) continua com o layout em que foi gerado', () => {
    expect(zptRows([{ bl_id:'A1', termo:true, procuracao:false, delivered:true, paid:true }], 'zpt-5-v1')).toEqual([
      { BL:'A1', Termo:'Sim', Procuração:'Não', 'Entrega de BL':'Sim', 'Pagamento das taxas':'Sim' },
    ])
  })
})

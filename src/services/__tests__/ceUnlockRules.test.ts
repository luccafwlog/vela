import { describe, expect, it } from 'vitest'
import { annualDocumentValid, zptRows } from '../ceUnlockRules'

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
  it('exporta somente cinco colunas, preserva BL como texto e neutraliza fórmula', () => {
    expect(zptRows([{ bl_id:'00123', termo:true, procuracao:true, delivered:true, paid:true }, {bl_id:'=SUM(A1)', termo:false, procuracao:false, delivered:false, paid:false}])).toEqual([
      { BL:'00123', Termo:'Sim', Procuração:'Sim', 'Entrega de BL':'Sim', 'Pagamento das taxas':'Sim' },
      { BL:"'=SUM(A1)", Termo:'Não', Procuração:'Não', 'Entrega de BL':'Não', 'Pagamento das taxas':'Não' },
    ])
  })
})

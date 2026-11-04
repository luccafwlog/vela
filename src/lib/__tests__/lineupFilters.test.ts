import { describe, expect, it } from 'vitest'
import { countActiveLineUpFilters, emptyLineUpFilters, filterLineUpRows } from '../lineupFilters'
import type { LineUpRow } from '../../services/lineup'

const rows: LineUpRow[] = [
  row({ id: '1::SSZ', voyageId: 1, vesselName: 'Aurora', voyageNumber: '001A', pod: 'SSZ', eta: '2026-07-11', vin: 2, bbTotal: 1, mty: 3, rtw: 2, ceStatus: 'approved', linked: true }),
  row({ id: '1::RIO', voyageId: 1, vesselName: 'Aurora', voyageNumber: '001A', pod: 'RIO', eta: '2026-07-12', vin: 0, bbTotal: 0, mty: 0, rtw: null, ceStatus: 'waiting', linked: false }),
  row({ id: '2::PNG', voyageId: 2, vesselName: 'Boreal', voyageNumber: '002B', pod: 'PNG', eta: '2026-07-13', vin: 0, bbTotal: 0, mty: 0, rtw: 0, ceStatus: 'missing', linked: false }),
  row({ id: 'exp::3', voyageId: 3, vesselName: 'Exportador', voyageNumber: '003C', rowType: 'export', eta: '2026-07-14', exportCeStatus: 'approved', exportLinked: true }),
]

describe('filterLineUpRows', () => {
  it('filtra por busca de navio/viagem e período inclusive', () => {
    expect(filterLineUpRows(rows, { ...emptyLineUpFilters(), search: 'aurora', periodo: 'custom', dataInicio: '2026-07-12', dataFim: '2026-07-12' }).map((item) => item.id)).toEqual(['1::RIO'])
    expect(filterLineUpRows(rows, { ...emptyLineUpFilters(), search: '002B' }).map((item) => item.id)).toEqual(['2::PNG'])
  })

  // Decisão do dono de 2026-11-03: Busca, Escalas e Período valem também para a linha de exportação.
  it('aplica Busca, Escalas e Período à linha de exportação', () => {
    expect(filterLineUpRows(rows, { ...emptyLineUpFilters(), search: 'exportador' }).map((item) => item.id)).toEqual(['exp::3'])
    expect(filterLineUpRows(rows, { ...emptyLineUpFilters(), search: '003c' }).map((item) => item.id)).toEqual(['exp::3'])
    expect(filterLineUpRows(rows, { ...emptyLineUpFilters(), periodo: 'custom', dataInicio: '2026-07-14', dataFim: '2026-07-14' }).map((item) => item.id)).toEqual(['exp::3'])
    expect(filterLineUpRows(rows, { ...emptyLineUpFilters(), periodo: 'custom', dataInicio: '2026-07-11', dataFim: '2026-07-13' }).map((item) => item.id)).not.toContain('exp::3')

    const completedExport = row({ id: 'exp::5', voyageId: 5, rowType: 'export', voyageStatus: 'completed', eta: '2026-07-15' })
    expect(filterLineUpRows([...rows, completedExport], emptyLineUpFilters()).map((item) => item.id)).not.toContain('exp::5')
    expect(filterLineUpRows([...rows, completedExport], { ...emptyLineUpFilters(), status: 'completed' }).map((item) => item.id)).toEqual(['exp::5'])
    expect(filterLineUpRows([...rows, completedExport], { ...emptyLineUpFilters(), status: 'all' }).map((item) => item.id)).toContain('exp::5')
  })

  it('filtra linhas de importação que possuem veículos ou BB', () => {
    expect(filterLineUpRows(rows, { ...emptyLineUpFilters(), vehicles: 'with' }).map((item) => item.id)).toEqual(['1::SSZ', 'exp::3'])
    expect(filterLineUpRows(rows, { ...emptyLineUpFilters(), bb: 'with' }).map((item) => item.id)).toEqual(['1::SSZ', 'exp::3'])
  })

  it('filtra linhas de importação sem veículos', () => {
    expect(filterLineUpRows(rows, { ...emptyLineUpFilters(), vehicles: 'without' }).map((item) => item.id)).toEqual(['1::RIO', '2::PNG', 'exp::3'])
  })

  it('considera MTY em toda a viagem, embora seja creditado apenas na primeira rota', () => {
    expect(filterLineUpRows(rows, { ...emptyLineUpFilters(), mty: 'with' }).map((item) => item.id)).toEqual(['1::SSZ', '1::RIO', 'exp::3'])
  })

  it('mantém as rotas de importação quando a exportação recebe primeiro o crédito MTY', () => {
    const voyageRows = [
      row({ id: 'exp::4', voyageId: 4, rowType: 'export', mty: 2 }),
      row({ id: '4::SSZ', voyageId: 4, rowType: 'import', mty: 0 }),
    ]

    expect(filterLineUpRows(voyageRows, { ...emptyLineUpFilters(), mty: 'with' }).map((item) => item.id)).toEqual(['exp::4', '4::SSZ'])
  })

  it('não considera RTW nulo ou zero como presente', () => {
    expect(filterLineUpRows(rows, { ...emptyLineUpFilters(), rtw: 'with' }).map((item) => item.id)).toEqual(['1::SSZ', 'exp::3'])
  })

  it('agrupa waiting e missing como CEs aguardando', () => {
    expect(filterLineUpRows(rows, { ...emptyLineUpFilters(), ces: 'waiting' }).map((item) => item.id)).toEqual(['1::RIO', '2::PNG', 'exp::3'])
  })

  it('usa os campos de exportação para CEs e Linked e mantém exportações visíveis', () => {
    expect(filterLineUpRows(rows, { ...emptyLineUpFilters(), ces: 'approved', linked: 'with' }).map((item) => item.id)).toEqual(['1::SSZ', 'exp::3'])
  })

  // Revisão de 2026-11-04 (D5): Terminal › Sem terminal fica com as linhas,
  // de importação ou de exportação, que têm frente do seu sentido sem terminal.
  it('Terminal "Sem terminal" fica só com as linhas com frente pendente, nos dois sentidos', () => {
    const pendentes = [
      ...rows,
      row({ id: '6::BRVIX', voyageId: 6, importTerminal: 'TVV / TBC', pendingTerminalFronts: ['importacao:carga_solta'] }),
      row({ id: 'exp::6::BRVIX', voyageId: 6, rowType: 'export', exportTerminal: 'TBC', pendingTerminalFronts: ['exportacao:granito'] }),
      row({ id: '7::BRVIX', voyageId: 7, importTerminal: 'TVV', pendingTerminalFronts: [] }),
    ]
    expect(filterLineUpRows(pendentes, { ...emptyLineUpFilters(), terminal: 'pending' }).map((item) => item.id)).toEqual(['6::BRVIX', 'exp::6::BRVIX'])
    expect(filterLineUpRows(pendentes, emptyLineUpFilters())).toHaveLength(pendentes.length)
    expect(countActiveLineUpFilters({ ...emptyLineUpFilters(), terminal: 'pending' })).toBe(1)
  })

  it('conta filtros ativos sem contar as datas isoladamente', () => {
    expect(countActiveLineUpFilters({ ...emptyLineUpFilters(), search: 'Aurora', periodo: 'custom', dataInicio: '2026-07-11', dataFim: '2026-07-12', linked: 'with' })).toBe(3)
  })
})

function row(overrides: Partial<LineUpRow>): LineUpRow {
  return {
    id: 'row', voyageId: 99, voyageNumber: '000', voyageStatus: 'active', vesselName: 'Navio', pod: 'POD', eta: null, etb: null,
    ata: null, atb: null,
    rowType: 'import', importTerminal: 'TBC', exportTerminal: 'TBC', vin: 0, car: 0, cg: 0, total: 0, mty: 0, rtw: null, bbMachines: 0, bbPackages: 0, bbTotal: 0,
    atd: null, omitted: false, ceStatus: 'waiting', linked: false, exportHasGranite: null, exportContainersQty: null, exportMovementsQty: null,
    exportCeStatus: null, exportLinked: null, ...overrides,
  }
}

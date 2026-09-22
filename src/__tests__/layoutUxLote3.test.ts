import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('Lote 3: Layouts, Grids & UX Contract Tests', () => {
  it('POR-003: ClientesPortal integra contadores nas abas e move Exportar XLSX para PageHeader', () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../pages/ClientesPortal.tsx'), 'utf8')
    expect(code.includes('presetCounts[item.value]')).toBe(true)
    expect(code.includes('xl:grid-cols-8')).toBe(false)
    expect(code.includes('Exportar XLSX') && code.includes('PageHeader')).toBe(true)
  })

  it('BLS-001: Bls.tsx unifica cards de topo em um grid compartilhado sem card isolado de 100%', () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../pages/Bls.tsx'), 'utf8')
    expect(code.includes('<div>\n          <MetricCard label="Pendentes revisão"')).toBe(false)
    expect(code.includes('<MetricCard label="Pendentes revisão"')).toBe(true)
  })

  it('CLI-003: Clientes.tsx unifica cards de topo em grid balanceado', () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../pages/Clientes.tsx'), 'utf8')
    expect(code.includes('<div>\n          <MetricCard label="Saldo pendente"')).toBe(false)
    expect(code.includes('lg:grid-cols-5')).toBe(true)
  })

  it('CLI-004: CustomerTable remove texto redundante "Com saldo em aberto" e alinha valor financeiro', () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../components/customers/CustomerTable.tsx'), 'utf8')
    expect(code.includes('Com saldo em aberto')).toBe(false)
    expect(code.includes('app-table__cell-value--financial text-left')).toBe(true)
  })

  it('COM-002: ClientesComunicacao posiciona "CE / Taxas" logo após "Clientes"', () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../pages/ClientesComunicacao.tsx'), 'utf8')
    const hasOrder = code.includes('<th scope="col" className="p-3">Clientes</th><th scope="col" className="p-3">CE / Taxas</th><th scope="col" className="p-3">NOA</th>')
    expect(hasOrder).toBe(true)
  })

  it('BLD-005, BLD-006 & BLD-007: BlOperacionalTab posiciona Partes, alinha grid e compacta notas', () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../components/bl/BlOperacionalTab.tsx'), 'utf8')
    const partesIndex = code.indexOf('>Partes<')
    const rotaIndex = code.indexOf('>Rota e datas<')
    const shipperIndex = code.indexOf('label="Shipper"')
    const consigneeIndex = code.indexOf('label="Consignatário"')
    expect(partesIndex).toBeLessThan(shipperIndex)
    expect(shipperIndex).toBeLessThan(consigneeIndex)
    expect(consigneeIndex).toBeLessThan(rotaIndex)

    expect(code.includes('items-start')).toBe(true)
    expect(code.includes('min-h-[72px]')).toBe(true)
  })

  it('BLD-001: BlDetalhe não exibe painel global de processamento físico de viagem', () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../pages/BlDetalhe.tsx'), 'utf8')
    expect(code.includes('Processamento físico da viagem')).toBe(false)
  })

  it('BLS-004: Bls.tsx utiliza rótulo amigável no campo de busca', () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../pages/Bls.tsx'), 'utf8')
    expect(code.includes('label="Buscar B/L ou cliente"')).toBe(true)
    expect(code.includes('label="Texto livre"')).toBe(false)
  })
})

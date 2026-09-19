import { describe, expect, it } from 'vitest'
import { armazenagemPorDepotCondicao, diasCobraveis, totalEmbarque, totalLinha, veto } from '../vaziosCusto'

const depots = [
  { id: 'd1', tipo: 'depot' as const, free_time_vazio_days: 2, free_time_material_days: 1 },
  { id: 'd2', tipo: 'depot' as const, free_time_vazio_days: 0, free_time_material_days: 3 },
  { id: 'tvv', tipo: 'terminal_portuario' as const, free_time_vazio_days: 0, free_time_material_days: 0 },
]
const units = [
  { container_number: 'ABCD1234567', local_id: 'd1', condition: 'vazio' as const, hand_in_date: '2026-07-01', hand_out_date: '2026-07-05' },
  { container_number: 'EFGH1234567', local_id: 'd1', condition: 'material' as const, hand_in_date: '2026-07-01', hand_out_date: '2026-07-04' },
  { container_number: 'IJKL1234567', local_id: 'd2', condition: 'vazio' as const, hand_in_date: '2026-07-01', hand_out_date: '2026-07-03' },
  { container_number: 'MNOP1234567', local_id: 'tvv', condition: 'vazio' as const, hand_in_date: null, hand_out_date: null },
]

describe('motor de custo do Embarque de Vazios', () => {
  it('desconta free time por condição, contando entrada e saída (+1 dia)', () => {
    expect(diasCobraveis(units[0], depots[0])).toBe(3)
    expect(diasCobraveis(units[1], depots[0])).toBe(3)
    expect(diasCobraveis(units[3], depots[2])).toBe(0)
  })

  it('agrupa armazenagem por depot e condição', () => {
    expect(armazenagemPorDepotCondicao(units, depots)).toEqual([
      { depot_id: 'd1', condition: 'vazio', quantidade: 3 },
      { depot_id: 'd1', condition: 'material', quantidade: 3 },
      { depot_id: 'd2', condition: 'vazio', quantidade: 3 },
    ])
  })

  it('calcula linhas sem percentual, usando 100% implícito', () => {
    const linhas = [
      { natureza: 'armazenagem', local_id: 'd1', condition: 'vazio', quantidade: 0, percentual: null, valor_unitario: 10 },
      { natureza: 'geral', local_id: 'tvv', quantidade: 2, percentual: null, valor_unitario: 100 },
    ] as const
    expect(totalLinha(linhas[0], units, depots)).toBe(30)
    expect(totalLinha(linhas[1], units, depots)).toBe(200)
    expect(totalEmbarque({ unidades: units, linhas: [...linhas], depots })).toBe(230)
  })

  // Decisão confirmada com o usuário em 2026-09-19: a ADR 0033 §3 não tem
  // percentual na fórmula ("O total é `quantidade × valor unitário`"); uma
  // linha legada com percentual gravado (ex.: 50) não deve mais reduzir o
  // total exibido — só a fórmula nova conta.
  it('ignora percentual legado gravado na linha: o total é sempre quantidade × valor unitário', () => {
    const linhaComPercentualLegado = {
      natureza: 'geral', local_id: 'tvv', quantidade: 2, percentual: 50, valor_unitario: 100,
    } as const
    expect(totalLinha(linhaComPercentualLegado, units, depots)).toBe(200)
  })

  it('veta transporte sem rota, armazenagem fora de depot e duplicata', () => {
    expect(veto({ natureza: 'transporte', local_id: 'd1', destino_id: null, quantidade: 1, percentual: null, valor_unitario: 1 })).toContain('rota')
    expect(veto({ natureza: 'armazenagem', local_id: 'tvv', condition: 'vazio', quantidade: 1, percentual: null, valor_unitario: 1 }, { depots })).toContain('depot')
    const first = { natureza: 'armazenagem', local_id: 'd1', condition: 'vazio', quantidade: 1, percentual: null, valor_unitario: 1 }
    expect(veto(first, { depots, lines: [first, { ...first }] })).toContain('Já existe')
    expect(veto({ natureza: 'geral', local_id: 'd1', quantidade: 1, percentual: null, valor_unitario: 1 })).toBeNull()
  })
})

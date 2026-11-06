import { describe, expect, it } from 'vitest'
import {
  armazenagemALancar,
  armazenagemPorDepotCondicao,
  armazenagemPorUnidade,
  containerSize,
  diasCobraveis,
  quantidadeEfetiva,
  servicoDeArmazenagem,
  totaisDeArmazenagem,
  totalEmbarque,
  totalLinha,
  unidadesDoLocal,
  veto,
} from '../vaziosCusto'

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
      { depot_id: 'd1', condition: 'vazio', size: null, quantidade: 3 },
      { depot_id: 'd1', condition: 'material', size: null, quantidade: 3 },
      { depot_id: 'd2', condition: 'vazio', size: null, quantidade: 3 },
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

describe('Armazenagem a lançar (lote 5b)', () => {
  const freeTime = [{ id: 'd1', tipo: 'depot' as const, free_time_vazio_days: 10, free_time_material_days: 2 }]
  const dentro = { local_id: 'd1', condition: 'vazio' as const, hand_in_date: '2026-07-01', hand_out_date: '2026-07-05' }
  const fora = { local_id: 'd1', condition: 'material' as const, hand_in_date: '2026-07-01', hand_out_date: '2026-07-05' }

  it('esconde a combinação com 0 dia: as unidades ficaram dentro do free time', () => {
    expect(armazenagemALancar([dentro, fora], freeTime, [])).toEqual([{ depot_id: 'd1', condition: 'material', size: null, quantidade: 3 }])
  })

  it('esconde a combinação que já tem linha de armazenagem lançada', () => {
    expect(armazenagemALancar([fora], freeTime, [{ natureza: 'armazenagem', local_id: 'd1', condition: 'material' }])).toEqual([])
    // Linha de outra natureza no mesmo local não conta como lançada.
    expect(armazenagemALancar([fora], freeTime, [{ natureza: 'geral', local_id: 'd1', condition: null }])).toHaveLength(1)
  })
})

// Decisões do dono de 2026-11-06 (ADR 0130, migration 606): alguns depots
// cobram a armazenagem de 20' e de 40' à parte (ZIRAN: R$ 1,58 e R$ 3,14 por
// dia), e o free time fica congelado na linha lançada.
describe('armazenagem por tamanho e free time congelado (606)', () => {
  const ziran = [{ id: 'z', tipo: 'depot' as const, free_time_vazio_days: 30, free_time_material_days: 30 }]
  // 36 dias no depot (01/10 a 05/11) − 30 de free time = 6 dias cobráveis cada.
  const unit = (container: string, type: string | null) => ({
    container_number: container, container_type: type, local_id: 'z', condition: 'vazio' as const,
    hand_in_date: '2026-10-01', hand_out_date: '2026-11-05',
  })
  const unidades = [
    ...Array.from({ length: 10 }, (_, index) => unit(`ZRAN${String(index).padStart(7, '0')}`, '22G1')),
    ...Array.from({ length: 10 }, (_, index) => unit(`ZRBN${String(index).padStart(7, '0')}`, '45G1')),
  ]
  const catalogo = [
    { id: 's20', name: "ARMAZENAGEM 20''", depot_id: 'z', natureza: 'armazenagem', condition: 'vazio', container_type: '20', rate_brl: 1.58 },
    { id: 's40', name: "ARMAZENAGEM 40''", depot_id: 'z', natureza: 'armazenagem', condition: 'vazio', container_type: '40', rate_brl: 3.14 },
  ]

  it('tamanho pelo tipo ISO ou de mercado; 45G1 é 40 pés HC', () => {
    expect(['22G1', '20DV', "20'", '45G1', '40HC', 'L5G1', null].map(containerSize)).toEqual(['20', '20', '20', '40', '40', null, null])
  })

  it('Armazenagem a lançar separa 20\' e 40\' quando o catálogo cobra à parte, e escolhe o serviço do tamanho', () => {
    const aLancar = armazenagemALancar(unidades, ziran, [], catalogo)
    expect(aLancar).toEqual([
      { depot_id: 'z', condition: 'vazio', size: '20', quantidade: 60 },
      { depot_id: 'z', condition: 'vazio', size: '40', quantidade: 60 },
    ])
    expect(aLancar.map((need) => servicoDeArmazenagem(catalogo, need)?.id)).toEqual(['s20', 's40'])
  })

  it('cada linha conta só as unidades do seu tamanho: 60 × 1,58 + 60 × 3,14 = R$ 283,20', () => {
    const linhas = [
      { natureza: 'armazenagem', local_id: 'z', condition: 'vazio', container_type: '20', free_time_days: 30, quantidade: 0, valor_unitario: 1.58 },
      { natureza: 'armazenagem', local_id: 'z', condition: 'vazio', container_type: '40', free_time_days: 30, quantidade: 0, valor_unitario: 3.14 },
    ]
    expect(linhas.map((linha) => quantidadeEfetiva(linha, unidades, ziran, linhas))).toEqual([60, 60])
    expect(totalEmbarque({ unidades, linhas, depots: ziran })).toBeCloseTo(283.2, 2)
    // Com só a de 20' lançada, a de 40' continua a lançar e não entra na de 20'.
    expect(armazenagemALancar(unidades, ziran, [linhas[0]], catalogo)).toEqual([{ depot_id: 'z', condition: 'vazio', size: '40', quantidade: 60 }])
  })

  it('depot sem preço por tamanho: uma linha só conta todas as unidades', () => {
    const linha = { natureza: 'armazenagem', local_id: 'z', condition: 'vazio', container_type: null, quantidade: 0, valor_unitario: 2 }
    expect(armazenagemALancar(unidades, ziran, [], [])).toEqual([{ depot_id: 'z', condition: 'vazio', size: null, quantidade: 120 }])
    expect(quantidadeEfetiva(linha, unidades, ziran, [linha])).toBe(120)
  })

  it('o free time da linha vale, não o do cadastro: mudar o cadastro não muda a linha', () => {
    const cadastroNovo = [{ ...ziran[0], free_time_vazio_days: 5 }]
    const linha = { natureza: 'armazenagem', local_id: 'z', condition: 'vazio', container_type: null, free_time_days: 30, quantidade: 0, valor_unitario: 2 }
    expect(quantidadeEfetiva(linha, unidades, cadastroNovo, [linha])).toBe(120)
    // Linha anterior à 606 (sem free time gravado) segue o cadastro.
    expect(quantidadeEfetiva({ ...linha, free_time_days: null }, unidades, cadastroNovo)).toBe(20 * 31)
  })

  it('Storage do ADR conta só a unidade com dia cobrável e mostra os dias por unidade', () => {
    const dentro = { ...unit('ZRCN0000001', '22G1'), hand_in_date: '2026-10-20' }
    expect(totaisDeArmazenagem([...unidades, dentro], ziran)).toEqual({ containers: 20, days: 120, calculatedDays: 120 })
    const [row] = armazenagemPorUnidade([dentro], ziran)
    expect(row).toMatchObject({ totalDays: 17, freeTime: 30, chargeableDays: 0, launched: false })
  })

  it('C4: Storage → Dias cobráveis usa a quantidade à mão da linha e guarda o calculado pela lista ao lado', () => {
    const linhas = [
      // 20' com quantidade à mão (a fatura do depot cobrou 50, a lista dá 60).
      { natureza: 'armazenagem', local_id: 'z', condition: 'vazio', container_type: '20', free_time_days: 30, quantidade: 50, quantidade_manual: true, valor_unitario: 1.58 },
      // 40' ainda sem linha: os 60 dias calculados continuam no total.
    ]
    expect(totaisDeArmazenagem(unidades, ziran, linhas)).toEqual({ containers: 20, days: 110, calculatedDays: 120 })
    // Sem quantidade à mão, os dois totais são o mesmo número.
    expect(totaisDeArmazenagem(unidades, ziran, [{ ...linhas[0], quantidade_manual: false }])).toEqual({ containers: 20, days: 120, calculatedDays: 120 })
  })

  it('sugere a quantidade de handling e transporte pelas unidades do local e do tamanho do serviço', () => {
    expect(unidadesDoLocal(unidades, 'z', null)).toMatchObject({ total: 20, vazio: 20, material: 0, porTamanho: { '20': 10, '40': 10, sem: 0 } })
    expect(unidadesDoLocal(unidades, 'z', '40').total).toBe(10)
    expect(unidadesDoLocal(unidades, 'outro', null).total).toBe(0)
  })

  it('veta a segunda armazenagem do mesmo depot, condição e tamanho, mas não a de outro tamanho nem a própria linha em edição', () => {
    const vinte = { id: 'l1', natureza: 'armazenagem', local_id: 'z', condition: 'vazio', container_type: '20', quantidade: 0, valor_unitario: 1 }
    expect(veto({ ...vinte, id: undefined }, { depots: ziran, lines: [vinte] })).toContain('Já existe')
    expect(veto({ ...vinte, id: undefined, container_type: '40' }, { depots: ziran, lines: [vinte] })).toBeNull()
    expect(veto({ ...vinte }, { depots: ziran, lines: [{ ...vinte }] })).toBeNull()
  })
})

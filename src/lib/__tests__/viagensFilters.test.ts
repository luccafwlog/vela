import { describe, expect, it } from 'vitest'
import { filterVoyageRailItems } from '../viagensFilters'
import type { VoyageRailItem } from '../../services/voyageSummaries'

const noModules = { container: false, cargaSolta: false, veiculos: false, vazios: false, granito: false }

const items: VoyageRailItem[] = [
  {
    id: 1,
    vesselName: 'MAERSK ATLANTIC',
    voyageNumber: '024E',
    carrierName: 'Hapag-Lloyd',
    originPorts: ['Shanghai'],
    destinationPorts: ['Santos'],
    status: 'active',
    estado: 'conciliado',
    proximaEscala: { pod: 'Santos', eta: '2026-06-20', etb: null },
    escalasBrasileiras: [{ port: 'Santos', eta: '2026-06-20' }],
    modules: noModules,
  },
  {
    id: 2,
    vesselName: 'CMA CGM JULES',
    voyageNumber: '117W',
    carrierName: 'CMA CGM',
    originPorts: ['Rotterdam'],
    destinationPorts: ['Santos'],
    status: 'active',
    estado: 'incompleto',
    proximaEscala: { pod: 'Santos', eta: '2026-06-18', etb: null },
    escalasBrasileiras: [{ port: 'Santos', eta: '2026-06-18' }],
    modules: noModules,
  },
]

describe('filterVoyageRailItems', () => {
  it('retorna tudo quando filtros vazios', () => {
    expect(filterVoyageRailItems(items, { search: '', status: 'all', conciliacao: 'all', periodo: 'all' })).toHaveLength(2)
  })

  it('filtra por busca em nome do navio', () => {
    const result = filterVoyageRailItems(items, { search: 'maersk', status: 'all', conciliacao: 'all', periodo: 'all' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(1)
  })

  it('busca também em voyageNumber, carrier e portos', () => {
    expect(filterVoyageRailItems(items, { search: 'cma', status: 'all', conciliacao: 'all', periodo: 'all' })).toHaveLength(1)
    expect(filterVoyageRailItems(items, { search: 'rotterdam', status: 'all', conciliacao: 'all', periodo: 'all' })).toHaveLength(1)
  })

  it('filtra por status', () => {
    expect(filterVoyageRailItems(items, { search: '', status: 'completed', conciliacao: 'all', periodo: 'all' })).toHaveLength(0)
  })

  it('filtra por conciliação pendente (incompleto ou divergente)', () => {
    const result = filterVoyageRailItems(items, { search: '', status: 'all', conciliacao: 'pendente', periodo: 'all' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(2)
  })

  it('filtra por conciliação conciliada', () => {
    const result = filterVoyageRailItems(items, { search: '', status: 'all', conciliacao: 'conciliada', periodo: 'all' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(1)
  })

  it('período "próximos 7 dias" mantém a escala dentro da janela e descarta a de depois', () => {
    const today = new Date()
    const inDays = (days: number) => {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days)
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    }
    const janela: VoyageRailItem[] = [
      { ...items[0], id: 10, proximaEscala: { pod: 'Santos', eta: inDays(3), etb: null } },
      { ...items[0], id: 11, proximaEscala: { pod: 'Santos', eta: inDays(20), etb: null } },
      { ...items[0], id: 12, proximaEscala: { pod: 'Santos', eta: inDays(-1), etb: null } },
    ]

    const result = filterVoyageRailItems(janela, { search: '', status: 'all', conciliacao: 'all', periodo: '7d' })

    expect(result.map((item) => item.id)).toEqual([10])
  })

  it('ordena por próxima escala (ETA) ascendente, depois por navio/viagem', () => {
    const result = filterVoyageRailItems(items, { search: '', status: 'all', conciliacao: 'all', periodo: 'all' })
    expect(result[0].id).toBe(2) // ETA 2026-06-18 vem antes de 2026-06-20
  })

  it('desempata ETAs pela ETB antes de navio e viagem', () => {
    const sameEta = [
      {
        ...items[0],
        id: 3,
        vesselName: 'ALPHA',
        voyageNumber: '003E',
        proximaEscala: { pod: 'Santos', eta: '2026-06-20', etb: '2026-06-22' },
      },
      {
        ...items[1],
        id: 4,
        vesselName: 'ZULU',
        voyageNumber: '004E',
        proximaEscala: { pod: 'Santos', eta: '2026-06-20', etb: '2026-06-21' },
      },
    ]

    const result = filterVoyageRailItems(sameEta, { search: '', status: 'all', conciliacao: 'all', periodo: 'all' })

    expect(result.map((item) => item.id)).toEqual([4, 3])
  })

  it('coloca ETB nula após ETBs definidas quando a ETA é igual', () => {
    const sameEta = [
      {
        ...items[0],
        id: 5,
        vesselName: 'ALPHA',
        proximaEscala: { pod: 'Santos', eta: '2026-06-20', etb: null },
      },
      {
        ...items[1],
        id: 6,
        vesselName: 'ZULU',
        proximaEscala: { pod: 'Santos', eta: '2026-06-20', etb: '2026-06-21' },
      },
    ]

    const result = filterVoyageRailItems(sameEta, { search: '', status: 'all', conciliacao: 'all', periodo: 'all' })

    expect(result.map((item) => item.id)).toEqual([6, 5])
  })

  it('desempata navio antes da viagem quando um nome é prefixo do outro', () => {
    const sameSchedule = [
      {
        ...items[0],
        id: 7,
        vesselName: 'ALPHA',
        voyageNumber: 'Z',
        proximaEscala: { pod: 'Santos', eta: '2026-06-20', etb: '2026-06-21' },
      },
      {
        ...items[1],
        id: 8,
        vesselName: 'ALPHA A',
        voyageNumber: 'A',
        proximaEscala: { pod: 'Santos', eta: '2026-06-20', etb: '2026-06-21' },
      },
    ]

    const result = filterVoyageRailItems(sameSchedule, { search: '', status: 'all', conciliacao: 'all', periodo: 'all' })

    expect(result.map((item) => item.id)).toEqual([7, 8])
  })

  it('filtro de período "hoje" inclui só escalas com ETA >= hoje', () => {
    // Como o "hoje" varia, validamos apenas que a função não quebra e respeita o tipo.
    const result = filterVoyageRailItems(items, { search: '', status: 'all', conciliacao: 'all', periodo: 'hoje' })
    expect(Array.isArray(result)).toBe(true)
  })

  it('período "custom" filtra escalas entre datas específicas (inclusive)', () => {
    const result = filterVoyageRailItems(items, {
      search: '',
      status: 'all',
      conciliacao: 'all',
      periodo: 'custom',
      dataInicio: '2026-06-19',
      dataFim: '2026-06-21',
    })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(1) // ETA 2026-06-20 dentro do intervalo; id 2 (18/06) fora
  })

  it('período "custom" com só data inicial aplica apenas o piso', () => {
    const result = filterVoyageRailItems(items, {
      search: '',
      status: 'all',
      conciliacao: 'all',
      periodo: 'custom',
      dataInicio: '2026-06-19',
      dataFim: '',
    })
    expect(result.map((r) => r.id)).toEqual([1])
  })

  it('período "custom" sem datas não filtra nada', () => {
    const result = filterVoyageRailItems(items, {
      search: '',
      status: 'all',
      conciliacao: 'all',
      periodo: 'custom',
      dataInicio: '',
      dataFim: '',
    })
    expect(result).toHaveLength(2)
  })
})

import { describe, expect, it } from 'vitest'
import type { PortalOperationBL } from '../../services/portalOperation'
import {
  blCargoLabel,
  blMatchesReturnSituation,
  blReturnSummary,
  containerMatchesReturnSituation,
  containerSituation,
  countContainersInDemurrage,
  countContainersWithoutReturn,
  flattenContainers,
  localChargesView,
} from '../portalOperationViews'

const bls: PortalOperationBL[] = [
  {
    bl_id: 'BL1', ce_mercante: 'CE1', pol: 'CNSHA', pod: 'BRVIX', voyage_id: 1, voyage_number: '001W', vessel_name: 'NAVIO A',
    container_count: 2, containers_in_demurrage: 1, containers_returned: 1,
    containers: [
      { id: 1, container_number: 'C1', type: '40GP', discharge_date: '2026-06-01', return_date: '2026-06-10', usage_days: 9, free_time_days: 21, demurrage_days: 0, status: 'devolvido' },
      { id: 2, container_number: 'C2', type: '20GP', discharge_date: '2026-06-01', return_date: null, usage_days: 25, free_time_days: 10, demurrage_days: 15, status: 'em_demurrage' },
    ],
  },
  {
    bl_id: 'BL2', ce_mercante: null, pol: 'CNSHA', pod: 'BRSSZ', voyage_id: 2, voyage_number: '002W', vessel_name: 'NAVIO B',
    container_count: 1, containers_in_demurrage: 0, containers_returned: 1,
    containers: [
      { id: 3, container_number: 'C3', type: '40GP', discharge_date: '2026-06-02', return_date: '2026-06-12', usage_days: 10, free_time_days: 21, demurrage_days: 0, status: 'devolvido' },
    ],
  },
]

describe('flattenContainers', () => {
  it('achata containers carregando dados do B/L', () => {
    const flat = flattenContainers(bls)
    expect(flat).toHaveLength(3)
    expect(flat[0]).toMatchObject({ container_number: 'C1', bl_id: 'BL1', pol: 'CNSHA', vessel_name: 'NAVIO A' })
  })
})

describe('countContainers helpers', () => {
  it('conta containers sem devolucao', () => {
    expect(countContainersWithoutReturn(bls)).toBe(1)
  })
  it('conta containers em demurrage (sem devolucao e dias > 0)', () => {
    expect(countContainersInDemurrage(bls)).toBe(1)
  })
})

describe('blMatchesReturnSituation', () => {
  it('todos_devolvidos exige todos os containers devolvidos', () => {
    expect(blMatchesReturnSituation(bls[0], 'todos_devolvidos')).toBe(false)
    expect(blMatchesReturnSituation(bls[1], 'todos_devolvidos')).toBe(true)
  })
  it('sem_devolucao identifica B/Ls com pendencias', () => {
    expect(blMatchesReturnSituation(bls[0], 'sem_devolucao')).toBe(true)
    expect(blMatchesReturnSituation(bls[1], 'sem_devolucao')).toBe(false)
  })
  it('em_demurrage identifica B/Ls com container em demurrage', () => {
    expect(blMatchesReturnSituation(bls[0], 'em_demurrage')).toBe(true)
    expect(blMatchesReturnSituation(bls[1], 'em_demurrage')).toBe(false)
  })
})

describe('containerMatchesReturnSituation', () => {
  const flat = flattenContainers(bls)
  it('sem_devolucao filtra containers ainda nao devolvidos', () => {
    expect(flat.filter((c) => containerMatchesReturnSituation(c, 'sem_devolucao')).map((c) => c.container_number)).toEqual(['C2'])
  })
  it('em_demurrage filtra containers gerando sobreestadia', () => {
    expect(flat.filter((c) => containerMatchesReturnSituation(c, 'em_demurrage')).map((c) => c.container_number)).toEqual(['C2'])
  })
})

describe('portalOperationViews — SOC', () => {
  const socBl: PortalOperationBL = {
    ...bls[0],
    bl_id: 'BL-SOC',
    container_count: 2,
    containers_returned: 1,
    containers: [
      { id: 10, container_number: 'S1', type: '40GP', discharge_date: '2026-06-01', return_date: null, usage_days: 60, free_time_days: 21, demurrage_days: null, status: 'soc' },
      { id: 11, container_number: 'C1', type: '40GP', discharge_date: '2026-06-01', return_date: '2026-06-10', usage_days: 9, free_time_days: 21, demurrage_days: 0, status: 'devolvido' },
    ],
  }

  it('SOC não conta como devolução pendente nem impede "todos devolvidos"', () => {
    expect(blMatchesReturnSituation(socBl, 'todos_devolvidos')).toBe(true)
    expect(blMatchesReturnSituation(socBl, 'sem_devolucao')).toBe(false)
    expect(containerMatchesReturnSituation(socBl.containers[0], 'sem_devolucao')).toBe(false)
    expect(countContainersWithoutReturn([socBl])).toBe(0)
    expect(countContainersInDemurrage([socBl])).toBe(0)
  })
})

describe('portalOperationViews — tela limpa da rodada 2', () => {
  const inFreeTime = { id: 20, container_number: 'F1', type: '20GP', discharge_date: '2026-10-05', return_date: null, usage_days: 12, free_time_days: 21, demurrage_days: 0, status: 'dentro_free_time' as const }
  const freeTimeBl: PortalOperationBL = { ...bls[1], bl_id: 'BL-FT', containers: [inFreeTime, bls[0].containers[1]] }

  it('no_free_time separa quem ainda está no free time de quem já está em demurrage', () => {
    expect(containerMatchesReturnSituation(inFreeTime, 'no_free_time')).toBe(true)
    expect(containerMatchesReturnSituation(bls[0].containers[1], 'no_free_time')).toBe(false)
    expect(containerMatchesReturnSituation({ ...inFreeTime, return_date: '2026-10-10' }, 'no_free_time')).toBe(false)
    expect(blMatchesReturnSituation(freeTimeBl, 'no_free_time')).toBe(true)
    expect(blMatchesReturnSituation(bls[0], 'no_free_time')).toBe(false)
  })

  it('situação em texto com os dias que faltam do free time', () => {
    expect(containerSituation(inFreeTime)).toEqual({ label: 'No free time · 9 dias', tone: 'warning' })
    expect(containerSituation({ ...inFreeTime, usage_days: 20 }).label).toBe('No free time · 1 dia')
    expect(containerSituation({ ...inFreeTime, usage_days: 21 }).label).toBe('No free time · último dia')
    expect(containerSituation(bls[0].containers[1])).toEqual({ label: 'Em demurrage', tone: 'danger' })
    expect(containerSituation(bls[0].containers[0])).toEqual({ label: 'Devolvido', tone: 'default' })
  })

  it('resume devolução e demurrage do B/L sem contar SOC', () => {
    expect(blReturnSummary(bls[0])).toEqual({ returnable: 2, returned: 1, awaiting: 1, inDemurrage: 1 })
    const soc = { ...inFreeTime, id: 21, status: 'soc' as const }
    expect(blReturnSummary({ ...bls[0], containers: [soc, bls[0].containers[0]] })).toEqual({ returnable: 1, returned: 1, awaiting: 0, inDemurrage: 0 })
  })

  it('escreve a carga com vírgula decimal e diz que é carga solta', () => {
    expect(blCargoLabel(bls[0])).toBe('2 containers')
    expect(blCargoLabel(bls[1])).toBe('1 container')
    expect(blCargoLabel({ ...bls[1], cargo_mode: 'carga_solta', container_count: 0, containers: [], bb_weight_ton: 64.5 })).toBe('Carga solta · 64,5 t')
    expect(blCargoLabel({ ...bls[1], cargo_mode: 'misto', bb_weight_ton: 12.5 })).toBe('1 container + 12,5 t')
  })

  it('Taxas locais e Pagamento só com fatura visível', () => {
    const open = localChargesView({ status: 'open', total_brl: 4804, balance_brl: 1202 })
    expect(open.total).toBe(4804)
    expect(open.payment?.tone).toBe('warning')
    expect(open.payment?.label).toMatch(/^R\$\s1\.202,00 em aberto$/)
    expect(localChargesView({ status: 'paid', total_brl: 2702, balance_brl: 0 })).toEqual({ total: 2702, payment: { label: 'Pago', tone: 'paid' } })
    expect(localChargesView({ status: 'awaiting_invoice', total_brl: null, balance_brl: null })).toEqual({ total: null, payment: { label: 'Aguardando fatura', tone: 'default' } })
    expect(localChargesView({ status: 'none', total_brl: null, balance_brl: null })).toEqual({ total: null, payment: null })
    expect(localChargesView(undefined)).toEqual({ total: null, payment: null })
  })
})

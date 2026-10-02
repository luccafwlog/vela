import { describe, expect, it } from 'vitest'
import type { PortalOperationBL } from '../../services/portalOperation'
import {
  blMatchesReturnSituation,
  containerMatchesReturnSituation,
  countContainersInDemurrage,
  countContainersWithoutReturn,
  flattenContainers,
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

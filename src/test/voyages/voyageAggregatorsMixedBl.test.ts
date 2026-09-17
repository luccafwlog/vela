import { describe, expect, it } from 'vitest'
import {
  splitVoyageBls,
  summarizeImportByPod,
  type VoyageBl,
} from '../../services/voyageSummaries'

describe('Agregadores de Viagem com B/Ls Mistos', () => {
  const mixedBl: VoyageBl = {
    id: 'BL-MISTO-01',
    cargo_mode: 'misto',
    pol: 'CNSHA',
    pod: 'BRVIX',
    bb_weight_ton: 25.4,
    bb_packages_qty: 6,
    bb_machine_qty: 2,
    total_cbm: 50,
    bl_containers: [
      {
        container_number: 'CNTR001',
        is_imo: true,
        is_oog: false,
        container_type: '40HC',
      } as unknown as NonNullable<VoyageBl['bl_containers']>[number],
    ],
  } as unknown as VoyageBl

  const containerOnlyBl: VoyageBl = {
    id: 'BL-CNTR-01',
    cargo_mode: 'container',
    pol: 'CNSHA',
    pod: 'BRVIX',
    bl_containers: [
      {
        container_number: 'CNTR002',
        is_imo: false,
        is_oog: false,
        container_type: '20GP',
      } as unknown as NonNullable<VoyageBl['bl_containers']>[number],
    ],
  } as unknown as VoyageBl

  const breakbulkOnlyBl: VoyageBl = {
    id: 'BL-BB-01',
    cargo_mode: 'carga_solta',
    pol: 'CNSHA',
    pod: 'BRVIX',
    bb_weight_ton: 10.0,
    bb_packages_qty: 4,
    bb_machine_qty: 0,
    total_cbm: 20,
    bl_containers: [],
  } as unknown as VoyageBl

  it('splitVoyageBls inclui BL misto em ambas as listas sem duplicar nas contagens globais', () => {
    const bls = [mixedBl, containerOnlyBl, breakbulkOnlyBl]
    const { containerBls, breakbulkBls } = splitVoyageBls(bls)

    // containerBls deve conter o puro container e o misto
    expect(containerBls.map((b) => b.id)).toEqual(['BL-MISTO-01', 'BL-CNTR-01'])

    // breakbulkBls deve conter o puro carga solta e o misto
    expect(breakbulkBls.map((b) => b.id)).toEqual(['BL-MISTO-01', 'BL-BB-01'])

    // O total de B/Ls unicos da viagem continua sendo 3 (sem duplicacao)
    const uniqueBlCount = new Set([...containerBls, ...breakbulkBls].map((b) => b.id)).size
    expect(uniqueBlCount).toBe(3)
  })

  it('summarizeImportByPod agrega corretamente contêineres e carga solta do B/L misto', () => {
    const bls = [mixedBl, containerOnlyBl, breakbulkOnlyBl]
    const summaries = summarizeImportByPod(bls, [])

    expect(summaries).toHaveLength(1)
    const vixSummary = summaries[0]

    expect(vixSummary.pod).toBe('BRVIX')

    // 1. Contêineres: 1 do misto + 1 do container = 2 contêineres distintos
    expect(vixSummary.containers.distinct).toBe(2)
    // 1 IMO vindo do misto
    expect(vixSummary.containers.imo).toBe(1)

    // 2. Carga Solta: 25.4t (misto) + 10.0t (solta) = 35.4t
    expect(vixSummary.breakbulk.weightTon).toBeCloseTo(35.4)
    // 6 pacotes (misto) + 4 pacotes (solta) = 10 pacotes
    expect(vixSummary.breakbulk.packages).toBe(10)
    // 2 máquinas (misto) + 0 (solta) = 2 máquinas
    expect(vixSummary.breakbulk.machines).toBe(2)
    // 50 cbm + 20 cbm = 70 cbm
    expect(vixSummary.breakbulk.cbm).toBe(70)
    // 2 B/Ls com carga solta (1 misto + 1 breakbulk puro)
    expect(vixSummary.breakbulk.bls).toBe(2)
  })
})

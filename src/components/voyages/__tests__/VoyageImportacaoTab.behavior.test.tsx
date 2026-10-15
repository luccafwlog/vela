// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../services/supabase', () => ({ supabase: {}, isSupabaseConfigured: true }))
vi.mock('../../shared/VoyageImportActions', () => ({
  VoyageImportActions: () => <div data-testid="voyage-import-actions">Ações de Importação</div>,
}))

import { VoyageImportacaoTab } from '../VoyageImportacaoTab'
import type { Voyage } from '../voyageCardTypes'
import type { VoyageVehicleStat } from '../../../hooks/useVehicles'
import type { VoyageVaziosImportacaoStat } from '../../../hooks/useVaziosImportacaoStats'

afterEach(cleanup)

const emptyVehicleStats: VoyageVehicleStat = {
  totalVehicles: 0,
  distinctContainerCount: 0,
  containerNumbers: [],
  brandSummary: '',
  vehicleByContainerTypeSummary: '',
  byPod: {},
}

const emptyVaziosStats: VoyageVaziosImportacaoStat = {
  totalManifests: 0,
  distinctContainers: 0,
  containerTypes: '',
  destinations: '',
  byPod: {},
}

function makeVoyage(bls: Voyage['bls'] = []): Voyage {
  return {
    id: 10,
    voyage_number: '088E',
    vessel: { id: 1, name: 'ARIES' },
    carrier: { id: 1, name: 'COSCO' },
    status: 'active',
    created_at: '2026-08-01',
    bls,
  } as unknown as Voyage
}

describe('VoyageImportacaoTab', () => {
  it('renderiza estado vazio quando a viagem não tem cargas de importação', () => {
    render(
      <VoyageImportacaoTab
        voyage={makeVoyage([])}
        voyageLabel="ARIES / 088E"
        vehicleStats={emptyVehicleStats}
        vaziosImpStats={emptyVaziosStats}
        userId="user-1"
      />,
    )

    expect(screen.getByText('Nenhuma carga de importação vinculada a esta viagem.')).toBeTruthy()
    expect(screen.getByText('Total da viagem')).toBeTruthy()
    expect(screen.getByTestId('voyage-import-actions')).toBeTruthy()
  })

  it('renderiza blocos por escala com contagens de containers, carga solta e faixas por POD', () => {
    const voyage = makeVoyage([
      {
        id: 'bl-1',
        pod: 'BRSSZ',
        cargo_mode: 'container',
        bl_containers: [
          { id: 1, container_number: 'MSCU1234567', type: '40HC', is_imo: false, is_oog: true },
          { id: 2, container_number: 'MSCU7654321', type: '20GP', is_imo: true, is_oog: false },
        ],
      },
      {
        id: 'bl-2',
        pod: 'BRSSZ',
        cargo_mode: 'carga_solta',
        bb_weight_ton: 150,
        bb_machine_qty: 2,
        bb_packages_qty: 20,
        total_cbm: 45,
      },
    ] as unknown as Voyage['bls'])

    const vaziosStats: VoyageVaziosImportacaoStat = {
      ...emptyVaziosStats,
      totalManifests: 1,
      distinctContainers: 4,
      byPod: {
        BRSSZ: {
          manifestos: 1,
          distinctContainers: 4,
          types: [{ label: '20GP', count: 2 }, { label: '40HC', count: 2 }],
        },
      },
    }

    render(
      <VoyageImportacaoTab
        voyage={voyage}
        voyageLabel="ARIES / 088E"
        vehicleStats={emptyVehicleStats}
        vaziosImpStats={vaziosStats}
        userId="user-1"
      />,
    )

    expect(screen.getAllByText('BRSSZ').length).toBeGreaterThan(0)
    // Contêineres e carga solta dizem em quantos B/Ls estão (identidade, lote 1).
    expect(screen.getByText('2 CNTRs em 1 B/L · 150 t de carga solta em 1 B/L')).toBeTruthy()
    expect(screen.getByText('distintos em 1 B/L')).toBeTruthy()
    expect(screen.getByText('Sem veículos descarregados nesta escala')).toBeTruthy()
    expect(screen.getByText('150')).toBeTruthy()
    expect(screen.getByText('ton em 1 B/L')).toBeTruthy()
    expect(screen.getByText('Vazios IMP')).toBeTruthy()
  })

  it('preserva e renderiza vazios sem POD vinculados (importação manual por planilha)', () => {
    const unassignedVaziosStats: VoyageVaziosImportacaoStat = {
      totalManifests: 1,
      distinctContainers: 6,
      containerTypes: '40HC (4) | 20GP (2)',
      destinations: '',
      byPod: {},
      unassigned: {
        manifestos: 1,
        distinctContainers: 6,
        types: [{ label: '40HC', count: 4 }, { label: '20GP', count: 2 }],
      },
    }

    render(
      <VoyageImportacaoTab
        voyage={makeVoyage([])}
        voyageLabel="ARIES / 088E"
        vehicleStats={emptyVehicleStats}
        vaziosImpStats={unassignedVaziosStats}
        userId="user-1"
      />,
    )

    expect(screen.queryByText('Nenhuma carga de importação vinculada a esta viagem.')).toBeNull()
    expect(screen.getByText('Sem escala atribuída')).toBeTruthy()
    expect(screen.getByText('Cargas de importação sem porto de descarga (POD) definido')).toBeTruthy()
    expect(screen.getByText('6 vazios')).toBeTruthy()
    expect(screen.getByText('containers')).toBeTruthy()
  })

  it('calcula corretamente a faixa de totais da viagem', () => {
    const voyage = makeVoyage([
      {
        id: 'bl-1',
        pod: 'BRSSZ',
        cargo_mode: 'container',
        bl_containers: [
          { id: 1, container_number: 'MSCU1111111', type: '40HC', is_imo: true, is_oog: false },
          { id: 2, container_number: 'MSCU2222222', type: '20GP', is_imo: false, is_oog: true },
        ],
      },
      {
        id: 'bl-2',
        pod: 'BRVIX',
        cargo_mode: 'carga_solta',
        bb_weight_ton: 80,
      },
    ] as unknown as Voyage['bls'])

    const vehicleStats: VoyageVehicleStat = {
      totalVehicles: 5,
      distinctContainerCount: 2,
      containerNumbers: ['MSCU1111111'],
      brandSummary: 'TOYOTA: 5',
      vehicleByContainerTypeSummary: '40HC: 5',
      byPod: {
        BRSSZ: {
          totalVehicles: 5,
          distinctContainerCount: 1,
          brandSummary: 'TOYOTA: 5',
          vehicleByContainerTypeSummary: '40HC: 5',
        },
      },
    }

    const { container } = render(
      <VoyageImportacaoTab
        voyage={voyage}
        voyageLabel="ARIES / 088E"
        vehicleStats={vehicleStats}
        vaziosImpStats={emptyVaziosStats}
        userId="user-1"
      />,
    )

    const totalStrip = container.querySelector('.flex.flex-wrap.items-center') as HTMLElement
    expect(totalStrip).toBeTruthy()
    expect(within(totalStrip).getByText('B/Ls')).toBeTruthy()
    expect(within(totalStrip).getByText(/^CNTRs distintos em \d+ B\/Ls?$/)).toBeTruthy()
    expect(within(totalStrip).getByText(/^Carga solta em \d+ B\/Ls?$/)).toBeTruthy()
    expect(within(totalStrip).getByText('Veículos')).toBeTruthy()
    expect(within(totalStrip).getByText('80 ton')).toBeTruthy()
  })
})

// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../services/supabase', () => ({ supabase: {}, isSupabaseConfigured: true }))
vi.mock('../../shared/VoyageImportActions', () => ({
  VoyageImportActions: () => <div data-testid="voyage-import-actions">Ações de Exportação</div>,
}))

import { VoyageExportacaoTab } from '../VoyageExportacaoTab'
import type { Voyage } from '../voyageCardTypes'

afterEach(cleanup)

function makeVoyage(overrides: Partial<Voyage> = {}): Voyage {
  return {
    id: 10,
    voyage_number: '088E',
    vessel: { id: 1, name: 'ARIES' },
    carrier: { id: 1, name: 'COSCO' },
    status: 'active',
    created_at: '2026-08-01',
    granite_manifests: [],
    vazios_manifests: [],
    ...overrides,
  } as unknown as Voyage
}

describe('VoyageExportacaoTab', () => {
  it('renderiza mensagem de estado vazio quando a viagem não tem cargas de exportação', () => {
    render(
      <VoyageExportacaoTab
        voyage={makeVoyage()}
        voyageLabel="ARIES / 088E"
        userId="user-1"
      />,
    )

    expect(screen.getByText('Nenhuma carga de exportação vinculada a esta viagem.')).toBeTruthy()
    expect(screen.getByText('Total da viagem')).toBeTruthy()
    expect(screen.getByTestId('voyage-import-actions')).toBeTruthy()
  })

  it('renderiza terminal com granito e vazios com breakdown por depot', () => {
    const voyage = makeVoyage({
      granite_manifests: [
        {
          id: 'gm-1',
          loading_port: 'BRSSZ',
          total_bls: 2,
          total_weight_kg: 213000,
          granite_bls: [{ id: 'gbl-1' }, { id: 'gbl-2' }],
        },
      ] as never,
      vazios_manifests: [
        {
          id: 'vm-1',
          vazios_bookings: [
            { id: 'vb-1', container_number: 'MSCU1', container_type: '20GP', local_id: 'd1', operation: { embark_port: 'BRSSZ' }, local: { id: 'd1', code: 'SSZ-SB', name: 'Santos Brasil' } },
            { id: 'vb-2', container_number: 'MSCU2', container_type: '40HC', local_id: 'd2', operation: { embark_port: 'BRSSZ' }, local: { id: 'd2', code: 'SSZ-GRJ', name: 'Depot Guarujá' } },
          ],
        },
      ] as never,
    })

    render(
      <VoyageExportacaoTab
        voyage={voyage}
        voyageLabel="ARIES / 088E"
        userId="user-1"
      />,
    )

    expect(screen.getAllByText('BRSSZ').length).toBeGreaterThan(0)
    expect(screen.getByText('2 vazios · 2 depots · 2 B/Ls de granito')).toBeTruthy()
    expect(screen.getByText('Santos Brasil')).toBeTruthy()
    expect(screen.getByText('Depot Guarujá')).toBeTruthy()
    expect(screen.getByText('213')).toBeTruthy()
    // Granito só totaliza a carga (lote 5b): o painel não mostra estados de cobrança.
    expect(screen.queryByText('Prontos')).toBeNull()
    expect(screen.queryByText('Faturados')).toBeNull()
  })

  it('trata terminal com apenas granito e zero vazios sem quebrar layout', () => {
    const voyage = makeVoyage({
      granite_manifests: [
        {
          id: 'gm-1',
          loading_port: 'BRVIX',
          total_bls: 5,
          total_weight_kg: 120000,
          granite_bls: [{ id: 'gbl-1' }],
        },
      ] as never,
      vazios_manifests: [],
    })

    render(
      <VoyageExportacaoTab
        voyage={voyage}
        voyageLabel="ARIES / 088E"
        userId="user-1"
      />,
    )

    expect(screen.getAllByText('BRVIX').length).toBeGreaterThan(0)
    expect(screen.getByText('5 B/Ls de granito')).toBeTruthy()
    expect(screen.queryByText(/0 vazios/)).toBeNull()
    expect(screen.getByText('Sem vazios embarcados neste terminal')).toBeTruthy()
    expect(screen.getByText('120')).toBeTruthy()
  })
})

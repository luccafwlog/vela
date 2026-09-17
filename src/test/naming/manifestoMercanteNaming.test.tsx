// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { VoyageManifestosTab } from '../../components/voyages/VoyageManifestosTab'
import { PolScheduleModal } from '../../components/shared/VoyageScheduleModals'
import { buildVoyageTimeline } from '../../services/voyageSummaries'
import type { VoyageRecord } from '../../types/database'

describe('Nomenclatura Oficial: Manifesto Mercante em vez de CE Master', () => {
  it('garante que a aba de rotas e manifestos usa "Nº de manifesto Mercante" e nao "CE Master"', () => {
    const dummyVoyage: VoyageRecord = {
      id: 99,
      voyage_number: '001W',
      vessel_id: 'v1',
      created_at: '2026-01-01',
      bls: [
        {
          id: 'BL-TEST-01',
          voyage_id: 99,
          pol: 'CNSHA',
          pod: 'BRVIX',
          bl_containers: [],
          ce_mercante: null,
          cargo_mode: 'container',
        } as any,
      ],
    }

    const queryClient = new QueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <VoyageManifestosTab
            voyage={dummyVoyage}
            voyageLabel="TEST / 001W"
            importBatches={[]}
            polSchedules={new Map([
              ['99::CNSHA', { entityId: '99::CNSHA', voyageId: 99, pol: 'CNSHA', etd: '2026-06-01', atd: null, escalaNumber: null }],
            ])}
            routeCeMasters={undefined}
            ceCoverage={{ filled: 0, total: 1 }}
            onEditPol={() => {}}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // O header e os botoes nao devem conter "CE Master"
    expect(screen.queryByText(/CE Master/i)).toBeNull()
    const informButton = screen.getByRole('button', { name: /Informar/i })
    expect(informButton.getAttribute('aria-label')).toContain('Nº de Manifesto Mercante')
    expect(informButton.getAttribute('aria-label')).not.toContain('CE Master')
  })

  it('garante que o modal de edicao de escala usa "Nº de Manifesto Mercante"', () => {
    render(
      <PolScheduleModal
        open={true}
        onClose={() => {}}
        polSchedule={{
          voyageId: 99,
          voyageLabel: 'TEST / 001W',
          pol: 'CNSHA',
          pod: 'BRVIX',
          etd: '2026-06-01',
          atd: null,
          ceMaster: null,
          batchIds: [],
          cargoMode: 'container',
        }}
        onSave={async () => {}}
      />,
    )

    expect(screen.getByText(/Nº de Manifesto Mercante/i)).toBeTruthy()
    expect(screen.queryByText(/CE Master/i)).toBeNull()
  })

  it('garante que a timeline de auditoria usa "Nº de Manifesto Mercante" nos eventos', () => {
    const events = buildVoyageTimeline({
      importBatches: [],
      auditEvents: [
        {
          id: 1,
          voyage_id: 99,
          field_name: 'ce_master',
          old_value: 'BR001',
          new_value: 'BR002',
          changed_at: '2026-06-01T12:00:00Z',
          changed_by: 'user1',
        },
      ],
      baplieImports: [],
    })

    const manifestoEvent = events.find((e) => e.kind === 'ce-master')
    expect(manifestoEvent).toBeDefined()
    expect(manifestoEvent?.title).toBe('Nº de Manifesto Mercante alterado')
    expect(manifestoEvent?.title).not.toContain('CE Master')
  })
})

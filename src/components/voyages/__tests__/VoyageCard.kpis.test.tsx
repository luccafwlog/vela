// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('../../../services/supabase', () => ({ supabase: {}, isSupabaseConfigured: true }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false, user: null, profile: null }) }))
vi.mock('../../../hooks/useVoyageReconciliation', () => ({ useVoyageReconciliation: () => ({ data: { items: [] } }) }))
vi.mock('../../../hooks/useAgencyReport', () => ({ useClosedAgencyReportPorts: () => ({ data: [] }) }))
let mockManifestos: Array<{ pol: string; pod: string; numero: string }> = []
vi.mock('../../../hooks/useManifestosMercante', () => ({
  useManifestosMercanteByVoyage: () => ({ data: mockManifestos }),
}))
vi.mock('../VoyageVisaoTab', () => ({ VoyageVisaoTab: () => <div /> }))
vi.mock('../VoyageImportacaoTab', () => ({ VoyageImportacaoTab: () => <div /> }))
vi.mock('../VoyageExportacaoTab', () => ({ VoyageExportacaoTab: () => <div /> }))
vi.mock('../VoyageManifestosTab', () => ({ VoyageManifestosTab: () => <div /> }))
vi.mock('../VoyageAgencyReportTab', () => ({ VoyageAgencyReportTab: () => <div /> }))
vi.mock('../OmitEscalaModal', () => ({ OmitEscalaModal: () => <div /> }))

import { VoyageCard, type Voyage } from '../VoyageCard'

afterEach(cleanup)
beforeEach(() => {
  mockManifestos = []
})

function renderCard(voyage: Partial<Voyage>, routeCeMasters?: Map<string, string>) {
  render(
    <VoyageCard
      voyage={{
        id: 7,
        voyage_number: '088E',
        status: 'active',
        vessel: { id: 1, name: 'ARIES', carrier: { id: 1, name: 'COSCO' } },
        bls: [],
        import_batches: [],
        granite_manifests: [],
        vazios_manifests: [],
        ...voyage,
      } as unknown as Voyage}
      vehicleStats={undefined}
      vaziosImpStats={undefined}
      voyagesWithUnpaidBls={null}
      polSchedules={undefined}
      routeCeMasters={routeCeMasters}
      scheduledEscalaRows={[]}
      exportSchedules={[]}
      onEditVoyage={() => {}}
      onDeleteVoyage={() => {}}
      onCancelVoyage={() => {}}
      onEditEscala={() => {}}
      onEditPol={() => {}}
    />,
  )
}

function kpiValue(label: string) {
  const cell = screen.getByText(label).parentElement
  return cell?.querySelector('strong')?.textContent
}

describe('KPIs do cabeçalho da viagem', () => {
  it('renderiza o card de conciliação com o título CONCILIAÇÃO e métricas estruturadas', () => {
    renderCard({
      bls: [
        { id: 'bl-1', batch_id: null, cargo_mode: 'container', pol: 'CNSHA', pod: 'BRVIX', ce_mercante: '123', bl_containers: [] },
        { id: 'bl-2', batch_id: null, cargo_mode: 'container', pol: 'CNSHA', pod: 'BRVIX', ce_mercante: null, bl_containers: [] },
      ],
    } as unknown as Partial<Voyage>)

    expect(screen.getByText('CONCILIAÇÃO')).toBeTruthy()
    expect(kpiValue('CE Mercante')).toBe('1/2')
    expect(kpiValue('Manifestos Mercante')).toBe('0/1')
    expect(kpiValue('Divergências EDIxBLs')).toBe('0')
  })

  it('conta Manifestos Mercante do manifesto importado, como a aba Rotas e Manifestos', () => {
    // O número Mercante desta rota vive no batch (setImportBatchCeMaster), não
    // em voyage_route_ce_master: o KPI precisa ler as duas fontes.
    renderCard({
      import_batches: [
        { id: 3, voyage_id: 7, cargo_mode: 'container', filename: 'manifesto.csv', uploaded_at: '2026-08-01', status: 'completed', total_bls: 1, ce_master: 'CE-123' },
      ],
      bls: [
        { id: 'bl-1', batch_id: 3, cargo_mode: 'container', pol: 'CNSHA', pod: 'BRVIX', ce_mercante: '1', bl_containers: [] },
      ],
    } as unknown as Partial<Voyage>)

    expect(kpiValue('Manifestos Mercante')).toBe('1/1')
  })

  it('conta Manifestos Mercante avulso por rota quando a viagem nasce só de B/Ls', () => {
    renderCard(
      { bls: [{ id: 'bl-1', batch_id: null, cargo_mode: 'container', pol: 'CNSHA', pod: 'BRVIX', ce_mercante: null, bl_containers: [] }] } as unknown as Partial<Voyage>,
      new Map([['7::CNSHA__BRVIX', 'CE-999']]),
    )

    expect(kpiValue('Manifestos Mercante')).toBe('1/1')
  })

  it('conta Manifestos Mercante registrados na tabela manifestos_mercante', () => {
    mockManifestos = [{ pol: 'CNSHA', pod: 'BRVIX', numero: 'MAN-555' }]
    renderCard({
      bls: [{ id: 'bl-1', batch_id: null, cargo_mode: 'container', pol: 'CNSHA', pod: 'BRVIX', ce_mercante: null, bl_containers: [] }],
    } as unknown as Partial<Voyage>)

    expect(kpiValue('Manifestos Mercante')).toBe('1/1')
  })

  it('usa os bookings realmente vinculados como total de vazios embarcados', () => {
    // total_bookings do manifesto está defasado (9) contra os 2 bookings que a
    // aba Exportação soma por porto de embarque.
    renderCard({
      vazios_manifests: [
        {
          id: 'm1',
          voyage_id: 7,
          description: null,
          total_bookings: 9,
          vazios_bookings: [
            { id: 'b1', container_number: 'AAAU1000001', container_type: '20GP', local_id: 'd1', condition: 'vazio', operation: { id: 'o1', embark_port: 'BRVIX' }, local: { id: 'd1', code: 'DEP', name: 'Depot', tipo: 'depot' } },
            { id: 'b2', container_number: 'AAAU1000002', container_type: '20GP', local_id: 'd1', condition: 'vazio', operation: { id: 'o1', embark_port: 'BRVIX' }, local: { id: 'd1', code: 'DEP', name: 'Depot', tipo: 'depot' } },
          ],
        },
      ],
    } as unknown as Partial<Voyage>)

    expect(screen.getByText('vazios embarcados').previousElementSibling?.textContent).toBe('2')
  })
})

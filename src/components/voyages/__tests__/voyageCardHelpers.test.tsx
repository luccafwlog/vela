// @vitest-environment jsdom
import { MemoryRouter } from 'react-router-dom'
import { renderToStaticMarkup } from 'react-dom/server'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useVoyageTransshipments } from '../../../hooks/useTransshipments'
import { useManifestosMercanteByVoyage } from '../../../hooks/useManifestosMercante'
import type { VoyageBl } from '../../../services/voyageSummaries'
import { buildVoyagePolEntityId } from '../../../services/voyageRouteSchedules'
import { VoyageManifestosTab } from '../VoyageManifestosTab'
import { buildVoyageRouteLegs, collectVoyageManifestBatchRows, formatPolDeparture, type VoyageImportBatch } from '../voyageCardHelpers'
import type { Voyage } from '../voyageCardTypes'

vi.mock('../../../services/supabase', () => ({ supabase: {}, isSupabaseConfigured: true }))
vi.mock('../../../hooks/useTransshipments', () => ({
  useVoyageTransshipments: vi.fn(() => ({ data: { omissions: [], transshipments: [] } })),
}))
vi.mock('../../../hooks/useManifestosMercante', () => ({
  useManifestosMercanteByVoyage: vi.fn(() => ({ data: [] })),
}))
function makeBl(overrides: Partial<VoyageBl> = {}): VoyageBl {
  return {
    id: 'BL-001',
    batch_id: null,
    cargo_mode: 'container',
    ce_mercante: null,
    bb_machine_qty: null,
    bb_packages_qty: null,
    bb_packages_total: null,
    bb_weight_ton: null,
    shipper: null,
    consignee: null,
    notify_party: null,
    pol: 'CNTAC',
    pod: 'BRVIX',
    total_weight_kg: null,
    total_cbm: null,
    bl_containers: null,
    bl_breakbulk_items: null,
    ...overrides,
  }
}

describe('collectVoyageManifestBatchRows', () => {
  it('deriva linhas de manifesto pelas rotas dos B/Ls mesmo sem batch', () => {
    const rows = collectVoyageManifestBatchRows({
      voyageId: 14,
      batches: [],
      bls: [
        makeBl({ id: 'BL-001', ce_mercante: 'CE-001' }),
        makeBl({ id: 'BL-002', ce_mercante: null }),
      ],
      polSchedules: new Map([['14::CNTAC', { etd: '2026-07-15' }]]),
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      routeKey: 'CNTAC__BRVIX',
      pol: 'CNTAC',
      pod: 'BRVIX',
      routeLabel: 'TAICANG -> VITORIA',
      modeLabel: 'CNTR',
      batchIds: [],
      etd: '2026-07-15',
      blCount: 2,
      ceFilled: 1,
      ceTotal: 2,
      ceMaster: null,
    })
  })

  it('usa CE Master por rota como fallback quando a viagem so-B/L nao tem batch', () => {
    const rows = collectVoyageManifestBatchRows({
      voyageId: 14,
      batches: [],
      bls: [makeBl({ id: 'BL-001', ce_mercante: 'CE-001' })],
      routeCeMasters: new Map([['14::CNTAC__BRVIX', '25BR09999']]),
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).not.toHaveProperty('filenames')
    expect(rows[0]).toMatchObject({ routeKey: 'CNTAC__BRVIX', batchIds: [], ceMaster: '25BR09999' })
  })

  it('exibe o desvio da rota quando o POD da linha tem omissao vigente', () => {
    const rows = collectVoyageManifestBatchRows({
      voyageId: 14,
      batches: [],
      bls: [makeBl({ pod: 'BRVIX', ce_mercante: 'CE-001' })],
      omissions: [{ id: 1, omittedPod: 'BRVIX', dischargePod: 'BRSSZ' }],
      transshipments: [{ blId: 'BL-001', omissionId: 1 }],
    })

    expect(rows[0]).toMatchObject({
      routeKey: 'CNTAC__BRVIX',
      routeLabel: 'TAICANG → VITORIA → SANTOS',
      omission: { omittedPod: 'BRVIX', dischargePod: 'BRSSZ' },
    })
  })

  it('não marca uma rota normal no mesmo POD de desembarque de outra omissão', () => {
    const rows = collectVoyageManifestBatchRows({
      voyageId: 14,
      batches: [],
      bls: [makeBl({ id: 'BL-NORMAL', pod: 'BRVIX' })],
      omissions: [{ id: 2, omittedPod: 'BRSSA', dischargePod: 'BRVIX' }],
      transshipments: [],
    })

    expect(rows[0].omission).toBeNull()
  })

  it('soma B/Ls avulsos na mesma rota de um batch existente', () => {
    const batch: VoyageImportBatch = {
      id: 10,
      voyage_id: 14,
      cargo_mode: 'container',
      filename: 'manifesto-cntac-brvix.xlsx',
      uploaded_at: '2026-07-01T10:00:00Z',
      status: 'completed',
      total_bls: 1,
      ce_master: '25BR00481',
    }

    const rows = collectVoyageManifestBatchRows({
      voyageId: 14,
      batches: [batch],
      bls: [
        makeBl({ id: 'BL-001', batch_id: 10, ce_mercante: 'CE-001' }),
        makeBl({ id: 'BL-002', batch_id: null, ce_mercante: null }),
      ],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      routeKey: 'CNTAC__BRVIX',
      batchIds: [10],
      blCount: 2,
      ceFilled: 1,
      ceTotal: 2,
      ceMaster: '25BR00481',
    })
  })

  it('inclui linhas de manifesto de vazios de importação com badge VAZIOS e CE Master de vazios', () => {
    const rows = collectVoyageManifestBatchRows({
      voyageId: 14,
      batches: [],
      bls: [makeBl({ id: 'BL-001', ce_mercante: 'CE-001' })],
      routeCeMasters: new Map([
        ['14::CNTAC__BRVIX', '25BR00001'],
        ['14::CNTAC__BRVIX__VAZIOS', '25BR99999'],
      ]),
      vaziosRoutes: [{ pol: 'CNTAC', pod: 'BRVIX', containerCount: 12 }],
    })

    expect(rows).toHaveLength(2)
    const cargoRow = rows.find((r) => !r.isVazios)
    const vaziosRow = rows.find((r) => r.isVazios)

    expect(cargoRow).toMatchObject({
      routeKey: 'CNTAC__BRVIX',
      modeLabel: 'CNTR',
      ceMaster: '25BR00001',
      blCount: 1,
    })

    expect(vaziosRow).toMatchObject({
      routeKey: 'CNTAC__BRVIX__vazios',
      modeLabel: 'VAZIOS',
      cargoMode: 'vazios',
      isVazios: true,
      containerCount: 12,
      ceMaster: '25BR99999',
    })
  })
})

describe('formatPolDeparture', () => {
  it('retorna ATD como data real quando existe', () => {
    expect(formatPolDeparture('2026-07-15', '2026-07-16')).toEqual({ value: '2026-07-16', isActual: true })
  })

  it('retorna ETD quando ATD nao existe sem quebrar com nulos', () => {
    expect(formatPolDeparture('2026-07-15', null)).toEqual({ value: '2026-07-15', isActual: false })
    expect(formatPolDeparture(null, null)).toEqual({ value: null, isActual: false })
  })
})

describe('VoyageManifestosTab', () => {
  it('mantem o titulo ETD e destaca ATD em verde quando conhecido', () => {
    const voyage = {
      id: 14,
      voyage_number: '001',
      vessel: { name: 'ALPHA' },
      bls: [makeBl({ id: 'BL-001', ce_mercante: 'CE-001' })],
    } as Voyage

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <VoyageManifestosTab
          voyage={voyage}
          voyageLabel="ALPHA / 001"
          importBatches={[]}
          polSchedules={new Map([
            [buildVoyagePolEntityId(14, 'CNTAC'), { entityId: '14::CNTAC', voyageId: 14, pol: 'CNTAC', etd: '2026-07-15', atd: '2026-07-16', escalaNumber: null }],
          ])}
          routeCeMasters={undefined}
          ceCoverage={{ filled: 1, total: 1 }}
          onEditPol={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(html).toContain('>Rota</th>')
    expect(html).toContain('>CE Mercante · cobertura</th>')
    expect(html).toContain('>Nº de manifesto Mercante</th>')
    expect(html).toContain('Total da viagem')
    expect(html).toContain('B/Ls vinculados')
    expect(html).toContain('Nº de manifesto a informar')
    expect(html).not.toContain('Conciliação:')
    expect(html).not.toContain('15/07/2026')
    expect(html).toContain('16/07/2026')
    expect(html).toContain('style="color:var(--app-green)"')
    expect(html).toContain('font-medium')
    expect(html).toContain('href="/bls?voyage=14&amp;pol=CNTAC&amp;pod=BRVIX"')
    expect(html).not.toContain('Rota derivada dos B/Ls')
    expect(html).not.toContain('Gerar EDI Mercante')
  })

  it('marca a rota desviada e sinaliza manifesto pendente', () => {
    const voyage = {
      id: 14,
      voyage_number: '001',
      vessel: { name: 'ALPHA' },
      bls: [makeBl({ id: 'BL-001', ce_mercante: 'CE-001', pod: 'BRSSZ' })],
    } as Voyage

    vi.mocked(useVoyageTransshipments).mockReturnValueOnce({
      data: {
        omissions: [{ id: 1, voyageId: 14, omittedPod: 'BRVIX', dischargePod: 'BRSSZ', reason: null, onwardVesselName: null, onwardCarrier: null, onwardVoyageNumber: null, onwardEtd: null, onwardEta: null }],
        transshipments: [{ id: 1, blId: 'BL-001', omissionId: 1, disposition: 'transshipment' }],
      },
    } as never)

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <VoyageManifestosTab
          voyage={voyage}
          voyageLabel="ALPHA / 001"
          importBatches={[]}
          polSchedules={undefined}
          routeCeMasters={undefined}
          ceCoverage={{ filled: 1, total: 1 }}
          onEditPol={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(html).toContain('TAICANG →')
    expect(html).toContain('class="line-through text-[var(--app-muted-soft)]"')
    expect(html).toContain('Omissão')
    expect(html).toContain('Informar')
    expect(html).not.toContain('manifesto não informado')
    expect(html).not.toContain('Informe o CE Master pelo lápis desta linha')
  })

  it('dispara onEditPol ao clicar no chip Informar de um manifesto pendente', () => {
    const onEditPol = vi.fn()
    const voyage = {
      id: 14,
      voyage_number: '001',
      vessel: { name: 'ALPHA' },
      bls: [makeBl({ id: 'BL-001', ce_mercante: 'CE-001', pol: 'CNTAC', pod: 'BRVIX' })],
    } as Voyage

    render(
      <MemoryRouter>
        <VoyageManifestosTab
          voyage={voyage}
          voyageLabel="ALPHA / 001"
          importBatches={[]}
          polSchedules={new Map([
            [buildVoyagePolEntityId(14, 'CNTAC'), { entityId: '14::CNTAC', voyageId: 14, pol: 'CNTAC', etd: '2026-07-15', atd: '2026-07-16', escalaNumber: null }],
          ])}
          routeCeMasters={undefined}
          ceCoverage={{ filled: 1, total: 1 }}
          onEditPol={onEditPol}
        />
      </MemoryRouter>,
    )

    const button = screen.getByRole('button', { name: 'Informar Nº de Manifesto Mercante de TAICANG -> VITORIA' })
    fireEvent.click(button)

    expect(onEditPol).toHaveBeenCalledTimes(1)
    expect(onEditPol).toHaveBeenCalledWith({
      voyageId: 14,
      voyageLabel: 'ALPHA / 001',
      pol: 'CNTAC',
      pod: 'BRVIX',
      etd: '2026-07-15',
      atd: '2026-07-16',
      ceMaster: null,
      batchIds: [],
    })
  })

  it('renderiza linha de vazios com link para vazios-importacao e permite informar CE Master de vazios', () => {
    const onEditPol = vi.fn()
    const voyage = {
      id: 14,
      voyage_number: '001',
      vessel: { name: 'ALPHA' },
      bls: [],
    } as unknown as Voyage

    render(
      <MemoryRouter>
        <VoyageManifestosTab
          voyage={voyage}
          voyageLabel="ALPHA / 001"
          importBatches={[]}
          polSchedules={new Map([
            [buildVoyagePolEntityId(14, 'CNTAC'), { entityId: '14::CNTAC', voyageId: 14, pol: 'CNTAC', etd: '2026-07-15', atd: '2026-07-16', escalaNumber: null }],
          ])}
          routeCeMasters={undefined}
          ceCoverage={{ filled: 0, total: 0 }}
          vaziosRoutes={[{ pol: 'CNTAC', pod: 'BRVIX', containerCount: 5 }]}
          onEditPol={onEditPol}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('VAZIOS')).toBeTruthy()
    expect(screen.getByText('5 cntr')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'TAICANG -> VITORIA' })
    expect(link.getAttribute('href')).toBe('/vazios-importacao?voyage=14&pod=BRVIX')

    const button = screen.getByRole('button', { name: 'Informar Nº de Manifesto Mercante de TAICANG -> VITORIA' })
    fireEvent.click(button)

    expect(onEditPol).toHaveBeenCalledWith({
      voyageId: 14,
      voyageLabel: 'ALPHA / 001',
      pol: 'CNTAC',
      pod: 'BRVIX',
      etd: '2026-07-15',
      atd: '2026-07-16',
      ceMaster: null,
      batchIds: [],
      cargoMode: 'vazios',
    })
  })

  it('renderiza multiplos manifestos mercante para a mesma rota com badges de natureza', () => {
    const voyage = {
      id: 14,
      voyage_number: '001',
      vessel: { name: 'ALPHA' },
      bls: [makeBl({ id: 'BL-001', ce_mercante: 'CE-001', pol: 'CNTAC', pod: 'BRVIX' })],
    } as Voyage

    vi.mocked(useManifestosMercanteByVoyage).mockReturnValueOnce({
      data: [
        {
          id: 'm1',
          voyage_id: 14,
          pol: 'CNTAC',
          pod: 'BRVIX',
          numero: '26BR000100',
          natureza: 'carga',
          created_at: '2026-07-01',
        },
        {
          id: 'm2',
          voyage_id: 14,
          pol: 'CNTAC',
          pod: 'BRVIX',
          numero: '26BR000200',
          natureza: 'vazio',
          created_at: '2026-07-02',
        },
      ],
    } as any)

    render(
      <MemoryRouter>
        <VoyageManifestosTab
          voyage={voyage}
          voyageLabel="ALPHA / 001"
          importBatches={[]}
          polSchedules={new Map([
            [buildVoyagePolEntityId(14, 'CNTAC'), { entityId: '14::CNTAC', voyageId: 14, pol: 'CNTAC', etd: '2026-07-15', atd: '2026-07-16', escalaNumber: null }],
          ])}
          routeCeMasters={undefined}
          ceCoverage={{ filled: 1, total: 1 }}
          onEditPol={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('26BR000100')).toBeTruthy()
    expect(screen.getByText('carga')).toBeTruthy()
    expect(screen.getByText('26BR000200')).toBeTruthy()
    expect(screen.getByText('vazio')).toBeTruthy()
  })
})

describe('buildVoyageRouteLegs', () => {
  const escalas = [
    { port: 'BRSSA', temImportacao: true, temExportacao: false },
    { port: 'BRVIX', temImportacao: true, temExportacao: true },
  ]

  it('separa a perna de importação da de exportação', () => {
    const legs = buildVoyageRouteLegs({
      bls: [],
      fallbackPol: null,
      escalas,
      exportDischargePorts: [],
    })

    expect(legs.importLeg).toEqual({ originPorts: [], destinationPorts: ['BRSSA', 'BRVIX'] })
    expect(legs.exportLeg).toEqual({ originPorts: ['BRVIX'], destinationPorts: [] })
  })

  it('mantém só a perna de importação quando nenhuma escala embarca', () => {
    const legs = buildVoyageRouteLegs({
      bls: [{ pol: 'CNTAC', pod: 'BRSSA' }],
      fallbackPol: null,
      escalas: [escalas[0]],
      exportDischargePorts: [],
    })

    expect(legs.importLeg).toEqual({ originPorts: ['CNTAC'], destinationPorts: ['BRSSA'] })
    expect(legs.exportLeg).toBeNull()
  })

  it('não inventa perna de importação em viagem que só embarca', () => {
    const legs = buildVoyageRouteLegs({
      bls: [],
      fallbackPol: 'BRVIX',
      escalas: [{ port: 'BRVIX', temImportacao: false, temExportacao: true, dischargePorts: ['NLRTM'] }],
      exportDischargePorts: [],
    })

    expect(legs.importLeg).toBeNull()
    expect(legs.exportLeg).toEqual({ originPorts: ['BRVIX'], destinationPorts: ['NLRTM'] })
  })

  it('soma os portos de descarga do cadastro aos dos manifestos importados', () => {
    const legs = buildVoyageRouteLegs({
      bls: [],
      fallbackPol: null,
      escalas: [{ ...escalas[1], dischargePorts: ['NLRTM'] }],
      exportDischargePorts: ['ITGOA', null],
    })

    expect(legs.exportLeg).toEqual({ originPorts: ['BRVIX'], destinationPorts: ['ITGOA', 'NLRTM'] })
  })

  it('abre a perna de exportação só com o cadastro, antes de existir manifesto', () => {
    const legs = buildVoyageRouteLegs({
      bls: [{ pol: 'CNTAC', pod: 'BRSSA' }],
      fallbackPol: null,
      escalas: [escalas[0], { ...escalas[1], dischargePorts: ['NLRTM'] }],
      exportDischargePorts: [],
    })

    expect(legs.importLeg).toEqual({ originPorts: ['CNTAC'], destinationPorts: ['BRSSA', 'BRVIX'] })
    expect(legs.exportLeg).toEqual({ originPorts: ['BRVIX'], destinationPorts: ['NLRTM'] })
  })
})

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { VoyageManifestosTab } from '../VoyageManifestosTab'
import type { ManifestoMercante } from '../../../services/manifestosMercanteService'
import type { VoyageDetail } from '../../../services/voyageReadModels'

const manifestos = vi.hoisted(() => ({ current: [] as ManifestoMercante[] }))

vi.mock('../../../hooks/useManifestosMercante', () => ({
  useManifestosMercanteByVoyage: () => ({ data: manifestos.current }),
}))
vi.mock('../../../hooks/useTransshipments', () => ({
  useVoyageTransshipments: () => ({ data: undefined }),
}))

const voyage = {
  id: 99,
  voyage_number: '22',
  bls: [{ id: 'BL-1', voyage_id: 99, pol: 'CNTAC', pod: 'BRVIX', bl_containers: [], ce_mercante: null, cargo_mode: 'container' }],
} as unknown as VoyageDetail

const manifesto = (id: string, numero: string, natureza: 'carga' | 'vazio'): ManifestoMercante => ({
  id, voyage_id: 99, pol: 'CNTAC', pod: 'BRVIX', numero, natureza, created_at: '2026-08-01',
})

function renderTab() {
  render(
    <MemoryRouter>
      <VoyageManifestosTab
        voyage={voyage}
        voyageLabel="TEST / 22"
        importBatches={[]}
        polSchedules={undefined}
        routeCeMasters={undefined}
        ceCoverage={{ filled: 0, total: 1 }}
        vaziosRoutes={[{ pol: 'CNTAC', pod: 'BRVIX', containerCount: 102 }]}
        canGenerateMercanteEdi
        onEditPol={() => {}}
      />
    </MemoryRouter>,
  )
  const rows = screen.getAllByRole('row').slice(1) // pula a linha de cabeçalho
  const rowOf = (modo: string) => rows.find((row) => within(row).queryByText(modo)) as HTMLElement
  return { carga: rowOf('CNTR'), vazios: rowOf('VAZIOS') }
}

describe('Rotas e manifestos: carga e vazios na mesma rota POL/POD', () => {
  beforeEach(() => { manifestos.current = [] })

  it('a linha VAZIOS não herda o número do manifesto de carga', () => {
    manifestos.current = [manifesto('m1', '1226501801342', 'carga')]
    const { carga, vazios } = renderTab()

    expect(within(carga).getByText('1226501801342')).toBeTruthy()
    expect(within(vazios).queryByText('1226501801342')).toBeNull()
    expect(within(vazios).getByRole('button', { name: /Informar Nº de Manifesto Mercante/ })).toBeTruthy()
  })

  it('cada linha mostra o seu próprio número', () => {
    manifestos.current = [manifesto('m1', '1226501801342', 'carga'), manifesto('m2', '1226501801999', 'vazio')]
    const { carga, vazios } = renderTab()

    expect(within(carga).getByText('1226501801342')).toBeTruthy()
    expect(within(carga).queryByText('1226501801999')).toBeNull()
    expect(within(vazios).getByText('1226501801999')).toBeTruthy()
    expect(within(vazios).queryByText('1226501801342')).toBeNull()
  })

  it('linha de contêiner e linha VAZIOS oferecem Gerar EDI Mercante (issue #560)', () => {
    const { carga, vazios } = renderTab()

    expect(within(carga).getByRole('button', { name: /^Gerar EDI Mercante de .*\(contêiner\)$/ })).toBeTruthy()
    expect(within(vazios).getByRole('button', { name: /Gerar EDI Mercante de .*\(vazios\)/ })).toBeTruthy()
  })

  // Migration 592 (decisão do dono de 2026-11-05): contêiner e carga solta da
  // mesma rota são linhas separadas, cada uma com os seus Manifestos e o seu EDI.
  const mixed = {
    ...voyage,
    bls: [
      { id: 'BL-1', voyage_id: 99, pol: 'CNTAC', pod: 'BRVIX', bl_containers: [], ce_mercante: '123456789012345', cargo_mode: 'container' },
      { id: 'BB-1', voyage_id: 99, pol: 'CNTAC', pod: 'BRVIX', bl_containers: [], ce_mercante: null, cargo_mode: 'carga_solta' },
      { id: 'MIX-1', voyage_id: 99, pol: 'CNTAC', pod: 'BRVIX', bl_containers: [], ce_mercante: null, cargo_mode: 'misto' },
    ],
  } as unknown as VoyageDetail

  function renderMixed() {
    render(
      <MemoryRouter>
        <VoyageManifestosTab voyage={mixed} voyageLabel="TEST / 22" importBatches={[]} polSchedules={undefined} routeCeMasters={undefined} ceCoverage={{ filled: 1, total: 3 }} vaziosRoutes={[]} canGenerateMercanteEdi
        onEditPol={() => {}} />
      </MemoryRouter>,
    )
    const rows = screen.getAllByRole('row').slice(1)
    expect(screen.queryByText('CNTR/BB')).toBeNull()
    return {
      cntr: rows.find((row) => within(row).queryByText('CNTR')) as HTMLElement,
      bb: rows.find((row) => within(row).queryByText('BB')) as HTMLElement,
    }
  }

  it('rota com contêiner e carga solta vira duas linhas; o misto fica na de carga solta', () => {
    const { cntr, bb } = renderMixed()
    expect(within(cntr).getByText('1')).toBeTruthy()
    expect(within(cntr).getByText('1 de 1')).toBeTruthy()
    expect(within(bb).getByText('2')).toBeTruthy()
    expect(within(bb).getByText('0 de 2')).toBeTruthy()
    expect(screen.getByText(/^1 rota/)).toBeTruthy()
  })

  it('cada linha mostra só os Manifestos da sua natureza', () => {
    manifestos.current = [
      { ...manifesto('m1', '1226502020123', 'carga'), cargo_mode: 'container' },
      { ...manifesto('m2', '1226502044464', 'carga'), cargo_mode: 'carga_solta' },
    ]
    const { cntr, bb } = renderMixed()
    expect(within(cntr).getByText('1226502020123')).toBeTruthy()
    expect(within(cntr).queryByText('1226502044464')).toBeNull()
    expect(within(bb).getByText('1226502044464')).toBeTruthy()
    expect(within(bb).queryByText('1226502020123')).toBeNull()
  })

  it('cada linha gera só o EDI da sua natureza', () => {
    const { cntr, bb } = renderMixed()
    expect(within(cntr).getByRole('button', { name: /^Gerar EDI Mercante de .*\(contêiner\)$/ })).toBeTruthy()
    expect(within(cntr).queryByRole('button', { name: /carga solta/ })).toBeNull()
    expect(within(bb).getByRole('button', { name: /Gerar EDI Mercante de .*\(carga solta\) \(parcial\)/ })).toBeTruthy()
    expect(within(bb).queryByRole('button', { name: /\(contêiner\)/ })).toBeNull()
  })

  it('sem a marca Dev, nenhuma linha mostra Gerar EDI Mercante', () => {
    render(
      <MemoryRouter>
        <VoyageManifestosTab voyage={voyage} voyageLabel="TEST / 22" importBatches={[]} polSchedules={undefined} routeCeMasters={undefined} ceCoverage={{ filled: 0, total: 1 }} vaziosRoutes={[{ pol: 'CNTAC', pod: 'BRVIX', containerCount: 102 }]} onEditPol={() => {}} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: /Gerar EDI Mercante/ })).toBeNull()
  })

  it('rota só de contêiner não oferece o arquivo de carga solta', () => {
    const { carga } = renderTab()
    expect(within(carga).queryByRole('button', { name: /carga solta/ })).toBeNull()
    expect(screen.queryByText('BB')).toBeNull()
  })
})

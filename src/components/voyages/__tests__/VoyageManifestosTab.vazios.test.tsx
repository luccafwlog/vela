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

    expect(within(carga).getByRole('button', { name: /^Gerar EDI Mercante de [^(]*$/ })).toBeTruthy()
    expect(within(vazios).getByRole('button', { name: /Gerar EDI Mercante de .*\(vazios\)/ })).toBeTruthy()
  })

  it('rota com contêiner e carga solta oferece os dois arquivos; só carga solta, só o parcial', () => {
    const mixed = {
      ...voyage,
      bls: [
        ...voyage.bls,
        { id: 'BB-1', voyage_id: 99, pol: 'CNTAC', pod: 'BRVIX', bl_containers: [], ce_mercante: null, cargo_mode: 'carga_solta' },
        { id: 'BB-2', voyage_id: 99, pol: 'CNTAC', pod: 'BRSSA', bl_containers: [], ce_mercante: null, cargo_mode: 'carga_solta' },
      ],
    } as unknown as VoyageDetail
    render(
      <MemoryRouter>
        <VoyageManifestosTab voyage={mixed} voyageLabel="TEST / 22" importBatches={[]} polSchedules={undefined} routeCeMasters={undefined} ceCoverage={{ filled: 0, total: 3 }} vaziosRoutes={[]} onEditPol={() => {}} />
      </MemoryRouter>,
    )
    const rows = screen.getAllByRole('row').slice(1)
    const mista = rows.find((row) => within(row).queryByText('CNTR/BB')) as HTMLElement
    const soCargaSolta = rows.find((row) => within(row).queryByText('BB')) as HTMLElement
    expect(within(mista).getByRole('button', { name: /^Gerar EDI Mercante de [^(]*$/ })).toBeTruthy()
    expect(within(mista).getByRole('button', { name: /Gerar EDI Mercante da carga solta .*\(parcial\)/ })).toBeTruthy()
    expect(within(soCargaSolta).queryByRole('button', { name: /^Gerar EDI Mercante de [^(]*$/ })).toBeNull()
    expect(within(soCargaSolta).getByRole('button', { name: /Gerar EDI Mercante da carga solta/ })).toBeTruthy()
  })

  it('rota CNTR/BB só com B/L misto oferece só o arquivo de carga solta', () => {
    const onlyMixed = {
      ...voyage,
      bls: [{ id: 'MIX-1', voyage_id: 99, pol: 'CNTAC', pod: 'BRSSZ', bl_containers: [], ce_mercante: null, cargo_mode: 'misto' }],
    } as unknown as VoyageDetail
    render(
      <MemoryRouter>
        <VoyageManifestosTab voyage={onlyMixed} voyageLabel="TEST / 22" importBatches={[]} polSchedules={undefined} routeCeMasters={undefined} ceCoverage={{ filled: 0, total: 1 }} vaziosRoutes={[]} onEditPol={() => {}} />
      </MemoryRouter>,
    )
    const row = screen.getAllByRole('row').slice(1).find((candidate) => within(candidate).queryByText('CNTR/BB')) as HTMLElement
    expect(within(row).queryByRole('button', { name: /^Gerar EDI Mercante de [^(]*$/ })).toBeNull()
    expect(within(row).getByRole('button', { name: /Gerar EDI Mercante da carga solta/ })).toBeTruthy()
  })

  it('rota só de contêiner não oferece o arquivo de carga solta', () => {
    const { carga } = renderTab()
    expect(within(carga).queryByRole('button', { name: /carga solta/ })).toBeNull()
  })
})

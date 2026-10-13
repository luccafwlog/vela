// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { BlVisaoGeralTab, type BaplieStatus } from '../BlVisaoGeralTab'

vi.mock('../BlClienteSection', () => ({
  BlClienteSection: ({ layout }: { layout: (parts: { cliente: unknown; portal: unknown; wide: boolean }) => unknown }) =>
    layout({ cliente: <div>Cliente</div>, portal: <div>Portal</div>, wide: false }),
}))

const baseBl = {
  id: 'BL1',
  voyage_id: 7,
  pol: 'BRSSZ',
  pod: 'BRRIG',
  bb_machine_qty: 0,
  bb_packages_qty: 0,
  bb_packages_total: 0,
  bb_weight_ton: 0,
  total_cbm: 0,
} as never

const containerSummary = { distinct: 0, imo: 0, oog: 0, soc: 0, coc: 0 }
const breakbulkSummary = { machines: 0, packages: 0, packagesTotal: 0, weightTon: 0, cbm: 0 }
const omittedVoyage = { id: 9, voyageId: 7, omittedPod: 'BRSSA', dischargePod: 'BRVIX', reason: null, onwardVesselName: null, onwardCarrier: null, onwardVoyageNumber: null, onwardEtd: null, onwardEta: null }

function renderTab(baplieStatus: BaplieStatus) {
  render(
    <MemoryRouter>
      <BlVisaoGeralTab
        active
        bl={baseBl}
        cargoMode="container"
        containerSummary={containerSummary}
        breakbulkSummary={breakbulkSummary}
        baplieStatus={baplieStatus}
      />
    </MemoryRouter>,
  )
}

describe('BlVisaoGeralTab — status do Baplie', () => {
  it('mostra estado de carregamento, nao verde, enquanto a reconciliacao esta pendente', () => {
    renderTab({ state: 'loading', divergenceCount: 0 })
    expect(screen.getByText('Verificando Baplie…')).toBeTruthy()
    expect(screen.queryByText('Baplie sem divergências')).toBeNull()
  })

  it('mostra erro explicito quando a consulta falha, nao verde', () => {
    renderTab({ state: 'error', divergenceCount: 0 })
    expect(screen.getByText('Erro ao verificar Baplie')).toBeTruthy()
    expect(screen.queryByText('Baplie sem divergências')).toBeNull()
  })

  it('mostra nao importado quando nao ha staging do Baplie, nao verde', () => {
    renderTab({ state: 'not_imported', divergenceCount: 0 })
    expect(screen.getByText('Baplie não importado')).toBeTruthy()
    expect(screen.queryByText('Baplie sem divergências')).toBeNull()
  })

  it('so mostra verde apos reconciliacao concluida sem divergencias', () => {
    renderTab({ state: 'reconciled', divergenceCount: 0 })
    expect(screen.getByText('Baplie sem divergências')).toBeTruthy()
  })

  it('mostra contagem de divergencias quando reconciliado com achados', () => {
    renderTab({ state: 'reconciled', divergenceCount: 3 })
    expect(screen.getByText('3 divergências com o Baplie')).toBeTruthy()
  })
})

describe('BlVisaoGeralTab — transbordo e COD', () => {
  it('mostra a ação Marcar COD quando existe omissão sem disposição persistida', () => {
    render(
      <MemoryRouter>
        <BlVisaoGeralTab
          active
          bl={baseBl}
          omission={omittedVoyage}
          cargoMode="container"
          containerSummary={containerSummary}
          breakbulkSummary={breakbulkSummary}
          onCod={vi.fn()}
          baplieStatus={{ state: 'not_imported', divergenceCount: 0 }}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Transbordo' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Marcar COD/ })).toBeTruthy()
  })
})

describe('BlVisaoGeralTab — blocos da identidade', () => {
  const container = (id: number, number: string, extra: Record<string, unknown> = {}) => ({
    id, container_number: number, ownership: 'COC', return_date: null, discharge_date: '2026-10-11', seal_number: `SL${id}`, gross_weight_kg: 24250, demurrage_status: 'within_free_time', ...extra,
  })

  it('separa Embarque, Documento Mercante e Carga em blocos, com a devolução como dado principal', () => {
    render(
      <MemoryRouter>
        <BlVisaoGeralTab
          active
          bl={{ ...(baseBl as object), ce_mercante: '152605123456701', bl_containers: [container(1, 'CSNU6012301'), container(2, 'CSNU6012302', { return_date: '2026-10-12' })] } as never}
          cargoMode="container"
          containerSummary={{ ...containerSummary, distinct: 2, coc: 2 }}
          breakbulkSummary={breakbulkSummary}
          baplieStatus={{ state: 'not_imported', divergenceCount: 0 }}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('region', { name: 'Embarque' })).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Documento Mercante' })).getByText('152605123456701')).toBeTruthy()
    const carga = screen.getByRole('region', { name: 'Carga' })
    expect(within(carga).getByText('1 de 2 devolvidos').className).toContain('app-lead__value--warning')
    expect(within(carga).getByRole('link', { name: /Ver na aba Carga/ }).className).toContain('app-btn')
    // Devolução vem antes de "No terminal", cada grupo com a sua faixa.
    const groups = within(carga).getAllByRole('columnheader').filter((cell) => cell.className.includes('app-table__group'))
    expect(groups.map((cell) => cell.textContent)).toEqual(['Contêiner', 'Devolução', 'No terminal'])
    expect(within(carga).getAllByRole('row')).toHaveLength(4)
    // Sem Manifesto Mercante e sem data de devolução: traço com significado.
    expect(screen.getByText('Sem vínculo com Manifesto Mercante')).toBeTruthy()
    expect(within(carga).getByText('Sem data de devolução')).toBeTruthy()
  })
})

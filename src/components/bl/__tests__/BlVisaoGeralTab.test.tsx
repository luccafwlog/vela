// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { BlVisaoGeralTab, type BaplieStatus } from '../BlVisaoGeralTab'

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

const containerSummary = { distinct: 0, imo: 0, oog: 0 }
const breakbulkSummary = { machines: 0, packages: 0, packagesTotal: 0, weightTon: 0, cbm: 0 }
const omittedVoyage = { id: 9, voyageId: 7, omittedPod: 'BRSSA', dischargePod: 'BRVIX', reason: null, onwardVesselName: null, onwardCarrier: null, onwardVoyageNumber: null, onwardEtd: null, onwardEta: null }

function renderTab(baplieStatus: BaplieStatus) {
  render(
    <MemoryRouter>
      <BlVisaoGeralTab
        active
        bl={baseBl}
        cockpit={undefined}
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
    expect(screen.getByText('3 divergência(s) Baplie')).toBeTruthy()
  })
})

describe('BlVisaoGeralTab — transbordo e COD', () => {
  it('mostra a ação Marcar COD quando existe omissão sem disposição persistida', () => {
    render(
      <MemoryRouter>
        <BlVisaoGeralTab
          active
          bl={baseBl}
          cockpit={{ omission: omittedVoyage, transshipment: null } as never}
          omission={omittedVoyage}
          cargoMode="container"
          containerSummary={containerSummary}
          breakbulkSummary={breakbulkSummary}
          onCod={vi.fn()}
          baplieStatus={{ state: 'not_imported', divergenceCount: 0 }}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Transbordo / COD')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Marcar COD/ })).toBeTruthy()
  })
})

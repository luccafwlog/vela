// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import type { PortalScheduleVoyage } from '../../../services/portalScheduleVoyages'
import { PORTAL_SCHEDULE_LANES } from '../../../services/portalScheduleLanes'

const refetch = vi.fn()
let hookState: { isLoading: boolean; isError?: boolean; data?: PortalScheduleVoyage[] } = { isLoading: false }

vi.mock('../../../hooks/usePortalScheduleVoyages', () => ({
  usePortalScheduleVoyages: () => ({ ...hookState, refetch, isFetching: false }),
}))

import { ShipScheduleWidget } from '../ShipScheduleWidget'
import { scheduleCellState } from '../shipScheduleCells'

const ALPHA: PortalScheduleVoyage = {
  voyageId: 1,
  vesselName: 'ALPHA',
  voyage: '001',
  imoNumber: '9876543',
  datesByLabel: { QINGDAO: '2026-01-04', SALVADOR: '2099-01-22', 'PECÉM': '2026-01-10' },
  actualDatesByLabel: { QINGDAO: '2026-01-04' },
  omittedByLabel: { 'VITÓRIA': true },
  earliestEta: '2099-01-22',
}

const lane = (label: string) => PORTAL_SCHEDULE_LANES.find((item) => item.label === label)!

afterEach(cleanup)

it('renderiza a programação projetada com data efetiva, previsão, OMIT e X distintos', () => {
  hookState = { isLoading: false, data: [ALPHA] }
  render(<ShipScheduleWidget />)

  const table = screen.getByRole('table')
  expect(within(table).getByRole('link', { name: /ALPHA/ }).getAttribute('href')).toBe(
    'https://www.marinetraffic.com/en/ais/details/ships/imo:9876543',
  )
  // ATD no POL: data efetiva, lida em texto e não só pela cor.
  expect(within(table).getByText(/04\/01\/2026/).textContent).toContain('saída registrada')
  expect(within(table).getByText(/22\/01\/2099/).textContent).toContain('previsão')
  expect(within(table).getByText(/10\/01\/2026/).textContent).toContain('previsão a confirmar')
  expect(within(table).getByText('OMIT')).toBeTruthy()
  expect(within(table).getAllByText('X').length).toBeGreaterThan(0)
  expect(within(table).getByRole('columnheader', { name: 'Pecém' })).toBeTruthy()
})

it('não confunde erro de consulta com programação vazia', async () => {
  hookState = { isLoading: false, isError: true }
  render(<ShipScheduleWidget />)

  expect(screen.getByRole('alert').textContent).toContain('Não foi possível carregar a programação de navios.')
  expect(screen.queryByText('Nenhum navio programado no momento.')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(refetch).toHaveBeenCalled()
})

it('classifica a célula pela origem da data', () => {
  const today = '2026-06-01'
  expect(scheduleCellState(ALPHA, lane('QINGDAO'), today).state).toBe('actual')
  expect(scheduleCellState(ALPHA, lane('SALVADOR'), today).state).toBe('forecast')
  expect(scheduleCellState(ALPHA, lane('PECÉM'), today).state).toBe('overdue')
  expect(scheduleCellState(ALPHA, lane('VITÓRIA'), today).state).toBe('omitted')
  expect(scheduleCellState(ALPHA, lane('NINGBO'), today).state).toBe('none')
})

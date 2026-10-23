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

import { ScheduleLegend, ScheduleTable, ShipScheduleWidget } from '../ShipScheduleWidget'
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

it('renderiza a programação projetada com data efetiva, previsão, omitida e sem data distintos', () => {
  hookState = { isLoading: false, data: [ALPHA] }
  render(<ShipScheduleWidget />)

  const table = screen.getByRole('table')
  // A posição do navio é o botão "Ver no mapa" (MarineTraffic pelo IMO cadastrado).
  expect(within(table).getByRole('link', { name: /Ver ALPHA no mapa/ }).getAttribute('href')).toBe(
    'https://www.marinetraffic.com/en/ais/details/ships/imo:9876543',
  )
  // ATD no POL: data efetiva, lida em texto e não só pela cor.
  expect(within(table).getByText(/04\/01\/2026/).textContent).toContain('saída registrada')
  expect(within(table).getByText(/22\/01\/2099/).textContent).toContain('previsão')
  // Revisão de 2026-10-22 (B3/B4): no Portal a previsão vencida é só previsão,
  // sem âmbar nem "a confirmar"; o cliente vê previsão ou data efetiva.
  const overdue = within(table).getByText(/10\/01\/2026/)
  expect(overdue.textContent).toContain('previsão')
  expect(overdue.textContent).not.toContain('a confirmar')
  expect(overdue.closest('.app-status-text--warning')).toBeNull()
  expect(screen.queryByText('âmbar')).toBeNull()
  expect(within(table).getByText('Omitida')).toBeTruthy()
  // Uma linha de título: Saída (ETD) antes da Chegada (ETA), na ordem em que acontecem.
  const headers = within(table).getAllByRole('columnheader').map((th) => th.textContent ?? '')
  expect(headers.findIndex((h) => h.endsWith('ETD'))).toBeLessThan(headers.findIndex((h) => h.endsWith('ETA')))
  expect(within(table).getByRole('columnheader', { name: 'Pecém ETA' })).toBeTruthy()
  // Porto sem data em nenhum navio sai da tabela, com nota (regra 4).
  expect(within(table).queryByRole('columnheader', { name: 'Ningbo ETD' })).toBeNull()
  expect(screen.getByText(/sem data em nenhum navio/)).toBeTruthy()

  // O cartão do celular segue a mesma ordem e também deixa o porto sem data de fora.
  const card = within(screen.getByRole('list', { name: 'Chegadas e saídas' })).getByRole('listitem')
  const text = card.textContent ?? ''
  expect(text.indexOf('Saída na origem (ETD)')).toBeLessThan(text.indexOf('Chegada no Brasil (ETA)'))
  expect(text).not.toMatch(/Ningbo/i)
})

it('não confunde erro de consulta com programação vazia', async () => {
  hookState = { isLoading: false, isError: true }
  render(<ShipScheduleWidget />)

  expect(screen.getByRole('alert').textContent).toContain('Não foi possível carregar chegadas e saídas.')
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

// Revisão de 2026-10-22 (B3): o âmbar fica no Vela, para o operador confirmar.
it('no Vela a previsão vencida fica em âmbar, com o motivo e a legenda', () => {
  render(<><ScheduleTable vessels={[ALPHA]} caption="Programação" audience="internal" /><ScheduleLegend audience="internal" /></>)
  const overdue = screen.getByText(/10\/01\/2026/)
  expect(overdue.textContent).toContain('previsão a confirmar')
  expect(overdue.closest('.app-status-text--warning')).toBeTruthy()
  expect(screen.getByText('âmbar')).toBeTruthy()
})

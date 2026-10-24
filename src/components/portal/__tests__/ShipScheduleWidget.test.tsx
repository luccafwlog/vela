// @vitest-environment jsdom

import { cleanup, render as rtlRender, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import type { PortalScheduleVoyage } from '../../../services/portalScheduleVoyages'
import type { PortalOperationBL } from '../../../services/portalOperation'
import { PORTAL_SCHEDULE_LANES } from '../../../services/portalScheduleLanes'

const refetch = vi.fn()
let hookState: { isLoading: boolean; isError?: boolean; data?: PortalScheduleVoyage[]; dataUpdatedAt?: number } = { isLoading: false }
let customerBls: PortalOperationBL[] = []
const refetchCustomerBls = vi.fn()

vi.mock('../../../hooks/usePortalScheduleVoyages', () => ({
  usePortalScheduleVoyages: () => ({ ...hookState, refetch, isFetching: false }),
}))

// A lista de B/Ls que o Portal já recebe do banco, só do Cliente da sessão.
vi.mock('../../../hooks/usePortalOperation', () => ({
  usePortalOperationBls: () => ({ data: customerBls, isLoading: false, refetch: refetchCustomerBls }),
}))

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function render(ui: ReactElement) {
  return rtlRender(
    <MemoryRouter initialEntries={['/portal']}>
      <Routes>
        <Route path="/portal" element={ui} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

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

const BETA: PortalScheduleVoyage = {
  voyageId: 2,
  vesselName: 'BETA STAR',
  voyage: '7/W',
  imoNumber: null,
  datesByLabel: { SALVADOR: '2099-02-10' },
  earliestEta: '2099-02-10',
}

function bl(id: string, voyageId: number | null, extra: Partial<PortalOperationBL> = {}): PortalOperationBL {
  return {
    bl_id: id, ce_mercante: null, pol: null, pod: null, voyage_id: voyageId, voyage_number: null, vessel_name: null,
    container_count: 0, containers_in_demurrage: 0, containers_returned: 0, containers: [], ...extra,
  }
}

const lane = (label: string) => PORTAL_SCHEDULE_LANES.find((item) => item.label === label)!

afterEach(() => {
  cleanup()
  customerBls = []
})

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

// Ponto 2 de 2026-10-23: atalho para os B/Ls do Cliente só no navio em que ele tem carga.
it('mostra "Ver meus B/Ls" só na viagem com carga do Cliente e leva à aba BLs filtrada', async () => {
  hookState = { isLoading: false, data: [ALPHA, BETA] }
  // B/L vivo na BETA; o da ALPHA foi cancelado e não conta.
  customerBls = [bl('BL-1', 2), bl('BL-2', 1, { cancelled_at: '2026-06-01T10:00:00Z' })]
  render(<ShipScheduleWidget />)

  const table = screen.getByRole('table')
  const rows = within(table).getAllByRole('row').slice(1)
  expect(within(rows[0]).queryByRole('link', { name: /Ver meus B\/Ls/ })).toBeNull()
  const link = within(rows[1]).getByRole('link', { name: 'Ver meus B/Ls no BETA STAR, viagem 7/W' })
  // O mapa continua ao lado (ALPHA tem IMO), no botão mais discreto (ghost).
  expect(within(rows[0]).getByRole('link', { name: /Ver ALPHA no mapa/ }).className).toContain('app-btn--ghost')

  await userEvent.click(link)
  const location = screen.getByTestId('location').textContent ?? ''
  const [path, query] = location.split('?')
  expect(path).toBe('/portal/operacao')
  const params = new URLSearchParams(query)
  expect(params.get('tab')).toBe('bls')
  expect(params.get('navio')).toBe('BETA STAR')
  expect(params.get('viagem')).toBe('7/W')
})

it('sem carga do Cliente em nenhum navio, não mostra o atalho; o cartão do celular também segue a regra', () => {
  hookState = { isLoading: false, data: [ALPHA, BETA] }
  customerBls = [bl('BL-9', 99)]
  render(<ShipScheduleWidget />)
  expect(screen.queryByRole('link', { name: /Ver meus B\/Ls/ })).toBeNull()

  customerBls = [bl('BL-1', 2)]
  cleanup()
  render(<ShipScheduleWidget />)
  const cards = within(screen.getByRole('list', { name: 'Chegadas e saídas' })).getAllByRole('listitem')
  expect(within(cards[1]).getByRole('link', { name: /Ver meus B\/Ls no BETA STAR/ }).textContent).toContain('Meus B/Ls')
  expect(within(cards[0]).queryByRole('link', { name: /Ver meus B\/Ls/ })).toBeNull()
})

// Ponto 3 de 2026-10-23: o cliente atualiza quando quiser e vê a hora da última leitura.
it('Atualizar relê as datas e a carga e mostra a hora de Brasília da última leitura', async () => {
  hookState = { isLoading: false, data: [ALPHA], dataUpdatedAt: Date.parse('2026-10-23T17:32:00Z') }
  refetch.mockReset()
  refetchCustomerBls.mockReset()
  refetch.mockImplementation(async () => {
    hookState = { ...hookState, dataUpdatedAt: Date.parse('2026-10-23T18:05:00Z') }
  })
  render(<ShipScheduleWidget />)

  expect(screen.getByRole('status').textContent).toBe('Atualizado em 23/10/2026 às 14:32 (horário de Brasília)')
  await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
  expect(refetch).toHaveBeenCalledTimes(1)
  expect(refetchCustomerBls).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('status').textContent).toBe('Atualizado em 23/10/2026 às 15:05 (horário de Brasília)')
})

it('Atualizar que falha mantém a última leitura na tela e avisa', () => {
  // React Query guarda os dados da leitura anterior quando a releitura falha.
  hookState = { isLoading: false, isError: true, data: [ALPHA], dataUpdatedAt: Date.parse('2026-10-23T17:32:00Z') }
  render(<ShipScheduleWidget />)

  expect(screen.getByRole('table')).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toBe('Não foi possível atualizar chegadas e saídas; a tabela abaixo é da última leitura.')
  expect(screen.queryByText('Não foi possível carregar chegadas e saídas.')).toBeNull()
  expect(screen.getByRole('status').textContent).toBe('Atualizado em 23/10/2026 às 14:32 (horário de Brasília)')
})

it('sem leitura concluída não inventa horário de atualização', () => {
  hookState = { isLoading: true }
  render(<ShipScheduleWidget />)
  expect(screen.queryByText(/Atualizado em/)).toBeNull()
  expect((screen.getByRole('button', { name: 'Atualizar' }) as HTMLButtonElement).disabled).toBe(true)
})

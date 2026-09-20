// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }), useQuery: () => ({ data: null, isLoading: false, error: null }) }))
vi.mock('../../hooks/useBls', () => ({
  useVoyages: () => ({
    data: [
      {
        id: 41,
        voyage_number: 'ACTIVE-41',
        status: 'active',
        vessel: { name: 'Navio ativo', carrier: null },
        pol: null,
        pod: null,
        bls: [],
      },
      {
        id: 42,
        voyage_number: 'CANCEL-42',
        status: 'cancelled',
        vessel: { name: 'Navio cancelado', carrier: null },
        pol: null,
        pod: null,
        bls: [],
      },
    ],
    isLoading: false,
    error: null,
  }),
  useVoyageDetail: (id: number | null) => ({
    data: id === 41 || id === 42 ? {
      id,
      voyage_number: id === 41 ? 'ACTIVE-41' : 'CANCEL-42',
      status: id === 41 ? 'active' : 'cancelled',
      vessel: { name: id === 41 ? 'Navio ativo' : 'Navio cancelado', carrier: null },
      pol: null,
      pod: null,
      bls: [],
      import_batches: [],
      granite_manifests: [],
      vazios_manifests: [],
    } : null,
    isLoading: false,
    error: null,
  }),
}))
vi.mock('../../hooks/useVehicles', () => ({ useVoyageVehicleStats: () => ({ data: { byVoyageId: {} } }) }))
vi.mock('../../hooks/useVaziosImportacaoStats', () => ({ useVaziosImportacaoStats: () => ({ data: { byVoyageId: {} } }) }))
vi.mock('../../hooks/useViagemSchedulesAndStats', () => ({
  useViagemSchedulesAndStats: () => ({
    voyagesWithUnpaidBls: [],
    polSchedules: new Map(),
    podSchedules: new Map(),
    podSchedulesByVoyage: new Map(),
    escalaSchedulesByVoyage: new Map([
      [41, [{
        voyageId: 41,
        port: 'BRVIX',
        eta: null,
        atracacoes: [],
        etb: null,
        ata: null,
        atb: null,
        etd: null,
        atd: null,
        rtw: null,
        ceStatus: 'waiting',
        podCeStatus: 'waiting',
        exportCeStatus: 'waiting',
        linked: false,
        escalaNumber: null,
        omitted: false,
        deleted: false,
        temImportacao: false,
        temExportacao: true,
        temGranito: true,
        temVazios: true,
        containersQty: null,
        movementsQty: null,
        dischargePorts: [],
        divergences: [],
      }]],
    ]),
    exportSchedulesData: new Map([
      [41, new Map([['BRVIX', {
        id: 'export-41',
        voyageId: 41,
        pol: 'BRVIX',
        temExportacao: true,
        hasGranite: true,
        hasEmpty: true,
        containersQty: null,
        movementsQty: null,
        ceStatus: 'waiting',
        linked: false,
        dischargePorts: [],
      }]])],
    ]),
  }),
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false, user: null, can: () => false }) }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../services/supabase', () => ({ supabase: { from: vi.fn() } }))

import { Viagens } from '../Viagens'
import { ConfirmDialogProvider } from '../../components/ui/ConfirmDialog'

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <ConfirmDialogProvider>
        <Routes>
          <Route path="/viagens" element={<Viagens />} />
          <Route path="/viagens/:voyageId" element={<Viagens />} />
        </Routes>
      </ConfirmDialogProvider>
    </MemoryRouter>,
  )
}

afterEach(cleanup)

it('filtra o rail por viagens canceladas', () => {
  renderAt('/viagens')

  fireEvent.click(screen.getByRole('button', { name: /Filtros/ }))
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'cancelled' } })

  expect(screen.getByText('Navio cancelado / CANCEL-42')).toBeTruthy()
  expect(screen.queryByText('Navio ativo / ACTIVE-41')).toBeNull()
})

it('mantém a busca visível e permite remover um filtro aplicado pelo chip', () => {
  renderAt('/viagens')

  expect(screen.getByLabelText('Busca')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Filtros/ }))
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'cancelled' } })

  expect(screen.getByLabelText('Filtros aplicados').textContent).toContain('Status: Canceladas')
  fireEvent.click(screen.getByRole('button', { name: 'Remover filtro Status' }))

  expect(screen.queryByLabelText('Filtros aplicados')).toBeNull()
  expect(screen.getByText('Navio ativo / ACTIVE-41')).toBeTruthy()
})

it('não exibe badge no botão Filtros quando apenas busca textual está ativa', () => {
  renderAt('/viagens')

  fireEvent.change(screen.getByLabelText('Busca'), { target: { value: 'ACTIVE' } })
  const filtrosBtn = screen.getByRole('button', { name: /^Filtros/ })
  expect(filtrosBtn.textContent).toBe('Filtros')
  expect(screen.getByRole('button', { name: 'Limpar' })).toBeTruthy()
})

it('US-213: sem selecao mostra "Selecione uma viagem"', () => {
  renderAt('/viagens')
  expect(screen.getByText('Selecione uma viagem')).toBeTruthy()
})

it('declara granito e vazios no rail mesmo sem quantidades operadas', () => {
  renderAt('/viagens')

  expect(screen.getByLabelText('Vazios EXP')).toBeTruthy()
  expect(screen.getByLabelText('Granito')).toBeTruthy()
})

it('seleciona a viagem pelo id do item do rail', () => {
  renderAt('/viagens')

  fireEvent.click(screen.getByText('Navio cancelado / CANCEL-42'))

  expect(screen.getByRole('heading', { name: 'Navio cancelado / CANCEL-42' })).toBeTruthy()
})

it('mostra breadcrumb no deep-link da viagem', () => {
  renderAt('/viagens/41')
  const breadcrumb = screen.getByRole('navigation', { name: 'Navegação estrutural' })
  expect(breadcrumb.textContent).toContain('Viagens')
  expect(breadcrumb.textContent).toContain('Navio ativo / ACTIVE-41')
})

it('US-213: ID inexistente mantem a tela e mostra "Viagem não encontrada"', () => {
  renderAt('/viagens/999')
  expect(screen.getByText('Viagem não encontrada')).toBeTruthy()
})

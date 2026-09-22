// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  importManifest: vi.fn(),
  loadMaps: vi.fn(() => Promise.resolve({})),
  findMatch: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) =>
    queryKey[0] === 'granite-bls'
      ? { data: { rows: [], count: 0 }, isLoading: false, error: null }
      : { data: undefined },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../hooks/useBls', () => ({
  useVoyageOptions: () => ({ data: [{ id: 7, voyage_number: '14N', vessel: { name: 'GREEN' } }] }),
}))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../services/graniteImport', () => ({ parseGraniteManifestFile: mocks.parse, importGraniteManifest: mocks.importManifest }))
vi.mock('../../services/graniteCharges', () => ({ listGraniteBls: vi.fn(), calculateGraniteBlCharges: vi.fn() }))
vi.mock('../../services/customerReconciliation', () => ({
  loadCustomerMaps: mocks.loadMaps,
  findMatchedCustomer: mocks.findMatch,
  resolveCustomerLink: (match: { customer?: { id: number }; matchType?: string } | null) => match?.matchType === 'document'
    ? { customerId: match.customer?.id ?? null, suggestedCustomerId: null, status: 'matched_document', notes: '' }
    : match?.matchType === 'name'
      ? { customerId: null, suggestedCustomerId: match.customer?.id ?? null, status: 'matched_name', notes: '' }
      : { customerId: null, suggestedCustomerId: null, status: 'missing_customer', notes: '' },
}))

import { Granite } from '../Granite'

function bl(overrides: Record<string, unknown> = {}) {
  return {
    rowNumber: 2,
    bl_number: 'BL-G1',
    shipper_name: 'Granito SA',
    shipper_cnpj: null,
    real_weight_kg: 5000,
    final_m3: null,
    phase: null,
    clientId: null,
    suggestedClientId: null,
    reconciliationStatus: 'missing_cnpj',
    ...overrides,
  }
}

function renderGranite() {
  render(
    <MemoryRouter>
      <Granite />
    </MemoryRouter>,
  )
}

function getDestinationVoyageInput() {
  const inputs = screen.getAllByPlaceholderText('Busque por navio ou viagem')
  return inputs[inputs.length - 1]! as HTMLInputElement
}

async function selectVoyage(user: ReturnType<typeof userEvent.setup>) {
  const input = getDestinationVoyageInput()
  await user.type(input, 'GREEN')
  await waitFor(() => expect(screen.getByText('GREEN / 14N')).toBeTruthy())
  await user.click(screen.getByText('GREEN / 14N'))
  await waitFor(() => expect(getDestinationVoyageInput().value).toBe('GREEN / 14N'))
  return getDestinationVoyageInput()
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

it('US-075: abre o modal de importacao e oferece a selecao de viagem', async () => {
  const user = userEvent.setup()
  renderGranite()

  await user.click(screen.getByRole('button', { name: /Importar Planilha COSCO/ }))

  expect(screen.getByText('Viagem de destino')).toBeTruthy()
  const input = await selectVoyage(user)
  expect(input.value).toBe('GREEN / 14N')
})

it('US-079: o preview alerta sobre B/Ls pendentes sem cliente resolvido', async () => {
  const user = userEvent.setup()
  mocks.parse.mockResolvedValue({ vesselVoyage: 'NAVIO/14', bls: [bl()], rowErrors: [] })
  renderGranite()

  await user.click(screen.getByRole('button', { name: /Importar Planilha COSCO/ }))
  await selectVoyage(user)
  await user.upload(screen.getByLabelText(/Arquivo/), new File(['x'], 'cosco.xlsx'))

  await waitFor(() => expect(screen.getByText(/sem cliente resolvido/)).toBeTruthy())
})

it('US-079: importar com pendencias chama importGraniteManifest e reporta a pendencia no toast', async () => {
  const user = userEvent.setup()
  mocks.parse.mockResolvedValue({ vesselVoyage: 'NAVIO/14', bls: [bl(), bl({ bl_number: 'BL-G2' })], rowErrors: [] })
  // Sem match: os dois B/Ls seguem pendentes ao confirmar.
  mocks.findMatch.mockReturnValue(null)
  mocks.importManifest.mockResolvedValue({ manifestId: 'm1', pendingCount: 2 })
  renderGranite()

  await user.click(screen.getByRole('button', { name: /Importar Planilha COSCO/ }))
  await selectVoyage(user)
  await user.upload(screen.getByLabelText(/Arquivo/), new File(['x'], 'cosco.xlsx'))
  await waitFor(() => expect(screen.getByText(/sem cliente resolvido/)).toBeTruthy())

  await user.click(screen.getByRole('button', { name: /Confirmar importação/ }))

  await waitFor(() => expect(mocks.importManifest).toHaveBeenCalledTimes(1))
  expect(mocks.importManifest).toHaveBeenCalledWith(
    expect.objectContaining({ voyageId: 7, uploadedBy: 'u1', filename: 'cosco.xlsx' }),
  )
  // A pendência de cliente é operacional; Granito não promete faturamento.
  expect(mocks.showToast).toHaveBeenCalledWith(
    expect.stringContaining('2 com reconciliação pendente'),
    'success',
  )
})

it('bloqueia confirmacao quando o preview possui erro de parser', async () => {
  const user = userEvent.setup()
  mocks.parse.mockResolvedValue({
    vesselVoyage: 'NAVIO/14',
    bls: [bl()],
    rowErrors: [{ row: 2, message: 'Data invalida', raw: {} }],
  })
  renderGranite()

  await user.click(screen.getByRole('button', { name: /Importar Planilha COSCO/ }))
  await selectVoyage(user)
  await user.upload(screen.getByLabelText(/Arquivo/), new File(['x'], 'cosco.xlsx'))

  await waitFor(() => expect(screen.getByText(/Data invalida/)).toBeTruthy())
  expect((screen.getByRole('button', { name: 'Confirmar importação' }) as HTMLButtonElement).disabled).toBe(true)
})

it('US-078: resolver o CNPJ no preview reconcilia o B/L pendente', async () => {
  const user = userEvent.setup()
  mocks.parse.mockResolvedValue({ vesselVoyage: 'NAVIO/14', bls: [bl()], rowErrors: [] })
  mocks.findMatch.mockReturnValue({ customer: { id: 99, name: 'Granito SA' }, matchType: 'document' })
  renderGranite()

  await user.click(screen.getByRole('button', { name: /Importar Planilha COSCO/ }))
  await selectVoyage(user)
  await user.upload(screen.getByLabelText(/Arquivo/), new File(['x'], 'cosco.xlsx'))
  await waitFor(() => expect(screen.getByText(/sem cliente resolvido/)).toBeTruthy())

  const cnpjInput = screen.getByPlaceholderText('Digite o CNPJ') as HTMLInputElement
  expect(cnpjInput.maxLength).toBe(18)
  await user.type(cnpjInput, '11222333000181')

  // ao reconciliar, o alerta de pendencia desaparece
  await waitFor(() => expect(screen.queryByText(/sem cliente resolvido/)).toBeNull())
  expect(mocks.findMatch).toHaveBeenCalled()
})

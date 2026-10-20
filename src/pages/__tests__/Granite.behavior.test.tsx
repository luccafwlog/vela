// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  importManifest: vi.fn(),
  showToast: vi.fn(),
  invalidate: vi.fn().mockResolvedValue(undefined),
  listRows: [] as unknown[],
  cargoRows: [] as unknown[],
  cargoError: null as Error | null,
}))

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: (data: unknown) => data,
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    if (queryKey[0] === 'granite-bls' && queryKey[1] === 'list') {
      return { data: { rows: mocks.listRows, count: mocks.listRows.length }, isLoading: false, error: null, isPlaceholderData: false, fetchStatus: 'idle' }
    }
    if (queryKey[0] === 'granite-bls' && queryKey[1] === 'cargo') {
      if (mocks.cargoError) return { data: undefined, isLoading: false, error: mocks.cargoError, isPlaceholderData: false, fetchStatus: 'idle', refetch: vi.fn() }
      return { data: mocks.cargoRows, isLoading: false, error: null, isPlaceholderData: false, fetchStatus: 'idle' }
    }
    return { data: undefined }
  },
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../hooks/useBls', () => ({
  useVoyageOptions: () => ({ data: [{ id: 7, voyage_number: '14N', vessel: { name: 'GREEN' } }] }),
}))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../services/graniteImport', () => ({
  parseGraniteManifestFile: mocks.parse,
  importGraniteManifest: mocks.importManifest,
  graniteRemovalConfirmOptions: (missing: string[]) => ({ message: missing.join(',') }),
  describeGraniteImport: (result: { inserted: number; updated: number }) => `${result.inserted} novo(s), ${result.updated} atualizado(s)`,
}))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }))

import { Granite } from '../Granite'

const voyage = { voyage_id: 7, voyage: { id: 7, voyage_number: '14N', vessel: { name: 'GREEN' } } }

function savedBl(overrides: Record<string, unknown> = {}) {
  return {
    id: 'g1',
    bl_number: 'COSU1',
    shipper_name: 'Granitos Serra Azul Ltda',
    vessel_voyage: 'GREEN/14N',
    loading_port: 'BRVIX',
    discharge_port: 'CNXMN',
    blocks_qty: 5,
    real_weight_kg: 80100,
    shipper_weight_kg: 79000,
    manifest: voyage,
    ...overrides,
  }
}

function parsedBl(overrides: Record<string, unknown> = {}) {
  return {
    rowNumber: 2,
    bl_number: 'BL-G1',
    shipper_name: 'Granito SA',
    shipper_cnpj: '11222333000181',
    loading_port: 'BRVIX',
    discharge_port: 'CNXMN',
    blocks_qty: 3,
    real_weight_kg: 5000,
    shipper_weight_kg: null,
    final_m3: null,
    phase: null,
    ...overrides,
  }
}

function renderGranite(path = '/granito') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Granite />
    </MemoryRouter>,
  )
}

function getDestinationVoyageInput() {
  const inputs = screen.getAllByPlaceholderText('Busque por navio ou viagem')
  return inputs[inputs.length - 1]! as HTMLInputElement
}

async function openImportWithVoyage(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Importar planilha COSCO' }))
  const input = getDestinationVoyageInput()
  await user.type(input, 'GREEN')
  await waitFor(() => expect(screen.getByText('GREEN / 14N')).toBeTruthy())
  await user.click(screen.getByText('GREEN / 14N'))
  await waitFor(() => expect(getDestinationVoyageInput().value).toBe('GREEN / 14N'))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listRows = []
  mocks.cargoRows = []
  mocks.cargoError = null
})
afterEach(cleanup)

it('com erro na leitura da carga, os cartões dizem "Sem dado", não "Carregando"', () => {
  mocks.cargoError = new Error('falha de rede')
  renderGranite()

  const totals = screen.getByRole('group', { name: 'Totais do recorte' })
  expect(within(totals).getAllByText('Sem dado')).toHaveLength(3)
  expect(within(totals).queryByText('Carregando')).toBeNull()
})

it('mostra só a carga: totais do recorte, carga por viagem e B/Ls com o peso real', () => {
  const rows = [
    savedBl(),
    savedBl({ id: 'g2', bl_number: 'COSU2', shipper_name: 'Comercial Pacífico S.A.', blocks_qty: 7, real_weight_kg: null, shipper_weight_kg: 111900 }),
  ]
  mocks.listRows = rows
  mocks.cargoRows = rows
  renderGranite()

  expect(screen.getByRole('heading', { name: 'Granito', level: 1 })).toBeTruthy()
  // Só a importação COSCO no topo: saem Tarifas, CE Mercante e cálculo.
  expect(screen.queryByText(/Tarifas|Tabela de Taxas/)).toBeNull()
  expect(screen.queryByRole('button', { name: /CE Mercante|Calcular/ })).toBeNull()

  const totals = screen.getByRole('group', { name: 'Totais do recorte' })
  expect(within(totals).getByText('2')).toBeTruthy()
  expect(within(totals).getByText('12')).toBeTruthy()
  // Só o peso real conta: o declarado pelo shipper (111,9 t) não entra.
  expect(within(totals).getByText('80,1 t')).toBeTruthy()

  const byVoyage = screen.getByRole('table', { name: 'Carga de Granito por navio e viagem' })
  const voyageLink = within(byVoyage).getByRole('link', { name: 'GREEN / 14N' })
  expect(voyageLink.getAttribute('href')).toBe('/viagens/7')
  expect(within(byVoyage).getByText('BRVIX → CNXMN')).toBeTruthy()

  const list = screen.getByRole('table', { name: 'B/Ls de Granito do recorte atual' })
  // Sem peso real, o B/L fica "Sem peso", mesmo com o declarado; o B/L não abre ficha.
  expect(within(list).getByText('80,1 t')).toBeTruthy()
  expect(within(list).getByText('Sem peso')).toBeTruthy()
  expect(screen.queryByText('111,9 t')).toBeNull()
  expect(within(list).queryByRole('link')).toBeNull()
  expect(within(list).getByText('Comercial Pacífico S.A.')).toBeTruthy()
  expect(screen.getByText('Peso: o peso real da planilha COSCO.')).toBeTruthy()
})

it('o POD é uma lista de portos do recorte, e o filtro ativo mostra o navio, não o número interno', () => {
  mocks.cargoRows = [savedBl(), savedBl({ id: 'g2', discharge_port: 'ITMDX' })]
  // Chegada pela Viagem (?voyage=7) sem B/L na página: o vazio diz o filtro pelo nome.
  renderGranite('/granito?voyage=7')

  const pod = screen.getByLabelText('POD') as HTMLSelectElement
  expect(Array.from(pod.options).map((option) => option.textContent)).toEqual(['Todos', 'CNXMN', 'ITMDX'])
  expect(screen.getByText('Filtros ativos: Viagem GREEN / 14N.')).toBeTruthy()
  expect(screen.queryByText(/Viagem 7\b/)).toBeNull()
})

it('a prévia conta B/Ls, blocos e peso, sem conferência de Cliente ou CNPJ', async () => {
  const user = userEvent.setup()
  mocks.parse.mockResolvedValue({
    vesselVoyage: 'NAVIO/14',
    bls: [parsedBl(), parsedBl({ bl_number: 'BL-G2', blocks_qty: 4, real_weight_kg: 0, shipper_weight_kg: 7000 })],
    rowErrors: [],
    fileBlNumbers: ['BL-G1', 'BL-G2'],
  })
  renderGranite()

  await openImportWithVoyage(user)
  expect(screen.getByText(/Colunas obrigatórias/)).toBeTruthy()
  await user.upload(screen.getByLabelText(/^Arquivo \(/), new File(['x'], 'cosco.xlsx'))

  await waitFor(() => expect(screen.getByRole('table', { name: 'Prévia do manifesto Granito' })).toBeTruthy())
  // Só o peso real: o total e a linha do BL-G1 dão 5,0 t; o BL-G2, com peso
  // real zero, fica "Sem peso" e o declarado (7,0 t) não entra.
  expect(screen.getAllByText('5,0 t')).toHaveLength(2)
  expect(screen.getByText('Sem peso')).toBeTruthy()
  expect(screen.queryByText(/12,0 t|7,0 t/)).toBeNull()
  expect(screen.getByText('7')).toBeTruthy()
  expect(screen.queryByPlaceholderText('Digite o CNPJ')).toBeNull()
  expect(screen.queryByText(/✓ OK|Sugestão|⚠ CNPJ|Não cad\./)).toBeNull()
})

it('confirmar importa na Viagem escolhida, atualiza as telas e avisa o resultado', async () => {
  const user = userEvent.setup()
  mocks.parse.mockResolvedValue({ vesselVoyage: 'NAVIO/14', bls: [parsedBl()], rowErrors: [], fileBlNumbers: ['BL-G1'] })
  mocks.importManifest.mockResolvedValue({ manifestId: 'm1', inserted: 1, updated: 0, removed: [], keptMissing: [], keptInvoiced: [] })
  renderGranite()

  await openImportWithVoyage(user)
  await user.upload(screen.getByLabelText(/^Arquivo \(/), new File(['x'], 'cosco.xlsx'))
  await waitFor(() => expect(screen.getByRole('table', { name: 'Prévia do manifesto Granito' })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: 'Importar 1 B/L' }))

  await waitFor(() => expect(mocks.importManifest).toHaveBeenCalledTimes(1))
  expect(mocks.importManifest).toHaveBeenCalledWith(expect.objectContaining({ voyageId: 7, uploadedBy: 'u1', filename: 'cosco.xlsx' }))
  for (const queryKey of [['granite-bls'], ['agency-report'], ['voyage-export-schedules'], ['lineup-tv-v3']]) {
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey })
  }
  expect(mocks.showToast).toHaveBeenCalledWith('Granito importado: 1 novo(s), 0 atualizado(s).', 'success')
})

it('a recusa do banco chega em português, sem o texto cru', async () => {
  const user = userEvent.setup()
  mocks.parse.mockResolvedValue({ vesselVoyage: 'NAVIO/14', bls: [parsedBl()], rowErrors: [], fileBlNumbers: ['BL-G1'] })
  mocks.importManifest.mockRejectedValue({ code: 'XX000', message: 'B/L Granito 0d1c-uuid nao encontrado' })
  renderGranite()

  await openImportWithVoyage(user)
  await user.upload(screen.getByLabelText(/^Arquivo \(/), new File(['x'], 'cosco.xlsx'))
  await waitFor(() => expect(screen.getByRole('table', { name: 'Prévia do manifesto Granito' })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: 'Importar 1 B/L' }))

  // A recusa fica no modal, com a prévia, para corrigir e confirmar de novo.
  await waitFor(() => expect(screen.getByText('Não foi possível importar a planilha do Granito. Tente novamente.')).toBeTruthy())
  expect(screen.queryByText(/0d1c-uuid/)).toBeNull()
})

it('bloqueia a confirmação quando a leitura tem erro', async () => {
  const user = userEvent.setup()
  mocks.parse.mockResolvedValue({
    vesselVoyage: 'NAVIO/14',
    bls: [parsedBl()],
    rowErrors: [{ row: 2, message: 'Data inválida', raw: {} }],
    fileBlNumbers: ['BL-G1'],
  })
  renderGranite()

  await openImportWithVoyage(user)
  await user.upload(screen.getByLabelText(/^Arquivo \(/), new File(['x'], 'cosco.xlsx'))

  await waitFor(() => expect(screen.getByText(/Data inválida/)).toBeTruthy())
  expect((screen.getByRole('button', { name: 'Importar 1 B/L' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText(/Com erro no arquivo, nada é importado/)).toBeTruthy()
})

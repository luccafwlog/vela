// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(() => Promise.resolve()),
  showToast: vi.fn(),
  parseBreakbulkManifestFile: vi.fn(),
  importBreakbulkManifest: vi.fn(() => Promise.resolve()),
  parseBaplieFile: vi.fn(),
  importBaplieStaging: vi.fn(() => Promise.resolve({ staged: 1 })),
  countBaplieStaging: vi.fn(() => Promise.resolve(0)),
  confirm: vi.fn(() => Promise.resolve(true)),
  can: vi.fn<(permission: string) => boolean>(() => true),
  effectiveRole: vi.fn(() => 'documentacao'),
  profile: { id: 'user-1' },
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))
vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ can: mocks.can, effectiveRole: mocks.effectiveRole(), profile: mocks.profile }),
}))
vi.mock('../../../services/supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('../../../services/breakbulkImport', () => ({
  parseBreakbulkManifestFile: mocks.parseBreakbulkManifestFile,
  importBreakbulkManifest: mocks.importBreakbulkManifest,
  hasBlockingRowErrors: (rowErrors: Array<{ severity?: 'error' | 'warning' }>) =>
    rowErrors.some((e) => (e.severity ?? 'error') === 'error'),
}))
vi.mock('../../../services/baplieParser', () => ({
  parseBaplieFile: mocks.parseBaplieFile,
}))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../../services/baplieImport', () => ({
  importBaplieStaging: mocks.importBaplieStaging,
  countBaplieStaging: mocks.countBaplieStaging,
  baplieReplacementMessage: (existing: number, incoming: number) => `${existing}->${incoming}`,
}))
vi.mock('../CeMercanteImportModal', () => ({
  CeMercanteImportModal: ({ lockedVoyageId, target }: { lockedVoyageId?: number; target?: string }) => <div>CE travado: {lockedVoyageId} · {target ?? 'bls'}</div>,
}))

import { VoyageImportActions } from '../VoyageImportActions'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.can.mockReturnValue(true)
  mocks.effectiveRole.mockReturnValue('documentacao')
  mocks.invalidateQueries.mockResolvedValue(undefined)
  mocks.importBreakbulkManifest.mockResolvedValue(undefined)
  mocks.parseBaplieFile.mockReset()
  mocks.importBaplieStaging.mockReset()
  mocks.importBaplieStaging.mockResolvedValue({ staged: 1 })
  mocks.countBaplieStaging.mockResolvedValue(0)
  mocks.confirm.mockReset()
  mocks.confirm.mockResolvedValue(true)
  mocks.navigate.mockReset()
})
afterEach(cleanup)

function renderActions() {
  return render(
    <VoyageImportActions
      voyageId={7}
      voyageLabel="GREEN SANTOS / 14N"
      userId="user-1"
      types={['bb', 'granite', 'baplie']}
    />,
  )
}

it('US-223: renderiza as acoes de importacao rapida escopadas na viagem', () => {
  renderActions()

  expect(screen.queryByRole('button', { name: /Manifesto CNTR/ })).toBeNull()
  expect(screen.getByRole('button', { name: /Manifesto BB/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Manifesto Granito/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Baplie EDI/ })).toBeTruthy()
})

it('US-223: clicar numa acao abre o importador escopado na viagem', () => {
  renderActions()

  // Nenhum modal aberto antes do clique.
  expect(screen.queryByText('Importar Manifesto BB (Break Bulk)')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: /Manifesto BB/ }))

  // O modal abre exibindo o rótulo da viagem — prova de escopo.
  expect(screen.getByText('Importar Manifesto BB (Break Bulk)')).toBeTruthy()
  expect(screen.getByText('GREEN SANTOS / 14N')).toBeTruthy()
})

it('US-223: confirmar a importacao conecta o importador ao voyageId travado', async () => {
  mocks.parseBreakbulkManifestFile.mockResolvedValue({
    bls: [{ id: 'BL-1' }],
    rowErrors: [],
  })

  const { container } = render(
    <VoyageImportActions
      voyageId={7}
      voyageLabel="GREEN SANTOS / 14N"
      userId="user-1"
      types={['bb']}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: /Manifesto BB/ }))

  const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(['BL;Cidade\nBL-1;Vitória'], 'manifesto-bb.csv', { type: 'text/csv' })
  fireEvent.change(fileInput, { target: { files: [file] } })

  // Aguarda o parser rodar e o botao Confirmar habilitar (prévia válida).
  await waitFor(() => expect(mocks.parseBreakbulkManifestFile).toHaveBeenCalledWith(file))
  const confirm = screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement
  await waitFor(() => expect(confirm.disabled).toBe(false))

  fireEvent.click(confirm)

  await waitFor(() => {
    expect(mocks.importBreakbulkManifest).toHaveBeenCalledTimes(1)
  })
  expect(mocks.importBreakbulkManifest).toHaveBeenCalledWith(
    expect.objectContaining({ voyageId: 7, filename: 'manifesto-bb.csv', uploadedBy: 'user-1' }),
  )
})

it('bloqueia manifesto BB quando a previa contem erro de linha', async () => {
  mocks.parseBreakbulkManifestFile.mockResolvedValue({
    bls: [{ id: 'BL-1' }],
    rowErrors: [{ row: 2, message: 'Peso invalido', raw: {} }],
  })

  const { container } = render(
    <VoyageImportActions voyageId={7} voyageLabel="GREEN SANTOS / 14N" userId="user-1" types={['bb']} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Manifesto BB/ }))
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['BL;CE\nBL-1;CE-1'], 'manifesto-bb.csv')] },
  })

  await waitFor(() => expect(mocks.parseBreakbulkManifestFile).toHaveBeenCalledTimes(1))
  expect((screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement).disabled).toBe(true)
  expect(mocks.importBreakbulkManifest).not.toHaveBeenCalled()
})

it('bloqueia staging quando a prévia do Baplie contém issue bloqueante', async () => {
  mocks.parseBaplieFile.mockResolvedValue({
    vessel_name: 'GREEN SANTOS',
    voyage_number: '14N',
    containers: [{
      container_number: 'TCLU1234567',
      size_type: '45G1',
      status: 'full',
      weight_kg: null,
      pol: null,
      pod: null,
      final_dest: null,
      bl_ref: null,
      slot: '010101',
      is_imo: false,
      imo_class: null,
      un_number: null,
      is_oog: false,
    }],
    pods: [],
    issues: [{
      row: 1,
      field: 'weight_kg',
      code: 'invalid_number',
      severity: 'error',
      message: 'Peso inválido no conjunto 1.',
    }],
    encoding: 'utf-8',
  })

  const { container } = renderActions()
  fireEvent.click(screen.getByRole('button', { name: /Baplie/ }))
  const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(fileInput, { target: { files: [new File(['edi'], 'manifesto.edi', { type: 'text/plain' })] } })

  await waitFor(() => expect(mocks.parseBaplieFile).toHaveBeenCalledTimes(1))
  const confirm = screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement
  expect(screen.getByText(/Peso inválido no conjunto 1/)).toBeTruthy()
  expect(confirm.disabled).toBe(true)

  fireEvent.click(confirm)
  expect(mocks.importBaplieStaging).not.toHaveBeenCalled()
})

it('ordena as importacoes e abre CE Mercante travado na viagem', () => {
  render(
    <VoyageImportActions
      voyageId={7}
      voyageLabel="GREEN SANTOS / 14N"
      userId="user-1"
      types={['vaziosImp', 'vehicles', 'bb', 'ceMercante', 'blFreight', 'blBreakbulk', 'baplie']}
    />,
  )

  expect(screen.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
    'Baplie EDI', 'B/L container', 'B/L carga solta', 'CE Mercante', 'Manifesto BB', 'Veículos', 'Vazios IMP',
  ])
  fireEvent.click(screen.getByRole('button', { name: /CE Mercante/ }))
  expect(screen.getByText('CE travado: 7 · bls')).toBeTruthy()
})

it('separa a barra por família sem criar separador dentro dos B/Ls', () => {
  const { container } = render(
    <VoyageImportActions
      voyageId={7}
      voyageLabel="GREEN SANTOS / 14N"
      userId="user-1"
      types={['baplie', 'blFreight', 'blBreakbulk', 'ceMercante', 'vehicles', 'vaziosImp']}
    />,
  )

  expect(container.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(2)
})

it('leva Vazios Exp ao Embarque com a viagem travada', () => {
  render(
    <VoyageImportActions
      voyageId={7}
      voyageLabel="GREEN SANTOS / 14N"
      userId="user-1"
      types={['vaziosExp']}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Novo embarque de vazios' }))
  expect(mocks.navigate).toHaveBeenCalledWith('/embarquevazios?voyage=7')
})

it('abre CE Mercante do Granito com o alvo correto e a viagem travada', () => {
  render(
    <VoyageImportActions
      voyageId={7}
      voyageLabel="GREEN SANTOS / 14N"
      userId="user-1"
      types={['ceMercanteGranite']}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'CE Mercante (Granito)' }))
  expect(screen.getByText('CE travado: 7 · granite')).toBeTruthy()
})

it('mantém a escrita aberta também para Equipamentos', () => {
  mocks.effectiveRole.mockReturnValue('equipamentos')

  render(
    <VoyageImportActions
      voyageId={7}
      voyageLabel="GREEN SANTOS / 14N"
      userId="user-1"
      types={['bb', 'granite', 'vaziosImp', 'vaziosExp', 'vehicles', 'baplie', 'blFreight', 'blBreakbulk', 'ceMercante']}
    />,
  )

  expect(screen.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
    'Baplie EDI', 'B/L container', 'B/L carga solta', 'CE Mercante', 'Manifesto BB', 'Veículos', 'Vazios IMP', 'Manifesto Granito', 'Novo embarque de vazios',
  ])
})

it('preserva todas as importacoes solicitadas para os demais papeis', () => {
  mocks.effectiveRole.mockReturnValue('documentacao')
  mocks.can.mockReturnValue(true)

  render(
    <VoyageImportActions
      voyageId={7}
      voyageLabel="GREEN SANTOS / 14N"
      userId="user-1"
      types={['bb', 'granite', 'vaziosImp', 'vaziosExp', 'vehicles', 'baplie', 'blFreight', 'blBreakbulk', 'ceMercante']}
    />,
  )

  expect(screen.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
    'Baplie EDI', 'B/L container', 'B/L carga solta', 'CE Mercante', 'Manifesto BB', 'Veículos', 'Vazios IMP', 'Manifesto Granito', 'Novo embarque de vazios',
  ])
})

it('manifesto BB permite importar sem override quando a prévia contém apenas avisos (severity: warning)', async () => {
  mocks.effectiveRole.mockReturnValue('documentacao')
  mocks.can.mockReturnValue(true)
  mocks.parseBreakbulkManifestFile.mockResolvedValue({
    bls: [{ id: 'BL-WARN' }],
    rowErrors: [{ row: 1, message: 'Cubagem ausente', raw: {}, severity: 'warning' }],
  })

  const { container } = render(
    <VoyageImportActions voyageId={7} voyageLabel="GREEN SANTOS / 14N" userId="user-1" types={['bb']} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Manifesto BB/ }))
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['BL;CE\nBL-WARN;CE-1'], 'manifesto-bb.csv')] },
  })

  await waitFor(() => expect(mocks.parseBreakbulkManifestFile).toHaveBeenCalled())
  const confirm = screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement
  await waitFor(() => expect(confirm.disabled).toBe(false))
})

it('permite declarar o formato numérico no modal de manifesto BB', async () => {
  mocks.effectiveRole.mockReturnValue('documentacao')
  mocks.can.mockReturnValue(true)
  mocks.parseBreakbulkManifestFile.mockResolvedValue({
    bls: [{ id: 'BL-FMT' }],
    rowErrors: [],
  })

  const { container } = render(
    <VoyageImportActions voyageId={7} voyageLabel="GREEN SANTOS / 14N" userId="user-1" types={['bb']} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Manifesto BB/ }))

  const select = container.querySelector('select') as HTMLSelectElement
  expect(select).toBeTruthy()
  fireEvent.change(select, { target: { value: 'pt-BR' } })

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['BL;CE\nBL-FMT;CE-1'], 'manifesto-bb.csv')] },
  })

  await waitFor(() => {
    expect(mocks.parseBreakbulkManifestFile).toHaveBeenCalledWith(
      expect.any(File),
      { numberFormat: 'pt-BR' },
    )
  })
})

const validBaplie = {
  vessel_name: 'GREEN SANTOS',
  voyage_number: '14N',
  containers: [{
    container_number: 'TCLU1234567', size_type: '45G1', status: 'full', weight_kg: 21000, pol: 'CNSHA', pod: 'BRSSA',
    final_dest: null, bl_ref: null, slot: '010101', is_imo: false, imo_class: null, un_number: null, is_oog: false,
  }],
  pods: ['BRSSA'],
  issues: [],
  encoding: 'utf-8',
}

async function openBaplieWithFile() {
  const { container } = renderActions()
  fireEvent.click(screen.getByRole('button', { name: /Baplie/ }))
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['edi'], 'baplie.edi', { type: 'text/plain' })] },
  })
  await waitFor(() => expect(mocks.parseBaplieFile).toHaveBeenCalledTimes(1))
  const confirm = screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement
  await waitFor(() => expect(confirm.disabled).toBe(false))
  fireEvent.click(confirm)
}

it('pede confirmação antes de substituir o Baplie que a viagem já tem', async () => {
  mocks.parseBaplieFile.mockResolvedValue(validBaplie)
  mocks.countBaplieStaging.mockResolvedValue(612)
  mocks.confirm.mockResolvedValue(false)

  await openBaplieWithFile()

  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: '612->1' })))
  expect(mocks.importBaplieStaging).not.toHaveBeenCalled()
})

it('importa direto quando a viagem ainda não tem Baplie', async () => {
  mocks.parseBaplieFile.mockResolvedValue(validBaplie)

  await openBaplieWithFile()

  await waitFor(() => expect(mocks.importBaplieStaging).toHaveBeenCalledTimes(1))
  expect(mocks.confirm).not.toHaveBeenCalled()
})

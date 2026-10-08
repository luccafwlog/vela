// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(() => Promise.resolve()),
  showToast: vi.fn(),
  parseBreakbulkManifestFile: vi.fn(),
  importBreakbulkManifest: vi.fn(() => Promise.resolve()),
  parseBaplieFile: vi.fn(),
  reimportBaplie: vi.fn(),
  bapliePlan: null as null | { existing: number },
  baplieFlagsError: null as null | string,
  baplieVaziosError: null as null | string,
  retryBaplieVazios: vi.fn(),
  confirm: vi.fn(() => Promise.resolve(true)),
  importedBaplie: vi.fn(),
  can: vi.fn<(permission: string) => boolean>(() => true),
  effectiveRole: vi.fn(() => 'documentacao'),
  profile: { id: 'user-1' },
  navigate: vi.fn(),
  parseVehicleImportFile: vi.fn(),
  importVehicleRows: vi.fn(),
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
  reimportBaplie: mocks.reimportBaplie,
  baplieReplacementConfirmOptions: (plan: { existing: number }, incoming: number) => ({ message: `${plan.existing}->${incoming}` }),
  baplieImportToast: () => 'Baplie importado.',
  hasBapliePendency: (result: { flagsError: string | null; vaziosError: string | null }) => Boolean(result.flagsError || result.vaziosError),
  baplieFootnoteForPendency: () => 'Baplie gravado com pendência.',
  retryBaplieVazios: mocks.retryBaplieVazios,
}))
vi.mock('../../../services/vehicleImport', () => ({
  parseVehicleImportFile: mocks.parseVehicleImportFile,
  importVehicleRows: mocks.importVehicleRows,
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
  mocks.bapliePlan = null
  mocks.baplieFlagsError = null
  mocks.baplieVaziosError = null
  mocks.retryBaplieVazios.mockReset().mockResolvedValue(undefined)
  // Simula o serviço: com Baplie anterior e diferença, pergunta antes de gravar.
  mocks.reimportBaplie.mockReset()
  mocks.reimportBaplie.mockImplementation(async ({ confirmReplacement }: { confirmReplacement: (plan: unknown) => Promise<boolean> }) => {
    if (mocks.bapliePlan && !(await confirmReplacement(mocks.bapliePlan))) return { status: 'cancelled' }
    mocks.importedBaplie()
    return { status: mocks.bapliePlan ? 'replaced' : 'imported', staged: 1, vaziosReplaced: false, flagsError: mocks.baplieFlagsError, vaziosError: mocks.baplieVaziosError }
  })
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
  expect(screen.queryByText('Importar manifesto BB (carga solta)')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: /Manifesto BB/ }))

  // O modal abre exibindo o rótulo da viagem — prova de escopo.
  expect(screen.getByText('Importar manifesto BB (carga solta)')).toBeTruthy()
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
  const confirm = screen.getByRole('button', { name: 'Importar manifesto' }) as HTMLButtonElement
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
  expect((screen.getByRole('button', { name: 'Importar manifesto' }) as HTMLButtonElement).disabled).toBe(true)
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
  const confirm = screen.getByRole('button', { name: /^Importar Baplie/ }) as HTMLButtonElement
  expect(screen.getByText(/Peso inválido no conjunto 1/)).toBeTruthy()
  expect(confirm.disabled).toBe(true)

  fireEvent.click(confirm)
  expect(mocks.reimportBaplie).not.toHaveBeenCalled()
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
  const confirm = screen.getByRole('button', { name: 'Importar manifesto' }) as HTMLButtonElement
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
  const confirm = screen.getByRole('button', { name: /^Importar Baplie/ }) as HTMLButtonElement
  await waitFor(() => expect(confirm.disabled).toBe(false))
  fireEvent.click(confirm)
}

it('pede confirmação antes de substituir o Baplie que a viagem já tem', async () => {
  mocks.parseBaplieFile.mockResolvedValue(validBaplie)
  mocks.bapliePlan = { existing: 612 }
  mocks.confirm.mockResolvedValue(false)

  await openBaplieWithFile()

  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: '612->1' })))
  expect(mocks.importedBaplie).not.toHaveBeenCalled()
})

it('importa direto quando a viagem ainda não tem Baplie', async () => {
  mocks.parseBaplieFile.mockResolvedValue(validBaplie)

  await openBaplieWithFile()

  await waitFor(() => expect(mocks.importedBaplie).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['voyages'] }))
  expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['baplie-staging', '7'] })
  expect(mocks.confirm).not.toHaveBeenCalled()
})

it('Baplie gravado sem IMO/OOG nos B/Ls fica no modal com o aviso e só Concluir', async () => {
  mocks.parseBaplieFile.mockResolvedValue(validBaplie)
  mocks.baplieFlagsError = 'timeout na aplicação'

  await openBaplieWithFile()

  expect(await screen.findByText('Baplie importado, mas IMO/OOG não foram aplicados aos B/Ls')).toBeTruthy()
  expect(screen.getByText('timeout na aplicação')).toBeTruthy()
  // O staging foi gravado: a viagem é atualizada mesmo com a falha parcial.
  expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['baplie-staging', '7'] })
  expect(screen.queryByRole('button', { name: /^Importar Baplie/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Concluir' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('vazios não recadastrados: o aviso refaz só os vazios, porque reimportar o mesmo arquivo não os toca', async () => {
  mocks.parseBaplieFile.mockResolvedValue(validBaplie)
  mocks.baplieVaziosError = 'falha nos vazios'
  mocks.retryBaplieVazios.mockRejectedValueOnce(new Error('ainda falhou')).mockResolvedValueOnce(undefined)

  await openBaplieWithFile()

  expect(await screen.findByText('Baplie importado, mas os vazios de importação não foram recadastrados')).toBeTruthy()
  expect(screen.getByText('falha nos vazios')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Recadastrar vazios' }))
  expect(await screen.findByText('ainda falhou')).toBeTruthy()
  mocks.invalidateQueries.mockClear()
  fireEvent.click(screen.getByRole('button', { name: 'Recadastrar vazios' }))
  expect(await screen.findByText('Vazios de importação recadastrados.')).toBeTruthy()
  expect(mocks.retryBaplieVazios).toHaveBeenLastCalledWith({ voyageId: 7, actorId: expect.any(String) })
  await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['baplie-staging', '7'] }))
  expect(screen.queryByRole('button', { name: 'Recadastrar vazios' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Concluir' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('resultado parcial de veículos fica no modal com as linhas recusadas e só Concluir', async () => {
  mocks.parseVehicleImportFile.mockResolvedValue({
    rows: [{ rowNumber: 2, chassis: 'CH-1' }, { rowNumber: 3, chassis: 'CH-2' }],
    rowErrors: [],
  })
  mocks.importVehicleRows.mockResolvedValue({
    processed: 2,
    successCount: 1,
    errorCount: 1,
    errors: [{ row: 3, message: 'B/L BL-9 não pertence à viagem' }],
  })
  const { container } = render(
    <VoyageImportActions voyageId={7} voyageLabel="GREEN SANTOS / 14N" userId="user-1" types={['vehicles']} />,
  )

  fireEvent.click(screen.getByRole('button', { name: /Veículos/ }))
  const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(fileInput, { target: { files: [new File(['x'], 'veiculos.xlsx')] } })
  const confirm = await screen.findByRole('button', { name: 'Importar 2 veículos' })
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(confirm)

  await waitFor(() => expect(mocks.importVehicleRows).toHaveBeenCalledWith({ voyageId: 7, rows: expect.any(Array) }))
  expect(await screen.findByText(/1 linha recusada ao gravar/)).toBeTruthy()
  expect(screen.getByText(/BL-9 não pertence à viagem/)).toBeTruthy()
  expect(screen.getByText('Importação gravada em parte. As linhas recusadas estão acima.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Concluir' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Importar 2 veículos/ })).toBeNull()
})

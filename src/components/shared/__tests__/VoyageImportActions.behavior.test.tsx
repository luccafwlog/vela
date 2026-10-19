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
  parseGraniteManifestFile: vi.fn(),
  importGraniteManifest: vi.fn(),
  refetchVoyageContext: vi.fn(),
  // Viagem conferida: as regras do Baplie rodaram e a importação pode seguir.
  voyageContext: {
    data: { voyageNumber: '14N', vesselName: 'GREEN SANTOS', eligiblePods: [] } as unknown,
    isError: false,
    error: null as unknown,
  },
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
  // A conferência com os B/Ls gravados tem teste próprio; aqui a prévia é a do parser.
  withBreakbulkReimportCheck: async (manifest: unknown) => manifest,
  describeOtherVoyage: () => '',
  describeBreakbulkPending: () => [],
  NO_BREAKBULK_APPROVAL: { customerChanges: [], billedRouteChanges: [] },
  hasBlockingRowErrors: (rowErrors: Array<{ severity?: 'error' | 'warning' }>) =>
    rowErrors.some((e) => (e.severity ?? 'error') === 'error'),
}))
vi.mock('../../../services/baplieParser', () => ({
  parseBaplieFile: mocks.parseBaplieFile,
}))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../../hooks/useBaplieVoyageContext', () => ({
  useBaplieVoyageContext: () => ({ ...mocks.voyageContext, refetch: mocks.refetchVoyageContext }),
}))
vi.mock('../../../services/baplieImport', async (importOriginal) => ({
  baplieVoyageContextBlock: (await importOriginal<typeof import('../../../services/baplieImport')>()).baplieVoyageContextBlock,
  // Regras da Viagem (etapa 9): aqui a prévia é a do parser.
  applyBaplieVoyageRules: (parsed: { containers: unknown[]; pods?: string[]; issues: unknown[] }) => ({ containers: parsed.containers, pods: parsed.pods ?? [], issues: parsed.issues }),
  reimportBaplie: mocks.reimportBaplie,
  baplieReplacementConfirmOptions: (plan: { existing: number }, incoming: number) => ({ message: `${plan.existing}->${incoming}` }),
  baplieImportToast: (result: { vaziosReplaced: boolean }) => `Baplie importado.${result.vaziosReplaced ? ' Vazios de importação recadastrados.' : ''}`,
  hasBapliePendency: (result: { flagsError: string | null; vaziosError: string | null }) => Boolean(result.flagsError || result.vaziosError),
  baplieFootnoteForPendency: (result: { flagsError: string | null; vaziosError: string | null }) => (result.flagsError || result.vaziosError ? 'Baplie gravado com pendência.' : 'Baplie gravado, sem pendências.'),
  retryBaplieVazios: mocks.retryBaplieVazios,
}))
vi.mock('../../../services/vehicleImport', () => ({
  parseVehicleImportFile: mocks.parseVehicleImportFile,
  importVehicleRows: mocks.importVehicleRows,
}))
vi.mock('../../../services/graniteImport', () => ({
  parseGraniteManifestFile: mocks.parseGraniteManifestFile,
  importGraniteManifest: mocks.importGraniteManifest,
  graniteRemovalConfirmOptions: (missing: string[]) => ({ message: missing.join(',') }),
  describeGraniteImport: (result: { inserted: number }) => `${result.inserted} novo(s)`,
}))
vi.mock('../CeMercanteImportModal', () => ({
  CeMercanteImportModal: ({ initialVoyageId, target }: { initialVoyageId?: number; target?: string }) => <div>CE semeado: {initialVoyageId} · {target ?? 'bls'}</div>,
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
  mocks.voyageContext = { data: { voyageNumber: '14N', vesselName: 'GREEN SANTOS', eligiblePods: [] }, isError: false, error: null }
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
  const confirm = screen.getByRole('button', { name: 'Importar 1 B/L' }) as HTMLButtonElement
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
  const confirm = await screen.findByRole('button', { name: 'Importar 1 B/L' }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  // Regra de 2026-10-19: erro recusa o arquivo inteiro, sem aceite que force.
  expect(screen.queryByText(/forçar a importação/)).toBeNull()
  expect(screen.queryByRole('checkbox', { name: /Conferi os avisos/ })).toBeNull()
  expect(screen.getByText('Com erro no arquivo, nada é importado. Corrija e escolha o arquivo de novo.')).toBeTruthy()
  fireEvent.click(confirm)
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
  const confirm = screen.getByRole('button', { name: 'Importar containers' }) as HTMLButtonElement
  expect(screen.getByText(/Peso inválido no conjunto 1/)).toBeTruthy()
  expect(confirm.disabled).toBe(true)

  fireEvent.click(confirm)
  expect(mocks.reimportBaplie).not.toHaveBeenCalled()
})

it('ordena as importacoes e abre CE Mercante semeado com a viagem (B26)', () => {
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
  expect(screen.getByText('CE semeado: 7 · bls')).toBeTruthy()
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

it('leva Vazios Exp ao Embarque semeado com a viagem', () => {
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

it('abre CE Mercante do Granito com o alvo correto e semeado com a viagem (B26)', () => {
  render(
    <VoyageImportActions
      voyageId={7}
      voyageLabel="GREEN SANTOS / 14N"
      userId="user-1"
      types={['ceMercanteGranite']}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'CE Mercante (Granito)' }))
  expect(screen.getByText('CE semeado: 7 · granite')).toBeTruthy()
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
  const confirm = screen.getByRole('button', { name: 'Importar 1 B/L' }) as HTMLButtonElement
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
  const confirm = screen.getByRole('button', { name: /^Importar \d+ containers?$/ }) as HTMLButtonElement
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
  expect(screen.queryByRole('button', { name: /^Importar \d+ container/ })).toBeNull()
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
  // Título, resumo e rodapé deixam de citar os vazios.
  expect(await screen.findByText('Baplie importado, sem pendências')).toBeTruthy()
  expect(screen.getByText('Baplie importado. Vazios de importação recadastrados.')).toBeTruthy()
  expect(screen.getByText('Baplie gravado, sem pendências.')).toBeTruthy()
  expect(screen.queryByText('Baplie importado, mas os vazios de importação não foram recadastrados')).toBeNull()
  expect(mocks.retryBaplieVazios).toHaveBeenLastCalledWith({ voyageId: 7, actorId: expect.any(String) })
  await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['baplie-staging', '7'] }))
  expect(screen.queryByRole('button', { name: 'Recadastrar vazios' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Concluir' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

// Regra de 2026-10-19 (ADR 0091): recusa da conferência com o que já está
// gravado desfaz tudo — nada é gravado e a tela lista o que foi recusado.
it('recusa de veículos na conferência com o gravado: nada foi gravado, lista as recusadas', async () => {
  mocks.parseVehicleImportFile.mockResolvedValue({
    rows: [{ rowNumber: 2, chassis: 'CH-1' }, { rowNumber: 3, chassis: 'CH-2' }],
    rowErrors: [],
  })
  mocks.importVehicleRows.mockResolvedValue({
    processed: 2,
    successCount: 0,
    errorCount: 1,
    errors: [{ row: 3, message: 'B/L BL-9 não pertence à viagem' }],
  })
  const { container } = render(
    <VoyageImportActions voyageId={7} voyageLabel="GREEN SANTOS / 14N" userId="user-1" types={['vehicles']} />,
  )

  fireEvent.click(screen.getByRole('button', { name: /Veículos/ }))
  expect(screen.getByText('GREEN SANTOS / 14N')).toBeTruthy()
  const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(fileInput, { target: { files: [new File(['x'], 'veiculos.xlsx')] } })
  const confirm = await screen.findByRole('button', { name: 'Importar 2 veículos' })
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(confirm)

  await waitFor(() => expect(mocks.importVehicleRows).toHaveBeenCalledWith(expect.objectContaining({ voyageId: 7, rows: expect.any(Array), confirmUnpacking: expect.any(Function) })))
  expect(await screen.findByText(/Nada foi gravado: 1 linha recusada/)).toBeTruthy()
  expect(screen.getByText(/BL-9 não pertence à viagem/)).toBeTruthy()
  expect(screen.getByText('Nada foi gravado. Corrija as linhas recusadas e escolha a planilha de novo.')).toBeTruthy()
  // Nada gravado: não há "Concluir" nem cache a atualizar, e o botão fica travado.
  expect(screen.queryByRole('button', { name: 'Concluir' })).toBeNull()
  expect((screen.getByRole('button', { name: 'Importar 2 veículos' }) as HTMLButtonElement).disabled).toBe(true)
  expect(mocks.invalidateQueries).not.toHaveBeenCalled()
})

it('veículos com erro de linha na planilha: nada é importado e não há aceite para forçar', async () => {
  mocks.parseVehicleImportFile.mockResolvedValue({
    rows: [{ rowNumber: 2, chassis: 'CH-1' }],
    rowErrors: [{ row: 3, message: 'Todos os campos obrigatórios devem ser preenchidos.', raw: {} }],
  })
  const { container } = render(
    <VoyageImportActions voyageId={7} voyageLabel="GREEN SANTOS / 14N" userId="user-1" types={['vehicles']} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Veículos/ }))
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['x'], 'veiculos.xlsx')] } })
  const confirm = await screen.findByRole('button', { name: 'Importar 1 veículo' }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  expect(screen.queryByRole('checkbox')).toBeNull()
  fireEvent.click(confirm)
  expect(mocks.importVehicleRows).not.toHaveBeenCalled()
})

// E9-01: sem a Viagem conferida, navio/viagem e escalas do arquivo não são checados.
it('Baplie: não importa enquanto a Viagem carrega nem quando a conferência falha', async () => {
  mocks.parseBaplieFile.mockResolvedValue(validBaplie)
  mocks.voyageContext = { data: undefined, isError: true, error: { code: 'PGRST202', message: 'Could not find the function public.list_voyage_eligible_pods' } }
  const { container, rerender } = renderActions()
  fireEvent.click(screen.getByRole('button', { name: /Baplie/ }))
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['edi'], 'baplie.edi', { type: 'text/plain' })] },
  })
  await waitFor(() => expect(mocks.parseBaplieFile).toHaveBeenCalledTimes(1))
  expect(await screen.findByText('Não foi possível conferir a Viagem: a leitura do navio, da viagem e das escalas falhou. Tente novamente.')).toBeTruthy()
  expect(screen.getByText('Importação bloqueada até a Viagem ser conferida.')).toBeTruthy()
  const confirm = screen.getByRole('button', { name: 'Importar containers' }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(mocks.refetchVoyageContext).toHaveBeenCalled()

  mocks.voyageContext = { data: undefined, isError: false, error: null }
  rerender(<VoyageImportActions voyageId={7} voyageLabel="GREEN SANTOS / 14N" userId="user-1" types={['bb', 'granite', 'baplie']} />)
  expect(await screen.findByText('Conferindo navio, viagem e escalas da Viagem…')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Importar containers' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Importar containers' }))
  expect(mocks.reimportBaplie).not.toHaveBeenCalled()
})

// A1 do lote 6a: o Granito da Viagem é o mesmo modal de /granito, com a viagem fixa.
it('Granito pela Viagem: mesmo modal com a viagem fixa; erro de linha recusa o arquivo', async () => {
  const granite = { rowNumber: 2, bl_number: 'BL-G1', shipper_name: 'Granito SA', shipper_cnpj: '11222333000181', real_weight_kg: 5000, blocks_qty: 2, phase: null, clientId: 9, suggestedClientId: null, reconciliationStatus: 'matched' }
  mocks.parseGraniteManifestFile.mockResolvedValueOnce({ vesselVoyage: 'NAVIO/14', bls: [granite], rowErrors: [{ row: 3, message: 'BL BL-G2: Real Weight ausente ou zero.', raw: {} }], fileBlNumbers: ['BL-G1', 'BL-G2'] })
  mocks.parseGraniteManifestFile.mockResolvedValueOnce({ vesselVoyage: 'NAVIO/14', bls: [granite], rowErrors: [], fileBlNumbers: ['BL-G1'] })
  mocks.importGraniteManifest.mockResolvedValue({ manifestId: 'm1', pendingCount: 0, inserted: 1, updated: 0, removed: [], keptMissing: [], keptInvoiced: [] })
  const { container } = render(<VoyageImportActions voyageId={7} voyageLabel="GREEN SANTOS / 14N" userId="user-1" types={['granite']} />)

  fireEvent.click(screen.getByRole('button', { name: /Manifesto Granito/ }))
  expect(screen.getByText('Importar manifesto Granito')).toBeTruthy()
  expect(screen.getByText('GREEN SANTOS / 14N')).toBeTruthy()
  const input = () => container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input(), { target: { files: [new File(['x'], 'cosco.xlsx')] } })
  const confirm = await screen.findByRole('button', { name: 'Importar 1 B/L' }) as HTMLButtonElement
  expect(await screen.findByText(/Real Weight ausente ou zero/)).toBeTruthy()
  expect(confirm.disabled).toBe(true)
  expect(screen.queryByRole('checkbox')).toBeNull()

  fireEvent.change(input(), { target: { files: [new File(['y'], 'cosco-corrigido.xlsx')] } })
  await waitFor(() => expect((screen.getByRole('button', { name: 'Importar 1 B/L' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Importar 1 B/L' }))
  await waitFor(() => expect(mocks.importGraniteManifest).toHaveBeenCalledWith(expect.objectContaining({ voyageId: 7, uploadedBy: 'user-1', filename: 'cosco-corrigido.xlsx' })))
  expect(mocks.importGraniteManifest.mock.calls[0]?.[0]).not.toHaveProperty('allowRowErrors')
  expect(await screen.findByText('Manifesto gravado')).toBeTruthy()
  expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['granite-bls'] })
})

// @vitest-environment jsdom
// Lote 6a, tela 19 (A2 e regra de 2026-10-19): o arquivo de vazios de
// importação é lido antes da viagem; a viagem libera o botão Importar; a
// contagem separa erros de avisos; erro recusa o arquivo inteiro.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  importManifest: vi.fn(),
  invalidateQueries: vi.fn(() => Promise.resolve()),
  showToast: vi.fn(),
  confirm: vi.fn(() => Promise.resolve(true)),
  existing: [] as Array<{ container_number: string; pol: string | null; pod: string | null; source: 'manual' | 'baplie' }>,
}))

// Vazios já gravados na Viagem escolhida (ADR 0095, decisão 21).
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useQuery: ({ enabled }: { enabled?: boolean }) => ({ data: enabled ? mocks.existing : undefined, isError: false }),
}))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../../services/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('../VoyageCombobox', () => ({
  VoyageCombobox: ({ onSelect }: { onSelect: (id: number | null) => void }) => (
    <button type="button" onClick={() => onSelect(7)}>Escolher viagem 7</button>
  ),
}))
vi.mock('../../../services/vaziosImportacaoImport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/vaziosImportacaoImport')>()),
  parseVaziosImportacaoFile: mocks.parse,
  importVaziosImportacaoManifest: mocks.importManifest,
}))

import { VaziosImportacaoImportModal } from '../VaziosImportacaoImportModal'

const container = (container_number: string) => ({ rowNumber: 2, container_number, container_type: '40HC', tare_kg: 3800, pol: 'CNTAC', pod: 'BRVIX' })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.existing = []
  mocks.importManifest.mockResolvedValue({ manifestId: 'm1', mercanteManifestIds: ['mm1'] })
})
afterEach(cleanup)

function chooseFile(view: ReturnType<typeof render>) {
  fireEvent.change(view.container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'vazios.xlsx')] },
  })
}

it('lê o arquivo antes da viagem e diz que a viagem libera o botão Importar', async () => {
  mocks.parse.mockResolvedValue({ containers: [container('TGHU7654325')], rowErrors: [], warnings: [], hidden: { rows: 0, sheets: [] } })
  const onClose = vi.fn()
  const view = render(<VaziosImportacaoImportModal onClose={onClose} />)

  chooseFile(view)
  await waitFor(() => expect(mocks.parse).toHaveBeenCalledTimes(1))
  expect(await screen.findByText('Escolha a viagem de destino: é ela que libera o botão Importar.')).toBeTruthy()
  const confirm = screen.getByRole('button', { name: 'Importar 1 container' }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)

  fireEvent.click(screen.getByRole('button', { name: 'Escolher viagem 7' }))
  fireEvent.change(screen.getByPlaceholderText('Ex.: 1226501801342'), { target: { value: '1226501801342' } })
  await waitFor(() => expect(confirm.disabled).toBe(false))
  fireEvent.click(confirm)

  await waitFor(() => expect(mocks.importManifest).toHaveBeenCalledTimes(1))
  expect(mocks.importManifest).toHaveBeenCalledWith(expect.objectContaining({ voyageId: 7, uploadedBy: 'user-1', manifestNumbers: { CNTAC__BRVIX: '1226501801342' } }))
  expect(mocks.importManifest.mock.calls[0]?.[0]).not.toHaveProperty('allowRowErrors')
  await waitFor(() => expect(onClose).toHaveBeenCalled())
})

it('erro em uma linha recusa o arquivo inteiro: sem aceite para forçar, sem gravar', async () => {
  mocks.parse.mockResolvedValue({
    containers: [container('TGHU7654325')],
    rowErrors: [
      { row: 3, message: 'Container MSCU1: formato ISO esperado (XXXX0000000).', raw: {} },
      { row: 4, message: 'Container TGHU7654325: tara não informada.', raw: {}, severity: 'warning' },
    ],
    warnings: [],
    hidden: { rows: 0, sheets: [] },
  })
  const view = render(<VaziosImportacaoImportModal voyage={{ id: 7, label: 'GREEN SANTOS / 14N' }} onClose={vi.fn()} />)
  expect(screen.getByText('GREEN SANTOS / 14N')).toBeTruthy()

  chooseFile(view)
  // A contagem separa erros de avisos (antes "Avisos" contava os erros).
  const summary = await screen.findByLabelText('Resumo da planilha')
  // Rótulo e número de cada item: 1 container, 1 erro, 1 aviso.
  expect(summary.textContent).toBe('container1erro1aviso1')
  expect(screen.getByText('Com erro no arquivo, nada é importado. Corrija e escolha o arquivo de novo.')).toBeTruthy()
  expect(screen.queryByRole('checkbox')).toBeNull()
  const confirm = screen.getByRole('button', { name: 'Importar 1 container' }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  fireEvent.click(confirm)
  expect(mocks.importManifest).not.toHaveBeenCalled()
})

it('aviso sem erro pede o aceite e então importa o arquivo inteiro', async () => {
  mocks.parse.mockResolvedValue({
    containers: [container('TGHU7654325')],
    rowErrors: [{ row: 2, message: 'Container TGHU7654325: tara não informada.', raw: {}, severity: 'warning' }],
    warnings: [],
    hidden: { rows: 0, sheets: [] },
  })
  const view = render(<VaziosImportacaoImportModal voyage={{ id: 7, label: 'GREEN SANTOS / 14N' }} onClose={vi.fn()} />)
  chooseFile(view)
  fireEvent.change(await screen.findByPlaceholderText('Ex.: 1226501801342'), { target: { value: '99' } })
  const confirm = screen.getByRole('button', { name: 'Importar 1 container' }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  fireEvent.click(screen.getByRole('checkbox', { name: /Conferi os avisos e quero importar o arquivo/ }))
  await waitFor(() => expect(confirm.disabled).toBe(false))
  fireEvent.click(confirm)
  await waitFor(() => expect(mocks.importManifest).toHaveBeenCalledWith(expect.objectContaining({ voyageId: 7 })))
})

// ADR 0095, decisão 21 (migration 398): um vazio de importação por Viagem.
it('container de outra planilha em outra rota da Viagem bloqueia; o do Baplie passa a valer pela planilha', async () => {
  mocks.existing = [
    { container_number: 'TGHU7654325', pol: 'CNTAC', pod: 'BRSSZ', source: 'manual' },
    { container_number: 'MSCU1234565', pol: 'CNTAC', pod: 'BRSSZ', source: 'baplie' },
  ]
  mocks.parse.mockResolvedValue({ containers: [container('TGHU7654325'), container('MSCU1234565')], rowErrors: [], warnings: [], hidden: { rows: 0, sheets: [] } })
  const view = render(<VaziosImportacaoImportModal onClose={vi.fn()} defaultVoyageId="7" />)
  chooseFile(view)
  expect(await screen.findByText(/O container TGHU7654325 já está nos Vazios de importação desta Viagem na rota CNTAC → BRSSZ, de outra planilha/)).toBeTruthy()
  expect(screen.getByText(/MSCU1234565 \(Baplie CNTAC → BRSSZ, planilha CNTAC → BRVIX\) passam a valer pela planilha/)).toBeTruthy()
  fireEvent.change(screen.getByPlaceholderText('Ex.: 1226501801342'), { target: { value: '1226501801342' } })
  expect((screen.getByRole('button', { name: 'Importar 2 containers' }) as HTMLButtonElement).disabled).toBe(true)
  expect(mocks.importManifest).not.toHaveBeenCalled()
})

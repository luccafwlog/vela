// @vitest-environment jsdom
// Regra de 2026-10-19 (ADR 0092): erro no Baplie recusa a importação inteira;
// IMO/OOG e vazios são passos depois da gravação, retomáveis (item 5).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  reimport: vi.fn(),
  retryVazios: vi.fn(),
  invalidateQueries: vi.fn(() => Promise.resolve()),
  showToast: vi.fn(),
  confirm: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }) }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../../services/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('../../../services/baplieParser', () => ({ parseBaplieFile: mocks.parse }))
vi.mock('../../../hooks/useBaplieVoyageContext', () => ({
  useBaplieVoyageContext: (voyageId: number | null) => ({
    data: voyageId ? { voyageNumber: '14N', vesselName: 'GREEN SANTOS', eligiblePods: ['BRSSZ'] } : undefined,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}))
vi.mock('../VoyageCombobox', () => ({
  VoyageCombobox: ({ onSelect, disabled }: { onSelect: (id: number | null) => void; disabled?: boolean }) => (
    <button type="button" disabled={disabled} onClick={() => onSelect(7)}>Escolher viagem 7</button>
  ),
}))
vi.mock('../../../services/baplieImport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/baplieImport')>()),
  // As regras da Viagem têm teste próprio; aqui a prévia é a do parser.
  applyBaplieVoyageRules: (parsed: { containers: unknown[]; pods?: string[]; issues: unknown[] }) => ({ containers: parsed.containers, pods: parsed.pods ?? [], issues: parsed.issues }),
  reimportBaplie: mocks.reimport,
  retryBaplieVazios: mocks.retryVazios,
}))

import { BaplieImportModal } from '../BaplieImportModal'

const container = { container_number: 'CXRU1234567', status: 'full', pod: 'BRSSZ', is_imo: false, is_oog: false }
const parsed = (issues: unknown[] = []) => ({ vessel_name: 'GREEN SANTOS', voyage_number: '14N', containers: [container], pods: ['BRSSZ'], issues })
const done = { status: 'imported', staged: 1, vaziosReplaced: false, flagsError: null, vaziosError: null, flags: undefined }
const fixed = { id: 7, label: 'GREEN SANTOS / 14N' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.reimport.mockResolvedValue(done)
  mocks.retryVazios.mockResolvedValue(undefined)
})
afterEach(cleanup)

function chooseFile(view: ReturnType<typeof render>) {
  fireEvent.change(view.container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['edi'], 'baplie.edi', { type: 'text/plain' })] },
  })
}

async function importNow() {
  const confirm = await screen.findByRole('button', { name: 'Importar 1 container' }) as HTMLButtonElement
  await waitFor(() => expect(confirm.disabled).toBe(false))
  fireEvent.click(confirm)
}

it('erro no arquivo: Importar desativado e o rodapé diz que nada é importado', async () => {
  mocks.parse.mockResolvedValue(parsed([{ row: 5, field: 'pod', code: 'unknown_port', severity: 'error', message: 'POD XXXXX desconhecido.' }]))
  const view = render(<BaplieImportModal voyage={fixed} onClose={vi.fn()} />)
  chooseFile(view)
  expect(await screen.findByText('Com erro no arquivo, nada é importado. Corrija e escolha o arquivo de novo.')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Importar containers' }) as HTMLButtonElement).disabled).toBe(true)
  expect(mocks.reimport).not.toHaveBeenCalled()
})

it('caminho feliz: grava uma vez, avisa e fecha; a Viagem escolhida aparece na prévia', async () => {
  mocks.parse.mockResolvedValue(parsed())
  const onClose = vi.fn()
  const view = render(<BaplieImportModal onClose={onClose} />)
  fireEvent.click(screen.getByRole('button', { name: 'Escolher viagem 7' }))
  chooseFile(view)
  await screen.findByText('Navio/viagem no arquivo')
  // Destino ao lado do que o arquivo diz.
  const destination = screen.getByText('Viagem', { selector: '.app-import-context__label' })
  expect(destination.nextElementSibling?.textContent).toBe('GREEN SANTOS / 14N')
  await importNow()
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  expect(mocks.reimport).toHaveBeenCalledTimes(1)
  // Só os PODs marcados e a viagem do arquivo vão ao servidor (migration 388).
  expect(mocks.reimport).toHaveBeenCalledWith(expect.objectContaining({ voyageId: 7, pods: ['BRSSZ'], file: { voyageNumber: '14N', voyageConfirmed: true } }))
})

it('pela aba da Viagem, a Viagem fica só no topo', async () => {
  mocks.parse.mockResolvedValue(parsed())
  const view = render(<BaplieImportModal voyage={fixed} onClose={vi.fn()} />)
  chooseFile(view)
  await screen.findByText('Navio/viagem no arquivo')
  expect(screen.getAllByText('Viagem', { selector: '.app-import-context__label' })).toHaveLength(1)
})

it('não fecha durante a gravação', async () => {
  mocks.parse.mockResolvedValue(parsed())
  let finish: ((value: unknown) => void) | undefined
  mocks.reimport.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const onClose = vi.fn()
  const view = render(<BaplieImportModal voyage={fixed} onClose={onClose} />)
  chooseFile(view)
  await importNow()
  await waitFor(() => expect(mocks.reimport).toHaveBeenCalledTimes(1))

  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'Fechar modal' }))
  expect(onClose).not.toHaveBeenCalled()
  expect(mocks.showToast).toHaveBeenCalledWith('Aguarde: a gravação ainda está em andamento.', 'info')

  finish?.(done)
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
})

it('vazios pendentes: o Resultado oferece o recadastro, diz onde ele continua e não fecha enquanto recadastra', async () => {
  mocks.parse.mockResolvedValue(parsed())
  mocks.reimport.mockResolvedValueOnce({ ...done, status: 'replaced', vaziosError: 'timeout no recadastro' })
  let finishRetry: (() => void) | undefined
  mocks.retryVazios.mockImplementationOnce(() => new Promise<void>((resolve) => { finishRetry = resolve }))
  const onClose = vi.fn()
  const view = render(<BaplieImportModal voyage={fixed} onClose={onClose} />)
  chooseFile(view)
  await importNow()

  expect(await screen.findByRole('heading', { name: 'Resultado' })).toBeTruthy()
  expect(screen.getByText('timeout no recadastro')).toBeTruthy()
  expect(screen.getByText(/a pendência continua em Baplie EDI desta viagem, com "Atualizar vazios do Baplie"/)).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Recadastrar vazios' }))
  await waitFor(() => expect(mocks.retryVazios).toHaveBeenCalledWith({ voyageId: 7, actorId: 'user-1' }))
  expect((screen.getByRole('button', { name: 'Concluir' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onClose).not.toHaveBeenCalled()

  finishRetry?.()
  await waitFor(() => expect(screen.queryByText('timeout no recadastro')).toBeNull())
  const concluir = screen.getByRole('button', { name: 'Concluir' }) as HTMLButtonElement
  await waitFor(() => expect(concluir.disabled).toBe(false))
  fireEvent.click(concluir)
  expect(onClose).toHaveBeenCalledTimes(1)
})

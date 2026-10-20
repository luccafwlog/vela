// @vitest-environment jsdom
// Regra de 2026-10-19 (ADR 0092): linha com erro recusa a planilha inteira;
// a gravação mostra o Resultado e não fecha no meio.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  importManifest: vi.fn(),
  invalidateQueries: vi.fn(() => Promise.resolve()),
  showToast: vi.fn(),
  confirm: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }) }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../../services/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('../VoyageCombobox', () => ({
  VoyageCombobox: ({ onSelect, disabled }: { onSelect: (id: number | null) => void; disabled?: boolean }) => (
    <button type="button" disabled={disabled} onClick={() => onSelect(7)}>Escolher viagem 7</button>
  ),
}))
vi.mock('../../../services/graniteImport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/graniteImport')>()),
  parseGraniteManifestFile: mocks.parse,
  importGraniteManifest: mocks.importManifest,
}))

import { GraniteImportModal } from '../GraniteImportModal'

const bl = (bl_number: string) => ({
  rowNumber: 2, sequence: 1, booking_number: null, bl_number, shipper_ref: null, vessel_voyage: 'COSCO / 14N',
  loading_port: 'BRVIX', discharge_port: 'CNTAO', shipper_name: 'GRANITOS SA', shipper_cnpj: null, consignee_name: null,
  charter: null, shipper_m3: null, shipper_weight_kg: null, blocks_qty: 3, real_weight_kg: 25000, phase: null,
})
const manifest = (rowErrors: unknown[] = []) => ({ vesselVoyage: 'COSCO / 14N', bls: [bl('GRN001')], rowErrors, fileBlNumbers: ['GRN001'], hidden: { rows: 0, sheets: [] } })
const result = { manifestId: 'm1', inserted: 1, updated: 0, removed: [], keptMissing: [], keptInvoiced: [] }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.importManifest.mockResolvedValue(result)
})
afterEach(cleanup)

function chooseFile(view: ReturnType<typeof render>) {
  fireEvent.change(view.container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'granito.xlsx')] },
  })
}

it('linha com erro: Importar desativado e o rodapé diz que nada é importado', async () => {
  mocks.parse.mockResolvedValue(manifest([{ row: 3, message: 'B/L GRN002: peso real zerado.', raw: {} }]))
  const view = render(<GraniteImportModal voyage={{ id: 7, label: 'COSCO / 14N' }} onClose={vi.fn()} />)
  chooseFile(view)
  expect(await screen.findByText('Com erro no arquivo, nada é importado. Corrija e escolha o arquivo de novo.')).toBeTruthy()
  const confirm = screen.getByRole('button', { name: 'Importar 1 B/L' }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  fireEvent.click(confirm)
  expect(mocks.importManifest).not.toHaveBeenCalled()
})

it('caminho feliz: grava uma vez e mostra o Resultado; a viagem fica travada', async () => {
  mocks.parse.mockResolvedValue(manifest())
  const onClose = vi.fn()
  const view = render(<GraniteImportModal onClose={onClose} />)
  chooseFile(view)
  fireEvent.click(await screen.findByRole('button', { name: 'Escolher viagem 7' }))
  const confirm = screen.getByRole('button', { name: 'Importar 1 B/L' }) as HTMLButtonElement
  await waitFor(() => expect(confirm.disabled).toBe(false))
  fireEvent.click(confirm)

  expect(await screen.findByRole('heading', { name: 'Resultado' })).toBeTruthy()
  expect(mocks.importManifest).toHaveBeenCalledTimes(1)
  expect(mocks.importManifest).toHaveBeenCalledWith(expect.objectContaining({ voyageId: 7, uploadedBy: 'user-1' }))
  expect(screen.getByText('Importação gravada.')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Escolher viagem 7' }) as HTMLButtonElement).disabled).toBe(true)
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Concluir' }))
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('não fecha durante a gravação', async () => {
  mocks.parse.mockResolvedValue(manifest())
  let finish: ((value: unknown) => void) | undefined
  mocks.importManifest.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const onClose = vi.fn()
  const view = render(<GraniteImportModal voyage={{ id: 7, label: 'COSCO / 14N' }} onClose={onClose} />)
  chooseFile(view)
  const confirm = await screen.findByRole('button', { name: 'Importar 1 B/L' }) as HTMLButtonElement
  await waitFor(() => expect(confirm.disabled).toBe(false))
  fireEvent.click(confirm)
  await waitFor(() => expect(mocks.importManifest).toHaveBeenCalledTimes(1))

  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'Fechar modal' }))
  expect(onClose).not.toHaveBeenCalled()
  expect(mocks.showToast).toHaveBeenCalledWith('Aguarde: a gravação ainda está em andamento.', 'info')

  finish?.(result)
  expect(await screen.findByRole('heading', { name: 'Resultado' })).toBeTruthy()
})

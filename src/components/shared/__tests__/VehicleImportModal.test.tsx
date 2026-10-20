// @vitest-environment jsdom
// Regra de 2026-10-19 (ADR 0091): linha com erro recusa a planilha inteira;
// a gravação não fecha no meio.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  importRows: vi.fn(),
  invalidateQueries: vi.fn(() => Promise.resolve()),
  showToast: vi.fn(),
  confirm: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }) }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../../services/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('../VoyageCombobox', () => ({
  VoyageCombobox: ({ onSelect }: { onSelect: (id: number | null) => void }) => (
    <button type="button" onClick={() => onSelect(7)}>Escolher viagem 7</button>
  ),
}))
vi.mock('../../../services/vehicleImport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/vehicleImport')>()),
  parseVehicleImportFile: mocks.parse,
  importVehicleRows: mocks.importRows,
}))

import { VehicleImportModal } from '../VehicleImportModal'

const row = {
  rowNumber: 2, chassis: 'LSVAX123456789012', brand: 'BYD', model: 'DOLPHIN', weight_kg: 1600, cbm: 12,
  container_number: 'TGHU7654325', container_type: '40HC', seal_number: 'S1', bl_id: 'BL-1',
}
const ok = { processed: 1, successCount: 1, errorCount: 0, errors: [] }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.importRows.mockResolvedValue(ok)
})
afterEach(cleanup)

function chooseFile(view: ReturnType<typeof render>) {
  fireEvent.change(view.container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'veiculos.xlsx')] },
  })
}

it('linha com erro: Importar desativado e o rodapé diz que nada é importado', async () => {
  mocks.parse.mockResolvedValue({ rows: [row], rowErrors: [{ row: 3, message: 'Chassi vazio.', raw: {} }] })
  const view = render(<VehicleImportModal voyage={{ id: 7, label: 'GREEN SANTOS / 14N' }} onClose={vi.fn()} />)
  chooseFile(view)
  expect(await screen.findByText('Com erro no arquivo, nada é importado. Corrija e escolha o arquivo de novo.')).toBeTruthy()
  const confirm = screen.getByRole('button', { name: 'Importar 1 veículo' }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  fireEvent.click(confirm)
  expect(mocks.importRows).not.toHaveBeenCalled()
})

// Veículos fecha ao gravar sem recusa: o resultado é o aviso de sucesso.
it('caminho feliz: grava uma vez, avisa e fecha', async () => {
  mocks.parse.mockResolvedValue({ rows: [row], rowErrors: [] })
  const onClose = vi.fn()
  const view = render(<VehicleImportModal onClose={onClose} />)
  chooseFile(view)
  fireEvent.click(await screen.findByRole('button', { name: 'Escolher viagem 7' }))
  const confirm = screen.getByRole('button', { name: 'Importar 1 veículo' }) as HTMLButtonElement
  await waitFor(() => expect(confirm.disabled).toBe(false))
  fireEvent.click(confirm)

  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  expect(mocks.importRows).toHaveBeenCalledTimes(1)
  expect(mocks.importRows).toHaveBeenCalledWith(expect.objectContaining({ voyageId: 7, rows: [row] }))
  expect(mocks.showToast).toHaveBeenCalledWith('1 veículo importado.', 'success')
})

it('não fecha durante a gravação', async () => {
  mocks.parse.mockResolvedValue({ rows: [row], rowErrors: [] })
  let finish: ((value: unknown) => void) | undefined
  mocks.importRows.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const onClose = vi.fn()
  const view = render(<VehicleImportModal voyage={{ id: 7, label: 'GREEN SANTOS / 14N' }} onClose={onClose} />)
  chooseFile(view)
  const confirm = await screen.findByRole('button', { name: 'Importar 1 veículo' }) as HTMLButtonElement
  await waitFor(() => expect(confirm.disabled).toBe(false))
  fireEvent.click(confirm)
  await waitFor(() => expect(mocks.importRows).toHaveBeenCalledTimes(1))

  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'Fechar modal' }))
  expect(onClose).not.toHaveBeenCalled()

  finish?.(ok)
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
})

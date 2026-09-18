// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  parseEdi: vi.fn(),
  partition: vi.fn(),
  importRows: vi.fn(),
  invalidateQueries: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }) }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../../services/ceMercanteImport', () => ({
  parseCeMercanteFile: mocks.parse,
  partitionRowsByVoyage: mocks.partition,
  importCeMercanteRows: mocks.importRows,
  importCeMercanteEdi: vi.fn(),
}))
vi.mock('../../../services/ceMercanteEdiParser', () => ({ parseCeMercanteEdiFile: mocks.parseEdi }))

import { CeMercanteImportModal } from '../CeMercanteImportModal'

afterEach(cleanup)

it('exclui do preview o BL de outra viagem e mostra erro bloqueante', async () => {
  const row = { rowNumber: 2, bl_id: 'BL-OUTRA', ce_mercante: '122605051526081' }
  mocks.parse.mockResolvedValue({ rows: [row], rowErrors: [] })
  mocks.partition.mockResolvedValue({
    rows: [],
    blocked: [{ row: 2, bl_id: 'BL-OUTRA', message: 'B/L BL-OUTRA pertence a outra viagem' }],
  })
  const { container } = render(<CeMercanteImportModal open lockedVoyageId={7} onClose={vi.fn()} />)

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'ce.xlsx')] },
  })

  await waitFor(() => expect(mocks.partition).toHaveBeenCalledWith([row], 7))
  expect(screen.getByText('Linha 2: B/L BL-OUTRA pertence a outra viagem')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Confirmar importação' }) as HTMLButtonElement).disabled).toBe(true)
})

it('invalida caches e informa parcialidade no EDI de Granito', async () => {
  mocks.parseEdi.mockResolvedValue({
    rows: [{ lineNumber: 1, bl_id: 'GR1', ce_mercante: '122605051526081' }],
    rowErrors: [],
  })
  mocks.importRows.mockResolvedValue({
    processed: 1,
    updated: 1,
    overwritten: 0,
    unchanged: 0,
    errorCount: 1,
    errors: [{ row: 2, bl_id: 'GR2', message: 'B/L GR2 nao encontrado no manifesto de granito.' }],
  })
  const { container } = render(<CeMercanteImportModal open target="granite" onClose={vi.fn()} />)
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['edi'], 'ce.edi')] },
  })
  // O botao é sempre renderizado (CeMercanteImportModal.tsx:329 só alterna
  // `disabled`), entao esperar pela existencia dele nao espera nada: o clique
  // cairia no botao desabilitado antes de parseEdi resolver, e o import nunca
  // rodaria. Esperar por `disabled === false` amarra o clique ao preview pronto.
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Confirmar importação' }) as HTMLButtonElement).disabled).toBe(false),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar importação' }))
  await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalled())
  expect(mocks.showToast).toHaveBeenCalledWith('Importacao parcial: 1 gravado(s), 1 pendencia(s).', 'error')
})

it('oferece campo de Nº de Manifesto Mercante e nao exibe rotulo equivocado "Manifesto detectado:"', async () => {
  mocks.parseEdi.mockResolvedValue({
    manifestRef: 'M_TOKEN_1',
    rows: [{ lineNumber: 1, bl_id: 'BL001', ce_mercante: '122605051526081' }],
    rowErrors: [],
  })

  const { container } = render(<CeMercanteImportModal open onClose={vi.fn()} />)

  // Deve haver o campo para informar o Nº de Manifesto Mercante
  expect(screen.getByLabelText(/Nº de Manifesto Mercante/i)).toBeTruthy()

  // Ao carregar EDI com manifestRef
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['edi'], 'ce.edi')] },
  })

  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Confirmar importação' }) as HTMLButtonElement).disabled).toBe(false),
  )

  // NÃO deve exibir o rótulo equivocado "Manifesto detectado:"
  expect(screen.queryByText(/Manifesto detectado:/i)).toBeNull()
})

it('envia o Nº de Manifesto Mercante junto com a importação de planilha', async () => {
  const row = { rowNumber: 2, bl_id: 'BL001', ce_mercante: '122605051526081' }
  mocks.parse.mockResolvedValue({ rows: [row], rowErrors: [] })
  mocks.importRows.mockResolvedValue({
    processed: 1,
    updated: 1,
    overwritten: 0,
    unchanged: 0,
    errorCount: 0,
    errors: [],
  })

  const { container } = render(<CeMercanteImportModal open onClose={vi.fn()} />)
  fireEvent.change(screen.getByPlaceholderText('Ex.: 26BR000001'), { target: { value: ' 26BR000001 ' } })
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'ce.xlsx')] },
  })

  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Confirmar importação' }) as HTMLButtonElement).disabled).toBe(false),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar importação' }))

  await waitFor(() => expect(mocks.importRows).toHaveBeenCalledWith([row], expect.objectContaining({
    manifestoNumero: '26BR000001',
  })))
})

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  partition: vi.fn(),
  importRows: vi.fn(),
  preview: vi.fn(),
  emit: vi.fn(),
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
  previewCeMercanteRows: mocks.preview,
  emitCeMercanteBilling: mocks.emit,
}))

const cleanPreview = { rows: [], errors: [], warnings: [], changes: 0, moves: 0, needs_confirmation: false, manifesto: { numero: null, exists: false } }

import { CeMercanteImportModal } from '../CeMercanteImportModal'

afterEach(() => {
  cleanup()
  mocks.preview.mockReset()
  mocks.emit.mockReset()
})

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
  expect((screen.getByRole('button', { name: /^Importar/ }) as HTMLButtonElement).disabled).toBe(true)
})

it('invalida caches e avisa que nada foi gravado na planilha de Granito com pendência', async () => {
  mocks.parse.mockResolvedValue({
    rows: [{ rowNumber: 2, bl_id: 'GR1', ce_mercante: '122605051526081' }],
    rowErrors: [],
  })
  mocks.importRows.mockResolvedValue({
    processed: 1,
    updated: 0,
    overwritten: 0,
    unchanged: 0,
    errorCount: 1,
    errors: [{ row: 2, bl_id: 'GR1', message: 'B/L GR1 nao encontrado no manifesto de granito.' }],
  })
  const { container } = render(<CeMercanteImportModal open target="granite" onClose={vi.fn()} />)
  // Granito não pede Nº de Manifesto Mercante.
  expect(screen.queryByLabelText(/Nº de Manifesto Mercante/i)).toBeNull()
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'ce.xlsx')] },
  })
  await waitFor(() =>
    expect((screen.getByRole('button', { name: /^Importar/ }) as HTMLButtonElement).disabled).toBe(false),
  )
  fireEvent.click(screen.getByRole('button', { name: /^Importar/ }))
  await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalled())
  expect(mocks.showToast).toHaveBeenCalledWith('Nada foi gravado: 1 erro(s). Corrija a planilha e envie de novo.', 'error')
})

it('exige o Nº de Manifesto Mercante antes de importar CE de B/L e aceita só planilha', async () => {
  mocks.parse.mockResolvedValue({ rows: [{ rowNumber: 2, bl_id: 'BL001', ce_mercante: '122605051526081' }], rowErrors: [] })
  const { container } = render(<CeMercanteImportModal open onClose={vi.fn()} />)

  expect((container.querySelector('input[type="file"]') as HTMLInputElement).accept).toBe('.xlsx,.xls,.csv')
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'ce.xlsx')] },
  })
  await waitFor(() => expect(screen.getByText('Informe o Nº de Manifesto Mercante para importar.')).toBeTruthy())
  expect((screen.getByRole('button', { name: /^Importar/ }) as HTMLButtonElement).disabled).toBe(true)

  fireEvent.change(screen.getByLabelText(/Nº de Manifesto Mercante/i), { target: { value: '1226501860578' } })
  expect((screen.getByRole('button', { name: /^Importar/ }) as HTMLButtonElement).disabled).toBe(false)
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
  mocks.preview.mockResolvedValue(cleanPreview)

  const { container } = render(<CeMercanteImportModal open onClose={vi.fn()} />)
  fireEvent.change(screen.getByPlaceholderText('Ex.: 1226501860578'), { target: { value: ' 1226501860578 ' } })
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'ce.xlsx')] },
  })

  await waitFor(() =>
    expect((screen.getByRole('button', { name: /^Importar/ }) as HTMLButtonElement).disabled).toBe(false),
  )
  fireEvent.click(screen.getByRole('button', { name: /^Importar/ }))

  await waitFor(() => expect(mocks.importRows).toHaveBeenCalledWith([row], expect.objectContaining({
    manifestoNumero: '1226501860578',
    deferBilling: true,
    confirmChanges: false,
  })))
})

it('bloqueia a planilha quando a prévia tem qualquer erro, mesmo com linhas válidas (tudo ou nada)', async () => {
  mocks.importRows.mockClear()
  const good = { rowNumber: 2, bl_id: 'BL-OK', ce_mercante: '122605051526081' }
  mocks.parse.mockResolvedValue({ rows: [good], rowErrors: [{ row: 3, message: 'CE com dígitos a menos' }] })
  const { container } = render(<CeMercanteImportModal open onClose={vi.fn()} />)

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'ce.xlsx')] },
  })

  await waitFor(() => expect(mocks.parse).toHaveBeenCalled())
  const confirm = await screen.findByRole('button', { name: /^Importar/ }) as HTMLButtonElement
  await waitFor(() => expect(confirm.disabled).toBe(true))
  fireEvent.click(confirm)
  expect(mocks.importRows).not.toHaveBeenCalled()
})

it('troca de CE pedida pela prévia do servidor só grava com confirmação e motivo', async () => {
  mocks.importRows.mockClear()
  const row = { rowNumber: 2, bl_id: 'BL001', ce_mercante: '122605051526081' }
  mocks.parse.mockResolvedValue({ rows: [row], rowErrors: [] })
  mocks.preview.mockResolvedValue({
    ...cleanPreview,
    changes: 1,
    needs_confirmation: true,
    rows: [{ row: 2, bl_id: 'BL001', status: 'change', current_ce: '122605051526080', new_ce: '122605051526081', target_manifesto: '1226501860578' }],
  })
  mocks.importRows.mockResolvedValue({ processed: 1, updated: 1, overwritten: 1, unchanged: 0, errorCount: 0, errors: [], billingPendingBlIds: [] })

  const { container } = render(<CeMercanteImportModal open onClose={vi.fn()} />)
  fireEvent.change(screen.getByPlaceholderText('Ex.: 1226501860578'), { target: { value: '1226501860578' } })
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['x'], 'ce.xlsx')] } })
  await waitFor(() => expect((screen.getByRole('button', { name: /^Importar/ }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: /^Importar/ }))

  await screen.findByText('122605051526080 → 122605051526081')
  expect(mocks.importRows).not.toHaveBeenCalled()
  const importar = screen.getByRole('button', { name: /^Importar/ }) as HTMLButtonElement
  expect(importar.disabled).toBe(true)

  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'CE retificado no Mercante' } })
  await waitFor(() => expect(importar.disabled).toBe(false))
  fireEvent.click(importar)
  await waitFor(() => expect(mocks.importRows).toHaveBeenCalledWith([row], expect.objectContaining({
    confirmChanges: true,
    reason: 'CE retificado no Mercante',
  })))
})

// Revisão da PR 929 (achado da revisão automática): a confirmação vale para a
// troca que o operador viu. Outra gravação mudou o CE do B/L depois da prévia:
// a tela mostra a troca nova e não grava com o motivo antigo.
it('troca confirmada que mudou depois da prévia não é gravada com o motivo antigo', async () => {
  mocks.importRows.mockReset()
  const row = { rowNumber: 2, bl_id: 'BL001', ce_mercante: '122605051526081' }
  const changeFrom = (current: string) => ({
    ...cleanPreview,
    changes: 1,
    needs_confirmation: true,
    rows: [{ row: 2, bl_id: 'BL001', status: 'change', current_ce: current, new_ce: '122605051526081', target_manifesto: '1226501860578' }],
  })
  mocks.parse.mockResolvedValue({ rows: [row], rowErrors: [] })
  mocks.preview.mockResolvedValueOnce(changeFrom('122605051526080')).mockResolvedValue(changeFrom('122605051526099'))

  const { container } = render(<CeMercanteImportModal open onClose={vi.fn()} />)
  fireEvent.change(screen.getByPlaceholderText('Ex.: 1226501860578'), { target: { value: '1226501860578' } })
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['x'], 'ce.xlsx')] } })
  await waitFor(() => expect((screen.getByRole('button', { name: /^Importar/ }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: /^Importar/ }))
  await screen.findByText('122605051526080 → 122605051526081')

  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'CE retificado no Mercante' } })
  const importar = screen.getByRole('button', { name: /^Importar/ }) as HTMLButtonElement
  await waitFor(() => expect(importar.disabled).toBe(false))
  fireEvent.click(importar)

  await screen.findByText('122605051526099 → 122605051526081')
  expect(mocks.importRows).not.toHaveBeenCalled()
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
})

it('emite em lotes depois de gravar e oferece Retomar quando um lote falha', async () => {
  const row = { rowNumber: 2, bl_id: 'BL001', ce_mercante: '122605051526081' }
  mocks.parse.mockResolvedValue({ rows: [row], rowErrors: [] })
  mocks.preview.mockResolvedValue(cleanPreview)
  mocks.importRows.mockResolvedValue({ processed: 1, updated: 1, overwritten: 0, unchanged: 0, errorCount: 0, errors: [], billingPendingBlIds: ['BL001'] })
  mocks.emit
    .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: '57014', done: [] }))
    .mockResolvedValueOnce([{ bl_id: 'BL001', status: 'invoiced', invoice_number: 'F-1' }])

  const { container } = render(<CeMercanteImportModal open onClose={vi.fn()} />)
  fireEvent.change(screen.getByPlaceholderText('Ex.: 1226501860578'), { target: { value: '1226501860578' } })
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['x'], 'ce.xlsx')] } })
  await waitFor(() => expect((screen.getByRole('button', { name: /^Importar/ }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: /^Importar/ }))

  await screen.findByRole('button', { name: 'Retomar emissão' })
  expect(screen.getByText(/A consulta demorou demais/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Retomar emissão' }))
  await waitFor(() => expect(mocks.emit).toHaveBeenLastCalledWith(['BL001'], expect.any(Function)))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retomar emissão' })).toBeNull())
})

it('erro do lote sem linha não aparece como "Linha 0"', async () => {
  const row = { rowNumber: 2, bl_id: 'BL001', ce_mercante: '122605051526081' }
  mocks.parse.mockResolvedValue({ rows: [row], rowErrors: [] })
  mocks.preview.mockResolvedValue({ ...cleanPreview, errors: [{ message: 'Os B/Ls da planilha não pertencem à viagem selecionada.' }] })
  const { container } = render(<CeMercanteImportModal open onClose={vi.fn()} />)
  fireEvent.change(screen.getByPlaceholderText('Ex.: 1226501860578'), { target: { value: '1226501860578' } })
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['x'], 'ce.xlsx')] } })
  await waitFor(() => expect((screen.getByRole('button', { name: /^Importar/ }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: /^Importar/ }))
  await screen.findByText('Os B/Ls da planilha não pertencem à viagem selecionada.')
  expect(screen.queryByText(/Linha 0/)).toBeNull()
})

it('a gravação que volta pedindo confirmação refaz a prévia e mostra a troca a confirmar (migration 195, K9)', async () => {
  mocks.importRows.mockReset()
  const row = { rowNumber: 2, bl_id: 'BL001', ce_mercante: '122605051526081' }
  mocks.parse.mockResolvedValue({ rows: [row], rowErrors: [] })
  // Prévia limpa; entre a prévia e a gravação outra planilha gravou outro CE.
  mocks.preview
    .mockResolvedValueOnce(cleanPreview)
    .mockResolvedValue({
      ...cleanPreview,
      changes: 1,
      needs_confirmation: true,
      rows: [{ row: 2, bl_id: 'BL001', status: 'change', current_ce: '122605051526080', new_ce: '122605051526081', target_manifesto: '1226501860578' }],
    })
  mocks.importRows
    .mockResolvedValueOnce({
      processed: 1, updated: 0, overwritten: 0, unchanged: 0, errorCount: 1, needsConfirmation: true,
      errors: [{ row: 0, message: 'A planilha troca o CE de 1 B/L(s) e muda o Manifesto de 0 B/L(s): confirme na prévia, com motivo.' }],
    })
    .mockResolvedValueOnce({ processed: 1, updated: 1, overwritten: 1, unchanged: 0, errorCount: 0, errors: [], billingPendingBlIds: [] })

  const { container } = render(<CeMercanteImportModal open onClose={vi.fn()} />)
  fireEvent.change(screen.getByPlaceholderText('Ex.: 1226501860578'), { target: { value: '1226501860578' } })
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['x'], 'ce.xlsx')] } })
  await waitFor(() => expect((screen.getByRole('button', { name: /^Importar/ }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: /^Importar/ }))

  // A prévia atualizada mostra a troca e a confirmação com motivo.
  await screen.findByText('122605051526080 → 122605051526081')
  expect(mocks.preview).toHaveBeenCalledTimes(2)
  expect(screen.queryByText(/Nada foi gravado: 1 erro/)).toBeNull()
  const importar = screen.getByRole('button', { name: /^Importar/ }) as HTMLButtonElement
  expect(importar.disabled).toBe(true)

  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'CE retificado no Mercante' } })
  await waitFor(() => expect(importar.disabled).toBe(false))
  fireEvent.click(importar)
  await waitFor(() => expect(mocks.importRows).toHaveBeenLastCalledWith([row], expect.objectContaining({
    confirmChanges: true,
    reason: 'CE retificado no Mercante',
  })))
})

it('emissão: espera de negócio aparece em "Aguardando" com a frase; sem mensagem, a tela não mostra o código cru (K1)', async () => {
  const row = { rowNumber: 2, bl_id: 'BL001', ce_mercante: '122605051526081' }
  mocks.parse.mockResolvedValue({ rows: [row], rowErrors: [] })
  mocks.preview.mockResolvedValue(cleanPreview)
  mocks.importRows.mockResolvedValue({ processed: 2, updated: 2, overwritten: 0, unchanged: 0, errorCount: 0, errors: [], billingPendingBlIds: ['BL001', 'BL002', 'BL003'] })
  mocks.emit.mockResolvedValue([
    { bl_id: 'BL001', status: 'blocked', reason: 'customer_reconciliation_pending', waiting: true, message: 'Aguardando conciliação do Cliente: a fatura sai quando o Cliente do B/L for conciliado.' },
    { bl_id: 'BL002', status: 'blocked', reason: 'review_pending', waiting: true, message: null },
    { bl_id: 'BL003', status: 'blocked', reason: 'auto_billing_failed', message: 'Tabela de cobranca incompleta.' },
  ])

  const { container } = render(<CeMercanteImportModal open onClose={vi.fn()} />)
  fireEvent.change(screen.getByPlaceholderText('Ex.: 1226501860578'), { target: { value: '1226501860578' } })
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['x'], 'ce.xlsx')] } })
  await waitFor(() => expect((screen.getByRole('button', { name: /^Importar/ }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: /^Importar/ }))

  await screen.findByText('BL001: Aguardando conciliação do Cliente: a fatura sai quando o Cliente do B/L for conciliado.')
  expect(screen.getByText('BL002: Aguardando Revisão do B/L.')).toBeTruthy()
  expect(screen.getByText('BL003: Tabela de cobranca incompleta.')).toBeTruthy()
  expect(screen.queryByText(/customer_reconciliation_pending|review_pending/)).toBeNull()
})

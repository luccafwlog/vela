// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(() => Promise.resolve()),
  showToast: vi.fn(),
  parseBLFile: vi.fn(),
  previewBlFreightImport: vi.fn(),
  confirmBlFreightImport: vi.fn(() => Promise.resolve({
    result: { imported: 1 },
    refusedCustomerRelinks: [] as Array<{ blNumber: string; blockers: string[] }>,
  })),
  applyLadenOnBoardAtd: vi.fn(() => Promise.resolve()),
  afterManifestoImportado: vi.fn(() => Promise.resolve()),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../../services/blParser', () => ({ parseBLFile: mocks.parseBLFile }))
vi.mock('../../../services/blFreightImport', () => ({
  previewBlFreightImport: mocks.previewBlFreightImport,
  confirmBlFreightImport: mocks.confirmBlFreightImport,
}))
vi.mock('../../../services/ladenOnBoardAtd', () => ({
  applyLadenOnBoardAtd: mocks.applyLadenOnBoardAtd,
}))
vi.mock('../../../services/cacheEffects', () => ({
  afterManifestoImportado: mocks.afterManifestoImportado,
}))
vi.mock('../VoyageCombobox', () => ({
  VoyageCombobox: ({
    initialValue,
    onSelect,
  }: {
    initialValue?: string
    onSelect: (voyageId: number | null) => void
  }) => (
    <div>
      <span data-testid="voyage-initial">{initialValue ?? ''}</span>
      <button type="button" onClick={() => onSelect(7)}>Escolher viagem</button>
      <button type="button" onClick={() => onSelect(null)}>Limpar viagem</button>
    </div>
  ),
}))

import { BlImportModal } from '../BlImportModal'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.invalidateQueries.mockResolvedValue(undefined)
  mocks.confirmBlFreightImport.mockResolvedValue({ result: { imported: 1 }, refusedCustomerRelinks: [] })
  mocks.applyLadenOnBoardAtd.mockResolvedValue(undefined)
  mocks.afterManifestoImportado.mockResolvedValue(undefined)
})
afterEach(cleanup)

function renderModal(props: Partial<React.ComponentProps<typeof BlImportModal>> = {}) {
  const onClose = vi.fn()
  const view = render(
    <BlImportModal
      open
      onClose={onClose}
      {...props}
    />,
  )
  return { ...view, onClose }
}

function parsedDoc(blNumber: string) {
  return {
    blNumber,
    parties: {
      shipperBlock: 'SHIPPER',
      consigneeBlock: 'CONSIGNEE',
      consigneeTaxId: '12345678000199',
      notifyBlock: '',
      alsoNotifyBlock: '',
    },
    route: {
      receipt: '',
      pol: 'CNSHA',
      pod: 'BRSSZ',
      delivery: '',
      vessel: 'GREEN',
      voyage: '14N',
      movementFrom: '',
      movementTo: '',
    },
    dates: { ladenOnBoard: '', issueDate: '', issuePlace: '' },
    containers: [],
    vehicles: [],
    freightCharges: [],
  }
}

const previewWithDiff = {
  rows: [
    {
      blNumber: 'COSU123',
      status: 'new',
      existing: false,
      voyageId: 7,
      voyageNumber: '14N',
      pol: 'CNSHA',
      pod: 'BRSSZ',
      ladenOnBoard: '2026-02-19',
      consigneeDocumentMatches: null,
      blockedReasons: [],
      billingImpacts: [],
      requiresBillingOverride: false,
      diffs: [],
      payload: { id: 'COSU123' },
    },
    {
      blNumber: 'COSU456',
      status: 'updated',
      existing: true,
      voyageId: 7,
      voyageNumber: '14N',
      pol: 'CNSHA',
      pod: 'BRSSZ',
      ladenOnBoard: '2026-02-20',
      consigneeDocumentMatches: true,
      blockedReasons: [],
      billingImpacts: [],
      requiresBillingOverride: false,
      diffs: [{ field: 'bl_freight_lines', label: 'Frete e despesas', from: 'USD 10', to: 'USD 12', billingImpact: false }],
      payload: { id: 'COSU456' },
    },
  ],
  summary: {
    total: 2,
    newCount: 1,
    updatedCount: 1,
    unchangedCount: 0,
    blockedCount: 0,
    billingOverrideCount: 0,
  },
}

it('mostra preview consolidado e tabela de diferencas depois do upload', async () => {
  mocks.parseBLFile
    .mockResolvedValueOnce(parsedDoc('COSU123'))
    .mockResolvedValueOnce(parsedDoc('COSU456'))
  mocks.previewBlFreightImport.mockResolvedValue(previewWithDiff)

  const { container } = renderModal({ voyageId: 7, voyageLabel: 'GREEN / 14N' })

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: {
      files: [
        new File(['a'], 'bl-1.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        new File(['b'], 'bl-2.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      ],
    },
  })

  await waitFor(() => expect(mocks.previewBlFreightImport).toHaveBeenCalledWith({
    documents: [expect.objectContaining({ blNumber: 'COSU123' }), expect.objectContaining({ blNumber: 'COSU456' })],
    voyageId: 7,
    onlyBlId: null,
  }))

  expect(screen.getByText('GREEN / 14N')).toBeTruthy()
  expect(screen.getByText('COSU123')).toBeTruthy()
  expect(screen.getByText('COSU456')).toBeTruthy()
  expect(screen.getByText('2026-02-19')).toBeTruthy()
  expect(screen.getByText('2026-02-20')).toBeTruthy()
  expect(screen.getByText('Frete e despesas')).toBeTruthy()
  expect(screen.getByText('USD 10')).toBeTruthy()
  expect(screen.getByText('USD 12')).toBeTruthy()
})

it('bloqueia confirmacao quando todos os B/Ls estao bloqueados', async () => {
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU999'))
  mocks.previewBlFreightImport.mockResolvedValue({
    rows: [{
      blNumber: 'COSU999',
      status: 'blocked',
      existing: true,
      voyageId: null,
      voyageNumber: null,
      pol: null,
      pod: null,
      ladenOnBoard: null,
      consigneeDocumentMatches: null,
      blockedReasons: ['Viagem nao encontrada para criar o B/L.'],
      billingImpacts: [],
      requiresBillingOverride: false,
      diffs: [],
      payload: null,
    }],
    summary: { total: 1, newCount: 0, updatedCount: 0, unchangedCount: 0, blockedCount: 1, billingOverrideCount: 0 },
  })

  const { container } = renderModal({ voyageId: 7, voyageLabel: 'GREEN / 14N' })

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'blocked.xlsx')] },
  })

  await screen.findByText('Viagem nao encontrada para criar o B/L.')

  expect((screen.getByRole('button', { name: /Confirmar importacao/ }) as HTMLButtonElement).disabled).toBe(true)
})

it('mantem confirmacao e preview travados enquanto nenhuma viagem foi escolhida', async () => {
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU123'))

  const { container } = renderModal()

  expect((screen.getByRole('button', { name: /Confirmar importacao/ }) as HTMLButtonElement).disabled).toBe(true)

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'bl.xlsx')] },
  })

  await waitFor(() => expect(mocks.previewBlFreightImport).not.toHaveBeenCalled())
  expect(mocks.showToast).toHaveBeenCalledWith('Selecione a viagem antes de carregar o preview do B/L.', 'error')
})

it('usa o voyageId escolhido pelo operador ao preparar o preview', async () => {
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU123'))
  mocks.previewBlFreightImport.mockResolvedValue(previewWithDiff)
  const { container } = renderModal()

  fireEvent.click(screen.getByRole('button', { name: 'Escolher viagem' }))
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'bl.xlsx')] },
  })

  await waitFor(() => expect(mocks.previewBlFreightImport).toHaveBeenCalledWith({
    documents: [expect.objectContaining({ blNumber: 'COSU123' })],
    voyageId: 7,
    onlyBlId: null,
  }))
})

it('confirma importacao, usa o efeito central de manifesto e fecha modal', async () => {
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU123'))
  mocks.previewBlFreightImport.mockResolvedValue(previewWithDiff)
  const { container, onClose } = renderModal({ voyageId: 7, voyageLabel: 'GREEN / 14N', onlyBlId: 'COSU123' })

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'bl.xlsx')] },
  })

  const confirm = await screen.findByRole('button', { name: /Confirmar importacao/ })
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(confirm)

  await waitFor(() => expect(mocks.confirmBlFreightImport).toHaveBeenCalledWith(previewWithDiff, 'user-1', false, 'bl.xlsx', false))
  expect(mocks.applyLadenOnBoardAtd).toHaveBeenCalledWith({ rows: previewWithDiff.rows, changedBy: 'user-1' })
  expect(mocks.afterManifestoImportado).toHaveBeenCalledWith(expect.anything(), { voyageId: 7 })
  expect(mocks.invalidateQueries).not.toHaveBeenCalled()
  expect(mocks.showToast).toHaveBeenCalledWith('Importacao de B/L concluida: 2 B/L(s), 0 bloqueado(s).', 'success')
  expect(onClose).toHaveBeenCalled()
})

it('avisa sobre falha do ATD sem mascarar importacao ja concluida', async () => {
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU123'))
  mocks.previewBlFreightImport.mockResolvedValue(previewWithDiff)
  mocks.applyLadenOnBoardAtd.mockRejectedValueOnce(new Error('RLS bloqueou ATD'))
  const { container, onClose } = renderModal({ voyageId: 7, voyageLabel: 'GREEN / 14N' })

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'bl.xlsx')] },
  })

  const confirm = await screen.findByRole('button', { name: /Confirmar importacao/ })
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(confirm)

  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(mocks.showToast).toHaveBeenCalledWith(
    'B/Ls importados; ATD do POL não pôde ser atualizado — edite manualmente.',
    'info',
  )
  expect(mocks.afterManifestoImportado).toHaveBeenCalledWith(expect.anything(), { voyageId: 7 })
  expect(mocks.showToast).toHaveBeenCalledWith('Importacao de B/L concluida: 2 B/L(s), 0 bloqueado(s).', 'success')
})

it('exibe impacto de faturamento e envia override quando o operador marca', async () => {
  const previewWithBillingImpact = {
    rows: [{
      blNumber: 'COSU777',
      status: 'updated',
      existing: true,
      voyageId: 7,
      ladenOnBoard: '2026-02-19',
      consigneeDocumentMatches: true,
      blockedReasons: [],
      billingImpacts: ['Quantidade de containers: 1 -> 2'],
      requiresBillingOverride: true,
      diffs: [{ field: 'containers', label: 'Containers', from: 'a', to: 'b', billingImpact: true }],
      payload: { id: 'COSU777' },
    }],
    summary: { total: 1, newCount: 0, updatedCount: 1, unchangedCount: 0, blockedCount: 0, billingOverrideCount: 1 },
  }
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU777'))
  mocks.previewBlFreightImport.mockResolvedValue(previewWithBillingImpact)
  const { container } = renderModal({ voyageId: 7, voyageLabel: 'GREEN / 14N' })

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'bl.xlsx')] },
  })

  await screen.findByText('Faturamento: Quantidade de containers: 1 -> 2')
  const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement
  expect(checkbox).toBeTruthy()
  fireEvent.click(checkbox)

  const confirm = await screen.findByRole('button', { name: /Confirmar importacao/ })
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(confirm)

  await waitFor(() => expect(mocks.confirmBlFreightImport).toHaveBeenCalledWith(previewWithBillingImpact, 'user-1', true, 'bl.xlsx', false))
})

/** Preview com troca de consignatario, compartilhado pelos testes de confirmacao. */
const previewWithCustomerChange = {
    rows: [{
      blNumber: 'COSU888',
      status: 'updated',
      existing: true,
      voyageId: 7,
      ladenOnBoard: '2026-02-19',
      consigneeDocumentMatches: false,
      blockedReasons: [],
      billingImpacts: [],
      requiresBillingOverride: false,
      customerChange: {
        fromCustomerId: 42,
        fromCustomerName: 'IMPORTADOR LTDA',
        fromDocument: '12345678000195',
        toCustomerId: 43,
        toCustomerName: 'NOVO IMPORTADOR LTDA',
        toDocument: '98765432000110',
        targetMissing: false,
        invoices: [{ invoiceNumber: 'INV-001', kind: 'local', status: 'issued', totalBrl: 1500, blockedReason: null }],
        blockedReasons: [],
        messages: [
          'Cliente do B/L: IMPORTADOR LTDA -> NOVO IMPORTADOR LTDA',
          'Fatura(s) que acompanham o novo cliente, com o mesmo valor: INV-001',
        ],
      },
      requiresCustomerConfirmation: true,
      diffs: [{ field: 'consignee', label: 'Consignatario', from: 'IMPORTADOR LTDA', to: 'NOVO IMPORTADOR LTDA', billingImpact: false }],
      payload: { id: 'COSU888' },
    }],
    summary: { total: 1, newCount: 0, updatedCount: 1, unchangedCount: 0, blockedCount: 0, billingOverrideCount: 0, customerChangeCount: 1 },
  }

it('alerta a troca de consignatario e so envia o revinculo quando o operador aceita', async () => {
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU888'))
  mocks.previewBlFreightImport.mockResolvedValue(previewWithCustomerChange)
  const { container } = renderModal({ voyageId: 7, voyageLabel: 'GREEN / 14N' })

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'bl.xlsx')] },
  })

  await screen.findByText('Cliente do B/L: IMPORTADOR LTDA -> NOVO IMPORTADOR LTDA')
  expect(screen.getByText('Fatura(s) que acompanham o novo cliente, com o mesmo valor: INV-001')).toBeTruthy()

  const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement
  fireEvent.click(checkbox)

  const confirm = await screen.findByRole('button', { name: /Confirmar importacao/ })
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(confirm)

  await waitFor(() => expect(mocks.confirmBlFreightImport).toHaveBeenCalledWith(previewWithCustomerChange, 'user-1', false, 'bl.xlsx', true))
})

it('nao diz "concluida" quando o servidor recusa a troca de cliente', async () => {
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU888'))
  mocks.previewBlFreightImport.mockResolvedValue(previewWithCustomerChange)
  mocks.confirmBlFreightImport.mockResolvedValue({
    result: { imported: 1 },
    refusedCustomerRelinks: [{ blNumber: 'COSU888', blockers: ['Fatura INV-001 ja tem pagamento registrado.'] }],
  })
  const { container } = renderModal({ voyageId: 7, voyageLabel: 'GREEN / 14N' })

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'bl.xlsx')] },
  })

  await screen.findByText('Cliente do B/L: IMPORTADOR LTDA -> NOVO IMPORTADOR LTDA')
  fireEvent.click(container.querySelector('input[type="checkbox"]') as HTMLInputElement)

  const confirm = await screen.findByRole('button', { name: /Confirmar importacao/ })
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(confirm)

  await waitFor(() =>
    expect(mocks.showToast).toHaveBeenCalledWith(
      expect.stringContaining('troca de cliente foi recusada em 1 B/L(s): COSU888 (Fatura INV-001 ja tem pagamento registrado.)'),
      'error',
    ),
  )
  expect(mocks.showToast).not.toHaveBeenCalledWith(expect.stringContaining('Importacao de B/L concluida'), 'success')
})

it('mostra o impedimento quando a fatura nao pode acompanhar a troca de cliente', async () => {
  const previewBlockedChange = {
    rows: [{
      blNumber: 'COSU999',
      status: 'updated',
      existing: true,
      voyageId: 7,
      ladenOnBoard: '2026-02-19',
      consigneeDocumentMatches: false,
      blockedReasons: [],
      billingImpacts: [],
      requiresBillingOverride: false,
      customerChange: {
        fromCustomerId: 42,
        fromCustomerName: 'IMPORTADOR LTDA',
        fromDocument: '12345678000195',
        toCustomerId: null,
        toCustomerName: 'NOVO IMPORTADOR LTDA',
        toDocument: '98765432000110',
        targetMissing: true,
        invoices: [],
        blockedReasons: ['Cliente do novo consignatario nao esta cadastrado; cadastre-o antes de reimportar para a fatura acompanhar.'],
        messages: ['Cliente do B/L: IMPORTADOR LTDA -> NOVO IMPORTADOR LTDA'],
      },
      requiresCustomerConfirmation: false,
      diffs: [],
      payload: { id: 'COSU999' },
    }],
    summary: { total: 1, newCount: 0, updatedCount: 1, unchangedCount: 0, blockedCount: 0, billingOverrideCount: 0, customerChangeCount: 0 },
  }
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU999'))
  mocks.previewBlFreightImport.mockResolvedValue(previewBlockedChange)
  const { container } = renderModal({ voyageId: 7, voyageLabel: 'GREEN / 14N' })

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'bl.xlsx')] },
  })

  await screen.findByText(/Impedimento: Cliente do novo consignatario nao esta cadastrado/)
  // sem troca aplicavel nao ha caixa de aceite; os demais campos seguem importando
  expect(container.querySelector('input[type="checkbox"]')).toBeNull()
})

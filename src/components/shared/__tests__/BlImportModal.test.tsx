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
    calculationErrors: [] as Array<{ blNumber: string; message: string }>,
  })),
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
  BlFreightImportRefused: class BlFreightImportRefused extends Error {
    readonly refused: string[]
    constructor(message: string, refused: string[] = []) {
      super(message)
      this.refused = refused
    }
  },
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
  mocks.confirmBlFreightImport.mockResolvedValue({ result: { imported: 1 }, refusedCustomerRelinks: [], calculationErrors: [] })
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

  expect((screen.getByRole('button', { name: /^Importar/ }) as HTMLButtonElement).disabled).toBe(true)
})

it('mantem confirmacao e preview travados enquanto nenhuma viagem foi escolhida', async () => {
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU123'))

  const { container } = renderModal()

  expect((screen.getByRole('button', { name: /^Importar/ }) as HTMLButtonElement).disabled).toBe(true)

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'bl.xlsx')] },
  })

  await waitFor(() => expect(mocks.previewBlFreightImport).not.toHaveBeenCalled())
  // Sem viagem o seletor fica desativado e diz por quê, em vez de aceitar o
  // arquivo e reclamar depois num toast.
  expect((container.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(true)
  expect(screen.getByText(/Escolha a viagem de destino: a prévia compara/)).toBeTruthy()
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

  const confirm = await screen.findByRole('button', { name: /^Importar/ })
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(confirm)

  await waitFor(() => expect(mocks.confirmBlFreightImport).toHaveBeenCalledWith(previewWithDiff, 'user-1', new Set(), 'bl.xlsx', false, new Set(), expect.stringMatching(/^[0-9a-f]{64}$/)))

  expect(mocks.afterManifestoImportado).toHaveBeenCalledWith(expect.anything(), { voyageId: 7 })
  expect(mocks.invalidateQueries).not.toHaveBeenCalled()
  expect(mocks.showToast).toHaveBeenCalledWith('Importação de B/L concluída: 2 B/Ls gravados.', 'success')
  expect(onClose).toHaveBeenCalled()
})

it('confia na transação do servidor para persistir ATD junto com o import', async () => {
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU123'))
  mocks.previewBlFreightImport.mockResolvedValue(previewWithDiff)

  const { container, onClose } = renderModal({ voyageId: 7, voyageLabel: 'GREEN / 14N' })

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'bl.xlsx')] },
  })

  const confirm = await screen.findByRole('button', { name: /^Importar/ })
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(confirm)

  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(mocks.showToast).not.toHaveBeenCalledWith(expect.stringContaining('ATD do POL não pôde ser atualizado'), 'info')
  expect(mocks.afterManifestoImportado).toHaveBeenCalledWith(expect.anything(), { voyageId: 7 })
  expect(mocks.showToast).toHaveBeenCalledWith('Importação de B/L concluída: 2 B/Ls gravados.', 'success')
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

  await screen.findByText('Quantidade de containers: 1 -> 2')
  // A confirmação é por B/L (ADR 0078, item 17), no aceite do molde, fora da
  // tabela; com um B/L só não há o "marcar todos".
  const checkbox = screen.getByLabelText(/Confirmar o faturamento do B\/L COSU777/) as HTMLInputElement
  expect(checkbox.closest('.app-import-override')).toBeTruthy()
  expect(container.querySelector('table input[type="checkbox"]')).toBeNull()
  // Com dezenas de arquivos, a lista de nomes so poluia o modal.
  expect(screen.queryByText(/arquivo\(s\) selecionado\(s\)/)).toBeNull()
  fireEvent.click(checkbox)

  const confirm = await screen.findByRole('button', { name: /^Importar/ })
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(confirm)

  await waitFor(() => expect(mocks.confirmBlFreightImport).toHaveBeenCalledWith(previewWithBillingImpact, 'user-1', new Set(['COSU777']), 'bl.xlsx', false, new Set(), expect.stringMatching(/^[0-9a-f]{64}$/)))
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

  const confirm = await screen.findByRole('button', { name: /^Importar/ })
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(confirm)

  await waitFor(() => expect(mocks.confirmBlFreightImport).toHaveBeenCalledWith(previewWithCustomerChange, 'user-1', new Set(), 'bl.xlsx', true, new Set(), expect.stringMatching(/^[0-9a-f]{64}$/)))
})

it('nao diz "concluida" quando o servidor recusa a troca de cliente', async () => {
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU888'))
  mocks.previewBlFreightImport.mockResolvedValue(previewWithCustomerChange)
  mocks.confirmBlFreightImport.mockResolvedValue({
    result: { imported: 1 },
    refusedCustomerRelinks: [{ blNumber: 'COSU888', blockers: ['Fatura INV-001 ja tem pagamento registrado.'] }],
    calculationErrors: [],
  })
  const { container } = renderModal({ voyageId: 7, voyageLabel: 'GREEN / 14N' })

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'bl.xlsx')] },
  })

  await screen.findByText('Cliente do B/L: IMPORTADOR LTDA -> NOVO IMPORTADOR LTDA')
  fireEvent.click(container.querySelector('input[type="checkbox"]') as HTMLInputElement)

  const confirm = await screen.findByRole('button', { name: /^Importar/ })
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(confirm)

  await waitFor(() =>
    expect(mocks.showToast).toHaveBeenCalledWith(
      expect.stringContaining('troca de cliente foi recusada em 1 B/L: COSU888 (Fatura INV-001 ja tem pagamento registrado.)'),
      'error',
    ),
  )
  expect(mocks.showToast).not.toHaveBeenCalledWith(expect.stringContaining('Importação de B/L concluída'), 'success')
  // O resultado parcial fica no modal: o operador vê qual B/L manteve o cliente antigo.
  expect(screen.getByText(/A troca de cliente foi recusada; o B\/L continua com o cliente anterior/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Concluir' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /^Importar/ })).toBeNull()
})

it('informa B/Ls cujo calculo automatico falhou sem esconder a importacao', async () => {
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU777'))
  mocks.previewBlFreightImport.mockResolvedValue({
    ...previewWithDiff,
    rows: [{ ...previewWithDiff.rows[0], blNumber: 'COSU777', payload: { id: 'COSU777' } }],
    summary: { ...previewWithDiff.summary, total: 1, updatedCount: 0 },
  })
  mocks.confirmBlFreightImport.mockResolvedValue({
    result: { imported: 1 },
    refusedCustomerRelinks: [],
    calculationErrors: [{ blNumber: 'COSU777', message: 'Nenhuma tabela vigente.' }],
  })
  const { container } = renderModal({ voyageId: 7, voyageLabel: 'GREEN / 14N' })

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'bl.xlsx')] },
  })
  await screen.findByText('COSU777')
  const confirm = await screen.findByRole('button', { name: /^Importar/ })
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(confirm)

  await waitFor(() =>
    expect(mocks.showToast).toHaveBeenCalledWith(
      expect.stringContaining('1 B/L ficou sem cálculo automático: COSU777 (Nenhuma tabela vigente.)'),
      'error',
    ),
  )
  expect(mocks.showToast).not.toHaveBeenCalledWith(expect.stringContaining('Importação de B/L concluída'), 'success')
})

it('avisa no resultado quando a Troca de Consignatário não foi confirmada (migration 213)', async () => {
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU555'))
  mocks.previewBlFreightImport.mockResolvedValue({
    ...previewWithDiff,
    rows: [{ ...previewWithDiff.rows[0], blNumber: 'COSU555', payload: { id: 'COSU555' } }],
    summary: { ...previewWithDiff.summary, total: 1, updatedCount: 0 },
  })
  mocks.confirmBlFreightImport.mockResolvedValue(Object.assign(
    { result: { imported: 1 }, refusedCustomerRelinks: [], calculationErrors: [] },
    { customerChangesIgnored: ['COSU555'] },
  ))
  const { container } = renderModal({ voyageId: 7, voyageLabel: 'GREEN / 14N' })

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'bl.xlsx')] },
  })
  await screen.findByText('COSU555')
  const confirm = await screen.findByRole('button', { name: /^Importar/ })
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(confirm)

  expect(await screen.findByText(/Consignatário mantido em COSU555: a troca de cliente não foi confirmada/)).toBeTruthy()
  expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('consignatário mantido em COSU555'), 'error')
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
        blockedReasons: ['Cliente do novo consignatário não está cadastrado; cadastre-o antes de reimportar para a fatura acompanhar.'],
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

  await screen.findByText(/Impedimento: Cliente do novo consignatário não está cadastrado/)
  expect(container.querySelector('input[type="checkbox"]')).toBeNull()
})

// A7 (revisão da PR 929): o resultado por B/L aparece sempre que a gravação
// mexeu em contêineres ou veículos, não só quando há remoção ou pendência.
it('mostra o resultado por B/L quando a gravação muda contêineres, mesmo sem pendência', async () => {
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU123'))
  mocks.previewBlFreightImport.mockResolvedValue(previewWithDiff)
  const result = {
    result: { imported: 2 },
    refusedCustomerRelinks: [],
    calculationErrors: [],
    containerChanges: [{ blNumber: 'COSU456', inserted: ['TCLU1234567'], updated: [], removed: [] }],
    cancelledSkipped: [],
    pricesRefixed: [],
  }
  mocks.confirmBlFreightImport.mockResolvedValue(result)
  const { container, onClose } = renderModal({ voyageId: 7, voyageLabel: 'GREEN / 14N' })

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'bl.xlsx')] },
  })
  const confirm = await screen.findByRole('button', { name: /^Importar/ })
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(confirm)

  await screen.findByText('COSU456 — 1 container entrou')
  expect(screen.getAllByText('2 B/Ls gravados').length).toBeGreaterThan(0)
  expect(screen.queryByText(/com pendências/)).toBeNull()
  expect(mocks.showToast).toHaveBeenCalledWith('Importação gravada; confira o resultado por B/L.', 'success')
  expect(onClose).not.toHaveBeenCalled()
})

// ADR 0095, decisão 9: o preço de hoje aparece por B/L e só refixa com o aceite.
it('mostra preço do dia da importação → preço de hoje e envia o aceite por B/L', async () => {
  const snapshot = (roe: number, tables: string[]) => ({ referenceDate: '2026-10-01', roe, tables, conditionItems: 0, totalBrl: 100, totalUsd: null })
  const previewWithRefix = {
    rows: [{ ...previewWithDiff.rows[1], priceRefix: { before: snapshot(5.1, ['TABELA ANTIGA']), after: snapshot(5.4, ['TABELA NOVA']) } }],
    summary: { ...previewWithDiff.summary, total: 1, newCount: 0, priceRefixCount: 1 },
  }
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU456'))
  mocks.previewBlFreightImport.mockResolvedValue(previewWithRefix)
  const { container } = renderModal({ voyageId: 7, voyageLabel: 'GREEN / 14N' })

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'bl.xlsx')] },
  })

  await screen.findByText(/Preço do dia da importação \(2026-10-01\): TABELA ANTIGA; sem Condição; câmbio 5,1000, R\$ 100,00 → preço de hoje: TABELA NOVA/)
  fireEvent.click(screen.getByLabelText(/Passar o B\/L COSU456 ao preço de hoje/))
  const confirm = screen.getByRole('button', { name: /^Importar/ }) as HTMLButtonElement
  fireEvent.click(confirm)

  await waitFor(() => expect(mocks.confirmBlFreightImport).toHaveBeenCalledWith(previewWithRefix, 'user-1', new Set(), 'bl.xlsx', false, new Set(['COSU456']), expect.stringMatching(/^[0-9a-f]{64}$/)))
})

// ADR 0092: B/L com erro recusa o arquivo inteiro; os liberados não gravam sozinhos.
it('um B/L bloqueado impede os outros: erro no painel comum e Importar desligado', async () => {
  mocks.parseBLFile
    .mockResolvedValueOnce(parsedDoc('COSU123'))
    .mockResolvedValueOnce(parsedDoc('COSU999'))
  mocks.previewBlFreightImport.mockResolvedValue({
    rows: [
      previewWithDiff.rows[0],
      { ...previewWithDiff.rows[1], blNumber: 'COSU999', status: 'blocked', blockedReasons: ['Arquivo é da viagem X / 1, mas você apontou GREEN / 14N.'], diffs: [], payload: null },
    ],
    summary: { ...previewWithDiff.summary, updatedCount: 0, blockedCount: 1 },
  })
  const { container } = renderModal({ voyageId: 7, voyageLabel: 'GREEN / 14N' })

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['a'], 'bl-1.xlsx'), new File(['b'], 'bl-2.xlsx')] },
  })

  await screen.findByText('Arquivo é da viagem X / 1, mas você apontou GREEN / 14N.')
  expect(screen.getByText('1 erro impede a importação')).toBeTruthy()
  expect(container.querySelector('tbody .app-import-tone--danger')?.textContent).toBe('Erro')
  expect(screen.getByText(/Com erro no arquivo, nada é importado/)).toBeTruthy()
  const confirm = screen.getByRole('button', { name: /^Importar/ }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  expect(confirm.textContent).toMatch(/^Importar B\/Ls/)
  fireEvent.click(confirm)
  expect(mocks.confirmBlFreightImport).not.toHaveBeenCalled()
})

it('recusa na gravação diz que nada foi gravado e lista o que o banco recusou', async () => {
  const { BlFreightImportRefused } = await import('../../../services/blFreightImport')
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU123'))
  mocks.previewBlFreightImport.mockResolvedValue(previewWithDiff)
  mocks.confirmBlFreightImport.mockRejectedValue(new BlFreightImportRefused(
    'Nada foi gravado: o banco recusou veículos da aba VIN. Corrija o arquivo e escolha de novo.',
    ['COSU456 — VIN VIN1: Chassi ja esta no B/L COSU9'],
  ))
  const { container, onClose } = renderModal({ voyageId: 7, voyageLabel: 'GREEN / 14N' })

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'bl.xlsx')] },
  })
  const confirm = await screen.findByRole('button', { name: /^Importar/ })
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(confirm)

  expect(await screen.findByText(/^Nada foi gravado: o banco recusou veículos da aba VIN/)).toBeTruthy()
  expect(screen.getByText('COSU456 — VIN VIN1: Chassi ja esta no B/L COSU9')).toBeTruthy()
  expect(mocks.afterManifestoImportado).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})

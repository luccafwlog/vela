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

  await waitFor(() => expect(mocks.confirmBlFreightImport).toHaveBeenCalledWith(previewWithDiff, 'user-1', new Set(), 'bl.xlsx', false, false))

  expect(mocks.afterManifestoImportado).toHaveBeenCalledWith(expect.anything(), { voyageId: 7 })
  expect(mocks.invalidateQueries).not.toHaveBeenCalled()
  expect(mocks.showToast).toHaveBeenCalledWith('Importação de B/L concluída: 2 B/L(s), 0 bloqueado(s).', 'success')
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
  expect(mocks.showToast).toHaveBeenCalledWith('Importação de B/L concluída: 2 B/L(s), 0 bloqueado(s).', 'success')
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
  // A confirmação é por B/L, na linha da prévia (ADR 0078, item 17); o rodapé
  // fixo marca todos de uma vez.
  expect(screen.getByLabelText('Confirmar faturamento deste B/L')).toBeTruthy()
  const checkbox = container.querySelector('.app-modal__actions input[type="checkbox"]') as HTMLInputElement
  expect(checkbox).toBeTruthy()
  // Com dezenas de arquivos, a lista de nomes so poluia o modal.
  expect(screen.queryByText(/arquivo\(s\) selecionado\(s\)/)).toBeNull()
  fireEvent.click(checkbox)

  const confirm = await screen.findByRole('button', { name: /^Importar/ })
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(confirm)

  await waitFor(() => expect(mocks.confirmBlFreightImport).toHaveBeenCalledWith(previewWithBillingImpact, 'user-1', new Set(['COSU777']), 'bl.xlsx', false, false))
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

  await waitFor(() => expect(mocks.confirmBlFreightImport).toHaveBeenCalledWith(previewWithCustomerChange, 'user-1', new Set(), 'bl.xlsx', true, false))
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
      expect.stringContaining('troca de cliente foi recusada em 1 B/L(s): COSU888 (Fatura INV-001 ja tem pagamento registrado.)'),
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
      expect.stringContaining('1 B/L(s) ficaram sem cálculo automático: COSU777 (Nenhuma tabela vigente.)'),
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
    vehicleChanges: [],
    vehiclesDiscarded: [],
    vehicleChangesPending: [],
  }
  mocks.confirmBlFreightImport.mockResolvedValue(result)
  const { container, onClose } = renderModal({ voyageId: 7, voyageLabel: 'GREEN / 14N' })

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'bl.xlsx')] },
  })
  const confirm = await screen.findByRole('button', { name: /^Importar/ })
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(confirm)

  await screen.findByText('COSU456 — contêineres: 1 entrou(aram)')
  expect(screen.getByText('2 B/Ls gravados')).toBeTruthy()
  expect(screen.queryByText(/com pendências/)).toBeNull()
  expect(mocks.showToast).toHaveBeenCalledWith('Importação gravada; confira o resultado por B/L.', 'success')
  expect(onClose).not.toHaveBeenCalled()
})

// A1 (revisão da PR 929): container que sai levando os veículos só sai com a
// lista de veículos confirmada; sem ela a gravação recusaria o lote inteiro.
it('exige a confirmação de veículos quando um container sai do B/L levando os veículos', async () => {
  const previewWithVehicleExit = {
    rows: [{
      ...previewWithDiff.rows[1],
      removedContainers: ['MSKU7654321'],
      vehicleChanges: { added: [], removed: [], changed: ['CHASSI0000000001'] },
      requiresVehicleConfirmation: true,
      vehicleConfirmationRequiredFor: ['MSKU7654321'],
    }],
    summary: { ...previewWithDiff.summary, total: 1, newCount: 0, vehicleConfirmationCount: 1 },
  }
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU456'))
  mocks.previewBlFreightImport.mockResolvedValue(previewWithVehicleExit)
  const { container } = renderModal({ voyageId: 7, voyageLabel: 'GREEN / 14N' })

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'bl.xlsx')] },
  })

  await screen.findByText(/Obrigatória para importar: no B\/L COSU456, o container MSKU7654321 sai do B\/L levando os veículos/)
  expect(screen.queryByText(/o restante do B\/L é aplicado/)).toBeNull()
  const confirm = screen.getByRole('button', { name: /^Importar/ }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)

  fireEvent.click(screen.getByLabelText(/Confirmo a lista de veículos da aba VIN/))
  await waitFor(() => expect(confirm.disabled).toBe(false))
  fireEvent.click(confirm)

  await waitFor(() => expect(mocks.confirmBlFreightImport).toHaveBeenCalledWith(previewWithVehicleExit, 'user-1', new Set(), 'bl.xlsx', false, true))
})

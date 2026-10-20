// @vitest-environment jsdom
// Regra de 2026-10-19 (ADR 0092): um arquivo com erro recusa todos os do lote.
// D1: B/L cancelado é aviso — o arquivo dele não é tocado e os demais entram.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../ui/Toast'

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../../hooks/useBls', () => ({
  useVoyageOptions: () => ({ data: [{ id: 7, voyage_number: '001N', vessel: { name: 'NAVIO' } }] }),
}))
vi.mock('../VoyageCombobox', () => ({ VoyageCombobox: () => null }))

const parseBlDocumentFile = vi.fn()
vi.mock('../../../services/blDocumentParser', () => ({
  parseBlDocumentFile: (file: File) => parseBlDocumentFile(file),
  blDocumentToManifest: (document: { bl_id: string }) => ({ bls: [{ bl_id: document.bl_id }], rowErrors: [] }),
}))

const checkBreakbulkReimport = vi.fn()
vi.mock('../../../services/breakbulkImport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/breakbulkImport')>()),
  checkBreakbulkReimport: (voyageId: number, manifest: { bls: Array<{ bl_id: string }> }) => checkBreakbulkReimport(voyageId, manifest),
}))

const importBlDocuments = vi.fn()
vi.mock('../../../services/blDocumentImport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/blDocumentImport')>()),
  importBlDocuments: (args: unknown) => importBlDocuments(args),
}))

const { BlDocumentImportModal } = await import('../BlDocumentImportModal')

function document(blId: string, overrides: Record<string, unknown> = {}) {
  return {
    bl_id: blId, errors: [], warnings: [], vessel_name: 'NAVIO', voyage_number: '001N', pol: 'CNSHA', pod: 'BRSSA',
    shipper: null, consignee: null, notify_party: null, cnpj_cpf: null, marks: null, machine_qty: null,
    freight_terms: null, originals: null, ncm_codes: [], place_and_date_of_issue: null, packages_qty: null,
    gross_weight_kg: null, total_cbm: null, ...overrides,
  }
}

function renderModal() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <BlDocumentImportModal voyageId={7} voyageLabel="NAVIO 001N" onClose={vi.fn()} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

const noReimport = { existing: [], otherVoyage: [], cancelled: [], billedRouteChanges: [], codPodKept: [], customerChanges: [] }

beforeEach(() => {
  vi.clearAllMocks()
  checkBreakbulkReimport.mockResolvedValue(noReimport)
  importBlDocuments.mockResolvedValue({ batchId: 1, inserted: ['BLAAA001'], updated: [], unchanged: [], ceIgnored: [], cancelledIgnored: [], customerChangesIgnored: [], refusedCustomerRelinks: [], billingLocked: [], codPodKept: [], calculationErrors: [] })
})

it('um arquivo com erro recusa todos os do lote', async () => {
  parseBlDocumentFile.mockImplementation(async (file: File) => (
    file.name.startsWith('RUIM') ? document('', { errors: ['Número do B/L não encontrado.'] }) : document(file.name.replace(/\.pdf$/, ''))
  ))
  const { container } = renderModal()
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['a'], 'BLAAA001.pdf'), new File(['b'], 'RUIM.pdf')] },
  })

  const summary = await screen.findByLabelText('Resumo dos arquivos lidos')
  expect(summary.textContent).toBe('arquivos lidos2com erro1com aviso0')
  expect(screen.getByText('Com erro no arquivo, nada é importado. Corrija e escolha o arquivo de novo.')).toBeTruthy()
  const confirm = screen.getByRole('button', { name: 'Importar 2 B/Ls' }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  fireEvent.click(confirm)
  expect(importBlDocuments).not.toHaveBeenCalled()
})

// Como no Manifesto BB e no CE Mercante, o cancelado só informa: não pede o
// aceite "Conferi os avisos".
it('B/L cancelado é aviso sem aceite: os demais arquivos entram', async () => {
  parseBlDocumentFile.mockImplementation(async (file: File) => document(file.name.replace(/\.pdf$/, '')))
  checkBreakbulkReimport.mockImplementation(async (_voyageId: number, manifest: { bls: Array<{ bl_id: string }> }) => (
    manifest.bls[0].bl_id === 'BLCAN002' ? { ...noReimport, cancelled: ['BLCAN002'] } : noReimport
  ))
  const { container } = renderModal()
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['a'], 'BLAAA001.pdf'), new File(['b'], 'BLCAN002.pdf')] },
  })

  const summary = await screen.findByLabelText('Resumo dos arquivos lidos')
  expect(summary.textContent).toBe('arquivos lidos2com erro0com aviso1')
  expect(screen.queryByRole('checkbox', { name: /Conferi os avisos/ })).toBeNull()
  const confirm = screen.getByRole('button', { name: 'Importar 1 B/L' }) as HTMLButtonElement
  await waitFor(() => expect(confirm.disabled).toBe(false))
  fireEvent.click(confirm)
  await waitFor(() => expect(importBlDocuments).toHaveBeenCalledTimes(1))
  expect(importBlDocuments).toHaveBeenCalledWith(expect.objectContaining({ voyageId: 7, acceptWarnings: false }))
})

it('todos os B/Ls cancelados: Importar desativado com "Nenhum B/L a importar"', async () => {
  parseBlDocumentFile.mockImplementation(async (file: File) => document(file.name.replace(/\.pdf$/, '')))
  checkBreakbulkReimport.mockImplementation(async (_voyageId: number, manifest: { bls: Array<{ bl_id: string }> }) => (
    { ...noReimport, cancelled: [manifest.bls[0].bl_id] }
  ))
  const { container } = renderModal()
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['b'], 'BLCAN002.pdf')] },
  })

  expect(await screen.findByText('Nenhum B/L a importar.')).toBeTruthy()
  expect(screen.getByText('B/L cancelado: este arquivo não é tocado')).toBeTruthy()
  expect(screen.queryByText(/Com erro no arquivo/)).toBeNull()
  const confirm = screen.getByRole('button', { name: 'Importar B/Ls' }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  fireEvent.click(confirm)
  expect(importBlDocuments).not.toHaveBeenCalled()
})

it('oferece o B/L de exemplo em .docx para baixar', () => {
  renderModal()
  const link = screen.getByRole('link', { name: 'Baixar modelo .docx' })
  expect(link.getAttribute('href')).toBe('/templates/bl-avulso-exemplo.docx')
})

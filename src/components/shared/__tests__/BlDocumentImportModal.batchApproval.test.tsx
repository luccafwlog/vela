// @vitest-environment jsdom
// Revisão da PR 929: com vários PDFs/DOCX, o aceite de Troca de Consignatário e
// a confirmação de faturamento valem para o lote inteiro. A prévia tem de
// listar os B/Ls afetados de TODOS os arquivos, não só o do arquivo aberto —
// senão marcar o aceite olhando um arquivo autoriza a troca nos outros.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../ui/Toast'

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../../hooks/useBls', () => ({
  useVoyageOptions: () => ({ data: [{ id: 7, voyage_number: '001N', vessel_name: 'NAVIO' }] }),
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

const { BlDocumentImportModal } = await import('../BlDocumentImportModal')

function document(blId: string) {
  return {
    bl_id: blId, errors: [], warnings: [], vessel_name: 'NAVIO', voyage_number: '001N', pol: 'CNSHA', pod: 'BRSSA',
    shipper: null, consignee: null, notify_party: null, cnpj_cpf: null, marks: null, machine_qty: null,
    freight_terms: null, originals: null, ncm_codes: [], place_and_date_of_issue: null, packages_qty: null,
    gross_weight_kg: null, total_cbm: null,
  }
}

beforeEach(() => {
  parseBlDocumentFile.mockImplementation(async (file: File) => document(file.name.replace(/\.pdf$/, '')))
  checkBreakbulkReimport.mockImplementation(async (_voyageId: number, manifest: { bls: Array<{ bl_id: string }> }) => {
    const blId = manifest.bls[0].bl_id
    return {
      existing: [blId], otherVoyage: [], cancelled: [], billedRouteChanges: [], codPodKept: [],
      customerChanges: [{ blId, currentCustomer: 'CLIENTE ATUAL', fileCustomer: `CLIENTE DO ARQUIVO ${blId}` }],
    }
  })
})

it('lista a Troca de Consignatário de todos os arquivos do lote junto do aceite', async () => {
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <BlDocumentImportModal voyageId={7} voyageLabel="NAVIO 001N" onClose={vi.fn()} />
      </ToastProvider>
    </QueryClientProvider>,
  )

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['a'], 'BLAAA001.pdf'), new File(['b'], 'BLBBB002.pdf')] },
  })

  await waitFor(() => expect(screen.getByText('Confirmo a troca de Cliente em 2 B/Ls')).toBeTruthy())
  expect(screen.getByText(/CLIENTE DO ARQUIVO BLAAA001/)).toBeTruthy()
  expect(screen.getByText(/CLIENTE DO ARQUIVO BLBBB002/)).toBeTruthy()
})

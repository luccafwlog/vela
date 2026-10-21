// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  reimport: vi.fn((): Promise<{ status: string; staged: number; vaziosReplaced: boolean; flagsError: string | null; vaziosError: string | null }> =>
    Promise.resolve({ status: 'imported', staged: 1, vaziosReplaced: false, flagsError: null, vaziosError: null })),
  countPending: vi.fn(() => Promise.resolve(0)),
  applyFlags: vi.fn((): Promise<unknown> => Promise.resolve({
    applied: 1, applied_to: [{ container: 'AAAU0000001', bl_id: 'BL-1' }], cleared: [], divergent_manual: [], invoice_reissues: [],
  })),
  parse: vi.fn(() => Promise.resolve({ vessel_name: 'GREEN SANTOS', voyage_number: '14N', containers: [{ container_number: 'CXRU1234567', status: 'full', pod: 'BRSSZ' }], pods: [], issues: [] })),
  showToast: vi.fn(),
  confirmWithReason: vi.fn(() => Promise.resolve('Armador confirmou o B/L' as string | null)),
  resolveDivergence: vi.fn(() => Promise.resolve()),
  reconcile: vi.fn(),
  refetchContext: vi.fn(),
  // Viagem conferida: as regras do Baplie rodaram e a importação pode seguir.
  voyageContext: {
    data: { voyageNumber: '14', vesselName: 'GREEN SANTOS', eligiblePods: [] } as unknown,
    isError: false,
    error: null as unknown,
  },
}))
vi.mock('../../services/supabase', () => ({ supabase: {} }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, profile: { id: 'user-1' } }) }))
vi.mock('../../hooks/useBls', () => ({ useVoyages: () => ({ data: [], isLoading: false }) }))
vi.mock('../../components/shared/VoyageCombobox', () => ({
  VoyageCombobox: ({ onSelect }: { onSelect: (id: number) => void }) => <button onClick={() => onSelect(24)}>Escolher viagem 24</button>,
}))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn(), useConfirmWithReason: () => mocks.confirmWithReason }))
vi.mock('../../services/baplieParser', () => ({ parseBaplieFile: mocks.parse }))
vi.mock('../../hooks/useBaplieVoyageContext', () => ({ useBaplieVoyageContext: () => ({ ...mocks.voyageContext, refetch: mocks.refetchContext }) }))
vi.mock('../../services/baplieImport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/baplieImport')>()
  return {
    // Regras da Viagem (etapa 9): aqui a prévia é a do parser.
    applyBaplieVoyageRules: (parsed: { containers: unknown[]; pods?: string[]; issues: unknown[] }) => ({ containers: parsed.containers, pods: parsed.pods ?? [], issues: parsed.issues }),
    reimportBaplie: mocks.reimport, baplieImportToast: () => 'Importado', baplieReplacementConfirmOptions: vi.fn(),
    hasBapliePendency: (result: { flagsError: string | null; vaziosError: string | null }) => Boolean(result.flagsError || result.vaziosError),
    baplieFootnoteForPendency: () => 'Baplie gravado com pendência.', retryBaplieVazios: vi.fn(),
    baplieVoyageContextBlock: actual.baplieVoyageContextBlock,
    summarizeBaplieFlags: actual.summarizeBaplieFlags,
    describeBaplieFlags: actual.describeBaplieFlags,
  }
})
vi.mock('../../services/baplieReconciliation', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/baplieReconciliation')>(), reconcileBaplieWithManifest: mocks.reconcile,
  countPendingBapliePhysicalFlags: mocks.countPending, applyBapliePhysicalFlagsDetailed: mocks.applyFlags,
  resolveBaplieDivergence: mocks.resolveDivergence,
}))
vi.mock('../../services/baplieReadModel', () => ({ hasBlsForVoyage: vi.fn(() => Promise.resolve(false)), listBaplieStaging: vi.fn(() => Promise.resolve([])) }))
vi.mock('../../services/vaziosImportacaoImport', () => ({ getBaplieManifestForVoyage: vi.fn(() => Promise.resolve(null)), importVaziosFromBaplie: vi.fn(), replaceVaziosFromBaplie: vi.fn() }))

import { Baplie } from '../Baplie'
import { hasBlsForVoyage, listBaplieStaging } from '../../services/baplieReadModel'

describe('upload na página Baplie', () => {
  it('atualiza a viagem escolhida no modal, mesmo sem mudar flags e com outra viagem aberta', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
    client.setQueryData(['baplie-staging', '24'], ['anterior'])
    client.setQueryData(['voyages'], ['anterior'])
    try {
      render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/?voyage=7']}><Baplie /></MemoryRouter></QueryClientProvider>)
      fireEvent.click(await screen.findByRole('button', { name: /Importar Baplie/ }))
      fireEvent.click(screen.getAllByRole('button', { name: 'Escolher viagem 24' })[1])
      const file = new File(['edi'], 'novo.edi', { type: 'text/plain' })
      fireEvent.change(screen.getByLabelText(/^Arquivo \(/), { target: { files: [file] } })
      await waitFor(() => expect((screen.getByRole('button', { name: 'Importar 1 container' }) as HTMLButtonElement).disabled).toBe(false))
      fireEvent.click(screen.getByRole('button', { name: 'Importar 1 container' }))
      await waitFor(() => expect(client.getQueryState(['baplie-staging', '24'])?.isInvalidated).toBe(true))
      expect(client.getQueryState(['voyages'])?.isInvalidated).toBe(true)
      expect(mocks.reimport).toHaveBeenCalledWith(expect.objectContaining({ voyageId: 24, actorId: 'user-1' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    } finally { client.clear() }
  })

  it('Baplie gravado com falha ao aplicar IMO/OOG fica no modal com o que falta, sem fechar', async () => {
    mocks.reimport.mockResolvedValueOnce({ status: 'imported', staged: 1, vaziosReplaced: false, flagsError: 'timeout na aplicação', vaziosError: null })
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
    try {
      render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/?voyage=24']}><Baplie /></MemoryRouter></QueryClientProvider>)
      fireEvent.click(await screen.findByRole('button', { name: /Importar Baplie/ }))
      fireEvent.change(screen.getByLabelText(/^Arquivo \(/), { target: { files: [new File(['edi'], 'novo.edi', { type: 'text/plain' })] } })
      await waitFor(() => expect((screen.getByRole('button', { name: 'Importar 1 container' }) as HTMLButtonElement).disabled).toBe(false))
      fireEvent.click(screen.getByRole('button', { name: 'Importar 1 container' }))
      expect(await screen.findByText('Baplie importado, mas IMO/OOG não foram aplicados aos B/Ls')).toBeTruthy()
      expect(screen.getByText('timeout na aplicação')).toBeTruthy()
      expect(screen.getByRole('dialog')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Concluir' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    } finally { client.clear() }
  })
})

describe('lista de containers do Baplie', () => {
  const staged = [
    { id: 1, container_number: 'AAAU0000001', status: 'full', size_type: '40HC', pol: 'CNSHA', pod: 'BRSSZ', slot: null, bl_ref: null, is_imo: true, is_oog: true, imo_class: '3', un_number: '1263', ownership: null, imported_at: '2026-10-08T10:00:00Z' },
    { id: 2, container_number: 'BBBU0000002', status: 'full', size_type: '40HC', pol: 'CNSHA', pod: 'BRSSZ', slot: null, bl_ref: null, is_imo: false, is_oog: false, imo_class: null, un_number: null, ownership: null, imported_at: '2026-10-08T10:00:00Z' },
  ]

  it('container IMO e OOG aparece no filtro OOG, e falha ao recarregar mantém a última leitura à vista', async () => {
    vi.mocked(listBaplieStaging).mockResolvedValue(staged as never)
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
    try {
      render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/?voyage=7']}><Baplie /></MemoryRouter></QueryClientProvider>)
      expect(await screen.findByText('AAAU0000001')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /^Filtros/ }))
      fireEvent.change(screen.getByLabelText('IMO / OOG'), { target: { value: 'oog' } })
      await waitFor(() => expect(screen.queryByText('BBBU0000002')).toBeNull())
      expect(screen.getByText('AAAU0000001')).toBeTruthy()

      vi.mocked(listBaplieStaging).mockRejectedValueOnce(new Error('rede'))
      await client.refetchQueries({ queryKey: ['baplie-staging', '7'] })
      expect(await screen.findByText('Não foi possível atualizar o Baplie desta viagem')).toBeTruthy()
      expect(screen.getByText('AAAU0000001')).toBeTruthy()
      expect(screen.queryByText('Não foi possível ler o Baplie desta viagem.')).toBeNull()
    } finally {
      vi.mocked(listBaplieStaging).mockResolvedValue([])
      client.clear()
    }
  })
})

describe('IMO/OOG pendentes depois de fechar o aviso da importação', () => {
  const staged = [
    { id: 1, container_number: 'AAAU0000001', status: 'full', size_type: '40HC', pol: 'CNSHA', pod: 'BRSSZ', slot: null, bl_ref: null, is_imo: true, is_oog: false, imo_class: '3', un_number: '1263', ownership: null, imported_at: '2026-10-08T10:00:00Z' },
  ]

  it('a tela recalcula a pendência, aplica com um clique e só então diz que está aplicado', async () => {
    vi.mocked(listBaplieStaging).mockResolvedValue(staged as never)
    vi.mocked(hasBlsForVoyage).mockResolvedValue(true)
    mocks.countPending.mockResolvedValueOnce(2).mockResolvedValue(0)
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
    try {
      render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/?voyage=7']}><Baplie /></MemoryRouter></QueryClientProvider>)
      expect(await screen.findByText('IMO/OOG do Baplie ainda não aplicados a 2 containers de B/L')).toBeTruthy()
      expect(screen.queryByText(/esses dados estão aplicados/)).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Aplicar IMO/OOG agora' }))
      await waitFor(() => expect(mocks.applyFlags).toHaveBeenCalledWith(7, 'user-1'))
      await waitFor(() => expect(screen.queryByText(/ainda não aplicados/)).toBeNull())
      expect(screen.getByText(/esses dados estão aplicados aos containers dos B\/Ls/)).toBeTruthy()
      // E9-09: o mesmo resumo da importação, não só a contagem.
      expect(mocks.showToast).toHaveBeenCalledWith('IMO/OOG do Baplie aplicados aos B/Ls. marcas aplicadas a 1 container(s) em 1 B/L(s).', 'success')
    } finally {
      vi.mocked(listBaplieStaging).mockResolvedValue([])
      vi.mocked(hasBlsForVoyage).mockResolvedValue(false)
      mocks.countPending.mockReset().mockResolvedValue(0)
      client.clear()
    }
  })
})

describe('revisão da etapa 9 na página Baplie', () => {
  const staged = [
    { id: 1, container_number: 'AAAU0000001', status: 'full', size_type: '40HC', pol: 'CNSHA', pod: 'BRSSZ', slot: null, bl_ref: null, is_imo: true, is_oog: false, imo_class: '3', un_number: '1263', ownership: 'SOC', imported_at: '2026-10-08T10:00:00Z' },
  ]
  const renderPage = (client: QueryClient, voyage = '7') =>
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/?voyage=${voyage}`]}><Baplie /></MemoryRouter></QueryClientProvider>)

  // E9-01: sem a Viagem conferida, as regras de navio/viagem e escalas não rodam.
  it('não deixa importar enquanto a Viagem carrega nem quando a conferência falha', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
    mocks.voyageContext = { data: undefined, isError: true, error: { code: '42501', message: 'permission denied for function list_voyage_eligible_pods' } }
    try {
      const view = renderPage(client, '24')
      fireEvent.click(await screen.findByRole('button', { name: /Importar Baplie/ }))
      fireEvent.change(screen.getByLabelText(/^Arquivo \(/), { target: { files: [new File(['edi'], 'novo.edi', { type: 'text/plain' })] } })
      expect(await screen.findByText('Não foi possível conferir a Viagem: Sem permissao para esta acao. Solicite acesso administrativo.')).toBeTruthy()
      expect(await screen.findByText('Importação bloqueada até a Viagem ser conferida.')).toBeTruthy()
      expect((screen.getByRole('button', { name: 'Importar containers' }) as HTMLButtonElement).disabled).toBe(true)
      fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
      expect(mocks.refetchContext).toHaveBeenCalled()

      mocks.voyageContext = { data: undefined, isError: false, error: null }
      view.rerender(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/?voyage=24']}><Baplie /></MemoryRouter></QueryClientProvider>)
      expect(await screen.findByText('Conferindo navio, viagem e escalas da Viagem…')).toBeTruthy()
      expect((screen.getByRole('button', { name: 'Importar containers' }) as HTMLButtonElement).disabled).toBe(true)
      expect(mocks.reimport).not.toHaveBeenCalled()
    } finally {
      mocks.voyageContext = { data: { voyageNumber: '14', vesselName: 'GREEN SANTOS', eligiblePods: [] }, isError: false, error: null }
      mocks.reimport.mockClear()
      client.clear()
    }
  })

  // E9-09: falha ao aplicar não mostra o texto cru do banco.
  it('falha ao aplicar IMO/OOG mostra mensagem segura', async () => {
    vi.mocked(listBaplieStaging).mockResolvedValue(staged as never)
    vi.mocked(hasBlsForVoyage).mockResolvedValue(true)
    mocks.countPending.mockResolvedValue(1)
    mocks.applyFlags.mockRejectedValueOnce(new Error('relation "bl_containers_tmp" does not exist'))
    mocks.reconcile.mockResolvedValue({ source: 'reconciled', pendingRoutes: [], items: [] })
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
    try {
      renderPage(client)
      fireEvent.click(await screen.findByRole('button', { name: 'Aplicar IMO/OOG agora' }))
      expect(await screen.findByText('Falha ao aplicar IMO/OOG aos B/Ls.')).toBeTruthy()
      expect(screen.queryByText(/bl_containers_tmp/)).toBeNull()
    } finally {
      vi.mocked(listBaplieStaging).mockResolvedValue([])
      vi.mocked(hasBlsForVoyage).mockResolvedValue(false)
      mocks.countPending.mockReset().mockResolvedValue(0)
      client.clear()
    }
  })

  // E9-16: "Vale o B/L" muda o container do B/L e grava no Histórico dele.
  it('"Vale o B/L" atualiza a ficha e o Histórico do B/L, não só a conciliação', async () => {
    vi.mocked(listBaplieStaging).mockResolvedValue(staged as never)
    vi.mocked(hasBlsForVoyage).mockResolvedValue(true)
    mocks.reconcile.mockResolvedValue({
      source: 'reconciled',
      pendingRoutes: [],
      items: [{ kind: 'ownership_mismatch', container_number: 'AAAU0000001', bl_container_id: 3, bl_id: 'BL-3', bl_ownership: 'COC', baplie_ownership: 'SOC' }],
    })
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
    client.setQueryData(['bl-timeline', 'BL-3'], ['anterior'])
    client.setQueryData(['bl-detail', 'BL-3'], { id: 'BL-3' })
    try {
      renderPage(client)
      fireEvent.click(await screen.findByRole('button', { name: 'Vale o B/L: AAAU0000001 no B/L BL-3' }))
      await waitFor(() => expect(mocks.resolveDivergence).toHaveBeenCalledWith(3, 'ownership', 'Armador confirmou o B/L'))
      await waitFor(() => expect(client.getQueryState(['bl-timeline', 'BL-3'])?.isInvalidated).toBe(true))
      expect(client.getQueryState(['bl-detail', 'BL-3'])?.isInvalidated).toBe(true)
    } finally {
      vi.mocked(listBaplieStaging).mockResolvedValue([])
      vi.mocked(hasBlsForVoyage).mockResolvedValue(false)
      client.clear()
    }
  })
})

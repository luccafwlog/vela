// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VaziosImportacao } from '../VaziosImportacao'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(() => Promise.resolve()),
  showToast: vi.fn(),
  listVaziosImportacaoContainers: vi.fn(),
  listVaziosMercanteManifestos: vi.fn(),
  setVaziosImportacaoNaturezaMany: vi.fn(),
  fetchVaziosImportacaoContainerIds: vi.fn(),
  exportVaziosImportacaoWorkbook: vi.fn(),
  containerFilters: [] as unknown[],
  manifestosError: null as Error | null,
  containersEnabled: [] as unknown[],
}))

const railItemsMock = vi.hoisted(() => vi.fn(() => ({ items: [] as unknown[], isLoading: false })))
// Cards de navio/viagem: o teste próprio está em VoyageRail.behavior.test.tsx.
vi.mock('../../hooks/useVoyageRailItems', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/useVoyageRailItems')>()),
  useVoyageRailItems: () => railItemsMock(),
}))
vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: (value: unknown) => value,
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
  useQuery: ({ queryKey, enabled }: { queryKey: unknown[]; enabled?: boolean }) => {
    const key = queryKey[0]
    if (key === 'vazios-importacao-containers') {
      mocks.containerFilters.push(queryKey[1])
      mocks.containersEnabled.push(enabled)
      return {
        data: mocks.listVaziosImportacaoContainers(),
        isLoading: false,
        error: null,
        fetchStatus: 'idle',
        refetch: vi.fn(),
      }
    }
    if (key === 'manifestos-mercante') {
      if (mocks.manifestosError) return { data: undefined, isLoading: false, isSuccess: false, error: mocks.manifestosError }
      return { data: mocks.listVaziosMercanteManifestos(), isLoading: false, isSuccess: true, error: null }
    }
    return { data: undefined, isLoading: false, error: null }
  },
}))

vi.mock('../../hooks/useBls', () => ({
  useVoyageOptions: () => ({ data: [{ id: 7, voyage_number: '088E', vessel: { name: 'COSCO SHIPPING ARIES' } }] }),
}))

vi.mock('../../components/shared/VoyageCombobox', () => ({
  VoyageCombobox: ({ label, onSelect }: { label?: string; onSelect: (id: number | null) => void }) => (
    <button type="button" onClick={() => onSelect(7)}>{`Escolher ${label}`}</button>
  ),
}))

vi.mock('../../components/ui/ConfirmDialog', () => ({
  useConfirm: () => vi.fn(() => Promise.resolve(true)),
}))

vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'test@example.com' },
    profile: { role: 'admin' },
    isAdmin: true,
  }),
}))

vi.mock('../../services/vaziosImportacaoImport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/vaziosImportacaoImport')>()
  return {
    listVaziosImportacaoContainers: () => mocks.listVaziosImportacaoContainers(),
    listVaziosMercanteManifestos: (...args: unknown[]) => mocks.listVaziosMercanteManifestos(...args),
    vazioManifestoNumero: actual.vazioManifestoNumero,
    parseVaziosImportacaoFile: vi.fn(),
    importVaziosImportacaoManifest: vi.fn(),
    resolveVaziosManifestNumbers: vi.fn(() => ({ manifestos: null, error: 'sem número' })),
    resolveVaziosManifestRoutes: vi.fn(() => ({ routes: null, error: 'sem rota' })),
    vaziosImportacaoHiddenConfirmOptions: vi.fn(() => null),
    vaziosRouteKey: (route: { pol: string; pod: string }) => `${route.pol}__${route.pod}`,
    VAZIOS_IMPORTACAO_REQUIRED_COLUMNS: ['Container', 'POL', 'POD'],
    VAZIOS_IMPORTACAO_OPTIONAL_COLUMNS: ['Tipo', 'Tara (kg)'],
  }
})

vi.mock('../../services/depots', () => ({ listBrazilianPorts: vi.fn() }))

vi.mock('../../services/vaziosNatureza', () => ({
  setVaziosImportacaoNaturezaMany: (...args: unknown[]) =>
    mocks.setVaziosImportacaoNaturezaMany(...args),
  fetchVaziosImportacaoContainerIds: (...args: unknown[]) =>
    mocks.fetchVaziosImportacaoContainerIds(...args),
}))

vi.mock('../../services/exports', () => ({
  exportVaziosImportacaoWorkbook: (...args: unknown[]) =>
    mocks.exportVaziosImportacaoWorkbook(...args),
}))

describe('VaziosImportacao — Atribuição em Lote de Natureza', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.setVaziosImportacaoNaturezaMany.mockResolvedValue(undefined)
    mocks.fetchVaziosImportacaoContainerIds.mockResolvedValue(['c-1', 'c-2', 'c-3'])
    mocks.exportVaziosImportacaoWorkbook.mockResolvedValue(undefined)
    mocks.containerFilters.length = 0
    mocks.manifestosError = null
    mocks.listVaziosMercanteManifestos.mockReturnValue([
      { id: 'mm-1', voyage_id: 7, pol: 'CNSHA', pod: 'BRVIX', numero: '2626501234568' },
    ])
    mocks.listVaziosImportacaoContainers.mockReturnValue({
      rows: [
        {
          id: 'c-1',
          container_number: 'MSCU1234567',
          container_type: '40HC',
          tare_kg: 3800,
          pol: 'CNSHA',
          pod: 'BRVIX',
          natureza: 'cama',
          manifest: { voyage_id: 7, description: 'Manifesto 1', imported_at: '2026-08-30T10:00:00Z', voyage: { voyage_number: '088E', vessel: { name: 'COSCO SHIPPING ARIES' } } },
        },
        {
          id: 'c-2',
          container_number: 'MSCU7654321',
          container_type: '40HC',
          tare_kg: 3850,
          pol: 'CNNGB',
          pod: 'BRVIX',
          natureza: null,
          manifest: { voyage_id: 7, description: 'Manifesto 1', imported_at: '2026-08-30T10:00:00Z', voyage: { voyage_number: '088E', vessel: { name: 'COSCO SHIPPING ARIES' } } },
        },
      ],
      count: 2,
    })
  })

  afterEach(() => {
    cleanup()
  })

  function renderPage(entry = '/vazios-importacao') {
    return render(
      <MemoryRouter initialEntries={[entry]}>
        <VaziosImportacao />
      </MemoryRouter>,
    )
  }

  it('lista os vazios com Trecho, Natureza em texto e o Nº do manifesto da rota', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Vazios de importação' })).toBeTruthy()
    const first = screen.getByText('MSCU1234567').closest('tr') as HTMLElement
    expect(within(first).getByText('CNSHA → BRVIX')).toBeTruthy()
    expect(within(first).getByText('Cama')).toBeTruthy()
    expect(within(first).getByText('2626501234568')).toBeTruthy()
    expect(within(first).getByText('COSCO SHIPPING ARIES / 088E')).toBeTruthy()
    // Rota sem manifesto de vazios: a pendência em âmbar, como o alerta CE Mercante pendente.
    const second = screen.getByText('MSCU7654321').closest('tr') as HTMLElement
    expect(within(second).getByText('Sem número')).toBeTruthy()
    expect(within(second).getByText('Sem natureza')).toBeTruthy()
    // Natureza só pela seleção: sem seletor por linha.
    expect(screen.queryByLabelText('Natureza do container MSCU1234567')).toBeNull()
    expect(screen.getByText('2 containers')).toBeTruthy()
  })

  it('filtros ativos mostram navio e viagem, nunca o número interno, e o POD vindo da Line Up tem campo', () => {
    renderPage('/vazios-importacao?voyage=7&pod=brvix')

    expect(screen.getByText('Filtros ativos: Viagem COSCO SHIPPING ARIES / 088E, POD BRVIX')).toBeTruthy()
    expect((screen.getByLabelText('POD') as HTMLSelectElement).value).toBe('BRVIX')
  })

  it('o filtro de Manifesto Mercante oferece só os da viagem e filtra pela rota do manifesto', () => {
    renderPage()
    expect((screen.getByLabelText('Manifesto Mercante') as HTMLSelectElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Escolher Viagem' }))
    const manifesto = screen.getByLabelText('Manifesto Mercante') as HTMLSelectElement
    expect(manifesto.disabled).toBe(false)
    expect([...manifesto.options].map((option) => option.text)).toEqual(['Todos da viagem', '2626501234568 · CNSHA → BRVIX'])

    fireEvent.change(manifesto, { target: { value: 'mm-1' } })
    expect(mocks.containerFilters.at(-1)).toMatchObject({ voyageId: '7', pol: 'CNSHA', pod: 'BRVIX' })
    expect(screen.getByText('Filtros ativos: Viagem COSCO SHIPPING ARIES / 088E, Manifesto Mercante 2626501234568, POD BRVIX')).toBeTruthy()
  })

  // Revisão de 2026-10-22 (G1): o cabeçalho marca o filtro inteiro.
  it('o cabeçalho seleciona todos os containers do filtro e define natureza como Cama em lote', async () => {
    mocks.fetchVaziosImportacaoContainerIds.mockResolvedValue(['c-1', 'c-2'])
    renderPage()

    fireEvent.click(screen.getByLabelText('Selecionar todos os containers do filtro (2)'))

    expect(await screen.findByText('2 de 2 containers selecionados')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cama' }))

    await waitFor(() => {
      expect(mocks.setVaziosImportacaoNaturezaMany).toHaveBeenCalledWith(['c-1', 'c-2'], 'cama')
      expect(mocks.showToast).toHaveBeenCalledWith('2 containers atualizados como Cama.', 'success')
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['vazios-importacao-containers'] })
    })
  })

  it('permite selecionar um container individual e definir como Cover plate em lote', async () => {
    renderPage()

    fireEvent.click(screen.getByLabelText('Selecionar container MSCU1234567'))
    expect(screen.getByText('1 de 2 containers selecionado')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cover plate' }))

    await waitFor(() => {
      expect(mocks.setVaziosImportacaoNaturezaMany).toHaveBeenCalledWith(['c-1'], 'cover_plate')
      expect(mocks.showToast).toHaveBeenCalledWith('1 container atualizado como Cover plate.', 'success')
    })
  })

  it('permite limpar natureza em lote', async () => {
    renderPage()

    fireEvent.click(screen.getByLabelText('Selecionar container MSCU7654321'))
    fireEvent.click(screen.getByRole('button', { name: 'Limpar natureza' }))

    await waitFor(() => {
      expect(mocks.setVaziosImportacaoNaturezaMany).toHaveBeenCalledWith(['c-2'], null)
      expect(mocks.showToast).toHaveBeenCalledWith('1 container atualizado: sem natureza.', 'success')
    })
  })

  it('exporta com o Nº do manifesto da rota de cada container', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))

    await waitFor(() => expect(mocks.exportVaziosImportacaoWorkbook).toHaveBeenCalled())
    const [rows] = mocks.exportVaziosImportacaoWorkbook.mock.calls[0] as [Array<{ container_number: string; manifesto_numero: string | null }>]
    expect(rows.map((row) => [row.container_number, row.manifesto_numero])).toEqual([
      ['MSCU1234567', '2626501234568'],
      ['MSCU7654321', null],
    ])
  })

  it('com várias páginas, o cabeçalho seleciona os containers de todas elas', async () => {
    mocks.listVaziosImportacaoContainers.mockReturnValue({
      rows: [
        {
          id: 'c-1',
          container_number: 'MSCU1234567',
          container_type: '40HC',
          tare_kg: 3800,
          pod: 'BRVIX',
          natureza: null,
          manifest: null,
        },
      ],
      count: 3,
    })

    renderPage()

    fireEvent.click(screen.getByLabelText('Selecionar todos os containers do filtro (3)'))

    await waitFor(() => {
      expect(mocks.fetchVaziosImportacaoContainerIds).toHaveBeenCalled()
      expect(screen.getByText('3 de 3 containers selecionados')).toBeTruthy()
    })
    // Marcado tudo, o cabeçalho desmarca o filtro inteiro.
    fireEvent.click(screen.getByLabelText('Desmarcar todos os containers do filtro (3)'))
    await waitFor(() => expect(screen.queryByText(/containers selecionados/)).toBeNull())
  })

  it('falha ao ler os manifestos aparece como falha, não como "Sem número" pendente', () => {
    mocks.manifestosError = new Error('rede')
    renderPage()

    const second = screen.getByText('MSCU7654321').closest('tr') as HTMLElement
    expect(within(second).getByText('Não foi possível carregar')).toBeTruthy()
    expect(screen.queryByText('Sem número')).toBeNull()
  })

  it('manifesto escolhido que some da Viagem limpa o filtro e a lista volta a carregar', async () => {
    const view = renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Escolher Viagem' }))
    fireEvent.change(screen.getByLabelText('Manifesto Mercante'), { target: { value: 'mm-1' } })
    expect(mocks.containerFilters.at(-1)).toMatchObject({ pol: 'CNSHA' })

    // Reimportação trocou o manifesto da rota: o id escolhido não existe mais.
    mocks.listVaziosMercanteManifestos.mockReturnValue([
      { id: 'mm-2', voyage_id: 7, pol: 'CNSHA', pod: 'BRVIX', numero: '2626509999999' },
    ])
    view.rerender(
      <MemoryRouter initialEntries={['/vazios-importacao']}>
        <VaziosImportacao />
      </MemoryRouter>,
    )

    await waitFor(() => expect((screen.getByLabelText('Manifesto Mercante') as HTMLSelectElement).value).toBe(''))
    expect(mocks.containerFilters.at(-1)).toMatchObject({ voyageId: '7', pol: '' })
    // Sem limpar, a consulta ficaria desligada esperando uma rota que não vem.
    expect(mocks.containersEnabled.at(-1)).toBe(true)
  })
})

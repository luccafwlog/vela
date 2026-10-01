// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VaziosImportacao } from '../VaziosImportacao'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(() => Promise.resolve()),
  showToast: vi.fn(),
  listVaziosImportacaoContainers: vi.fn(),
  listVaziosImportacaoManifests: vi.fn(),
  setVazioImportacaoNatureza: vi.fn(),
  setVaziosImportacaoNaturezaMany: vi.fn(),
  fetchVaziosImportacaoContainerIds: vi.fn(),
  exportVaziosImportacaoWorkbook: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = queryKey[0]
    if (key === 'vazios-importacao-containers') {
      return {
        data: mocks.listVaziosImportacaoContainers(),
        isLoading: false,
        error: null,
      }
    }
    if (key === 'vazios-importacao-manifests') {
      return {
        data: mocks.listVaziosImportacaoManifests(),
        isLoading: false,
        error: null,
      }
    }
    return { data: null, isLoading: false, error: null }
  },
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

vi.mock('../../services/vaziosImportacaoImport', () => ({
  listVaziosImportacaoContainers: () => mocks.listVaziosImportacaoContainers(),
  listVaziosImportacaoManifests: () => mocks.listVaziosImportacaoManifests(),
  parseVaziosImportacaoFile: vi.fn(),
  importVaziosImportacaoManifest: vi.fn(),
  resolveVaziosManifestRoute: vi.fn(() => ({ route: null, error: 'sem rota' })),
  VAZIOS_IMPORTACAO_REQUIRED_COLUMNS: ['Container', 'POL', 'POD'],
  VAZIOS_IMPORTACAO_OPTIONAL_COLUMNS: ['Tipo', 'Tara (kg)'],
}))

vi.mock('../../services/vaziosNatureza', () => ({
  setVazioImportacaoNatureza: (...args: unknown[]) =>
    mocks.setVazioImportacaoNatureza(...args),
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
    mocks.setVazioImportacaoNatureza.mockResolvedValue(undefined)
    mocks.setVaziosImportacaoNaturezaMany.mockResolvedValue(undefined)
    mocks.fetchVaziosImportacaoContainerIds.mockResolvedValue(['c-1', 'c-2', 'c-3'])
    mocks.exportVaziosImportacaoWorkbook.mockResolvedValue(undefined)
    mocks.listVaziosImportacaoManifests.mockReturnValue([])
    mocks.listVaziosImportacaoContainers.mockReturnValue({
      rows: [
        {
          id: 'c-1',
          container_number: 'MSCU1234567',
          container_type: '40HC',
          tare_kg: 3800,
          pod: 'BRVIX',
          natureza: null,
          manifest: { description: 'Manifesto 1', imported_at: '2026-08-30T10:00:00Z', voyage: null },
        },
        {
          id: 'c-2',
          container_number: 'MSCU7654321',
          container_type: '40HC',
          tare_kg: 3850,
          pod: 'BRVIX',
          natureza: null,
          manifest: { description: 'Manifesto 1', imported_at: '2026-08-30T10:00:00Z', voyage: null },
        },
      ],
      count: 2,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renderiza listagem de vazios de importação', () => {
    render(
      <MemoryRouter>
        <VaziosImportacao />
      </MemoryRouter>,
    )

    expect(screen.getByText('MSCU1234567')).toBeTruthy()
    expect(screen.getByText('MSCU7654321')).toBeTruthy()
    expect(screen.getByText('2 containers retornados')).toBeTruthy()
  })

  it('permite selecionar todos os containers da página e definir natureza como Cama em lote', async () => {
    render(
      <MemoryRouter>
        <VaziosImportacao />
      </MemoryRouter>,
    )

    const selectAllCheckbox = screen.getByLabelText('Selecionar todos os containers da página')
    fireEvent.click(selectAllCheckbox)

    expect(screen.getByText('2 containers selecionados')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Definir como Cama' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Definir como Cama' }))

    await waitFor(() => {
      expect(mocks.setVaziosImportacaoNaturezaMany).toHaveBeenCalledWith(['c-1', 'c-2'], 'cama')
      expect(mocks.showToast).toHaveBeenCalledWith('2 container(s) atualizado(s) como Cama.', 'success')
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['vazios-importacao-containers'] })
    })
  })

  it('permite selecionar um container individual e definir como Cover plate em lote', async () => {
    render(
      <MemoryRouter>
        <VaziosImportacao />
      </MemoryRouter>,
    )

    const rowCheckbox = screen.getByLabelText('Selecionar container MSCU1234567')
    fireEvent.click(rowCheckbox)

    expect(screen.getByText('1 container selecionado')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Definir como Cover plate' }))

    await waitFor(() => {
      expect(mocks.setVaziosImportacaoNaturezaMany).toHaveBeenCalledWith(['c-1'], 'cover_plate')
      expect(mocks.showToast).toHaveBeenCalledWith('1 container(s) atualizado(s) como Cover plate.', 'success')
    })
  })

  it('permite limpar natureza em lote', async () => {
    render(
      <MemoryRouter>
        <VaziosImportacao />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByLabelText('Selecionar container MSCU7654321'))
    fireEvent.click(screen.getByRole('button', { name: 'Limpar Natureza' }))

    await waitFor(() => {
      expect(mocks.setVaziosImportacaoNaturezaMany).toHaveBeenCalledWith(['c-2'], null)
      expect(mocks.showToast).toHaveBeenCalledWith('1 container(s) atualizado(s) como Sem natureza.', 'success')
    })
  })

  it('altera natureza individualmente via dropdown da linha', async () => {
    render(
      <MemoryRouter>
        <VaziosImportacao />
      </MemoryRouter>,
    )

    const select = screen.getByLabelText('Natureza do container MSCU1234567')
    fireEvent.change(select, { target: { value: 'cama' } })

    await waitFor(() => {
      expect(mocks.setVazioImportacaoNatureza).toHaveBeenCalledWith('c-1', 'cama')
      expect(mocks.showToast).toHaveBeenCalledWith('Natureza atualizada.', 'success')
    })
  })

  it('exibe opção para selecionar todos os containers filtrados quando há múltiplas páginas', async () => {
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

    render(
      <MemoryRouter>
        <VaziosImportacao />
      </MemoryRouter>,
    )

    const selectAllCheckbox = screen.getByLabelText('Selecionar todos os containers da página')
    fireEvent.click(selectAllCheckbox)

    const selectAllFilteredBtn = screen.getByRole('button', { name: 'Selecionar todos os 3 containers do filtro' })
    expect(selectAllFilteredBtn).toBeTruthy()

    fireEvent.click(selectAllFilteredBtn)

    await waitFor(() => {
      expect(mocks.fetchVaziosImportacaoContainerIds).toHaveBeenCalled()
      expect(screen.getByText('3 containers selecionados')).toBeTruthy()
    })
  })
})

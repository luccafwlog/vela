// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { summaryState } = vi.hoisted(() => ({ summaryState: { error: null as Error | null } }))

const mockSummary = [
  { department: 'documentacao', active_count: 5, dismissed_count: 2, is_legacy: false },
  { department: 'equipamentos', active_count: 3, dismissed_count: 0, is_legacy: false },
  { department: 'operacoes', active_count: 0, dismissed_count: 1, is_legacy: false },
  { department: 'administrativo', active_count: 2, dismissed_count: 0, is_legacy: false },
  { department: 'sem_departamento', active_count: 1, dismissed_count: 0, is_legacy: true },
]

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: (previous: unknown) => previous,
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = queryKey[0] as string
    if (key === 'lineup-tv-v3') {
      return { data: { rows: [] }, isLoading: false, error: null, refetch: vi.fn(), isFetching: false }
    }
    if (key === 'alert-department-summary') {
      return { data: summaryState.error ? undefined : mockSummary, isLoading: false, error: summaryState.error }
    }
    return { data: null, isLoading: false, error: null }
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../lib/telemetry', () => ({ markStartupStage: vi.fn() }))

import { Painel } from '../Painel'

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  summaryState.error = null
})

const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}))

function renderPainel() {
  render(
    <MemoryRouter>
      <Painel />
    </MemoryRouter>,
  )
}

describe('Painel — alertas por setor', () => {
  it('mostra um cartão por setor, inclusive o Administrativo (achado A1)', () => {
    renderPainel()

    expect(screen.getByRole('button', { name: /Documentação\s*5 alertas\s*2 dispensados/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Equipamentos\s*3 alertas/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Operações\s*Nenhum\s*1 dispensado/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Administrativo\s*2 alertas/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Sem setor\s*1 alerta\s*anteriores aos setores/ })).toBeTruthy()
  })

  it('cada cartão leva à fila de Alertas filtrada pelo setor', () => {
    renderPainel()

    fireEvent.click(screen.getByRole('button', { name: /Administrativo/ }))
    expect(navigate).toHaveBeenCalledWith('/alertas?departamento=administrativo')
    fireEvent.click(screen.getByRole('button', { name: /Sem setor/ }))
    expect(navigate).toHaveBeenCalledWith('/alertas?departamento=sem_departamento')
  })

  it('expõe falha do resumo sem transformar erro em cartões zerados', () => {
    summaryState.error = new Error('RPC indisponível')
    renderPainel()

    expect(screen.getByText('Erro ao carregar os alertas por setor.')).toBeTruthy()
    expect(screen.queryByText('5 alertas')).toBeNull()
  })
})

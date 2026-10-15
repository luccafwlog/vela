// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { summaryState } = vi.hoisted(() => ({ summaryState: { error: null as Error | null } }))

const mockSummary = [
  { department: 'documentacao', active_count: 5, dismissed_count: 2, is_legacy: false },
  { department: 'equipamentos', active_count: 3, dismissed_count: 0, is_legacy: false },
  { department: 'operacoes', active_count: 0, dismissed_count: 1, is_legacy: false },
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

describe('Painel — Resumo de Pendências por Setor', () => {
  it('renderiza os cartões de cada setor com pendências ativas e dispensadas', () => {
    render(
      <MemoryRouter>
        <Painel />
      </MemoryRouter>,
    )

    expect(screen.getByText('Pendências por Setor Responsável')).toBeTruthy()
    expect(screen.getByText('Documentação')).toBeTruthy()
    expect(screen.getByText('5 pendências')).toBeTruthy()
    expect(screen.getByText('+ 2 dispensada(s)')).toBeTruthy()

    expect(screen.getByText('Equipamentos')).toBeTruthy()
    expect(screen.getByText('3 pendências')).toBeTruthy()

    expect(screen.getByText('Operações')).toBeTruthy()
    expect(screen.getByText('0 pendências')).toBeTruthy()
    expect(screen.getByText('+ 1 dispensada(s)')).toBeTruthy()

    expect(screen.getByText('Sem setor / Legado')).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
  })

  it('cada cartão de setor possui link correto com query param para /alertas', () => {
    render(
      <MemoryRouter>
        <Painel />
      </MemoryRouter>,
    )

    const docLink = screen.getByText('Documentação').closest('a')
    expect(docLink?.getAttribute('href')).toBe('/alertas?departamento=documentacao')

    const equipLink = screen.getByText('Equipamentos').closest('a')
    expect(equipLink?.getAttribute('href')).toBe('/alertas?departamento=equipamentos')

    const opsLink = screen.getByText('Operações').closest('a')
    expect(opsLink?.getAttribute('href')).toBe('/alertas?departamento=operacoes')

    const legacyLink = screen.getByText('Sem setor / Legado').closest('a')
    expect(legacyLink?.getAttribute('href')).toBe('/alertas?departamento=sem_departamento')

    const fullQueueLink = screen.getByText('Fila completa de alertas').closest('a')
    expect(fullQueueLink?.getAttribute('href')).toBe('/alertas')
  })

  it('expõe falha do resumo sem transformar erro em cartões zerados', () => {
    summaryState.error = new Error('RPC indisponível')

    render(
      <MemoryRouter>
        <Painel />
      </MemoryRouter>,
    )

    expect(screen.getByText('Erro ao carregar pendências por setor.')).toBeTruthy()
    expect(screen.queryByText('5 pendências')).toBeNull()
  })
})

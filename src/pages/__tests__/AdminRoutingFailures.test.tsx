// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockFailures = [
  {
    id: 1,
    alert_id: 10,
    alert_item_id: 20,
    event_id: 30,
    item_type: 'voyage_baplie_missing',
    department: 'documentacao',
    reason: 'Nenhum usuário ativo com papel documentacao encontrado',
    created_at: '2026-08-20T10:00:00Z',
    entity_type: 'voyage',
    entity_id: '99',
  },
]

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = queryKey[0] as string
    if (key === 'admin-users') return { data: [], isLoading: false, error: null }
    if (key === 'admin-routing-failures') {
      return { data: { rows: mockFailures, count: 1 }, isLoading: false, error: null }
    }
    if (key === 'admin-audit-logs') return { data: { rows: [], count: 0 }, isLoading: false, error: null }
    if (key === 'admin-metrics') return { data: null, isLoading: false, error: null }
    return { data: null, isLoading: false, error: null }
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn(), useConfirmWithReason: () => vi.fn() }))
vi.mock('../../hooks/useAgencyReport', () => ({ useAgencyReportSla: () => ({ data: [], isLoading: false, error: null }) }))

import { Admin } from '../Admin'

// A aba de Administração vive na URL. Os testes montam a rota real para que
// `useParams` devolva o mesmo que o app entrega em produção.
function renderAdmin(tab = 'usuarios') {
  return render(
    <MemoryRouter initialEntries={[`/admin/${tab}`]}>
      <Routes>
        <Route path="/admin/:tab" element={<Admin />} />
      </Routes>
    </MemoryRouter>,
  )
}


afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

describe('Admin — Falhas de entrega de alertas', () => {
  it('lista a falha com Quando, Alerta, Setor sem destinatário, Motivo e a ação de abrir o alerta', () => {
    renderAdmin('falhas-de-alertas')

    expect(screen.getByText('Setor sem destinatário')).toBeTruthy()
    expect(screen.getByText('Baplie ausente')).toBeTruthy()
    expect(screen.getByText('Documentação')).toBeTruthy()
    const reason = screen.getByText('Nenhum usuário ativo com papel documentacao encontrado')
    expect(reason.className).toContain('app-table__text--wrap')
    expect(screen.getByRole('button', { name: 'Abrir alerta' })).toBeTruthy()
    expect(screen.getByText('Para resolver: ativar alguém do setor na aba Usuários.')).toBeTruthy()
  })

  it('o endereço antigo /admin/falhas abre a aba nova', () => {
    renderAdmin('falhas')
    expect(screen.getByRole('tab', { name: 'Falhas de entrega de alertas' }).getAttribute('aria-selected')).toBe('true')
  })

  it('a aba Usuários não fala mais em "fallback" nem no papel Administrador', () => {
    renderAdmin()

    expect(screen.queryByText('Audiência de Alertas e Notificações')).toBeNull()
    expect(document.body.textContent).not.toMatch(/fallback|Administrador\b/)
    expect(screen.getByText('Recebe os alertas do próprio setor')).toBeTruthy()
  })
})

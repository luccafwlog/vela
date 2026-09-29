// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  showToast: vi.fn(),
  listAllUserProfiles: vi.fn(),
  updateUserProfile: vi.fn(),
  createUser: vi.fn(),
  updateUserCredentials: vi.fn(),
  deactivateUser: vi.fn(),
  mutate: vi.fn(),
  confirm: vi.fn(),
  errorByKey: {} as Record<string, unknown>,
}))

const users = [
  { id: 'u-1', full_name: 'Alice Operadora', role: 'operacoes', active: true, created_at: '2026-01-02T00:00:00Z', email: 'alice@fwlog.com.br', last_sign_in_at: '2026-08-01T12:00:00Z' },
  { id: 'u-2', full_name: 'Bruno Inativo', role: 'financeiro', active: false, created_at: '2026-01-03T00:00:00Z', email: 'bruno@fwlog.com.br', last_sign_in_at: null },
]

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = queryKey[0] as string
    const error = mocks.errorByKey[key] ?? null
    if (key === 'admin-users') return { data: users, isLoading: false, error }
    return { data: undefined, isLoading: false, error }
  },
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useMutation: (opts: { mutationFn: (vars: unknown) => unknown }) => ({
    mutate: (vars: unknown) => {
      mocks.mutate(vars)
      return opts.mutationFn(vars)
    },
    isPending: false,
  }),
}))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../services/supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('../../services/adminUsers', async (importActual) => {
  const actual = await importActual<typeof import('../../services/adminUsers')>()
  return {
    ...actual,
    listAllUserProfiles: mocks.listAllUserProfiles,
    updateUserProfile: mocks.updateUserProfile,
    createUser: mocks.createUser,
    updateUserCredentials: mocks.updateUserCredentials,
    deactivateUser: mocks.deactivateUser,
  }
})

import { MemoryRouter, Route, Routes } from 'react-router-dom'
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


beforeEach(() => {
  vi.clearAllMocks()
  mocks.errorByKey = {}
  mocks.updateUserProfile.mockResolvedValue(undefined)
  mocks.confirm.mockResolvedValue(true)
})
afterEach(cleanup)

it('US-146: lista os usuarios com nome, perfil e status', () => {
  renderAdmin()

  expect(screen.getByText('Alice Operadora')).toBeTruthy()
  expect(screen.getByText('Bruno Inativo')).toBeTruthy()
  // status badges
  expect(screen.getAllByText('Ativo').length).toBeGreaterThan(0)
  expect(screen.getAllByText('Inativo').length).toBeGreaterThan(0)
})

it('US-147: alterna o status ativo de um usuario apos confirmar', async () => {
  renderAdmin()

  // Alice is active -> her action button reads "Desativar"
  fireEvent.click(screen.getAllByRole('button', { name: 'Desativar' })[0])

  // Pede confirmação antes de mutar (ação revoga acesso e encerra a sessão).
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
  await waitFor(() => expect(mocks.deactivateUser).toHaveBeenCalledWith('u-1'))
})

it('Task 9: cancelar a confirmacao nao desativa o usuario', async () => {
  mocks.confirm.mockResolvedValue(false)
  renderAdmin()

  fireEvent.click(screen.getAllByRole('button', { name: 'Desativar' })[0])

  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
  expect(mocks.deactivateUser).not.toHaveBeenCalled()
})

it('US-147: altera o perfil de acesso de um usuario', async () => {
  renderAdmin()

  const select = screen.getAllByRole('combobox')[0]
  fireEvent.change(select, { target: { value: 'financeiro' } })

  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
  await waitFor(() => expect(mocks.updateUserProfile).toHaveBeenCalledWith('u-1', { role: 'financeiro' }))
})

it('pede confirmacao antes de trocar o setor, mostrando o escopo do destino', async () => {
  renderAdmin()
  fireEvent.change(screen.getAllByTitle('Setor de acesso')[0], { target: { value: 'financeiro' } })
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
  const args = mocks.confirm.mock.calls[0][0] as { message: string }
  expect(args.message).toContain('Leitura e escrita globais')
  expect(mocks.updateUserProfile).toHaveBeenCalledWith('u-1', { role: 'financeiro' })
})

it('nao troca o setor quando a confirmacao e recusada', async () => {
  mocks.confirm.mockResolvedValue(false)
  renderAdmin()
  fireEvent.change(screen.getAllByTitle('Setor de acesso')[0], { target: { value: 'financeiro' } })
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
  expect(mocks.updateUserProfile).not.toHaveBeenCalled()
})

it('DEF-061: surface dedicada de erro ao carregar logs de acoes', () => {
  mocks.errorByKey = { 'admin-audit-logs': new Error('logs down') }
  renderAdmin('logs')

  expect(screen.getByText('Erro ao carregar logs de ações.')).toBeTruthy()
})

it('DEF-062: surface dedicada de erro ao carregar metricas do sistema', () => {
  mocks.errorByKey = { 'admin-metrics': new Error('metrics down') }
  renderAdmin('metricas')

  expect(screen.getByText('Erro ao carregar métricas do sistema.')).toBeTruthy()
})

it('mostra o e-mail de login de cada usuario', () => {
  renderAdmin()
  expect(screen.getByText('alice@fwlog.com.br')).toBeTruthy()
})

it('destaca quem nunca acessou o sistema', () => {
  renderAdmin()
  expect(screen.getByText('Nunca acessou')).toBeTruthy()
})

it('filtra a lista por e-mail', () => {
  renderAdmin()
  fireEvent.change(screen.getByPlaceholderText('Buscar por nome ou e-mail'), { target: { value: 'bruno@' } })
  expect(screen.queryByText('Alice Operadora')).toBeNull()
  expect(screen.getByText('Bruno Inativo')).toBeTruthy()
})

it('exige o setor para criar um usuario', () => {
  renderAdmin()
  fireEvent.click(screen.getByRole('button', { name: 'Novo usuário' }))
  fireEvent.change(screen.getByLabelText(/Nome completo/), { target: { value: 'Carla Nova' } })
  fireEvent.change(screen.getByLabelText(/E-mail de login/), { target: { value: 'carla@fwlog.com.br' } })
  fireEvent.change(screen.getByLabelText(/^Senha/), { target: { value: 'Senha123' } })
  fireEvent.change(screen.getByLabelText(/Confirmar senha/), { target: { value: 'Senha123' } })
  fireEvent.click(screen.getByRole('button', { name: 'Criar usuário' }))
  expect(screen.getByText('Selecione o setor do usuário.')).toBeTruthy()
  expect(mocks.createUser).not.toHaveBeenCalled()
})

it('recusa criacao quando a confirmacao de senha nao confere', () => {
  renderAdmin()
  fireEvent.click(screen.getByRole('button', { name: 'Novo usuário' }))
  fireEvent.change(screen.getByLabelText(/Nome completo/), { target: { value: 'Carla Nova' } })
  fireEvent.change(screen.getByLabelText(/E-mail de login/), { target: { value: 'carla@fwlog.com.br' } })
  fireEvent.change(screen.getByLabelText(/Setor/), { target: { value: 'documentacao' } })
  fireEvent.change(screen.getByLabelText(/^Senha/), { target: { value: 'Senha123' } })
  fireEvent.change(screen.getByLabelText(/Confirmar senha/), { target: { value: 'Senha124' } })
  fireEvent.click(screen.getByRole('button', { name: 'Criar usuário' }))
  expect(screen.getByText('As senhas não conferem.')).toBeTruthy()
  expect(mocks.createUser).not.toHaveBeenCalled()
})

it('cria o usuario com os dados preenchidos', async () => {
  mocks.createUser.mockResolvedValue(undefined)
  renderAdmin()
  fireEvent.click(screen.getByRole('button', { name: 'Novo usuário' }))
  fireEvent.change(screen.getByLabelText(/Nome completo/), { target: { value: 'Carla Nova' } })
  fireEvent.change(screen.getByLabelText(/E-mail de login/), { target: { value: 'Carla@FWLog.com.br' } })
  fireEvent.change(screen.getByLabelText(/Setor/), { target: { value: 'documentacao' } })
  fireEvent.change(screen.getByLabelText(/^Senha/), { target: { value: 'Senha123' } })
  fireEvent.change(screen.getByLabelText(/Confirmar senha/), { target: { value: 'Senha123' } })
  fireEvent.click(screen.getByRole('button', { name: 'Criar usuário' }))
  await waitFor(() => expect(mocks.createUser).toHaveBeenCalledWith({
    full_name: 'Carla Nova',
    email: 'carla@fwlog.com.br',
    password: 'Senha123',
    role: 'documentacao',
  }))
})

it('desativa pela Edge Function, que tambem encerra a sessao', async () => {
  mocks.deactivateUser.mockResolvedValue(undefined)
  renderAdmin()
  fireEvent.click(screen.getAllByRole('button', { name: 'Desativar' })[0])
  await waitFor(() => expect(mocks.deactivateUser).toHaveBeenCalledWith('u-1'))
})

it('mostra as informacoes do sistema na aba Metricas, nao no topo da tela', () => {
  renderAdmin()
  expect(screen.queryByText('Informações do sistema')).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: 'Métricas' }))
  expect(screen.getByText('Informações do sistema')).toBeTruthy()
})

it('solicita confirmação com diff ao alterar credenciais de acesso', async () => {
  mocks.updateUserCredentials.mockResolvedValue(undefined)
  renderAdmin()
  fireEvent.click(screen.getAllByRole('button', { name: 'Editar acesso' })[0])
  fireEvent.change(screen.getByLabelText(/E-mail de login/), { target: { value: 'novo@fwlog.com.br' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
    title: 'Alterar credenciais de acesso',
    changes: expect.arrayContaining([
      expect.objectContaining({ field: 'E-mail', after: 'novo@fwlog.com.br' }),
    ]),
  })))
  expect(mocks.updateUserCredentials).toHaveBeenCalled()
})

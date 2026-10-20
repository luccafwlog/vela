// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  showToast: vi.fn(),
  listAllUserProfiles: vi.fn(),
  updateUserProfile: vi.fn(),
  restoreUserRole: vi.fn(),
  authUserId: 'u-admin' as string | null,
  createUser: vi.fn(),
  updateUserCredentials: vi.fn(),
  deactivateUser: vi.fn(),
  reactivateCatalogRow: vi.fn(),
  mutate: vi.fn(),
  confirm: vi.fn(),
  errorByKey: {} as Record<string, unknown>,
  dataByKey: {} as Record<string, unknown>,
}))

const users = [
  { id: 'u-1', full_name: 'Alice Operadora', role: 'operacoes', active: true, created_at: '2026-01-02T00:00:00Z', email: 'alice@fwlog.com.br', last_sign_in_at: '2026-08-01T12:00:00Z', email_bounced: true },
  { id: 'u-2', full_name: 'Bruno Inativo', role: 'financeiro', active: false, created_at: '2026-01-03T00:00:00Z', email: 'bruno@fwlog.com.br', last_sign_in_at: null },
  { id: 'u-3', full_name: 'Carla Nunca', role: 'documentacao', active: true, created_at: '2026-01-04T00:00:00Z', email: 'carla@fwlog.com.br', last_sign_in_at: null },
]

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = queryKey[0] as string
    const error = mocks.errorByKey[key] ?? null
    if (key === 'admin-users') return { data: error ? undefined : users, isLoading: false, error }
    return { data: error ? undefined : mocks.dataByKey[key], isLoading: false, error }
  },
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useMutation: (opts: { mutationFn: (vars: unknown) => unknown; onSuccess?: (data: unknown, vars: unknown) => void; onError?: (err: unknown, vars: unknown) => void }) => ({
    // Como o React Query, a falha vai para onError em vez de virar rejeição solta.
    mutate: (vars: unknown) => {
      mocks.mutate(vars)
      return Promise.resolve()
        .then(() => opts.mutationFn(vars))
        .then((data) => opts.onSuccess?.(data, vars), (err) => opts.onError?.(err, vars))
    },
    isPending: false,
  }),
}))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm, useConfirmWithReason: () => async (options: unknown) => ((await mocks.confirm(options)) ? 'motivo' : null) }))
vi.mock('../../services/supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.authUserId ? { id: mocks.authUserId } : null }) }))
vi.mock('../../services/deleteRecords', () => ({ reactivateCatalogRow: mocks.reactivateCatalogRow }))
vi.mock('../../services/adminUsers', async (importActual) => {
  const actual = await importActual<typeof import('../../services/adminUsers')>()
  return {
    ...actual,
    listAllUserProfiles: mocks.listAllUserProfiles,
    updateUserProfile: mocks.updateUserProfile,
    restoreUserRole: mocks.restoreUserRole,
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

function userRow(name: string) {
  return screen.getByText(name).closest('tr') as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.errorByKey = {}
  mocks.dataByKey = {}
  mocks.updateUserProfile.mockResolvedValue(undefined)
  mocks.restoreUserRole.mockResolvedValue(true)
  mocks.authUserId = 'u-admin'
  mocks.confirm.mockResolvedValue(true)
})
afterEach(cleanup)

it('mostra as cinco abas com os nomes aprovados', () => {
  renderAdmin()
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
    'Usuários', 'Falhas de entrega de alertas', 'Histórico de ações', 'Sistema', 'Prazo do ADR',
  ])
})

it('lista os ativos por padrão, com e-mail em coluna própria, setor e situação em texto', () => {
  renderAdmin()
  expect(screen.getByText('Alice Operadora')).toBeTruthy()
  expect(screen.queryByText('Bruno Inativo')).toBeNull()
  const alice = userRow('Alice Operadora')
  expect(within(alice).getByText('alice@fwlog.com.br')).toBeTruthy()
  expect(within(alice).getByText('Operações')).toBeTruthy()
  expect(within(alice).getByText('Ativo')).toBeTruthy()
  // O setor não se troca mais na linha (decidido: só em "Editar acesso").
  expect(within(alice).queryByRole('combobox')).toBeNull()
})

it('a linha inativa aparece em cinza com a Situação "Todos"', () => {
  renderAdmin()
  fireEvent.change(screen.getByLabelText('Situação'), { target: { value: 'todos' } })
  const bruno = userRow('Bruno Inativo')
  expect(bruno.className).toContain('app-table__row--muted')
  expect(within(bruno).getByText('Inativo')).toBeTruthy()
  expect(within(bruno).getByRole('button', { name: 'Reativar Bruno Inativo' })).toBeTruthy()
})

it('marca o e-mail devolvido em âmbar, com o motivo ao passar o mouse', () => {
  renderAdmin()
  const icons = screen.getAllByRole('img', { name: 'E-mail devolvido' })
  expect(icons).toHaveLength(1)
  const cell = icons[0].closest('td') as HTMLElement
  expect(cell.textContent).toContain('alice@fwlog.com.br')
  expect(cell.getAttribute('title')).toMatch(/devolvido/)
})

it('mostra "Nunca acessou" para quem nunca entrou', () => {
  renderAdmin()
  expect(within(userRow('Carla Nunca')).getByText('Nunca acessou')).toBeTruthy()
})

it('filtra por busca e por setor', () => {
  renderAdmin()
  fireEvent.change(screen.getByLabelText('Buscar por nome ou e-mail'), { target: { value: 'carla@' } })
  expect(screen.queryByText('Alice Operadora')).toBeNull()
  expect(screen.getByText('Carla Nunca')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Buscar por nome ou e-mail'), { target: { value: '' } })
  fireEvent.change(screen.getByLabelText('Setor'), { target: { value: 'operacoes' } })
  expect(screen.getByText('Alice Operadora')).toBeTruthy()
  expect(screen.queryByText('Carla Nunca')).toBeNull()
})

it('desativa pela Edge Function depois de confirmar', async () => {
  mocks.deactivateUser.mockResolvedValue(undefined)
  renderAdmin()
  fireEvent.click(within(userRow('Alice Operadora')).getByRole('button', { name: 'Desativar Alice Operadora' }))
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
  await waitFor(() => expect(mocks.deactivateUser).toHaveBeenCalledWith('u-1'))
})

it('cancelar a confirmação não desativa o usuário', async () => {
  mocks.confirm.mockResolvedValue(false)
  renderAdmin()
  fireEvent.click(within(userRow('Alice Operadora')).getByRole('button', { name: 'Desativar Alice Operadora' }))
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
  expect(mocks.deactivateUser).not.toHaveBeenCalled()
})

it('A7: Reativar não repete a chamada enquanto a primeira está em andamento', async () => {
  mocks.reactivateCatalogRow.mockReturnValue(new Promise(() => {}))
  renderAdmin()
  fireEvent.change(screen.getByLabelText('Situação'), { target: { value: 'inativos' } })
  const button = within(userRow('Bruno Inativo')).getByRole('button', { name: 'Reativar Bruno Inativo' })
  fireEvent.click(button)
  await waitFor(() => expect(mocks.reactivateCatalogRow).toHaveBeenCalledWith('user_profiles', 'u-2', 'motivo'))
  fireEvent.click(button)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(mocks.reactivateCatalogRow).toHaveBeenCalledTimes(1)
  expect(mocks.confirm).toHaveBeenCalledTimes(1)
})

it('troca o setor em "Editar acesso", com a lista do que a pessoa poderá fazer e confirmação', async () => {
  renderAdmin()
  fireEvent.click(within(userRow('Alice Operadora')).getByRole('button', { name: 'Editar acesso de Alice Operadora' }))
  const dialog = screen.getByRole('dialog')
  const canList = () => within(dialog).getByText('Com este setor, Alice pode').nextElementSibling as HTMLElement
  expect(within(canList()).queryByText('Registrar pagamento (baixa manual) e confirmar Restituição')).toBeNull()
  fireEvent.change(within(dialog).getByLabelText('Setor'), { target: { value: 'financeiro' } })
  // A lista muda na hora, antes de salvar.
  expect(within(canList()).getByText('Registrar pagamento (baixa manual) e confirmar Restituição')).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
    title: 'Alterar setor',
    changes: [expect.objectContaining({ field: 'Setor', before: 'Operações', after: 'Financeiro' })],
  })))
  await waitFor(() => expect(mocks.updateUserProfile).toHaveBeenCalledWith('u-1', { role: 'financeiro' }))
  expect(mocks.updateUserCredentials).not.toHaveBeenCalled()
})

function changeSectorAndPassword() {
  fireEvent.click(within(userRow('Alice Operadora')).getByRole('button', { name: 'Editar acesso de Alice Operadora' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByLabelText('Setor'), { target: { value: 'financeiro' } })
  fireEvent.change(within(dialog).getByLabelText('Nova senha'), { target: { value: 'SenhaNova#2026' } })
  fireEvent.change(within(dialog).getByLabelText('Confirmar nova senha'), { target: { value: 'SenhaNova#2026' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
}

it('devolve o setor anterior quando a troca de senha falha na mesma edição, e diz isso', async () => {
  mocks.updateUserCredentials.mockRejectedValueOnce(new Error('Falhou a troca de senha.'))
  renderAdmin()
  changeSectorAndPassword()
  await waitFor(() => expect(mocks.restoreUserRole).toHaveBeenCalledWith('u-1', 'financeiro', 'operacoes'))
  expect(mocks.updateUserProfile).toHaveBeenCalledTimes(1)
  expect(mocks.updateUserProfile).toHaveBeenCalledWith('u-1', { role: 'financeiro' })
  await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('Falhou a troca de senha. O setor voltou a Operações.', 'error'))
})

it('avisa que o setor não voltou quando a volta é recusada ou alguém já o trocou', async () => {
  mocks.updateUserCredentials.mockRejectedValueOnce(new Error('Falhou a troca de senha.'))
  mocks.restoreUserRole.mockRejectedValueOnce(new Error('permission denied'))
  renderAdmin()
  changeSectorAndPassword()
  await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith(
    'Falhou a troca de senha. O setor ficou como Financeiro e não voltou a Operações; confira em Editar acesso.', 'error'))
  // A lista relê para mostrar o setor que ficou.
  expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin-users'] })

  vi.clearAllMocks()
  mocks.confirm.mockResolvedValue(true)
  mocks.updateUserCredentials.mockRejectedValueOnce(new Error('Falhou a troca de senha.'))
  mocks.restoreUserRole.mockResolvedValueOnce(false)
  cleanup()
  renderAdmin()
  changeSectorAndPassword()
  await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('não voltou a Operações'), 'error'))
})

it('na própria linha, o Setor fica travado com a explicação e só a credencial é enviada', async () => {
  mocks.authUserId = 'u-1'
  mocks.updateUserCredentials.mockResolvedValue({ released: 0 })
  renderAdmin()
  fireEvent.click(within(userRow('Alice Operadora')).getByRole('button', { name: 'Editar acesso de Alice Operadora' }))
  const dialog = screen.getByRole('dialog')
  const sectorSelect = within(dialog).getByLabelText('Setor') as HTMLSelectElement
  expect(sectorSelect.disabled).toBe(true)
  expect(within(dialog).getByText(/só pode ser trocado por outra pessoa do Administrativo/)).toBeTruthy()
  fireEvent.change(within(dialog).getByLabelText('Nova senha'), { target: { value: 'SenhaNova#2026' } })
  fireEvent.change(within(dialog).getByLabelText('Confirmar nova senha'), { target: { value: 'SenhaNova#2026' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
  await waitFor(() => expect(mocks.updateUserCredentials).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u-1', password: 'SenhaNova#2026' })))
  expect(mocks.updateUserProfile).not.toHaveBeenCalled()
})

it('a linha de outra pessoa continua com o Setor liberado', () => {
  renderAdmin()
  fireEvent.click(within(userRow('Carla Nunca')).getByRole('button', { name: 'Editar acesso de Carla Nunca' }))
  expect((within(screen.getByRole('dialog')).getByLabelText('Setor') as HTMLSelectElement).disabled).toBe(false)
})

it('salvar o acesso relê também o Histórico de ações', async () => {
  renderAdmin()
  fireEvent.click(within(userRow('Alice Operadora')).getByRole('button', { name: 'Editar acesso de Alice Operadora' }))
  fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Setor'), { target: { value: 'financeiro' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
  await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin-audit-logs'] }))
  expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin-users'] })
})

it('o mesmo e-mail em outra caixa de letra não conta como troca de e-mail', async () => {
  mocks.updateUserCredentials.mockResolvedValue({ released: 1 })
  renderAdmin()
  fireEvent.click(within(userRow('Alice Operadora')).getByRole('button', { name: 'Editar acesso de Alice Operadora' }))
  fireEvent.change(screen.getByLabelText(/E-mail de login/), { target: { value: 'ALICE@fwlog.com.br' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
    changes: [expect.objectContaining({ field: 'E-mail', after: 'Liberado para receber de novo' })],
  })))
})

it('não troca o setor quando a confirmação é recusada', async () => {
  mocks.confirm.mockResolvedValue(false)
  renderAdmin()
  fireEvent.click(within(userRow('Alice Operadora')).getByRole('button', { name: 'Editar acesso de Alice Operadora' }))
  fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Setor'), { target: { value: 'financeiro' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
  expect(mocks.updateUserProfile).not.toHaveBeenCalled()
})

it('mostra "O que cada setor pode" sem o papel extinto, com as ações exclusivas por padrão', () => {
  renderAdmin()
  const matrix = screen.getByRole('region', { name: 'O que cada setor pode' })
  expect(within(matrix).getByText('Cancelar e reativar Viagem e B/L, com motivo')).toBeTruthy()
  expect(within(matrix).queryByText('Importar arquivos (B/L, CE, Baplie, veículos, Vazios, Granito, datas, Clientes)')).toBeNull()
  fireEvent.click(within(matrix).getByRole('radio', { name: 'Todas as ações' }))
  expect(within(matrix).getByText('Importar arquivos (B/L, CE, Baplie, veículos, Vazios, Granito, datas, Clientes)')).toBeTruthy()
  expect(document.body.textContent).not.toMatch(/Administrador\b|fallback/)
})

it('A5: com a consulta em erro, mostra o erro e não "nenhum usuário"', () => {
  mocks.errorByKey = { 'admin-users': new Error('down') }
  renderAdmin()
  expect(screen.getByText('Não foi possível carregar os usuários.')).toBeTruthy()
  expect(screen.queryByText('Nenhum usuário com estes filtros.')).toBeNull()
})

it('exige o setor para criar um usuário', () => {
  renderAdmin()
  fireEvent.click(screen.getByRole('button', { name: 'Novo usuário' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByLabelText(/Nome completo/), { target: { value: 'Carla Nova' } })
  fireEvent.change(within(dialog).getByLabelText(/E-mail de login/), { target: { value: 'carla@fwlog.com.br' } })
  fireEvent.change(within(dialog).getByLabelText(/^Senha/), { target: { value: 'Senha123' } })
  fireEvent.change(within(dialog).getByLabelText(/Confirmar senha/), { target: { value: 'Senha123' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Criar usuário' }))
  expect(screen.getByText('Selecione o setor do usuário.')).toBeTruthy()
  expect(mocks.createUser).not.toHaveBeenCalled()
})

it('cria o usuário com os dados preenchidos e mostra o que o setor poderá fazer', async () => {
  mocks.createUser.mockResolvedValue(undefined)
  renderAdmin()
  fireEvent.click(screen.getByRole('button', { name: 'Novo usuário' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByLabelText(/Nome completo/), { target: { value: 'Carla Nova' } })
  fireEvent.change(within(dialog).getByLabelText(/E-mail de login/), { target: { value: 'Carla@FWLog.com.br' } })
  fireEvent.change(within(dialog).getByLabelText(/Setor/), { target: { value: 'documentacao' } })
  expect(within(dialog).getByText('Com este setor, Carla pode')).toBeTruthy()
  fireEvent.change(within(dialog).getByLabelText(/^Senha/), { target: { value: 'Senha123' } })
  fireEvent.change(within(dialog).getByLabelText(/Confirmar senha/), { target: { value: 'Senha123' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Criar usuário' }))
  await waitFor(() => expect(mocks.createUser).toHaveBeenCalledWith({
    full_name: 'Carla Nova',
    email: 'carla@fwlog.com.br',
    password: 'Senha123',
    role: 'documentacao',
  }))
})

it('recusa a criação quando a confirmação de senha não confere', () => {
  renderAdmin()
  fireEvent.click(screen.getByRole('button', { name: 'Novo usuário' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByLabelText(/Nome completo/), { target: { value: 'Carla Nova' } })
  fireEvent.change(within(dialog).getByLabelText(/E-mail de login/), { target: { value: 'carla@fwlog.com.br' } })
  fireEvent.change(within(dialog).getByLabelText(/Setor/), { target: { value: 'documentacao' } })
  fireEvent.change(within(dialog).getByLabelText(/^Senha/), { target: { value: 'Senha123' } })
  fireEvent.change(within(dialog).getByLabelText(/Confirmar senha/), { target: { value: 'Senha124' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Criar usuário' }))
  expect(screen.getByText('As senhas não conferem.')).toBeTruthy()
  expect(mocks.createUser).not.toHaveBeenCalled()
})

it('solicita confirmação com diff ao alterar credenciais de acesso', async () => {
  mocks.updateUserCredentials.mockResolvedValue({ released: 1 })
  renderAdmin()
  fireEvent.click(within(userRow('Alice Operadora')).getByRole('button', { name: 'Editar acesso de Alice Operadora' }))
  fireEvent.change(screen.getByLabelText(/E-mail de login/), { target: { value: 'novo@fwlog.com.br' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
    title: 'Alterar credenciais de acesso',
    changes: expect.arrayContaining([
      expect.objectContaining({ field: 'E-mail', after: 'novo@fwlog.com.br' }),
    ]),
  })))
  await waitFor(() => expect(mocks.updateUserCredentials).toHaveBeenCalled())
  expect(mocks.updateUserProfile).not.toHaveBeenCalled()
})

it('salvar o mesmo e-mail devolvido libera a supressão (plano dos e-mails, 2.8)', async () => {
  mocks.updateUserCredentials.mockResolvedValue({ released: 1 })
  renderAdmin()
  fireEvent.click(within(userRow('Alice Operadora')).getByRole('button', { name: 'Editar acesso de Alice Operadora' }))
  expect(screen.getByText(/salve o mesmo e-mail para liberá-lo/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
    changes: [expect.objectContaining({ field: 'E-mail', after: 'Liberado para receber de novo' })],
  })))
  await waitFor(() => expect(mocks.updateUserCredentials).toHaveBeenCalledWith(expect.objectContaining({ email: 'alice@fwlog.com.br' })))
})

it('redefinir só a senha de um e-mail devolvido não libera a supressão', async () => {
  mocks.updateUserCredentials.mockResolvedValue({ released: 0 })
  renderAdmin()
  fireEvent.click(within(userRow('Alice Operadora')).getByRole('button', { name: 'Editar acesso de Alice Operadora' }))
  fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'NovaSenha#2026' } })
  fireEvent.change(screen.getByLabelText('Confirmar nova senha'), { target: { value: 'NovaSenha#2026' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
  await waitFor(() => expect(mocks.updateUserCredentials).toHaveBeenCalled())
  expect(mocks.updateUserCredentials).toHaveBeenCalledWith(expect.objectContaining({ email: undefined, password: 'NovaSenha#2026' }))
  await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('Acesso atualizado.', 'success'))
})

it('avisa quando o e-mail devolvido continua bloqueado por ser também de Cliente', async () => {
  mocks.updateUserCredentials.mockResolvedValue({ released: 0 })
  renderAdmin()
  fireEvent.click(within(userRow('Alice Operadora')).getByRole('button', { name: 'Editar acesso de Alice Operadora' }))
  fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
  await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('continua bloqueado'), 'error'))
})

it('os endereços antigos das abas continuam abrindo a aba certa', () => {
  mocks.dataByKey = { 'admin-audit-logs': { rows: [], count: 0 } }
  renderAdmin('logs')
  expect(screen.getByRole('tab', { name: 'Histórico de ações' }).getAttribute('aria-selected')).toBe('true')
})

it('Histórico de ações: pessoa pelo nome, "Sistema" sem autor, assunto e frase em português', () => {
  mocks.dataByKey = {
    'admin-audit-logs': {
      count: 2,
      rows: [
        { id: 1, entity_type: 'granite_rates', entity_id: '7', field_name: 'criado', old_value: null, new_value: '{"id": 7, "description": "THC Granito", "unit_value": 45, "currency": "BRL"}', changed_by: null, changed_at: '2026-10-20T00:04:00Z', justification: null, changer_name: null },
        { id: 2, entity_type: 'user_profile', entity_id: 'u-3', field_name: 'role', old_value: 'documentacao', new_value: 'financeiro', changed_by: 'u-1', changed_at: '2026-10-19T21:02:00Z', justification: 'Mudou de área', changer_name: 'Alice Operadora' },
      ],
    },
  }
  renderAdmin('historico')
  const created = screen.getByText('Tarifa criada: THC Granito').closest('tr') as HTMLElement
  expect(within(created).getByText('Sistema')).toBeTruthy()
  expect(within(created).getByText('Tarifa do Granito')).toBeTruthy()
  expect(within(created).getByText('19/10/2026 21:04')).toBeTruthy()
  const role = screen.getByText('Setor: Financeiro').closest('tr') as HTMLElement
  expect(within(role).getByText('Alice Operadora')).toBeTruthy()
  expect(within(role).getByText('Usuário')).toBeTruthy()
  // O registro alterado: o Usuário pelo nome da lista já carregada; os demais pelo identificador.
  expect(within(role).getByText('Carla Nunca')).toBeTruthy()
  expect(within(created).getByText('7')).toBeTruthy()
  fireEvent.click(within(role).getByRole('button', { name: /Abrir/ }))
  const detail = role.nextElementSibling as HTMLElement
  expect(within(detail).getByText('Documentação')).toBeTruthy()
  expect(within(detail).getByText('Financeiro')).toBeTruthy()
  expect(within(detail).getByText('Mudou de área')).toBeTruthy()
  expect(document.body.textContent).not.toMatch(/granite_rates|user_profile|u-1/)
  // Os filtros têm nome em português e a lista de pessoas no lugar do número interno.
  expect(screen.getByLabelText('Assunto')).toBeTruthy()
  expect(within(screen.getByLabelText('Por')).getByRole('option', { name: 'Sistema' })).toBeTruthy()
  expect(screen.getByLabelText('Até')).toBeTruthy()
})

it('Histórico de ações: ADR reaberto em português, com o registro', () => {
  mocks.dataByKey = {
    'admin-audit-logs': {
      count: 1,
      rows: [
        { id: 3, entity_type: 'agency_departure_report', entity_id: '99::BRSSZ', field_name: 'status', old_value: 'closed', new_value: 'open', changed_by: 'u-1', changed_at: '2026-10-19T21:02:00Z', justification: 'Faltou assinatura', changer_name: 'Alice Operadora' },
      ],
    },
  }
  renderAdmin('historico')
  const row = screen.getByText('ADR de Saída reaberto').closest('tr') as HTMLElement
  expect(within(row).getByText('99 · BRSSZ')).toBeTruthy()
  fireEvent.click(within(row).getByRole('button', { name: /Abrir/ }))
  const detail = row.nextElementSibling as HTMLElement
  expect(within(detail).getByText('Fechado')).toBeTruthy()
  expect(within(detail).getByText('Aberto')).toBeTruthy()
  expect(document.body.textContent).not.toMatch(/\bopen\b|\bclosed\b/)
})

it('"O que cada setor pode": grupo e ação são cabeçalhos da linha', () => {
  renderAdmin()
  const matrix = screen.getByRole('region', { name: 'O que cada setor pode' })
  const action = within(matrix).getByRole('rowheader', { name: 'Cancelar e reativar Viagem e B/L, com motivo' })
  expect(action.getAttribute('scope')).toBe('row')
  const group = matrix.querySelector('th[scope="rowgroup"]') as HTMLElement
  expect(group).toBeTruthy()
  expect(group.getAttribute('colspan')).toBe('6')
})

it('A5: Histórico em erro não diz "nenhuma ação"', () => {
  mocks.errorByKey = { 'admin-audit-logs': new Error('logs down') }
  renderAdmin('historico')
  expect(screen.getByText('Não foi possível carregar o histórico de ações.')).toBeTruthy()
  expect(screen.queryByText('Nenhuma ação registrada.')).toBeNull()
})

it('Sistema: versão, ambiente da configuração e as datas que dizem o que medem', () => {
  mocks.dataByKey = { 'admin-metrics': { lastVoyageCreatedAt: '2026-10-20T00:03:00Z', lastInvoiceIssuedAt: null } }
  renderAdmin('sistema')
  expect(screen.getByText('Versão')).toBeTruthy()
  expect(screen.getByText('Ambiente')).toBeTruthy()
  expect(screen.getByText('Última viagem criada')).toBeTruthy()
  expect(screen.getByText('19/10/2026 21:03')).toBeTruthy()
  expect(screen.getByText('Última fatura emitida')).toBeTruthy()
  expect(screen.queryByText('Operacional')).toBeNull()
  expect(screen.queryByText(/conciliação Pix/i)).toBeNull()
})

it('Sistema: erro de consulta tem mensagem própria', () => {
  mocks.errorByKey = { 'admin-metrics': new Error('metrics down') }
  renderAdmin('sistema')
  expect(screen.getByText('Não foi possível carregar as datas do sistema.')).toBeTruthy()
})

it('Prazo do ADR: cartões "x de y no prazo" e células em texto (A6)', () => {
  mocks.dataByKey = {
    'agency-report-sla': [{
      voyageId: 1, port: 'BRSSZ', terminal: 'BTP', voyageNumber: '012S', vesselName: 'XIN PU DONG',
      atd: '2026-09-08', deadlineDate: '2026-09-11', deadlineAt: '2026-09-11T12:00:00Z',
      closedAt: '2026-09-11T15:00:00Z', closedBy: null, elapsedCalendarDaysToClosure: 3,
      departments: [
        { department: 'operacoes', label: 'Operações', signedAt: '2026-09-10T10:00:00Z', hoursElapsed: 40, state: 'on-time', outcome: 'on-time', hoursLate: null },
        { department: 'documentacao', label: 'Documentação', signedAt: '2026-09-11T18:00:00Z', hoursElapsed: 80, state: 'overdue', outcome: 'late', hoursLate: 6 },
        { department: 'equipamentos', label: 'Equipamentos', signedAt: null, hoursElapsed: null, state: 'no-deadline', outcome: 'unsigned', hoursLate: null },
      ],
    }],
  }
  renderAdmin('prazo-do-adr')
  const row = screen.getByText('XIN PU DONG / 012S').closest('tr') as HTMLElement
  expect(within(row).getByText('No prazo').getAttribute('title')).toMatch(/^Assinou em 10\/09\/2026/)
  expect(within(row).getByText('Atrasou 6 h')).toBeTruthy()
  expect(within(row).getByText('Não assinou')).toBeTruthy()
  expect(within(row).getByText('3 dias')).toBeTruthy()
  expect(within(row).getByText('3 dias').getAttribute('title')).toBe('Fechado em 11/09/2026 12:00')
  expect(screen.getByRole('columnheader', { name: 'Dias corridos do ATD ao Fechamento' })).toBeTruthy()
  expect(screen.getAllByText('1 de 1')).toHaveLength(1)
  expect(screen.queryByText('Sem prazo')).toBeNull()
})

it('Prazo do ADR vazio não fala em "snapshots"', () => {
  mocks.dataByKey = { 'agency-report-sla': [] }
  renderAdmin('prazo-do-adr')
  expect(screen.getByText('Nenhum ADR fechado no período.')).toBeTruthy()
  expect(document.body.textContent).not.toMatch(/snapshot/i)
})

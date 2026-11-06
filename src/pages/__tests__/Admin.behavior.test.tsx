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
  isDev: false,
  setCommunicationsEnabled: vi.fn(),
  sendAdminTestEmail: vi.fn(),
  fetchActionHistoryForExport: vi.fn(),
  exportActionHistoryWorkbook: vi.fn(),
  signOut: vi.fn(),
  createUser: vi.fn(),
  updateUserCredentials: vi.fn(),
  deactivateUser: vi.fn(),
  reactivateCatalogRow: vi.fn(),
  mutate: vi.fn(),
  confirm: vi.fn(),
  errorByKey: {} as Record<string, unknown>,
  dataByKey: {} as Record<string, unknown>,
  queryKeys: [] as unknown[][],
}))

const users = [
  { id: 'u-1', full_name: 'Alice Operadora', role: 'operacoes', active: true, created_at: '2026-01-02T00:00:00Z', email: 'alice@fwlog.com.br', last_sign_in_at: '2026-08-01T12:00:00Z', email_bounced: true, account_kind: 'pessoa' },
  // Conta técnica da baixa automática do Pix (migration 440): e-mail suprimido de propósito.
  { id: 'u-itau', full_name: 'API ITAÚ', role: 'financeiro', active: true, created_at: '2026-10-07T00:00:00Z', email: 'api-itau@fwlog.com.br', last_sign_in_at: null, email_bounced: true, account_kind: 'integracao' },
  { id: 'u-2', full_name: 'Bruno Inativo', role: 'financeiro', active: false, created_at: '2026-01-03T00:00:00Z', email: 'bruno@fwlog.com.br', last_sign_in_at: null },
  { id: 'u-3', full_name: 'Carla Nunca', role: 'documentacao', active: true, created_at: '2026-01-04T00:00:00Z', email: 'carla@fwlog.com.br', last_sign_in_at: null },
  // Marca Dev (migration 469): só vale no Administrativo; em outro setor não aparece.
  { id: 'u-dev', full_name: 'Dono Dev', role: 'administrativo', active: true, created_at: '2026-01-05T00:00:00Z', email: 'dono@fwlog.com.br', last_sign_in_at: null, account_kind: 'pessoa', is_dev: true },
  { id: 'u-4', full_name: 'Davi Marcado', role: 'equipamentos', active: true, created_at: '2026-01-06T00:00:00Z', email: 'davi@fwlog.com.br', last_sign_in_at: null, account_kind: 'pessoa', is_dev: true },
]

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    mocks.queryKeys.push(queryKey)
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
    mutateAsync: (vars: unknown) => {
      mocks.mutate(vars)
      return Promise.resolve().then(() => opts.mutationFn(vars))
    },
    isPending: false,
  }),
}))
vi.mock('../../services/appSettings', async (importActual) => ({
  ...(await importActual<typeof import('../../services/appSettings')>()),
  setCommunicationsEnabled: mocks.setCommunicationsEnabled,
}))
vi.mock('../../services/adminObservability', async (importActual) => ({
  ...(await importActual<typeof import('../../services/adminObservability')>()),
  sendAdminTestEmail: mocks.sendAdminTestEmail,
  fetchActionHistoryForExport: mocks.fetchActionHistoryForExport,
}))
vi.mock('../../services/exports', () => ({ exportActionHistoryWorkbook: mocks.exportActionHistoryWorkbook }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm, useConfirmWithReason: () => async (options: unknown) => ((await mocks.confirm(options)) ? 'motivo' : null) }))
vi.mock('../../services/supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.authUserId ? { id: mocks.authUserId } : null, signOut: mocks.signOut, isDev: mocks.isDev }) }))
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
  mocks.queryKeys = []
  mocks.updateUserProfile.mockResolvedValue(undefined)
  mocks.restoreUserRole.mockResolvedValue(true)
  mocks.authUserId = 'u-admin'
  mocks.isDev = false
  mocks.confirm.mockResolvedValue(true)
})
afterEach(cleanup)

it('a conta Dev vê Usuários, Histórico de ações e Sistema (decisões de 2026-11-06)', () => {
  mocks.isDev = true
  renderAdmin()
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Usuários', 'Histórico de ações', 'Sistema'])
})

it('o Administrativo sem a marca Dev vê só Usuários e Histórico de ações', () => {
  renderAdmin()
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Usuários', 'Histórico de ações'])
})

it('o endereço /admin/sistema, sem a marca Dev, diz que a aba é da conta Dev e não lê os dados', () => {
  renderAdmin('sistema')
  expect(screen.getByRole('alert').textContent).toContain('Esta aba é exclusiva da conta Dev do Administrativo.')
  expect(screen.getByRole('link', { name: 'Ir para Usuários' }).getAttribute('href')).toBe('/admin/usuarios')
  expect(screen.queryByText('Pontos de atenção')).toBeNull()
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

it('badge "Integração" só na conta de integração, sem o aviso de e-mail devolvido', () => {
  renderAdmin()
  const badges = screen.getAllByText('Integração')
  expect(badges).toHaveLength(1)
  expect(badges[0].className).toContain('app-badge--blue')
  expect(badges[0].getAttribute('title')).toBe('Conta técnica da baixa automática do Pix; não é uma pessoa')
  const itau = userRow('API ITAÚ')
  expect(within(itau).getByText('Integração')).toBe(badges[0])
  expect(within(itau).queryByRole('img', { name: 'E-mail devolvido' })).toBeNull()
  expect((within(itau).getByText('api-itau@fwlog.com.br').closest('td') as HTMLElement).getAttribute('title')).toBe('api-itau@fwlog.com.br')
  for (const name of ['Alice Operadora', 'Carla Nunca']) expect(within(userRow(name)).queryByText('Integração')).toBeNull()
})

it('o Setor mostra "Administrativo · Dev" só para a conta do Administrativo com a marca Dev', () => {
  renderAdmin()
  expect(within(userRow('Dono Dev')).getByText('Administrativo · Dev')).toBeTruthy()
  expect(within(userRow('Davi Marcado')).queryByText(/· Dev/)).toBeNull()
  expect(within(userRow('Carla Nunca')).queryByText(/· Dev/)).toBeNull()
})

it('Editar acesso da conta de integração não convida a liberar o e-mail suprimido', async () => {
  renderAdmin()
  // Pessoa com e-mail devolvido: a janela explica como liberar.
  fireEvent.click(within(userRow('Alice Operadora')).getByRole('button', { name: 'Editar acesso de Alice Operadora' }))
  await waitFor(() => expect(screen.getByText(/Este e-mail foi devolvido/)).toBeTruthy())
  cleanup()
  renderAdmin()
  fireEvent.click(within(userRow('API ITAÚ')).getByRole('button', { name: 'Editar acesso de API ITAÚ' }))
  await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
  expect(screen.queryByText(/Este e-mail foi devolvido/)).toBeNull()
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

it('desativar a última pessoa ativa da equipe avisa que os alertas dela ficam sem destinatário (2026-11-06)', async () => {
  mocks.deactivateUser.mockResolvedValue(undefined)
  renderAdmin()
  // Alice é a única pessoa ativa de Operações na lista.
  fireEvent.click(within(userRow('Alice Operadora')).getByRole('button', { name: 'Desativar Alice Operadora' }))
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
  expect(mocks.confirm.mock.calls[0][0].message).toMatch(/Alice Operadora é a última pessoa ativa de Operações/)
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

it('trocar a própria senha encerra a sessão, porque o token antigo já foi cortado', async () => {
  mocks.authUserId = 'u-1'
  mocks.updateUserCredentials.mockResolvedValue({ released: 0, sessionEnded: true })
  renderAdmin()
  fireEvent.click(within(userRow('Alice Operadora')).getByRole('button', { name: 'Editar acesso de Alice Operadora' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByLabelText('Nova senha'), { target: { value: 'SenhaNova#2026' } })
  fireEvent.change(within(dialog).getByLabelText('Confirmar nova senha'), { target: { value: 'SenhaNova#2026' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
  await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1))
  expect(mocks.showToast).toHaveBeenCalledWith('Acesso atualizado. Entre de novo com a nova credencial.', 'success')
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
  // Abre recolhido (decisão do dono de 2026-11-04).
  const toggle = within(matrix).getByRole('button', { name: 'Mostrar' })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(within(matrix).queryByRole('table')).toBeNull()
  expect(within(matrix).queryByRole('radio', { name: 'Todas as ações' })).toBeNull()
  fireEvent.click(toggle)
  expect(within(matrix).getByRole('button', { name: 'Recolher' }).getAttribute('aria-expanded')).toBe('true')
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

// Uma ação de uma linha só (migration 603): a frase é a da linha.
const historyRow = (patch: Record<string, unknown>) => ({
  action_key: `audit|${String(patch.id ?? 1)}|${String(patch.source ?? 'audit')}`, line_count: 1, entity_count: 1, groups: [],
  source: 'audit', id: 1, changed_at: '2026-10-20T00:04:00Z', entity_type: 'voyages', field_name: 'status', old_value: null, new_value: null,
  justification: null, action: 'alterou', actor_kind: 'equipe', actor_name: 'Alice Operadora', actor_email: 'alice@example.test',
  actor_department: 'documentacao', entity_label: null, old_label: null, new_label: null, value_labels: null, ...patch,
})

it('Histórico de ações: pessoa pelo nome, "Sistema" sem autor, assunto e frase em português', () => {
  mocks.dataByKey = {
    'admin-audit-logs': {
      count: 2,
      rows: [
        historyRow({ id: 1, entity_type: 'granite_rates', field_name: 'criado', new_value: '{"id": 7, "description": "THC Granito", "unit_value": 45, "currency": "BRL"}', action: 'criou', actor_kind: 'sistema', actor_name: null, actor_email: null, actor_department: null, entity_label: 'THC Granito' }),
        historyRow({ id: 2, entity_type: 'user_profile', field_name: 'role', old_value: 'documentacao', new_value: 'financeiro', changed_at: '2026-10-19T21:02:00Z', justification: 'Mudou de área', entity_label: 'Carla Nunca' }),
      ],
    },
  }
  renderAdmin('historico')
  const created = screen.getByText('Tarifa criada: THC Granito').closest('tr') as HTMLElement
  expect(within(created).getByText('Sistema')).toBeTruthy()
  expect(within(created).getByText('19/10/2026 21:04:00')).toBeTruthy()
  const role = screen.getByText('Setor: Financeiro').closest('tr') as HTMLElement
  expect(within(role).getByText('Alice Operadora')).toBeTruthy()
  // O registro pelo nome que o banco devolve; a justificativa na própria linha.
  expect(within(role).getByText('Carla Nunca')).toBeTruthy()
  expect(within(role).getByText('Mudou de área')).toBeTruthy()
  expect(within(role).getByText('Alice Operadora').getAttribute('title')).toBe('alice@example.test · Documentação')
  fireEvent.click(within(role).getByRole('button', { name: /Abrir/ }))
  const detail = role.nextElementSibling as HTMLElement
  expect(within(detail).getByText('Documentação')).toBeTruthy()
  expect(within(detail).getByText('Financeiro')).toBeTruthy()
  expect(within(detail).getByText(/alice@example\.test/)).toBeTruthy()
  expect(document.body.textContent).not.toMatch(/granite_rates|user_profile|u-1/)
  // Os filtros têm nome em português e a lista de pessoas no lugar do número interno.
  expect(screen.getByLabelText('Assunto')).toBeTruthy()
  expect(within(screen.getByLabelText('Por')).getByRole('option', { name: 'Sistema' })).toBeTruthy()
  expect(within(screen.getByLabelText('Por')).getByRole('option', { name: 'Cliente pelo Portal' })).toBeTruthy()
  expect(within(screen.getByLabelText('Ação')).getByRole('option', { name: 'Excluiu' })).toBeTruthy()
  // As datas aparecem ao escolher o período; a busca fica sempre à vista.
  expect(screen.getByLabelText('Busca')).toBeTruthy()
  fireEvent.click(screen.getByRole('radio', { name: 'Escolher datas' }))
  expect(screen.getByLabelText('Até')).toBeTruthy()
})

it('Histórico de ações: a busca lê o histórico depois da pausa de quem digita, não a cada letra', async () => {
  mocks.dataByKey = { 'admin-audit-logs': { count: 0, rows: [] } }
  renderAdmin('historico')
  const searched = () => mocks.queryKeys
    .filter((key) => key[0] === 'admin-audit-logs')
    .map((key) => (key[1] as { search?: string } | null)?.search)
  fireEvent.change(screen.getByLabelText('Busca'), { target: { value: 'MSCU1234567' } })
  expect(searched()).not.toContain('MSCU1234567')
  await waitFor(() => expect(searched()).toContain('MSCU1234567'))
})

it('Histórico de ações: com Assunto, a aba Filtros da planilha diz que vêm só as linhas que batem', async () => {
  mocks.dataByKey = { 'admin-audit-logs': { count: 1, rows: [] } }
  mocks.fetchActionHistoryForExport.mockResolvedValue({ rows: [], capped: false })
  mocks.exportActionHistoryWorkbook.mockResolvedValue(undefined)
  renderAdmin('historico')
  fireEvent.click(screen.getByRole('button', { name: 'Exportar planilha' }))
  await waitFor(() => expect(mocks.exportActionHistoryWorkbook).toHaveBeenCalledTimes(1))
  expect(mocks.exportActionHistoryWorkbook.mock.calls[0][1]).not.toContainEqual(expect.objectContaining({ Filtro: 'Linhas' }))
  const subject = screen.getByLabelText('Assunto') as HTMLSelectElement
  fireEvent.change(subject, { target: { value: subject.options[1].value } })
  fireEvent.click(screen.getByRole('button', { name: 'Exportar planilha' }))
  await waitFor(() => expect(mocks.exportActionHistoryWorkbook).toHaveBeenCalledTimes(2))
  expect(mocks.exportActionHistoryWorkbook.mock.calls[1][1]).toContainEqual({ Filtro: 'Linhas', Valor: 'Só as que batem com Busca, Assunto ou Ação; a tela mostra a ação inteira' })
})

it('Histórico de ações: ADR reaberto em português, com a Viagem pelo nome', () => {
  mocks.dataByKey = {
    'admin-audit-logs': {
      count: 1,
      rows: [
        historyRow({ id: 3, entity_type: 'agency_departure_report', field_name: 'status', old_value: 'closed', new_value: 'open', changed_at: '2026-10-19T21:02:00Z', justification: 'Faltou assinatura', entity_label: 'Rio de Janeiro / 012S · BRSSZ' }),
      ],
    },
  }
  renderAdmin('historico')
  const row = screen.getByText('ADR de Saída reaberto').closest('tr') as HTMLElement
  expect(within(row).getByText('Rio de Janeiro / 012S · BRSSZ')).toBeTruthy()
  fireEvent.click(within(row).getByRole('button', { name: /Abrir/ }))
  const detail = row.nextElementSibling as HTMLElement
  expect(within(detail).getByText('Fechado')).toBeTruthy()
  expect(within(detail).getByText('Aberto')).toBeTruthy()
  expect(document.body.textContent).not.toMatch(/\bopen\b|\bclosed\b/)
})

it('Histórico de ações: nunca mostra o número interno de um cadastro (Navio, Cliente)', () => {
  mocks.dataByKey = {
    'admin-audit-logs': {
      count: 4,
      rows: [
        historyRow({ id: 4, field_name: 'vessel_id', old_value: '37', new_value: '41', entity_label: 'Santos / 012S', old_label: 'Rio de Janeiro 2', new_label: 'Santos' }),
        historyRow({ id: 5, entity_type: 'bls', field_name: 'customer_id', old_value: '12', new_value: '13', entity_label: 'B/L MEDU1' }),
        historyRow({ id: 6, entity_type: 'vessels', field_name: 'criado', new_value: '{"id": 41, "name": "Santos", "carrier_id": 9}', action: 'criou', entity_label: 'Santos', value_labels: { carrier_id: 'Armador Nove' } }),
        historyRow({ id: 7, entity_type: 'customers', field_name: 'city', old_value: 'Santos', new_value: 'Vitória', actor_kind: 'portal', actor_name: 'Cliente pelo Portal: ATLÂNTICO LTDA', actor_email: 'contato@atlantico.test', actor_department: null, entity_label: 'ATLÂNTICO LTDA' }),
      ],
    },
  }
  renderAdmin('historico')
  const vessel = screen.getByText('Navio: Santos').closest('tr') as HTMLElement
  fireEvent.click(within(vessel).getByRole('button', { name: /Abrir/ }))
  expect(within(vessel.nextElementSibling as HTMLElement).getByText('Rio de Janeiro 2')).toBeTruthy()
  // Chave sem nome resolvido: a frase não traz o número.
  const customer = screen.getByText('Cliente alterado').closest('tr') as HTMLElement
  fireEvent.click(within(customer).getByRole('button', { name: /Abrir/ }))
  expect(within(customer.nextElementSibling as HTMLElement).getAllByText('Registro vinculado')).toHaveLength(2)
  const created = screen.getByText('Navio criado: Santos').closest('tr') as HTMLElement
  fireEvent.click(within(created).getByRole('button', { name: /Abrir/ }))
  expect(within(created.nextElementSibling as HTMLElement).getByText('Armador: Armador Nove')).toBeTruthy()
  expect(screen.getByText('Cliente pelo Portal: ATLÂNTICO LTDA')).toBeTruthy()
  for (const raw of ['37', '41', '12', '13']) {
    expect(Array.from(document.querySelectorAll('td')).some((cell) => cell.textContent?.trim() === raw)).toBe(false)
  }
  expect(document.body.textContent).not.toMatch(/Navio: 41|Cliente: 1[23]|Armador: 9\b/)
})

it('Histórico de ações: linhas das trilhas próprias com a mesma chave numérica não se confundem (561)', () => {
  mocks.dataByKey = {
    'admin-audit-logs': {
      count: 2,
      rows: [
        historyRow({ source: 'ce_unlock', id: 5, entity_type: 'ce_unlock_request', field_name: 'ce_unlock|submit', new_value: 'COSU1', justification: 'Cliente precisa retirar hoje', entity_label: 'B/L COSU1 · ATLÂNTICO LTDA' }),
        historyRow({ source: 'comunicado', id: 5, entity_type: 'customer_communication', field_name: 'comunicado|aviso_chegada_noa', new_value: 'enviado', entity_label: 'Santos / 012S · BRSSZ · ATLÂNTICO LTDA' }),
      ],
    },
  }
  renderAdmin('historico')
  const ce = screen.getByText('Desbloqueio de CE: Pedido enviado').closest('tr') as HTMLElement
  expect(within(ce).getByText('Cliente precisa retirar hoje')).toBeTruthy()
  const notice = screen.getByText('NOA · Chegada Próxima: Enviado').closest('tr') as HTMLElement
  fireEvent.click(within(ce).getByRole('button', { name: /Abrir/ }))
  // Abrir uma não abre a outra, mesmo com o mesmo id.
  expect(ce.nextElementSibling?.hasAttribute('data-row-detail')).toBe(true)
  expect(notice.nextElementSibling?.hasAttribute('data-row-detail') ?? false).toBe(false)
  expect(within(ce.nextElementSibling as HTMLElement).getByText('B/L COSU1')).toBeTruthy()
})

it('Histórico de ações: contagem acima do teto diz "Mais de 10.000 ações"', () => {
  mocks.dataByKey = { 'admin-audit-logs': { count: 10_000, capped: true, rows: [historyRow({ id: 8, field_name: 'voyage_number', old_value: '011S', new_value: '012S', entity_label: 'Santos / 012S' })] } }
  renderAdmin('historico')
  expect(screen.getByText('Mais de 10.000 ações')).toBeTruthy()
})

it('Histórico de ações: uma importação é uma linha, com o resumo por registro e o campo a campo sob demanda', () => {
  mocks.dataByKey = {
    'admin-audit-logs': {
      count: 1,
      rows: [historyRow({
        id: 30, entity_type: 'bls', field_name: 'criado', new_value: '{"id": "GSPT1"}', action: 'criou', entity_label: 'B/L GSPT1',
        changed_at: '2026-11-04T17:55:11.626336+00:00', justification: 'Importação de B/L · Viagem GREEN SEPETIBA 8',
        line_count: 2539, entity_count: 798,
        groups: [
          { entity_type: 'bl_containers', kind: 'criou', entities: 781, fields: ['criado', 'ownership'] },
          { entity_type: 'bls', kind: 'criou', entities: 17, fields: ['criado'] },
        ],
      })],
    },
  }
  renderAdmin('historico')
  const row = screen.getByText('781 Containers criados, 17 B/Ls criados').closest('tr') as HTMLElement
  expect(within(row).getByText('04/11/2026 14:55:11')).toBeTruthy()
  expect(within(row).getByText('B/L GSPT1 e mais 797')).toBeTruthy()
  expect(within(row).getByText('Origem: Importação de B/L · Viagem GREEN SEPETIBA 8')).toBeTruthy()
  fireEvent.click(within(row).getByRole('button', { name: /Abrir/ }))
  const detail = row.nextElementSibling as HTMLElement
  expect(within(detail).getByText('781 Containers criados')).toBeTruthy()
  expect(within(detail).getByRole('button', { name: 'Ver campo a campo (2.539 linhas)' })).toBeTruthy()
  expect(screen.getByText('1 ação')).toBeTruthy()
})

it('Histórico de ações: acima do teto, o rodapé diz "de mais de 10.000" e Próxima passa da página 200', () => {
  const page = Array.from({ length: 50 }, (_, index) => historyRow({ id: 100 + index, field_name: 'voyage_number', old_value: '011S', new_value: '012S', entity_label: 'Santos / 012S' }))
  mocks.dataByKey = { 'admin-audit-logs': { count: 10_000, capped: true, rows: page } }
  renderAdmin('historico')
  expect(screen.getByText('Exibindo 1–50 de mais de 10.000')).toBeTruthy()
  // Sem o total, não há "Página 1 de 200": o teto não é o fim da lista.
  expect(screen.queryByText(/Página \d+ de/)).toBeNull()
  expect(screen.queryByText('Exibindo 1–50 de 10.000')).toBeNull()
  expect((screen.getByRole('button', { name: 'Próxima' }) as HTMLButtonElement).disabled).toBe(false)
})

it('Histórico de ações: hora com segundos, motivo técnico em português e texto padrão do sistema fora da tela', () => {
  mocks.dataByKey = {
    'admin-audit-logs': {
      count: 3,
      rows: [
        historyRow({ id: 21, entity_type: 'bl', field_name: 'review_status', old_value: 'reviewed', new_value: 'pending_review', changed_at: '2026-11-04T17:55:11.626336+00:00', justification: 'Gate canonico reaplicado apos e-mail importado', entity_label: 'B/L GSPT1' }),
        historyRow({ id: 22, entity_type: 'voyage_pol_schedule', field_name: 'etd', old_value: '2026-11-02', new_value: '2026-11-03', changed_at: '2026-11-04T17:55:12Z', justification: 'Atualizacao manual de ETD por POL', entity_label: 'GREEN SEPETIBA / 8 · BRVIX' }),
        historyRow({ id: 23, entity_type: 'customer', field_name: 'held_billing_reprocessed', new_value: '3', actor_kind: 'sistema', actor_name: null, actor_email: null, actor_department: null, justification: 'Reprocesso automático das faturas retidas (portal_activation) pela conta de sistema', entity_label: 'ATLÂNTICO LTDA' }),
      ],
    },
  }
  renderAdmin('historico')
  const gate = screen.getByText('Status de revisão: Pendente').closest('tr') as HTMLElement
  expect(within(gate).getByText('04/11/2026 14:55:11')).toBeTruthy()
  expect(within(gate).getByText('Origem: B/L de volta à Revisão depois do e-mail importado')).toBeTruthy()
  // O texto que a tela salva sem motivo não é motivo de ninguém.
  const etd = screen.getByText('ETD: 03/11/2026').closest('tr') as HTMLElement
  expect(within(etd).getByText('04/11/2026 14:55:12')).toBeTruthy()
  expect(within(etd).getByText('Sem motivo')).toBeTruthy()
  const held = screen.getByText('Faturamento retido reprocessado').closest('tr') as HTMLElement
  expect(within(held).getByText('Origem: Faturas retidas emitidas: o Cliente ativou o Portal')).toBeTruthy()
  expect(document.body.textContent).not.toMatch(/Gate canonico|Atualizacao manual|portal_activation/)
})

it('"O que cada setor pode": grupo e ação são cabeçalhos da linha', () => {
  renderAdmin()
  const matrix = screen.getByRole('region', { name: 'O que cada setor pode' })
  fireEvent.click(within(matrix).getByRole('button', { name: 'Mostrar' }))
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

const health = (patch: Record<string, unknown> = {}) => ({
  alert_failures_30d: 0, last_alert_failure_at: null, teams_without_active: [], routines_failing: [], routine_failures_7d: 0,
  pix_provider: 'itau', pix_polled_until: new Date().toISOString(), pix_expiration_seconds: 2_592_000, pix_settlement_actor_name: 'API ITAÚ',
  suppressed_emails: 0, holidays_last_day: '2027-12-25', holidays_next_year: 13, next_year: 2027,
  communications_enabled: true, dunning_interval_days: 7, routine_actor_name: null, routine_actor_effective_name: 'Dono Dev', ...patch,
})

it('Sistema: tudo em dia, as rotinas pelo nome e as configurações com quem muda (2026-11-06)', () => {
  mocks.isDev = true
  mocks.dataByKey = {
    'admin-system-health': health(),
    'admin-system-routines': [{ jobname: 'itau-pix-queue', schedule: '* * * * *', active: true, last_run_at: '2026-11-06T10:14:00Z', last_status: 'succeeded', failures_7d: 0 }],
    'admin-routing-failures': { rows: [], count: 0 },
  }
  renderAdmin('sistema')
  expect(screen.getByText('Nada pede atenção')).toBeTruthy()
  const routine = screen.getByText('Leitura do Pix Itaú').closest('tr') as HTMLElement
  expect(within(routine).getByText('a cada minuto')).toBeTruthy()
  expect(within(routine).getByText('06/11/2026 07:14')).toBeTruthy()
  expect(within(routine).getByText('Em dia')).toBeTruthy()
  expect(screen.getByText('Envio real ligado')).toBeTruthy()
  expect(screen.getByText(/Não escolhida: usa Dono Dev/)).toBeTruthy()
  expect(screen.getByText('Cadastrados até 25/12/2027')).toBeTruthy()
  // As falhas de entrega de alertas moram aqui; Versão e Ambiente no rodapé.
  expect(screen.getByText('Nenhuma falha de entrega registrada.')).toBeTruthy()
  expect(screen.getByText('Versão')).toBeTruthy()
  expect(screen.queryByText('Última viagem criada')).toBeNull()
})

it('Sistema: equipe sem pessoa ativa, rotina com falha e feriados faltando viram pontos de atenção', () => {
  mocks.isDev = true
  mocks.dataByKey = {
    'admin-system-health': health({ teams_without_active: ['equipamentos'], routines_failing: ['demurrage-dunning'], holidays_next_year: 0, alert_failures_30d: 1 }),
    'admin-system-routines': [],
    'admin-routing-failures': { rows: [], count: 0 },
  }
  renderAdmin('sistema')
  expect(screen.getByText('4 pontos pedem atenção')).toBeTruthy()
  expect(screen.getByText(/Equipamentos sem nenhuma pessoa ativa/)).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Abrir Usuários' }).getAttribute('href')).toBe('/admin/usuarios')
  expect(screen.getByText('A última execução falhou: Régua de cobrança da Demurrage.')).toBeTruthy()
  expect(screen.getByText(/Faltam os feriados de 2027/)).toBeTruthy()
})

it('Sistema: o Envio real troca com confirmação, e o e-mail de teste vai para quem pediu', async () => {
  mocks.isDev = true
  mocks.setCommunicationsEnabled.mockResolvedValue(false)
  mocks.sendAdminTestEmail.mockResolvedValue('dono@fwlog.com.br')
  mocks.dataByKey = { 'admin-system-health': health(), 'admin-system-routines': [], 'admin-routing-failures': { rows: [], count: 0 } }
  renderAdmin('sistema')
  fireEvent.click(screen.getByRole('switch', { name: 'Envio real ligado' }))
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Desativar envio real' })))
  await waitFor(() => expect(mocks.setCommunicationsEnabled).toHaveBeenCalledWith(false))
  fireEvent.click(screen.getByRole('button', { name: 'Enviar teste para mim' }))
  await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('E-mail de teste enviado para dono@fwlog.com.br.', 'success'))
})

it('Sistema: a recusa do e-mail de teste mostra o motivo que a Edge Function deu', async () => {
  mocks.isDev = true
  mocks.sendAdminTestEmail.mockRejectedValue(new Error('O seu e-mail está bloqueado por devolução ou spam: o teste não saiu.'))
  mocks.dataByKey = { 'admin-system-health': health(), 'admin-system-routines': [], 'admin-routing-failures': { rows: [], count: 0 } }
  renderAdmin('sistema')
  fireEvent.click(screen.getByRole('button', { name: 'Enviar teste para mim' }))
  expect(await screen.findByText('O seu e-mail está bloqueado por devolução ou spam: o teste não saiu.')).toBeTruthy()
})

it('Sistema: erro de consulta tem mensagem própria', () => {
  mocks.isDev = true
  mocks.errorByKey = { 'admin-system-health': new Error('health down'), 'admin-system-routines': new Error('routines down') }
  mocks.dataByKey = { 'admin-routing-failures': { rows: [], count: 0 } }
  renderAdmin('sistema')
  expect(screen.getByText('Não foi possível conferir o sistema.')).toBeTruthy()
  expect(screen.getByText('Não foi possível carregar as rotinas.')).toBeTruthy()
})


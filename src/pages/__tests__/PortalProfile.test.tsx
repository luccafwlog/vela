// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'

const getProfile = vi.hoisted(() => vi.fn())
const updateProfile = vi.hoisted(() => vi.fn())
const invoke = vi.hoisted(() => vi.fn())
// Stable identities: PortalProfile's load effect depends on `overview`, so a fresh
// object per render would re-trigger the effect in a loop past test teardown.
const auth = vi.hoisted(() => ({ overview: { contact_email: 'fallback@example.com' }, refreshOverview: vi.fn() }))

// `usePortalScope` le `PortalAuthContext` direto (sem Provider, o default do
// contexto e o valor entregue), entao o mock parcial precisa exportar os dois.
vi.mock('../../hooks/usePortalAuth', async () => ({
  usePortalAuth: () => auth,
  PortalAuthContext: (await vi.importActual<typeof import('react')>('react')).createContext(auth),
}))
vi.mock('../../services/portalBilling', () => ({
  portalGetProfile: getProfile,
  portalUpdateProfile: updateProfile,
}))
vi.mock('../../services/supabase', () => ({
  supabasePortal: { functions: { invoke } },
}))
vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))

import { PortalProfile, RECOVERY_EMAIL_SEND_FAILED_MESSAGE } from '../PortalProfile'
import { ConfirmDialogProvider } from '../../components/ui/ConfirmDialog'
import { PortalScopeProvider } from '../../hooks/usePortalScope'

function renderProfile() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ConfirmDialogProvider><MemoryRouter><PortalProfile /></MemoryRouter></ConfirmDialogProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  getProfile.mockReset()
  updateProfile.mockReset()
  invoke.mockReset()
  auth.refreshOverview.mockReset()
  auth.overview = { contact_email: 'fallback@example.com' }
})

it('shows a load error and disables editing when the profile cannot be loaded', async () => {
  getProfile.mockRejectedValueOnce(new Error('Perfil indisponivel'))
  renderProfile()

  await waitFor(() => expect(screen.getByText('Falha ao carregar perfil. Tente novamente em instantes.')).toBeTruthy())
  expect(screen.queryByText('Perfil indisponivel')).toBeNull()
  expect((screen.getByRole('button', { name: 'Salvar endereço' }) as HTMLButtonElement).disabled).toBe(true)
})

it('preserva edicao local quando o overview muda depois da hidratacao', async () => {
  const user = userEvent.setup()
  getProfile.mockResolvedValue({ contact_email: 'perfil@example.com', phone: '', address: 'Rua Antiga', city: '', state: '', zip: '' })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { rerender } = render(
    <QueryClientProvider client={queryClient}>
      <ConfirmDialogProvider><MemoryRouter><PortalProfile /></MemoryRouter></ConfirmDialogProvider>
    </QueryClientProvider>,
  )

  const address = await screen.findByDisplayValue('Rua Antiga')
  await user.clear(address)
  await user.type(address, 'Rua Nova')

  auth.overview = { contact_email: 'novo-overview@example.com' }
  rerender(
    <QueryClientProvider client={queryClient}>
      <ConfirmDialogProvider><MemoryRouter><PortalProfile /></MemoryRouter></ConfirmDialogProvider>
    </QueryClientProvider>,
  )

  expect(screen.getByDisplayValue('Rua Nova')).toBeTruthy()
})

it('confirma a diferenca do perfil antes de salvar os dados cadastrais', async () => {
  const user = userEvent.setup()
  getProfile.mockResolvedValue({ contact_email: 'perfil@example.com', phone: '', address: 'Rua Antiga', city: '', state: '', zip: '' })
  renderProfile()

  const address = await screen.findByDisplayValue('Rua Antiga')
  await user.clear(address)
  await user.type(address, 'Rua Nova')
  await user.click(screen.getByRole('button', { name: 'Salvar endereço' }))

  const dialog = await screen.findByRole('dialog', { name: 'Confirmar endereço da empresa' })
  const table = within(dialog).getByRole('table', { name: 'Campos alterados' })
  expect(within(table).getByText('Rua Antiga')).toBeTruthy()
  expect(within(table).getByText('Rua Nova')).toBeTruthy()
  expect(updateProfile).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('button', { name: 'Voltar' }))
  expect(updateProfile).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: 'Salvar endereço' }))
  const repeatedDialog = await screen.findByRole('dialog', { name: 'Confirmar endereço da empresa' })
  await user.click(within(repeatedDialog).getByRole('button', { name: 'Salvar endereço' }))
  await waitFor(() => expect(updateProfile).toHaveBeenCalledWith(expect.objectContaining({ address: 'Rua Nova' }), expect.anything()))
})

it('avisa que a troca não começou quando o email de confirmação não sai', async () => {
  const user = userEvent.setup()
  getProfile.mockResolvedValue({ contact_email: 'perfil@example.com', phone: '', address: '', city: '', state: '', zip: '' })
  invoke.mockResolvedValue({ data: null, error: Object.assign(new Error('Edge Function returned a non-2xx status code'), { context: { status: 502 } }) })
  renderProfile()

  await user.type(await screen.findByLabelText('Senha atual'), 'senha-atual')
  await user.type(screen.getByLabelText('Novo e-mail'), 'novo@example.com')
  await user.type(screen.getByLabelText('Confirmar novo e-mail'), 'novo@example.com')
  await user.click(screen.getByRole('button', { name: 'Trocar e-mail de recuperação' }))
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Enviar link' }))

  expect(await screen.findByText(RECOVERY_EMAIL_SEND_FAILED_MESSAGE)).toBeTruthy()
  const recoveryForm = screen.getByLabelText('Senha atual').closest('form')!
  const addressForm = screen.getByLabelText('Endereço').closest('form')!
  expect(within(recoveryForm).getByRole('alert').textContent).toContain(RECOVERY_EMAIL_SEND_FAILED_MESSAGE)
  expect(within(addressForm).queryByRole('alert')).toBeNull()
})

it('mostra os blocos com um botão principal cada, apagado até haver o que salvar', async () => {
  const user = userEvent.setup()
  getProfile.mockResolvedValue({ contact_email: 'perfil@example.com', phone: '', address: 'Rua Antiga', city: 'Santos', state: 'SP', zip: '' })
  renderProfile()

  const address = await screen.findByDisplayValue('Rua Antiga')
  const addressBlock = screen.getByRole('heading', { name: 'Endereço da empresa' }).closest('section') as HTMLElement
  expect(screen.getByRole('heading', { name: 'E-mail de recuperação' })).toBeTruthy()

  const saveAddress = within(addressBlock).getByRole('button', { name: 'Salvar endereço' }) as HTMLButtonElement
  expect(saveAddress.disabled).toBe(true)
  expect(within(addressBlock).getByText('Nada alterado.')).toBeTruthy()
  await user.type(address, ', sala 41')
  expect(saveAddress.disabled).toBe(false)
  expect(within(addressBlock).getByText('Endereço alterado, ainda não salvo.')).toBeTruthy()

  // O e-mail espera os três campos; a senha atual começa vazia, sem exemplo.
  const password = screen.getByLabelText('Senha atual') as HTMLInputElement
  expect(password.value).toBe('')
  expect(password.getAttribute('placeholder')).toBeNull()
  const change = screen.getByRole('button', { name: 'Trocar e-mail de recuperação' }) as HTMLButtonElement
  expect(change.disabled).toBe(true)
  await user.type(password, 'senha-atual')
  await user.type(screen.getByLabelText('Novo e-mail'), 'novo@example.com')
  expect(change.disabled).toBe(true)
  await user.type(screen.getByLabelText('Confirmar novo e-mail'), 'novo@example.com')
  expect(change.disabled).toBe(false)
})

it('mostra o e-mail de recuperação atual como dado quando o perfil o traz', async () => {
  getProfile.mockResolvedValue({ contact_email: 'perfil@example.com', recovery_email: 'recuperacao@example.com', phone: '', address: '', city: '', state: '', zip: '' })
  renderProfile()
  const recovery = (await screen.findByRole('heading', { name: 'E-mail de recuperação' })).closest('section') as HTMLElement
  await waitFor(() => expect(within(recovery).getByText('recuperacao@example.com')).toBeTruthy())
  expect(within(recovery).getByText('E-mail atual')).toBeTruthy()
})

it('mantém o Modo Inspeção só para leitura', async () => {
  getProfile.mockResolvedValue({ contact_email: 'perfil@example.com', phone: '', address: 'Rua Antiga', city: '', state: '', zip: '' })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ConfirmDialogProvider><MemoryRouter>
        <PortalScopeProvider scope={{ mode: 'inspect', customerId: 10, basePath: '/clientes/portal/inspecao/10', overview: { contact_email: 'x@example.com' } as never }}>
          <PortalProfile />
        </PortalScopeProvider>
      </MemoryRouter></ConfirmDialogProvider>
    </QueryClientProvider>,
  )
  const address = (await screen.findByDisplayValue('Rua Antiga')) as HTMLInputElement
  expect(address.matches(':disabled')).toBe(true)
  expect(screen.getByLabelText('Senha atual').matches(':disabled')).toBe(true)
  expect((screen.getByRole('button', { name: 'Salvar endereço' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Trocar e-mail de recuperação' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByRole('note').textContent).toContain('Modo Inspeção')
})

it('depois de confirmar a troca pelo link antigo, relê o perfil e mostra o e-mail novo', async () => {
  getProfile
    .mockResolvedValueOnce({ contact_email: 'perfil@example.com', recovery_email: 'antigo@example.com', phone: '', address: '', city: '', state: '', zip: '' })
    .mockResolvedValue({ contact_email: 'perfil@example.com', recovery_email: 'novo@example.com', phone: '', address: '', city: '', state: '', zip: '' })
  invoke.mockResolvedValue({ error: null })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ConfirmDialogProvider><MemoryRouter initialEntries={['/portal/perfil?confirm_email=tok']}><PortalProfile /></MemoryRouter></ConfirmDialogProvider>
    </QueryClientProvider>,
  )
  await waitFor(() => expect(invoke).toHaveBeenCalled())
  expect(await screen.findByText('novo@example.com')).toBeTruthy()
  expect(invoke).toHaveBeenCalledWith('portal-recovery-email-change', { body: { action: 'confirm', token: 'tok' } })
})

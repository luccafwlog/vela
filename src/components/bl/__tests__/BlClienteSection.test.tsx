// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  createCustomer: vi.fn(),
  findCustomerIdByDocument: vi.fn(),
  linkBlCustomer: vi.fn(),
  showToast: vi.fn(),
  onboard: vi.fn(),
  invite: vi.fn(),
  autoInvoice: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../../hooks/useCustomers', () => ({ useCustomerLookup: () => ({ data: [] }) }))
vi.mock('../../../hooks/useReviewCustomerGroup', () => ({ useReviewCustomerGroup: () => ({ mutateAsync: mocks.onboard, isPending: false }) }))
vi.mock('../../../services/reviewCustomerGroup', () => ({ sendReviewPortalInvite: mocks.invite }))
vi.mock('../../../services/reviewBillingAutomation', () => ({ tryAutoIssueInvoice: mocks.autoInvoice }))
vi.mock('../../../hooks/useLocalCharges', () => ({ useOverrideCustomers: () => ({ data: [], isFetching: false }) }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../../services/customers', () => ({
  createCustomer: mocks.createCustomer,
  findCustomerIdByDocument: mocks.findCustomerIdByDocument,
}))
vi.mock('../../../services/review', () => ({ linkBlCustomer: mocks.linkBlCustomer }))

import { BlClienteSection } from '../BlClienteSection'

const bl = {
  id: 'BL-1',
  voyage_id: 1,
  customer_id: null,
  customer: null,
  manifest_customer_name: 'ACME LTDA',
  manifest_customer_cnpj_cpf: '11222333000181',
  manifest_customer_email: 'ops@acme.test',
}

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

function clickManifestLink() {
  render(<MemoryRouter><BlClienteSection bl={bl as never} /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Vincular este cliente' }))
}

describe('vínculo do cliente na ficha do B/L', () => {
  it('não cadastra o cliente do manifesto quando a confirmação é cancelada', async () => {
    mocks.findCustomerIdByDocument.mockResolvedValue(null)
    mocks.confirm.mockResolvedValue(false)
    clickManifestLink()
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
    expect(mocks.createCustomer).not.toHaveBeenCalled()
    expect(mocks.linkBlCustomer).not.toHaveBeenCalled()
  })

  it('usa o cadastro existente pelo CNPJ sem criar outro', async () => {
    mocks.findCustomerIdByDocument.mockResolvedValue(42)
    mocks.confirm.mockResolvedValue(true)
    mocks.linkBlCustomer.mockResolvedValue(undefined)
    clickManifestLink()
    await waitFor(() => expect(mocks.linkBlCustomer).toHaveBeenCalledWith(expect.objectContaining({ blId: 'BL-1', customerId: 42 })))
    expect(mocks.createCustomer).not.toHaveBeenCalled()
  })
})


it('recupera o cadastro criado enquanto o operador confirma o vínculo', async () => {
  mocks.findCustomerIdByDocument.mockResolvedValueOnce(null).mockResolvedValue(42)
  mocks.confirm.mockResolvedValue(true)
  mocks.createCustomer.mockRejectedValue({ code: '23505', message: 'duplicate key value violates unique constraint "customers_cnpj_cpf_key"' })
  mocks.linkBlCustomer.mockResolvedValue(undefined)
  clickManifestLink()
  await waitFor(() => expect(mocks.showToast).toHaveBeenCalled())
  expect(mocks.linkBlCustomer).toHaveBeenCalledWith(expect.objectContaining({ customerId: 42 }))
})

it('oferece o mesmo cadastro e convite da Revisão para este B/L, depois da confirmação', async () => {
  mocks.confirm.mockResolvedValue(true)
  mocks.onboard.mockResolvedValue({ onboarding: { customer: { id: 42 }, bls: [{ blId: 'BL-1', resolved: true }] }, portalInvite: 'sent' })
  mocks.autoInvoice.mockResolvedValue({ status: 'invoiced' })
  render(<MemoryRouter><BlClienteSection bl={{ ...bl, review_status: 'pending_review' } as never} /></MemoryRouter>)
  expect(screen.getByLabelText(/E-mail principal do cliente/).getAttribute('value')).toBe('ops@acme.test')
  fireEvent.click(screen.getByRole('checkbox', { name: /Enviar convite do Portal/ }))
  fireEvent.click(screen.getByRole('button', { name: /Criar cliente e vincular/ }))
  await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith(expect.stringMatching(/convite/i), 'success'))
  expect(mocks.onboard).toHaveBeenCalledWith(expect.objectContaining({ blIds: ['BL-1'], email: 'ops@acme.test', sendPortalInvite: true }))
  expect(mocks.autoInvoice).toHaveBeenCalledWith({ blId: 'BL-1', customerId: 42, actorId: 'user-1' })
})

it('preserva o cadastro concluído e oferece nova tentativa quando o convite falha', async () => {
  mocks.confirm.mockResolvedValue(true)
  mocks.onboard.mockResolvedValue({ onboarding: { customer: { id: 42 }, bls: [{ blId: 'BL-1', resolved: false }] }, portalInvite: 'failed' })
  render(<MemoryRouter><BlClienteSection bl={{ ...bl, review_status: 'pending_review' } as never} /></MemoryRouter>)
  fireEvent.click(screen.getByRole('checkbox', { name: /Enviar convite do Portal/ }))
  fireEvent.click(screen.getByRole('button', { name: /Criar cliente e vincular/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Tentar convite novamente' })).toBeTruthy())
  expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('cadastro foi concluído'), 'info')
})

it('reúne cliente e situação do Portal na mesma superfície', () => {
  // Seção dentro da superfície da Visão geral: nenhum card próprio.
  const { container } = render(<MemoryRouter><BlClienteSection bl={bl as never} portalStatus={{ visibility: { visible: false, reasons: ['Sem CE Mercante'] }, notifications: [], openDisputes: [] }} /></MemoryRouter>)
  expect(screen.getByRole('heading', { name: 'Cliente' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Portal' })).toBeTruthy()
  expect(screen.getByText('Sem CE Mercante')).toBeTruthy()
  expect(container.querySelectorAll('section.app-surface').length).toBe(0)
})

it('não executa o cadastro da Revisão quando a confirmação é recusada', async () => {
  mocks.confirm.mockResolvedValue(false)
  render(<MemoryRouter><BlClienteSection bl={{ ...bl, review_status: 'pending_review' } as never} /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: /Criar cliente e vincular/ }))
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
  expect(mocks.onboard).not.toHaveBeenCalled()
  expect(mocks.invite).not.toHaveBeenCalled()
})

it('permite convidar o cliente de B/L já revisado sem refazer o vínculo', async () => {
  mocks.confirm.mockResolvedValue(true)
  mocks.invite.mockResolvedValue(undefined)
  render(<MemoryRouter><BlClienteSection bl={{ ...bl, review_status: 'ok', customer_id: 42, customer: { id: 42, name: 'ACME', cnpj_cpf: bl.manifest_customer_cnpj_cpf } } as never} portalStatus={{ visibility: { visible: false, reasons: ['Conta do Portal não está ativa/provisionada'] }, notifications: [], openDisputes: [] }} /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Enviar convite do Portal' }))
  fireEvent.change(screen.getByLabelText('E-mail do convite'), { target: { value: ' Portal@acme.test ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar convite' }))
  await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('Convite do Portal iniciado.', 'success'))
  expect(mocks.invite).toHaveBeenCalledWith(42, 'portal@acme.test')
  expect(mocks.onboard).not.toHaveBeenCalled()
  expect(mocks.linkBlCustomer).not.toHaveBeenCalled()
})

// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingPortalRelease } from '../../../services/billingPortalRelease'

const auth = vi.hoisted(() => ({ effectiveRole: 'administrativo' as string }))
const state = vi.hoisted(() => ({ release: null as BillingPortalRelease | null }))
const grant = vi.hoisted(() => vi.fn())
const confirm = vi.hoisted(() => vi.fn())
const confirmWithReason = vi.hoisted(() => vi.fn())
const revoke = vi.hoisted(() => vi.fn())

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ effectiveRole: auth.effectiveRole }) }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => confirm, useConfirmWithReason: () => confirmWithReason }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../../hooks/useBillingPortalRelease', () => ({
  useBillingPortalRelease: () => ({ data: state.release, isLoading: false, isError: false, refetch: vi.fn() }),
  useGrantBillingPortalRelease: () => ({ mutateAsync: grant, isPending: false }),
  useRevokeBillingPortalRelease: () => ({ mutateAsync: revoke, isPending: false }),
}))

import { BillingPortalReleaseCard } from '../BillingPortalReleaseCard'

const future = new Date(Date.now() + 5 * 86_400_000).toISOString()
const past = new Date(Date.now() - 86_400_000).toISOString()
const baseRelease: BillingPortalRelease = {
  id: 1, customer_id: 9, justification: 'Cliente sem e-mail', granted_by: 'u1',
  granted_at: new Date(Date.now() - 10 * 86_400_000).toISOString(), review_at: future,
  revoked_at: null, revoked_by: null, revoke_reason: null,
}

describe('BillingPortalReleaseCard', () => {
  beforeEach(() => {
    auth.effectiveRole = 'administrativo'
    state.release = null
    grant.mockReset().mockResolvedValue({ release_id: 1, reprocess: { customer_id: 9, gate_open: true, issued: 2, blocked: 0, failed: 0 } })
    confirm.mockReset().mockResolvedValue(true)
    confirmWithReason.mockReset().mockResolvedValue('Portal ativado')
    revoke.mockReset().mockResolvedValue(undefined)
  })

  function openGrantForm() {
    fireEvent.click(screen.getByRole('button', { name: /Conceder (nova )?liberação/ }))
  }

  it('o Administrativo concede com justificativa e data, e o pedido leva as duas', async () => {
    render(<BillingPortalReleaseCard customerId={9} portalReady={false} />)
    openGrantForm()
    fireEvent.change(screen.getByRole('textbox', { name: /Justificativa/ }), { target: { value: 'Cliente sem e-mail até dia 30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Liberar faturamento' }))
    await waitFor(() => expect(grant).toHaveBeenCalledTimes(1))
    expect(grant.mock.calls[0][0]).toMatchObject({ customerId: 9, justification: 'Cliente sem e-mail até dia 30' })
    expect(grant.mock.calls[0][0].reviewDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // O resultado fica no conteúdo, não só no toast.
    expect(await screen.findByText('Liberação concedida: 2 faturas emitidas.')).toBeTruthy()
  })

  it('mostra no conteúdo o que seguiu retido depois da concessão', async () => {
    grant.mockResolvedValue({ release_id: 1, reprocess: { customer_id: 9, gate_open: true, issued: 1, blocked: 2, failed: 0 } })
    render(<BillingPortalReleaseCard customerId={9} portalReady={false} />)
    openGrantForm()
    fireEvent.change(screen.getByRole('textbox', { name: /Justificativa/ }), { target: { value: 'Cliente sem Portal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Liberar faturamento' }))
    expect(await screen.findByText('Liberação concedida: 1 fatura emitida; 2 B/Ls seguem com outro bloqueio na Validação.')).toBeTruthy()
  })

  it('não envia sem justificativa', async () => {
    render(<BillingPortalReleaseCard customerId={9} portalReady={false} />)
    openGrantForm()
    fireEvent.click(screen.getByRole('button', { name: 'Liberar faturamento' }))
    expect(await screen.findByText('Informe a justificativa.')).toBeTruthy()
    expect(grant).not.toHaveBeenCalled()
  })

  it('não envia revisão além de 30 dias', async () => {
    render(<BillingPortalReleaseCard customerId={9} portalReady={false} />)
    openGrantForm()
    fireEvent.change(screen.getByRole('textbox', { name: /Justificativa/ }), { target: { value: 'Cliente sem Portal' } })
    const far = new Date(Date.now() + 45 * 86_400_000).toLocaleDateString('en-CA')
    fireEvent.change(screen.getByLabelText(/Data de revisão/), { target: { value: far } })
    fireEvent.click(screen.getByRole('button', { name: 'Liberar faturamento' }))
    expect(await screen.findByText(/no máximo 30 dias/)).toBeTruthy()
    expect(grant).not.toHaveBeenCalled()
  })

  it('a Documentação vê a situação, mas não concede', () => {
    auth.effectiveRole = 'documentacao'
    render(<BillingPortalReleaseCard customerId={9} portalReady={false} />)
    expect(screen.queryByRole('button', { name: /Conceder/ })).toBeNull()
    expect(screen.getByText('A liberação é concedida pelo Administrativo.')).toBeTruthy()
  })

  it('mostra a liberação vencida como vencida e permite renovar', () => {
    state.release = { ...baseRelease, review_at: past }
    render(<BillingPortalReleaseCard customerId={9} portalReady={false} />)
    expect(screen.getByText('Vencida')).toBeTruthy()
    openGrantForm()
    expect(screen.getByRole('button', { name: 'Liberar faturamento' })).toBeTruthy()
  })

  it('com a liberação vigente, oferece só a revogação', () => {
    state.release = baseRelease
    render(<BillingPortalReleaseCard customerId={9} portalReady={false} />)
    expect(screen.getByText('Vigente')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Revogar liberação' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Conceder/ })).toBeNull()
  })

  it('revoga com o motivo pedido na confirmação', async () => {
    state.release = baseRelease
    render(<BillingPortalReleaseCard customerId={9} portalReady={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Revogar liberação' }))
    await waitFor(() => expect(revoke).toHaveBeenCalledWith({ customerId: 9, reason: 'Portal ativado' }))
    expect(confirmWithReason.mock.calls[0][0]).toMatchObject({ tone: 'danger', confirmLabel: 'Revogar liberação' })
  })

  it('motivo de revogação curto demais fica na tela, sem chamar o banco que o recusaria', async () => {
    state.release = baseRelease
    confirmWithReason.mockResolvedValue('ok')
    render(<BillingPortalReleaseCard customerId={9} portalReady={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Revogar liberação' }))
    expect(await screen.findByText(/pelo menos 3 caracteres/)).toBeTruthy()
    expect(revoke).not.toHaveBeenCalled()
  })

  it('com o Portal pronto, não oferece liberação', () => {
    render(<BillingPortalReleaseCard customerId={9} portalReady />)
    expect(screen.getByText(/O Portal deste Cliente está pronto/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Conceder/ })).toBeNull()
  })
})

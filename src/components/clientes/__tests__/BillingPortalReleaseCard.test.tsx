// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingPortalRelease } from '../../../services/billingPortalRelease'

const auth = vi.hoisted(() => ({ effectiveRole: 'administrativo' as string }))
const state = vi.hoisted(() => ({ release: null as BillingPortalRelease | null }))
const grant = vi.hoisted(() => vi.fn())
const confirm = vi.hoisted(() => vi.fn())

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ effectiveRole: auth.effectiveRole }) }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => confirm }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../../hooks/useBillingPortalRelease', () => ({
  useBillingPortalRelease: () => ({ data: state.release, isLoading: false, isError: false }),
  useGrantBillingPortalRelease: () => ({ mutateAsync: grant, isPending: false }),
  useRevokeBillingPortalRelease: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
  })

  it('o Administrativo concede com justificativa e data, e o pedido leva as duas', async () => {
    render(<BillingPortalReleaseCard customerId={9} portalReady={false} />)
    fireEvent.change(screen.getByRole('textbox', { name: /Justificativa/ }), { target: { value: 'Cliente sem e-mail até dia 30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Liberar faturamento' }))
    await waitFor(() => expect(grant).toHaveBeenCalledTimes(1))
    expect(grant.mock.calls[0][0]).toMatchObject({ customerId: 9, justification: 'Cliente sem e-mail até dia 30' })
    expect(grant.mock.calls[0][0].reviewDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('não envia sem justificativa', async () => {
    render(<BillingPortalReleaseCard customerId={9} portalReady={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Liberar faturamento' }))
    expect(await screen.findByText('Informe a justificativa.')).toBeTruthy()
    expect(grant).not.toHaveBeenCalled()
  })

  it('não envia revisão além de 30 dias', async () => {
    render(<BillingPortalReleaseCard customerId={9} portalReady={false} />)
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
    expect(screen.queryByRole('button', { name: 'Liberar faturamento' })).toBeNull()
    expect(screen.getByText('A liberação é concedida pelo Administrativo.')).toBeTruthy()
  })

  it('mostra a liberação vencida como vencida e permite renovar', () => {
    state.release = { ...baseRelease, review_at: past }
    render(<BillingPortalReleaseCard customerId={9} portalReady={false} />)
    expect(screen.getByText('Vencida')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Liberar faturamento' })).toBeTruthy()
  })

  it('com a liberação vigente, oferece só a revogação', () => {
    state.release = baseRelease
    render(<BillingPortalReleaseCard customerId={9} portalReady={false} />)
    expect(screen.getByText('Vigente')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Revogar liberação' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Liberar faturamento' })).toBeNull()
  })

  it('com o Portal pronto, não oferece liberação', () => {
    render(<BillingPortalReleaseCard customerId={9} portalReady />)
    expect(screen.getByText(/O Portal deste Cliente está pronto/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Liberar faturamento' })).toBeNull()
  })
})

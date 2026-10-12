// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { PaymentModal } from '../PaymentModal'

afterEach(cleanup)

const invoice = { id: 42, docNumber: 'DEM-042', netUsd: 400, currentTotalBrl: 2200, billedAt: '2026-07-01' }

it('submits the current payment date for the selected invoice', async () => {
  const onSubmit = vi.fn()
  const user = userEvent.setup()

  render(
    <PaymentModal open invoice={invoice} paymentDate="2026-07-19" onPaymentDateChange={vi.fn()} onClose={vi.fn()} onSubmit={onSubmit} />,
  )

  expect(screen.getByRole('dialog', { name: 'Registrar pagamento DEM-042' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Registrar pagamento' }))

  expect(onSubmit).toHaveBeenCalledWith(42, '2026-07-19')
})

it('recusa junto do campo a data anterior à emissão, que a RPC não aceitaria', async () => {
  const onSubmit = vi.fn()
  const user = userEvent.setup()

  render(
    <PaymentModal open invoice={invoice} paymentDate="2026-06-30" onPaymentDateChange={vi.fn()} onClose={vi.fn()} onSubmit={onSubmit} />,
  )

  await user.click(screen.getByRole('button', { name: 'Registrar pagamento' }))

  expect(onSubmit).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('anterior à emissão (01/07/2026)')
  expect(screen.getByLabelText(/Data do pagamento/).getAttribute('aria-invalid')).toBe('true')
})

it('mantém a falha da baixa no modal', () => {
  render(
    <PaymentModal open invoice={invoice} paymentDate="2026-07-19" error="Fatura 42 nao possui uma foto financeira pagavel." onPaymentDateChange={vi.fn()} onClose={vi.fn()} onSubmit={vi.fn()} />,
  )
  expect(screen.getByRole('alert').textContent).toContain('Nada foi baixado.')
})

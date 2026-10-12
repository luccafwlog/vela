// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

const modulePath = '../DemurragePaymentReversalModal'

it('requires a justification and submits the trimmed reason', async () => {
  const module = await import(/* @vite-ignore */ modulePath).catch(() => null)
  expect(module).not.toBeNull()

  const ReversalModal = module!.DemurragePaymentReversalModal
  const onSubmit = vi.fn()
  const user = userEvent.setup()
  render(
    <ReversalModal
      open
      docNumber="DEM-2026-0042"
      loading={false}
      onClose={vi.fn()}
      onSubmit={onSubmit}
    />,
  )

  const submit = screen.getByRole('button', { name: 'Cancelar baixa' })
  expect(submit.hasAttribute('disabled')).toBe(true)

  await user.type(screen.getByLabelText(/Justificativa para cancelar a baixa/), '  PIX conciliado em duplicidade  ')
  expect(submit.hasAttribute('disabled')).toBe(false)
  await user.click(submit)

  expect(onSubmit).toHaveBeenCalledWith('PIX conciliado em duplicidade')

  // O titulo cita a chave natural do documento, nunca `demurrage_invoices.id`.
  expect(screen.getByRole('dialog', { name: 'Cancelar baixa de Demurrage DEM-2026-0042' })).toBeTruthy()
})

// ADR 0079, decisão 2: o estorno de Invoice suspensa por datas alteradas
// avisa a consequência antes de confirmar.
it('avisa que a Invoice com datas alteradas é reemitida ao cancelar a baixa', async () => {
  const { DemurragePaymentReversalModal: ReversalModal } = await import('../DemurragePaymentReversalModal')
  const { rerender } = render(
    <ReversalModal open docNumber="DEM-2026-0043" datesChanged={{ negotiated: false }} loading={false} onClose={vi.fn()} onSubmit={vi.fn()} />,
  )
  expect(screen.getByText('As datas do container mudaram depois do pagamento')).toBeTruthy()
  expect(screen.getByText(/a Invoice é cancelada e reemitida com as datas atuais/)).toBeTruthy()

  rerender(<ReversalModal open docNumber="DEM-2026-0043" datesChanged={{ negotiated: true }} loading={false} onClose={vi.fn()} onSubmit={vi.fn()} />)
  expect(screen.getByText(/tem desconto ou disputa aberta: cancele/)).toBeTruthy()

  rerender(<ReversalModal open docNumber="DEM-2026-0043" loading={false} onClose={vi.fn()} onSubmit={vi.fn()} />)
  expect(screen.queryByText('As datas do container mudaram depois do pagamento')).toBeNull()
})

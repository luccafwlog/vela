// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { DisputeModal } from '../DisputeModal'

vi.mock('../../../hooks/usePortalDisputes', () => ({
  usePortalOpenDispute: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

afterEach(cleanup)

it('limpa motivo ao fechar e reabrir para outra fatura', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  const { rerender } = render(<DisputeModal demurrageInvoiceId={1} docNumber="DEM-A" onClose={onClose} />)

  await user.type(screen.getByLabelText('Motivo da disputa'), 'Valor divergente')
  await user.click(screen.getByRole('button', { name: 'Voltar' }))
  rerender(<DisputeModal demurrageInvoiceId={null} docNumber="" onClose={onClose} />)
  rerender(<DisputeModal demurrageInvoiceId={2} docNumber="DEM-B" onClose={onClose} />)

  expect((screen.getByLabelText('Motivo da disputa') as HTMLTextAreaElement).value).toBe('')
})

// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { DiscountModal } from '../DiscountModal'
import type { DiscountForm } from '../../../services/demurrage/demurrageForms'

// Plano dos e-mails, 1E.3 (D7; migration 304): o desconto integral quita a
// Invoice ao salvar, e a tela avisa a consequência antes.
const form = (discount_value: string, discount_mode: DiscountForm['discount_mode'] = 'percent'): DiscountForm => ({
  discount_type: 'cortesia',
  discount_value,
  discount_mode,
  discount_justification: '',
  discount_approver: '',
})

function renderModal(value: string, mode: DiscountForm['discount_mode'] = 'percent') {
  return render(
    <DiscountModal open docNumber="DEM-1" totalUsd={250} form={form(value, mode)} loading={false} onFormChange={vi.fn()} onClose={vi.fn()} onSubmit={vi.fn()} />,
  )
}

it('avisa que o desconto integral quita a Invoice e a tira da Régua e das pendências', () => {
  renderModal('100')
  expect(screen.getByText(/fica quitada \(isenta\) ao salvar/)).toBeTruthy()
})

it('valor fixo igual ao total também avisa; desconto parcial não', () => {
  const { unmount } = renderModal('250', 'fixed')
  expect(screen.queryByText(/fica quitada \(isenta\)/)).toBeTruthy()
  unmount()
  renderModal('40')
  expect(screen.queryByText(/fica quitada \(isenta\)/)).toBeNull()
})

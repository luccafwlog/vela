// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { DemurrageContainerDatesModal } from '../DemurrageContainerDatesModal'
import { validateContainerDates } from '../demurrageFormRules'
import type { DemurrageContainerRow } from '../../../services/demurrage/demurrageContainers'

afterEach(cleanup)

const container = {
  id: 11,
  bl_id: 'BL-001',
  container_number: 'MSCU1234567',
  type: '20GP',
  discharge_date: '2026-06-01',
  return_date: '2026-07-11',
  demurrage_status: 'returned',
  billed_in: [{ id: 21, doc_number: 'DEM-021', status: 'issued', bl_id: 'BL-001' }],
  bl: { id: 'BL-001', customer: { id: 7, name: 'Cliente Teste', cnpj_cpf: '12345678000195' } },
} as unknown as DemurrageContainerRow

it('o motivo para remover a devolução é cobrado junto do campo, não por aviso passageiro', async () => {
  const onSubmit = vi.fn()
  const user = userEvent.setup()
  render(<DemurrageContainerDatesModal container={container} loading={false} onClose={vi.fn()} onSubmit={onSubmit} />)

  await user.clear(screen.getByLabelText(/Data de devolução/))
  await user.click(screen.getByRole('button', { name: 'Salvar datas' }))

  const reason = screen.getByLabelText(/Motivo da remoção/)
  expect(reason.getAttribute('aria-invalid')).toBe('true')
  expect(screen.getByRole('alert').textContent).toBe('Informe o motivo para remover a data de devolução.')
  expect(onSubmit).not.toHaveBeenCalled()

  await user.type(reason, 'Devolução lançada no container errado')
  await user.click(screen.getByRole('button', { name: 'Salvar datas' }))
  expect(onSubmit).toHaveBeenCalledWith({ discharge: '2026-06-01', ret: null, reason: 'Devolução lançada no container errado' })
})

it('avisa o efeito na Invoice que já cobra a caixa', () => {
  render(<DemurrageContainerDatesModal container={container} loading={false} onClose={vi.fn()} onSubmit={vi.fn()} />)
  expect(screen.getByText(/Este container está na Invoice DEM-021/)).toBeTruthy()
})

it('valida ordem e descarga obrigatória', () => {
  expect(validateContainerDates(container, { discharge: '', ret: '', reason: '' }).errors.discharge).toBe('Informe a data de descarga.')
  expect(validateContainerDates(container, { discharge: '2026-06-10', ret: '2026-06-01', reason: '' }).errors.ret).toBe('A devolução não pode ser anterior à descarga.')
  expect(validateContainerDates({ return_date: null }, { discharge: '2026-06-01', ret: '', reason: '' }).input).toEqual({ discharge: '2026-06-01', ret: null, reason: null })
})

it('a recusa do banco fica no modal', () => {
  render(<DemurrageContainerDatesModal container={container} loading={false} error="Descarga posterior à devolução gravada." onClose={vi.fn()} onSubmit={vi.fn()} />)
  expect(screen.getByRole('alert').textContent).toContain('As datas não foram alteradas.')
})

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ManualChargeFormFields, type ManualChargeFormValue } from '../ManualChargeFormFields'
import type { ManualChargeItemForBl } from '../../../services/charges/chargeOperationsService'

afterEach(cleanup)

const items = [
  {
    charge_item_id: 1,
    charge_item_name: 'THC',
    currency: 'BRL',
    effective_unit_value_brl: 100,
    effective_unit_value_usd: null,
  },
  {
    charge_item_id: 2,
    charge_item_name: 'BL Fee',
    currency: 'USD',
    effective_unit_value_brl: null,
    effective_unit_value_usd: 25,
  },
] as unknown as ManualChargeItemForBl[]

const baseForm: ManualChargeFormValue = {
  chargeItemId: '',
  quantity: '1',
  notes: '',
  editingChargeCalculationId: null,
}

function setup(overrides: Partial<Parameters<typeof ManualChargeFormFields>[0]> = {}) {
  const onPatch = vi.fn()
  const onSave = vi.fn()
  const onCancel = vi.fn()
  render(
    <ManualChargeFormFields
      form={baseForm}
      items={items}
      itemsLoading={false}
      saving={false}
      deleting={false}
      onPatch={onPatch}
      onSave={onSave}
      onCancel={onCancel}
      {...overrides}
    />,
  )
  return { onPatch, onSave, onCancel }
}

describe('ManualChargeFormFields', () => {
  it('renderiza as opções de item com moeda e valor', () => {
    setup()
    expect(screen.getByRole('option', { name: /THC \(BRL\)/ })).toBeTruthy()
    expect(screen.getByRole('option', { name: /BL Fee \(USD\)/ })).toBeTruthy()
  })

  it('chama onPatch ao alterar quantidade e observação', async () => {
    const user = userEvent.setup()
    const { onPatch } = setup()
    await user.type(screen.getByLabelText('Quantidade'), '2')
    expect(onPatch).toHaveBeenCalledWith({ quantity: expect.any(String) })
    await user.type(screen.getByLabelText('Observação'), 'x')
    expect(onPatch).toHaveBeenCalledWith({ notes: expect.any(String) })
  })

  it('em modo de criação mostra "Adicionar" e não mostra Cancelar', () => {
    const { onSave } = setup()
    expect(screen.getByRole('button', { name: /Adicionar cobrança manual/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Voltar' })).toBeNull()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('em modo de edição mostra "Salvar edição", desabilita o item e dispara onCancel', async () => {
    const user = userEvent.setup()
    const { onCancel } = setup({
      form: { ...baseForm, editingChargeCalculationId: 7, chargeItemId: '1' },
    })
    expect(screen.getByRole('button', { name: /Salvar edição/ })).toBeTruthy()
    expect((screen.getByLabelText('Item') as HTMLSelectElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('dispara onSave ao clicar no botão principal', async () => {
    const user = userEvent.setup()
    const { onSave } = setup()
    await user.click(screen.getByRole('button', { name: /Adicionar cobrança manual/ }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})

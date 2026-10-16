// @vitest-environment jsdom
//
// `total_weight_kg`/`total_cbm` medem só a carga conteinerizada (migrations 061
// e 064): um B/L de carga solta que mostrasse esse par criaria uma segunda
// cubagem, somada por `blTotalCbm()` à que já está em `bb_cbm`.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ReviewBlCheckForm } from '../ReviewBlCheckForm'

function makeItem(overrides: Record<string, unknown>) {
  return { id: 'BL-CBM-1', source: 'bl', shipper: 'Sany', consignee: 'Timbro', review_reasons: [], ...overrides } as never
}

describe('ReviewBlCheckForm', () => {
  it('carga solta edita as colunas de carga solta, e não as de contêiner', () => {
    render(<ReviewBlCheckForm item={makeItem({ cargo_mode: 'carga_solta', bb_weight_ton: 259.312, bb_cbm: 1217.109 })} saving={false} onSave={vi.fn()} />)
    expect((screen.getByLabelText('Peso carga solta (t)') as HTMLInputElement).value).toBe('259.312')
    expect((screen.getByLabelText('CBM carga solta (m³)') as HTMLInputElement).value).toBe('1217.109')
    expect(screen.queryByLabelText('CBM contêiner (m³)')).toBeNull()
  })

  it('B/L misto edita os dois pares', () => {
    render(<ReviewBlCheckForm item={makeItem({ cargo_mode: 'misto', total_cbm: 58.4, bb_cbm: 120 })} saving={false} onSave={vi.fn()} />)
    expect((screen.getByLabelText('CBM contêiner (m³)') as HTMLInputElement).value).toBe('58.4')
    expect((screen.getByLabelText('CBM carga solta (m³)') as HTMLInputElement).value).toBe('120')
  })

  it('entrega os valores com vírgula decimal e a justificativa padrão; Descartar volta ao B/L', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<ReviewBlCheckForm item={makeItem({ cargo_mode: 'container', total_weight_kg: 24000 })} saving={false} onSave={onSave} />)
    await user.clear(screen.getByLabelText('Peso contêiner (kg)'))
    await user.type(screen.getByLabelText('Peso contêiner (kg)'), '24100,5')
    await user.click(screen.getByRole('button', { name: 'Salvar revisão' }))
    expect(onSave.mock.calls[0][1]).toMatchObject({ total_weight_kg: 24100.5, justification: 'Revisão manual', shipper: 'Sany' })

    await user.click(screen.getByRole('button', { name: 'Descartar' }))
    expect((screen.getByLabelText('Peso contêiner (kg)') as HTMLInputElement).value).toBe('24000')
  })

  it('número que não se lê trava o salvar em vez de limpar o campo', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<ReviewBlCheckForm item={makeItem({ cargo_mode: 'container', total_weight_kg: 24000 })} saving={false} onSave={onSave} />)
    const weight = screen.getByLabelText('Peso contêiner (kg)')
    await user.clear(weight)
    await user.type(weight, '24.000')
    expect(weight.getAttribute('aria-invalid')).toBe('true')
    expect((screen.getByRole('button', { name: 'Salvar revisão' }) as HTMLButtonElement).disabled).toBe(true)

    await user.clear(weight)
    await user.type(weight, '1.234,5')
    await user.click(screen.getByRole('button', { name: 'Salvar revisão' }))
    expect(onSave.mock.calls[0][1]).toMatchObject({ total_weight_kg: 1234.5 })
  })
})

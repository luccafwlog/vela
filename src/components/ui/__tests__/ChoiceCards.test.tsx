// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ChoiceCards } from '../ChoiceCards'

const options = [
  { value: 'agora', title: 'Enviar agora', description: 'O convite sai já.' },
  { value: 'depois', title: 'Deixar para depois', description: 'Fica pendente.' },
] as const

describe('ChoiceCards', () => {
  it('começa sem escolha e avisa a opção tocada, com o efeito no nome acessível', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ChoiceCards label="Portal do Cliente" options={options} value={null} onChange={onChange} />)

    expect(screen.getByRole('group', { name: 'Portal do Cliente' })).toBeTruthy()
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios.every((radio) => !radio.checked)).toBe(true)
    await user.click(screen.getByRole('radio', { name: /Deixar para depois.*Fica pendente/ }))
    expect(onChange).toHaveBeenCalledWith('depois')
  })

  it('marca a opção escolhida', () => {
    render(<ChoiceCards label="Portal do Cliente" options={options} value="agora" onChange={vi.fn()} />)
    expect((screen.getByRole('radio', { name: /Enviar agora/ }) as HTMLInputElement).checked).toBe(true)
  })
})

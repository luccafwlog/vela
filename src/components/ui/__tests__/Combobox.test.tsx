// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Combobox } from '../Combobox'

afterEach(() => vi.useRealTimers())

describe('Combobox acessível', () => {
  it('anuncia a opção ativa sem aninhar botão em option', async () => {
    vi.useFakeTimers()
    render(<Combobox label="Viagem" onValueChange={vi.fn()} fetchOptions={async () => [{ value: '1', label: 'NAVIO / 1' }]} />)
    const input = screen.getByRole('combobox', { name: 'Viagem' })
    fireEvent.change(input, { target: { value: 'NAV' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const option = screen.getByRole('option', { name: /NAVIO/ })
    expect(input.getAttribute('aria-activedescendant')).toBe(option.id)
    expect(option.querySelector('button')).toBeNull()
  })

  it('seleciona uma opção por clique sintetizado', async () => {
    vi.useFakeTimers()
    const onSelectOption = vi.fn()
    render(
      <Combobox
        label="Viagem"
        onValueChange={vi.fn()}
        onSelectOption={onSelectOption}
        fetchOptions={async () => [{ value: '1', label: 'NAVIO / 1' }]}
      />,
    )
    const input = screen.getByRole('combobox', { name: 'Viagem' })
    fireEvent.change(input, { target: { value: 'NAV' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })

    fireEvent.click(screen.getByRole('option', { name: /NAVIO/ }))

    expect(onSelectOption).toHaveBeenCalledWith({ value: '1', label: 'NAVIO / 1' })
    expect((input as HTMLInputElement).value).toBe('NAVIO / 1')
  })
})

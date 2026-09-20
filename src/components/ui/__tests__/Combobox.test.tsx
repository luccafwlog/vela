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

  it('fecha o menu e limpa o destaque ao pressionar Escape', async () => {
    vi.useFakeTimers()
    render(<Combobox label="Viagem" onValueChange={vi.fn()} fetchOptions={async () => [{ value: '1', label: 'NAVIO / 1' }]} />)
    const input = screen.getByRole('combobox', { name: 'Viagem' })
    fireEvent.change(input, { target: { value: 'NAV' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(input.getAttribute('aria-activedescendant')).toBeTruthy()

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(input.getAttribute('aria-activedescendant')).toBeNull()
  })

  it('rola a opção destacada para a área visível quando suportado', async () => {
    vi.useFakeTimers()
    const scrollIntoView = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView

    render(<Combobox label="Viagem" onValueChange={vi.fn()} fetchOptions={async () => [{ value: '1', label: 'NAVIO / 1' }]} />)
    const input = screen.getByRole('combobox', { name: 'Viagem' })
    fireEvent.change(input, { target: { value: 'NAV' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    fireEvent.keyDown(input, { key: 'ArrowDown' })

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })
})

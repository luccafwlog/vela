// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Combobox } from '../Combobox'
import { FilterBar } from '../FilterBar'

afterEach(() => vi.useRealTimers())

describe('FilterBar acessível', () => {
  it('fecha com Escape e devolve o foco ao botão de filtros', () => {
    render(
      <FilterBar>
        <label>Busca <input /></label>
      </FilterBar>,
    )

    const trigger = screen.getByRole('button', { name: 'Filtros' })
    fireEvent.click(trigger)
    const search = screen.getByRole('textbox', { name: 'Busca' })
    search.focus()
    fireEvent.keyDown(search, { key: 'Escape' })

    expect(screen.queryByRole('textbox', { name: 'Busca' })).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  it('deixa o combobox fechar primeiro e fecha os filtros no Escape seguinte', async () => {
    vi.useFakeTimers()
    render(
      <FilterBar>
        <Combobox label="Viagem" onValueChange={vi.fn()} fetchOptions={async () => [{ value: '1', label: 'NAVIO / 1' }]} />
      </FilterBar>,
    )

    const trigger = screen.getByRole('button', { name: 'Filtros' })
    fireEvent.click(trigger)
    const combo = screen.getByRole('combobox', { name: 'Viagem' })
    fireEvent.change(combo, { target: { value: 'NAV' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    fireEvent.keyDown(combo, { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeTruthy()

    fireEvent.keyDown(combo, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    fireEvent.keyDown(combo, { key: 'Escape' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })
})

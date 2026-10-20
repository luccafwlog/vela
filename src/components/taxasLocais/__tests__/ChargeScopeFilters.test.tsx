// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChargeScopeFilters } from '../ChargeScopeFilters'

afterEach(cleanup)

it('o filtro Modo de carga não oferece Granito, que não tem taxa (lote 5b)', () => {
  render(<ChargeScopeFilters cargoModeFilter="" setCargoModeFilter={vi.fn()} podFilter="" setPodFilter={vi.fn()} pods={[]} />)

  const select = screen.getAllByRole('combobox')[0]!
  const labels = within(select).getAllByRole('option').map((option) => option.textContent)
  expect(labels).toEqual(['Todos', 'Container', 'Carga solta'])
})

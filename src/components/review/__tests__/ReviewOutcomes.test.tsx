// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { ReviewOutcomes, type ReviewOutcome } from '../ReviewOutcomes'

afterEach(cleanup)

function renderOutcomes(outcomes: ReviewOutcome[]) {
  return (
    <MemoryRouter>
      <ReviewOutcomes outcomes={outcomes} recalcNotices={[]} recalcingId={null} onDismissOutcome={vi.fn()} onDismissRecalc={vi.fn()} onRecalc={vi.fn()} />
    </MemoryRouter>
  )
}

it('o primeiro resultado entra numa região viva que já estava montada', () => {
  const view = render(renderOutcomes([]))
  const live = view.container.querySelector('[aria-live="polite"]')
  expect(live).not.toBeNull()
  expect(screen.queryByRole('region', { name: 'Resultados recentes' })).toBeNull()

  view.rerender(renderOutcomes([{ id: 'o1', tone: 'danger', title: 'B/L BL1: falha ao salvar a correção', lines: ['Tente de novo.'] }]))
  const region = screen.getByRole('region', { name: 'Resultados recentes' })
  expect(view.container.querySelector('[aria-live="polite"]')).toBe(live)
  expect(live?.contains(region)).toBe(true)
  expect(region.textContent).toMatch(/falha ao salvar a correção/)
})

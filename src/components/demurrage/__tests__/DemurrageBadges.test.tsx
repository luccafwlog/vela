// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { InvoiceStatusBadge } from '../DemurrageBadges'

afterEach(cleanup)

it('B29: invoice de Demurrage não vence; overdue legado aparece como Em aberto, no tom de Faturado', () => {
  const { container: overdue } = render(<InvoiceStatusBadge status="overdue" />)
  expect(screen.getByText('Em aberto')).toBeTruthy()
  expect(screen.queryByText('Vencido')).toBeNull()
  const overdueClass = overdue.firstElementChild?.className
  cleanup()
  const { container: issued } = render(<InvoiceStatusBadge status="issued" />)
  expect(issued.firstElementChild?.className).toBe(overdueClass)
})

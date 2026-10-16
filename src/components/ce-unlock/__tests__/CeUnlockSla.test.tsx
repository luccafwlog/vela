// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { CeUnlockSla } from '../CeUnlockSla'
afterEach(cleanup)

// Início às 09:00 de sexta 16/10 (manhã): vence às 17:00 do mesmo dia.
const start = '2026-10-16T09:00:00-03:00'
it('prazo numa célula: data, "Hoje, HH:MM" em âmbar e "Venceu" em vermelho', () => {
  const ok = render(<CeUnlockSla start={start} now={new Date('2026-10-15T10:00:00-03:00')} />)
  expect(ok.container.textContent).toBe('16/10, 17:00')
  cleanup()
  const today = render(<CeUnlockSla start={start} now={new Date('2026-10-16T10:00:00-03:00')} />)
  expect(today.container.textContent).toBe('Hoje, 17:00')
  expect(today.container.querySelector('.app-status-text--warning')).toBeTruthy()
  cleanup()
  const late = render(<CeUnlockSla start={start} now={new Date('2026-10-16T18:00:00-03:00')} />)
  expect(late.container.textContent).toBe('Venceu 16/10, 17:00')
  expect(late.container.querySelector('.app-status-text--danger')).toBeTruthy()
  cleanup()
  const done = render(<CeUnlockSla start={start} doneAt="2026-10-16T18:00:00-03:00" />)
  expect(done.container.textContent).toBe('16/10, 17:00')
  expect(done.container.querySelector('[title="Exportado fora do prazo"]')).toBeTruthy()
})

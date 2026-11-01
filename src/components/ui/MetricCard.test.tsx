// @vitest-environment jsdom
import { afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MetricCard } from './MetricCard'

afterEach(cleanup)

describe('MetricCard', () => {
  it('renders label and string value', () => {
    render(<MetricCard label="Total" value="42" />)
    expect(screen.getByText('Total')).toBeTruthy()
    expect(screen.getByText('42')).toBeTruthy()
  })

  it('renders numeric value', () => {
    render(<MetricCard label="Count" value={99} />)
    expect(screen.getByText('99')).toBeTruthy()
  })

  it('applies app-metric-tile classes', () => {
    const { container } = render(<MetricCard label="L" value="V" />)
    expect(container.querySelector('.app-metric-tile')).toBeTruthy()
    expect(container.querySelector('.app-metric-tile__label')).toBeTruthy()
    expect(container.querySelector('.app-metric-tile__value')).toBeTruthy()
  })

  it('cartão sem ação é liso: sem botão e sem a marca de ação', () => {
    const { container } = render(<MetricCard label="Clientes" value="312" />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(container.querySelector('.app-metric-tile--static')).toBeTruthy()
    expect(container.querySelector('.app-metric-tile__cue')).toBeNull()
  })

  it('cartão que filtra é botão com "Filtrar" e diz quando o filtro está aplicado', () => {
    const { rerender } = render(<MetricCard label="Taxas a revisar" value="7" tone="warning" selected={false} onSelect={() => {}} />)
    const button = screen.getByRole('button', { name: /Taxas a revisar/ })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.textContent).toContain('Filtrar')
    rerender(<MetricCard label="Taxas a revisar" value="7" tone="warning" selected onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: /Taxas a revisar/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /Taxas a revisar/ }).textContent).toContain('Filtrando')
  })

  it('cartão que só leva a outra tela mostra "Abrir", sem aria-pressed', () => {
    render(<MetricCard label="Demurrage em aberto" value="US$ 0,00" onSelect={() => {}} />)
    const button = screen.getByRole('button', { name: /Demurrage em aberto/ })
    expect(button.getAttribute('aria-pressed')).toBeNull()
    expect(button.textContent).toContain('Abrir')
  })
})

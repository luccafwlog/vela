// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PreviewBox } from './PreviewBox'

afterEach(cleanup)

describe('PreviewBox', () => {
  it('formats numeric values, preserves strings, and honors fixed decimals', () => {
    const { rerender } = render(<PreviewBox label="Quantidade" value={1234} />)
    expect(screen.getByText('1.234')).toBeTruthy()

    rerender(<PreviewBox label="Viagem" value="COSCO 123" />)
    expect(screen.getByText('COSCO 123')).toBeTruthy()

    rerender(<PreviewBox label="Peso" value={12.5} decimals={3} />)
    expect(screen.getByText('12,500')).toBeTruthy()
  })

  it('rounds to an integer when decimals is zero', () => {
    render(<PreviewBox label="Quantidade" value={12.5} decimals={0} />)

    expect(screen.getByText('13')).toBeTruthy()
  })

  it('renders the caller-specific visual variants through the canonical component', () => {
    const { rerender } = render(<PreviewBox label="Linhas válidas" value={1} variant="metric-centered" />)
    expect(screen.getByText('Linhas válidas').parentElement?.classList.contains('app-metric-tile')).toBe(true)
    expect(screen.getByText('Linhas válidas').parentElement?.classList.contains('text-center')).toBe(true)

    rerender(<PreviewBox label="Erros" value={2} variant="kpi" tone="gold" />)
    expect(screen.getByText('Erros').parentElement?.classList.contains('app-kpi-card')).toBe(true)
    expect(screen.getByText('Erros').parentElement?.classList.contains('app-kpi-card--gold')).toBe(true)
    expect(screen.getByText('2').classList.contains('app-kpi-card__value')).toBe(true)
    expect(screen.getByText('2').classList.contains('app-kpi-card__value--gold')).toBe(true)

    for (const [label, tone] of [['Processados', 'blue'], ['Sucesso', 'green'], ['Viagem selecionada', 'navy']] as const) {
      rerender(<PreviewBox label={label} value={2} variant="kpi" tone={tone} />)
      expect(screen.getByText(label).parentElement?.classList.contains(`app-kpi-card--${tone}`)).toBe(true)
    }

    rerender(<PreviewBox label="Erros" value={2} variant="kpi" />)
    expect(screen.getByText('Erros').parentElement?.classList.contains('app-kpi-card--navy')).toBe(true)
  })
})

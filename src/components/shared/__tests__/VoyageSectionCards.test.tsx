// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  AccordionSection,
  Info,
  MetricPanel,
  MetricSection,
} from '../VoyageSectionCards'

afterEach(cleanup)

describe('AccordionSection', () => {
  it('renderiza filhos só quando aberto e reflete aria-expanded', () => {
    const { rerender } = render(
      <AccordionSection title="Importação" description="desc" open={false} onToggle={() => {}}>
        <div>conteúdo</div>
      </AccordionSection>,
    )
    expect(screen.queryByText('conteúdo')).toBeNull()
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')

    rerender(
      <AccordionSection title="Importação" description="desc" open onToggle={() => {}}>
        <div>conteúdo</div>
      </AccordionSection>,
    )
    expect(screen.getByText('conteúdo')).toBeTruthy()
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true')
  })

  it('dispara onToggle ao clicar', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(
      <AccordionSection title="T" description="d" open={false} onToggle={onToggle}>
        <div />
      </AccordionSection>,
    )
    await user.click(screen.getByRole('button'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})

describe('Info', () => {
  it('mostra valor simples', () => {
    render(<Info label="B/Ls" value="42" />)
    expect(screen.getByText('B/Ls')).toBeTruthy()
    expect(screen.getByText('42')).toBeTruthy()
  })

  it('renderiza tokens quando o valor tem múltiplos itens separados por " | "', () => {
    render(<Info label="Tipos" value="40HC: 2 | 20GP: 1" />)
    expect(screen.getByText('40HC: 2')).toBeTruthy()
    expect(screen.getByText('20GP: 1')).toBeTruthy()
  })
})

describe('MetricPanel / MetricSection', () => {
  it('MetricPanel mostra título e filhos', () => {
    render(
      <MetricPanel title="Container">
        <Info label="x" value="1" />
      </MetricPanel>,
    )
    expect(screen.getByText('Container')).toBeTruthy()
    expect(screen.getByText('x')).toBeTruthy()
  })

  it('MetricSection mostra título, descrição, ações e filhos', () => {
    render(
      <MetricSection title="Exportação" description="resumo" actions={<button>Editar</button>}>
        <div>corpo</div>
      </MetricSection>,
    )
    expect(screen.getByText('Exportação')).toBeTruthy()
    expect(screen.getByText('resumo')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Editar' })).toBeTruthy()
    expect(screen.getByText('corpo')).toBeTruthy()
  })
})

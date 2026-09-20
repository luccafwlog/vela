// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from '../Button'
import { EmptyState } from '../Card'
import { Field, Input } from '../Input'
import { SkeletonTable } from '../Skeleton'

describe('primitives acessíveis', () => {
  it('preserva o conteúdo no fluxo e anuncia botão ocupado', () => {
    render(<Button loading>Salvar</Button>)
    const button = screen.getByRole('button', { name: 'Carregando…' })
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.querySelector('[data-button-label]')?.textContent).toBe('Salvar')
  })

  it('propaga obrigatoriedade e erro do Field para o controle', () => {
    render(<Field label="Nome" required error="Informe o nome"><Input aria-describedby="orientacao-externa" /></Field>)
    const input = screen.getByRole('textbox', { name: /Nome/ })
    expect(input.getAttribute('required')).not.toBeNull()
    expect(input.getAttribute('aria-required')).toBe('true')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toContain('orientacao-externa')
  })

  it('renderiza ação contextual no estado vazio', () => {
    render(<EmptyState title="Nenhum registro" action={<Button>Importar</Button>} />)
    expect(screen.getByRole('button', { name: 'Importar' })).toBeTruthy()
  })

  it('aceita geometria de colunas e anuncia carregamento da tabela', () => {
    render(<SkeletonTable rows={1} cols={3} columnTemplate="2fr 1fr 80px" label="Carregando faturas" />)
    const skeleton = screen.getByLabelText('Carregando faturas')
    expect(skeleton.getAttribute('aria-busy')).toBe('true')
    expect((skeleton.firstElementChild as HTMLElement).style.gridTemplateColumns).toBe('2fr 1fr 80px')
  })
})

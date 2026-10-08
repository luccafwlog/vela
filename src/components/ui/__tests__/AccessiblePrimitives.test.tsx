// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../Button'
import { EmptyState } from '../Card'
import { Field, Input } from '../Input'
import { SkeletonTable } from '../Skeleton'

describe('primitives acessíveis', () => {
  it('mantém o rótulo visível e o nome da ação enquanto o botão está ocupado', () => {
    render(<Button loading aria-label="Salvar alterações">Salvar</Button>)
    const button = screen.getByRole('button', { name: 'Salvar alterações' })
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.hasAttribute('disabled')).toBe(true)
    const label = button.querySelector('[data-button-label]')
    expect(label?.textContent).toBe('Salvar')
    expect(label?.className).not.toContain('invisible')
    expect(button.querySelector('.app-btn__spinner')).toBeTruthy()
  })

  it('troca para o texto específico da ação sem mudar a célula do rótulo', () => {
    const { rerender } = render(<Button loading={false} loadingLabel="Emitindo…">Emitir fatura</Button>)
    // Em repouso, o texto de andamento já reserva a largura, fora da leitura.
    expect(screen.getByRole('button', { name: 'Emitir fatura' }).hasAttribute('aria-busy')).toBe(false)
    rerender(<Button loading loadingLabel="Emitindo…">Emitir fatura</Button>)
    const button = screen.getByRole('button', { name: 'Emitindo…' })
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.querySelectorAll('.app-btn__stack > *')).toHaveLength(2)
  })

  it('não dispara a ação de novo enquanto ocupado', async () => {
    const onClick = vi.fn()
    render(<Button loading onClick={onClick}>Salvar</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(onClick).not.toHaveBeenCalled()
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

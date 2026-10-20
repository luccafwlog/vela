// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Receipt, Trash2 } from 'lucide-react'
import { RowActionButton } from '../RowActionButton'
import { RowActionLink } from '../RowActionLink'

describe('RowActionButton', () => {
  it('dá o nome da ação ao leitor de tela e ao passar o mouse, sem texto visível', () => {
    const onClick = vi.fn()
    render(<RowActionButton label="Excluir" icon={Trash2} variant="danger" onClick={onClick} />)
    const button = screen.getByRole('button', { name: 'Excluir' })
    expect(button.getAttribute('title')).toBe('Excluir')
    expect(button.textContent).toBe('')
    expect(button.className).toContain('app-btn--icon')
    expect(button.className).toContain('app-btn--danger')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('aceita uma dica própria no title sem trocar o nome acessível', () => {
    render(<RowActionButton label="Resolver" icon={Trash2} title="Ver Demurrage" />)
    expect(screen.getByRole('button', { name: 'Resolver' }).getAttribute('title')).toBe('Ver Demurrage')
  })

  it('é type="button" por padrão, para não enviar o formulário em volta', () => {
    const onSubmit = vi.fn((event: Event) => event.preventDefault())
    render(<form onSubmit={(event) => onSubmit(event.nativeEvent)}><RowActionButton label="Editar" icon={Trash2} /></form>)
    const button = screen.getByRole('button', { name: 'Editar' })
    expect(button.getAttribute('type')).toBe('button')
    fireEvent.click(button)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('em andamento, fica desativado, anuncia aria-busy e mostra o indicador', () => {
    const { container, rerender } = render(<RowActionButton label="Editar" icon={Trash2} />)
    const button = screen.getByRole('button', { name: 'Editar' }) as HTMLButtonElement
    expect(button.getAttribute('aria-busy')).toBeNull()
    expect(container.querySelector('.app-btn__spinner')).toBeNull()
    rerender(<RowActionButton label="Editar" icon={Trash2} loading />)
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(container.querySelector('.app-btn__spinner')).not.toBeNull()
    expect(button.textContent).toBe('')
  })
})

describe('RowActionLink', () => {
  it('é um link do app com a cara do botão de ícone e o nome no title e no leitor de tela', () => {
    render(<MemoryRouter><RowActionLink to="/bls/MSCU1" label="Abrir B/L MSCU1" icon={Receipt} /></MemoryRouter>)
    const link = screen.getByRole('link', { name: 'Abrir B/L MSCU1' })
    expect(link.getAttribute('href')).toBe('/bls/MSCU1')
    expect(link.getAttribute('title')).toBe('Abrir B/L MSCU1')
    expect(link.textContent).toBe('')
    expect(link.className).toContain('app-btn')
    expect(link.className).toContain('app-btn--secondary')
    expect(link.className).toContain('app-btn--icon')
  })

  it('aceita dica própria no title e endereço externo em href, sem precisar de roteador', () => {
    render(<RowActionLink href="https://example.com/x" target="_blank" rel="noopener noreferrer" label="Ver no mapa (abre em nova aba)" title="Ver no mapa" icon={Receipt} />)
    const link = screen.getByRole('link', { name: 'Ver no mapa (abre em nova aba)' })
    expect(link.getAttribute('href')).toBe('https://example.com/x')
    expect(link.getAttribute('title')).toBe('Ver no mapa')
    expect(link.getAttribute('target')).toBe('_blank')
  })
})

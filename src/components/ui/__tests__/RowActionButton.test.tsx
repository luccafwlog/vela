// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Trash2 } from 'lucide-react'
import { RowActionButton } from '../RowActionButton'

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

  it('em andamento, fica desativado', () => {
    render(<RowActionButton label="Editar" icon={Trash2} loading />)
    expect((screen.getByRole('button', { name: 'Editar' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

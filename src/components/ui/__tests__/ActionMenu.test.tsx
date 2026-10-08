// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActionMenu } from '../ActionMenu'

afterEach(cleanup)

function renderMenu(onOmit = vi.fn(), onDelete = vi.fn()) {
  render(
    <MemoryRouter>
      <ActionMenu
        label="Mais ações da escala"
        trigger="⋮"
        menuId="menu-escala"
        items={[
          { key: 'omitir', label: 'Omitir escala', onSelect: onOmit },
          { key: 'bloqueada', label: 'Reativar escala', disabled: true },
          { key: 'excluir', label: 'Excluir escala', onSelect: onDelete, danger: true },
        ]}
      />
    </MemoryRouter>,
  )
  return { onOmit, onDelete }
}

describe('ActionMenu', () => {
  it('abre com foco no primeiro item, percorre com setas e pula item desativado', async () => {
    renderMenu()
    const trigger = screen.getByRole('button', { name: 'Mais ações da escala' })
    await userEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Omitir escala' }))
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Excluir escala' }))
    await userEvent.keyboard('{Home}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Omitir escala' }))
  })

  it('fecha com Escape e devolve o foco ao botão', async () => {
    renderMenu()
    const trigger = screen.getByRole('button', { name: 'Mais ações da escala' })
    await userEvent.click(trigger)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('executa o item escolhido e fecha o menu', async () => {
    const { onDelete } = renderMenu()
    await userEvent.click(screen.getByRole('button', { name: 'Mais ações da escala' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Excluir escala' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

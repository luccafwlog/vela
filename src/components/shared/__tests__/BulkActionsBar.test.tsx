// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BulkActionsBar } from '../BulkActionsBar'

afterEach(() => cleanup())

describe('BulkActionsBar', () => {
  it('nao renderiza nada quando nao ha selecao', () => {
    const { container } = render(
      <BulkActionsBar count={0} onClear={vi.fn()} onDelete={vi.fn()} noun={['veiculo', 'veiculos']} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('mostra o rotulo no singular para um item', () => {
    render(<BulkActionsBar count={1} onClear={vi.fn()} onDelete={vi.fn()} noun={['cliente', 'clientes']} />)
    expect(screen.getByText('1 cliente selecionado')).toBeTruthy()
  })

  it('mostra o rotulo no plural e dispara os callbacks', async () => {
    const onClear = vi.fn()
    const onDelete = vi.fn()
    render(<BulkActionsBar count={3} onClear={onClear} onDelete={onDelete} noun={['B/L', 'B/Ls']} />)

    expect(screen.getByText('3 B/Ls selecionados')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /limpar/i }))
    await userEvent.click(screen.getByRole('button', { name: /excluir selecionados/i }))

    expect(onClear).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('desabilita as acoes enquanto exclui', () => {
    render(<BulkActionsBar count={2} onClear={vi.fn()} onDelete={vi.fn()} deleting noun={['container', 'containers']} />)
    expect(screen.getByRole('button', { name: /limpar/i }).hasAttribute('disabled')).toBe(true)
  })

  it('renderiza acoes extras quando fornecidas', () => {
    render(
      <BulkActionsBar count={2} onClear={vi.fn()} onDelete={vi.fn()} noun={['veiculo', 'veiculos']} extraActions={<button type="button">Definir local de desova</button>} />,
    )
    expect(screen.getByRole('button', { name: 'Definir local de desova' })).toBeTruthy()
  })
})

it('enquanto lê o filtro inteiro, esconde excluir e as ações extras (agiriam só na seleção antiga)', () => {
  render(
    <BulkActionsBar count={2} total={50} loadingAll noun={['B/L', 'B/Ls']} onClear={() => {}} onDelete={() => {}}
      extraActions={<button type="button">Mover</button>} />,
  )
  expect(screen.queryByRole('button', { name: /Excluir selecionados/ })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Mover' })).toBeNull()
  expect(screen.getByRole('button', { name: /Limpar seleção/ })).toBeTruthy()
})

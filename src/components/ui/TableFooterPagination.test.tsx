// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { TableFooterPagination } from './TableFooterPagination'

describe('TableFooterPagination', () => {
  it('informa o intervalo visível e o total', () => {
    render(<TableFooterPagination page={2} pageSize={50} totalCount={340} totalPages={7} onPageChange={vi.fn()} />)
    expect(screen.getByText('Exibindo 51–100 de 340')).toBeTruthy()
    expect(screen.getByText('Página 2 de 7')).toBeTruthy()
  })

  it('calcula o intervalo quando a paginação começa em zero', () => {
    render(<TableFooterPagination page={1} pageBase={0} pageSize={20} totalCount={35} totalPages={2} onPageChange={vi.fn()} />)
    expect(screen.getByText('Exibindo 21–35 de 35')).toBeTruthy()
  })

  it('disables previous and next at the limits', () => {
    const onPageChange = vi.fn()

    const { rerender } = render(
      <TableFooterPagination page={1} pageSize={20} totalCount={20} totalPages={2} onPageChange={onPageChange} />,
    )

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Anterior' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Próxima' }).disabled).toBe(false)

    rerender(<TableFooterPagination page={2} pageSize={20} totalCount={20} totalPages={2} onPageChange={onPageChange} />)

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Anterior' }).disabled).toBe(false)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Próxima' }).disabled).toBe(true)
  })

  it('emits page size changes', async () => {
    const onPageSizeChange = vi.fn()

    render(
      <TableFooterPagination
        page={1}
        pageSize={20}
        totalCount={20}
        totalPages={1}
        onPageChange={vi.fn()}
        onPageSizeChange={onPageSizeChange}
      />,
    )

    await userEvent.selectOptions(screen.getByRole('combobox'), '50')

    expect(onPageSizeChange).toHaveBeenCalledWith(50)
  })

  it('mostra só "Nenhum registro" na lista vazia, sem "Página 0 de 0" nem navegação', () => {
    render(<TableFooterPagination page={1} pageSize={20} totalCount={0} totalPages={0} onPageChange={vi.fn()} />)
    expect(screen.getByText('Nenhum registro')).toBeTruthy()
    expect(screen.queryByText(/Página/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Anterior' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Próxima' })).toBeNull()
  })

  it('não repete "Página 1 de 1" nem mostra navegação com uma página só', () => {
    render(<TableFooterPagination page={1} pageSize={20} totalCount={7} totalPages={1} onPageChange={vi.fn()} />)
    expect(screen.getByText('Exibindo 1–7 de 7')).toBeTruthy()
    expect(screen.queryByText(/Página/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Próxima' })).toBeNull()
  })
})

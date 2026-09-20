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
})

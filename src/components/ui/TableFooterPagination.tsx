import { Button } from './Button'
import { Select } from './Input'
import { PAGE_SIZES } from '../../hooks/usePageFilters'

type TableFooterPaginationProps = {
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  pageSizes?: readonly number[]
  pageBase?: 0 | 1
}

export function TableFooterPagination({
  page,
  pageSize,
  totalCount,
  totalPages,
  onPageChange,
  onPageSizeChange,
  pageSizes = PAGE_SIZES,
  pageBase = 1,
}: TableFooterPaginationProps) {
  const displayPage = totalCount === 0 ? 0 : (pageBase === 0 ? page + 1 : page)
  const displayTotalPages = totalCount === 0 ? 0 : totalPages
  const firstPage = pageBase
  const lastPage = pageBase === 0 ? totalPages - 1 : totalPages
  const rangeStart = totalCount === 0 ? 0 : (displayPage - 1) * pageSize + 1
  const rangeEnd = Math.min(displayPage * pageSize, totalCount)
  const rangeSummary = totalCount === 0 ? 'Nenhum registro' : `Exibindo ${rangeStart}–${rangeEnd} de ${totalCount}`
  const pageSummary = `Página ${displayPage} de ${displayTotalPages}`

  return (
    <div className="app-table__footer">
      <div><span>{rangeSummary}</span><span className="block text-xs">{pageSummary}</span></div>
      <div className="app-table__footer-controls">
        {onPageSizeChange ? (
          <Select className="w-28" value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
            {pageSizes.map((size) => (
              <option key={size} value={size}>
                {size} por página
              </option>
            ))}
          </Select>
        ) : null}
        <Button variant="secondary" disabled={totalCount === 0 || page <= firstPage} onClick={() => onPageChange(Math.max(firstPage, page - 1))}>
          Anterior
        </Button>
        <Button variant="secondary" disabled={totalCount === 0 || page >= lastPage} onClick={() => onPageChange(Math.min(lastPage, page + 1))}>
          Próxima
        </Button>
      </div>
    </div>
  )
}

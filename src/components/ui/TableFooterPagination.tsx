import { Button } from './Button'
import { Select } from './Input'
import { PAGE_SIZES } from '../../hooks/usePageFilters'
import { describePageRange } from '../../lib/pagination'

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
  const displayPage = pageBase === 0 ? page + 1 : page
  const firstPage = pageBase
  const lastPage = pageBase === 0 ? totalPages - 1 : totalPages
  const rangeSummary = describePageRange({ page, pageSize, totalCount, pageBase })
  // Com uma página só, "Página 1 de 1" repete o intervalo; vazio não tem página.
  const pageSummary = totalCount > 0 && totalPages > 1 ? `Página ${displayPage} de ${totalPages}` : null
  const singlePage = totalCount === 0 || totalPages <= 1

  return (
    <div className="app-table__footer">
      <div aria-live="polite">
        <span>{rangeSummary}</span>
        {pageSummary ? <span className="app-table__footer-page">{pageSummary}</span> : null}
      </div>
      <div className="app-table__footer-controls">
        {onPageSizeChange ? (
          <Select className="w-36" aria-label="Registros por página" value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
            {pageSizes.map((size) => (
              <option key={size} value={size}>
                {size} por página
              </option>
            ))}
          </Select>
        ) : null}
        {singlePage ? null : (
          <>
            <Button variant="secondary" disabled={page <= firstPage} onClick={() => onPageChange(Math.max(firstPage, page - 1))}>
              Anterior
            </Button>
            <Button variant="secondary" disabled={page >= lastPage} onClick={() => onPageChange(Math.min(lastPage, page + 1))}>
              Próxima
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

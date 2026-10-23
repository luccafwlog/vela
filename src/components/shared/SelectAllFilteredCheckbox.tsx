import { useEffect, useRef } from 'react'

/**
 * Checkbox do cabeçalho que marca o resultado filtrado inteiro, em todas as
 * páginas (revisão de 2026-10-22, G1). Meio marcado quando só parte está
 * selecionada; o nome acessível diz quantas linhas o filtro tem.
 */
export function SelectAllFilteredCheckbox({
  selection,
  noun,
  disabled = false,
}: {
  selection: { allSelected: boolean; someSelected: boolean; loadingAll: boolean; totalCount: number; toggleAll: () => Promise<void> }
  /** Plural da entidade, ex.: 'B/Ls'. */
  noun: string
  disabled?: boolean
}) {
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = selection.someSelected
  }, [selection.someSelected])
  const total = selection.totalCount.toLocaleString('pt-BR')
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={selection.allSelected ? `Desmarcar todos os ${noun} do filtro (${total})` : `Selecionar todos os ${noun} do filtro (${total})`}
      aria-busy={selection.loadingAll || undefined}
      checked={selection.allSelected}
      disabled={disabled || selection.loadingAll || selection.totalCount === 0}
      onChange={() => void selection.toggleAll()}
    />
  )
}

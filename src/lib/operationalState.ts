export type OperationalFilter = {
  label: string
  value: string | number | boolean | null | undefined
}

export function formatResultCount(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`
}

export function describeActiveFilters(filters: OperationalFilter[]) {
  const active = filters
    .filter((filter) => filter.value !== null && filter.value !== undefined && String(filter.value).trim() !== '')
    .map((filter) => `${filter.label} ${String(filter.value).trim()}`)

  return active.length ? `Filtros ativos: ${active.join(', ')}` : 'Sem filtros ativos'
}

export function describeEmptyState({
  entitySingular,
  entityPlural,
  hasActiveFilters: filtered,
  emptyWithoutFilters,
  emptyWithFilters,
}: {
  entitySingular?: string
  entityPlural: string
  hasActiveFilters: boolean
  emptyWithoutFilters: string
  emptyWithFilters?: string
}) {
  if (filtered) {
    const singular = entitySingular ?? entityPlural.replace(/s$/, '')
    return {
      title: emptyWithFilters ?? `Nenhuma ${singular} encontrada.`,
      description: `Os filtros atuais nao retornaram ${entityPlural}. Ajuste ou limpe os filtros para ampliar a busca.`,
    }
  }

  return {
    title: emptyWithoutFilters,
    description: 'Quando houver dados para este módulo, eles aparecerão aqui.',
  }
}

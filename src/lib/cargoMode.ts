export type BlCargoMode = 'container' | 'carga_solta' | 'misto'

export type CargoModeLabel = BlCargoMode | 'granito' | string | null | undefined

/**
 * A B/L misto participates in both operational cargo lenses. It is still one
 * document, so callers that count B/Ls must not add it twice.
 */
export function isContainerCargoMode(mode: string | null | undefined) {
  return mode === 'container' || mode === 'misto'
}

export function isBreakbulkCargoMode(mode: string | null | undefined) {
  return mode === 'carga_solta' || mode === 'misto'
}

export function matchesBlCargoModeFilter(
  mode: string | null | undefined,
  filter: string | null | undefined,
) {
  if (!filter) return true
  if (filter === 'container') return isContainerCargoMode(mode)
  if (filter === 'carga_solta') return isBreakbulkCargoMode(mode)
  return mode === filter
}

export function cargoModeLabel(mode: CargoModeLabel) {
  if (mode === 'misto') return 'Misto'
  if (mode === 'carga_solta') return 'Carga Solta'
  if (mode === 'granito') return 'Granito'
  return 'Container'
}

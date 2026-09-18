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

/**
 * Peso físico total de um B/L, em quilos.
 *
 * `bls.total_weight_kg` mede SOMENTE a carga conteinerizada e `bls.bb_weight_ton`
 * SOMENTE a carga solta — são componentes disjuntos, e por isso somam. Até a
 * migration 061 os importadores de carga solta espelhavam o mesmo peso nas duas
 * colunas, o que obrigava os consumidores a escolher uma delas (`bb_weight_ton
 * ?? total_weight_kg / 1000`); esse desempate subcontava o B/L misto. Quem
 * precisa do peso total do documento usa este helper, não uma das colunas.
 */
export function blTotalWeightKg(
  bl: { total_weight_kg?: number | string | null; bb_weight_ton?: number | string | null },
) {
  return Number(bl.total_weight_kg ?? 0) + Number(bl.bb_weight_ton ?? 0) * 1000
}

export function blTotalWeightTon(
  bl: { total_weight_kg?: number | string | null; bb_weight_ton?: number | string | null },
) {
  return blTotalWeightKg(bl) / 1000
}

/**
 * Cubagem total de um B/L, em m³.
 *
 * Mesma história do peso, um degrau atrás: a migration 061 deu significado
 * único a `total_weight_kg`/`bb_weight_ton` e deixou `total_cbm` com os dois
 * donos que tinha — o importador de carga solta gravava a cubagem do manifesto
 * e o de B/L de armador gravava a soma dos contêineres, um sobrescrevendo o
 * outro em B/L misto. A migration 064 separou:
 *
 *   bls.total_cbm -> SOMENTE carga conteinerizada
 *   bls.bb_cbm    -> SOMENTE carga solta
 *
 * Quem precisa da cubagem do documento inteiro usa este helper, não uma das
 * colunas.
 */
export function blTotalCbm(
  bl: { total_cbm?: number | string | null; bb_cbm?: number | string | null },
) {
  return Number(bl.total_cbm ?? 0) + Number(bl.bb_cbm ?? 0)
}

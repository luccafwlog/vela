/**
 * Peso da linha de carga solta em toneladas, com fallback para
 * `total_weight_kg` quando `bb_weight_ton` não foi preenchido.
 *
 * As duas colunas são disjuntas desde a migration 061 (`total_weight_kg` é
 * peso de contêiner, `bb_weight_ton` é peso de carga solta), mas alguns
 * caminhos de import (ex.: B/L Avulso PDF/DOCX) só preenchem
 * `total_weight_kg` para um B/L de carga solta. Sem o fallback, o ADR e o
 * card da Viagem imprimiam "0 ton" ao lado de um B/L com peso real conhecido
 * — zero como fato medido, não como ausência de dado.
 */
export function breakbulkWeightTon(bl: {
  cargo_mode?: 'container' | 'carga_solta' | 'misto' | string | null
  bb_weight_ton?: number | null
  total_weight_kg?: number | null
}): number {
  if (bl.bb_weight_ton != null) return Number(bl.bb_weight_ton)
  // In a mixed B/L, total_weight_kg belongs exclusively to the containers.
  // Falling back to it would show container weight as loose cargo and double
  // count the same shipment in the ADR and voyage summaries.
  if (bl.cargo_mode === 'misto') return 0
  if (bl.total_weight_kg != null) return Number(bl.total_weight_kg) / 1000
  return 0
}

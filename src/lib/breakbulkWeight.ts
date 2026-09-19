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
export function breakbulkWeightTon(bl: { bb_weight_ton?: number | null; total_weight_kg?: number | null }): number {
  if (bl.bb_weight_ton != null) return Number(bl.bb_weight_ton)
  if (bl.total_weight_kg != null) return Number(bl.total_weight_kg) / 1000
  return 0
}

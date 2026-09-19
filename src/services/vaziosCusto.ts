export type EmptyUnit = {
  container_number?: string
  container_type?: string | null
  local_id: string | null
  condition: 'vazio' | 'material' | string | null
  hand_in_date?: string | null
  hand_out_date?: string | null
}

export type StorageDepot = {
  id: string
  tipo?: 'depot' | 'terminal_portuario' | string
  free_time_vazio_days?: number | null
  free_time_material_days?: number | null
}

export type CostServiceLine = {
  id?: string
  natureza: 'armazenagem' | 'transporte' | 'geral' | string
  local_id: string
  destino_id?: string | null
  condition?: 'vazio' | 'material' | string | null
  quantidade: number
  percentual?: number | null
  valor_unitario: number
  quantidade_manual?: boolean
}

export type CostShipment = {
  unidades: EmptyUnit[]
  linhas: CostServiceLine[]
  depots?: StorageDepot[]
}

// +1: o dia de entrada e o dia de saída contam ambos como dia de armazenagem.
const daysBetween = (start: string | null | undefined, end: string | null | undefined): number => {
  if (!start || !end) return 0
  const diff = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1
  return Number.isFinite(diff) ? Math.max(0, diff) : 0
}

export function diasCobraveis(unidade: EmptyUnit, depot: StorageDepot | null | undefined): number {
  if (!depot || depot.tipo === 'terminal_portuario' || unidade.local_id !== depot.id) return 0
  const freeTime = unidade.condition === 'material' ? depot.free_time_material_days : depot.free_time_vazio_days
  return Math.max(0, daysBetween(unidade.hand_in_date, unidade.hand_out_date) - Number(freeTime ?? 0))
}

export function armazenagemPorDepotCondicao(unidades: EmptyUnit[], depots: StorageDepot[] = []): Array<{ depot_id: string; condition: string; quantidade: number }> {
  const byKey = new Map<string, { depot_id: string; condition: string; quantidade: number }>()
  for (const unit of unidades) {
    const depot = depots.find((item) => item.id === unit.local_id)
    if (!depot || depot.tipo === 'terminal_portuario' || !unit.local_id || !unit.condition) continue
    const key = `${unit.local_id}:${unit.condition}`
    const row = byKey.get(key) ?? { depot_id: unit.local_id, condition: unit.condition, quantidade: 0 }
    row.quantidade += diasCobraveis(unit, depot)
    byKey.set(key, row)
  }
  return [...byKey.values()]
}

export function quantidadeEfetiva(linha: CostServiceLine, unidades: EmptyUnit[], depots: StorageDepot[] = []): number {
  if (linha.natureza !== 'armazenagem' || linha.quantidade_manual) return Number(linha.quantidade) || 0
  return armazenagemPorDepotCondicao(unidades, depots).find((row) => row.depot_id === linha.local_id && row.condition === linha.condition)?.quantidade ?? 0
}

// ADR 0033 §3: "O total é `quantidade × valor unitário`; não há percentual na
// linha." `vetoPercentual` já bloqueia percentual em linha nova; linhas
// legadas com percentual gravado (armazenagem com valor não nulo) agora
// recalculam pela fórmula da ADR em vez de manter o multiplicador antigo —
// decisão confirmada com o usuário em 2026-09-19.
export function totalLinha(linha: CostServiceLine, unidades: EmptyUnit[] = [], depots: StorageDepot[] = []): number {
  const quantity = quantidadeEfetiva(linha, unidades, depots)
  return quantity * Number(linha.valor_unitario || 0)
}

export function totalEmbarque(embarque: CostShipment): number {
  return embarque.linhas.reduce((sum, line) => sum + totalLinha(line, embarque.unidades, embarque.depots ?? []), 0)
}

export function vetoTransporteSemRota(line: Pick<CostServiceLine, 'natureza' | 'destino_id'>): string | null {
  return line.natureza === 'transporte' && !line.destino_id ? 'Transporte exige rota.' : null
}

export function vetoArmazenagemForaDepot(line: Pick<CostServiceLine, 'natureza' | 'local_id'>, depots: StorageDepot[]): string | null {
  const local = depots.find((depot) => depot.id === line.local_id)
  return line.natureza === 'armazenagem' && local?.tipo !== 'depot' ? 'Armazenagem exige um depot.' : null
}

export function vetoPercentual(line: Pick<CostServiceLine, 'natureza' | 'percentual'>): string | null {
  return line.percentual == null ? null : 'O percentual já está incorporado ao valor do serviço.'
}

export function vetoSegundaArmazenagem(line: CostServiceLine, lines: CostServiceLine[]): string | null {
  if (line.natureza !== 'armazenagem') return null
  const duplicate = lines.some((other) => other !== line && other.natureza === 'armazenagem' && other.local_id === line.local_id && other.condition === line.condition)
  return duplicate ? 'Já existe uma linha de armazenagem para este depot e condição.' : null
}

export function veto(line: CostServiceLine, context: { depots?: StorageDepot[]; lines?: CostServiceLine[] } = {}): string | null {
  return vetoTransporteSemRota(line)
    ?? vetoArmazenagemForaDepot(line, context.depots ?? [])
    ?? vetoPercentual(line)
    ?? vetoSegundaArmazenagem(line, context.lines ?? [])
}


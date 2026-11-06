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
  /** Tamanho do serviço lançado (migration 606): '20', '40' ou nulo (qualquer). */
  container_type?: string | null
  /** Free time congelado no lançamento da armazenagem (606); nulo segue o cadastro. */
  free_time_days?: number | null
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

/** Serviço de armazenagem do catálogo, o bastante para saber como a armazenagem se divide. */
export type StorageCatalogService = {
  depot_id: string
  natureza: string
  condition?: string | null
  container_type?: string | null
  active?: boolean | null
}

export type ContainerSize = '20' | '40'

/**
 * Tamanho do container pelo tipo: o primeiro caractere do código ISO 6346 é o
 * comprimento (2 = 20 pés, 4 = 40 pés, inclusive 45G1, que é 40 pés HC); os
 * rótulos de mercado (20DV, 40HC, 20') seguem a mesma regra.
 * ponytail: 45 pés (L5G1) e tipo sem tamanho ficam sem tamanho e caem no
 * serviço sem tamanho; uma terceira faixa é o upgrade se algum depot cobrar
 * 45 pés à parte.
 */
export function containerSize(type: string | null | undefined): ContainerSize | null {
  const normalized = String(type ?? '').trim().toUpperCase().replace(/[\s'"’-]/g, '')
  if (normalized.startsWith('2')) return '20'
  if (normalized.startsWith('4')) return '40'
  return null
}

/** '20' ou '40' de um texto do banco; outro valor (legado) não é tamanho. */
export function sizeOf(value: string | null | undefined): ContainerSize | null {
  return value === '20' || value === '40' ? value : null
}

// +1: o dia de entrada e o dia de saída contam ambos como dia de armazenagem.
const daysBetween = (start: string | null | undefined, end: string | null | undefined): number => {
  if (!start || !end) return 0
  const diff = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1
  return Number.isFinite(diff) ? Math.max(0, diff) : 0
}

function depotFreeTime(depot: StorageDepot, condition: string | null | undefined): number {
  return Number((condition === 'material' ? depot.free_time_material_days : depot.free_time_vazio_days) ?? 0)
}

/**
 * Dias cobráveis de uma unidade de Depot: `(saída − entrada + 1) − free time`,
 * nunca negativo. O free time é o da linha de armazenagem quando ela o
 * congelou (606) e, sem linha, o do cadastro do depot para a condição.
 */
export function diasCobraveis(unidade: EmptyUnit, depot: StorageDepot | null | undefined, freeTime?: number | null): number {
  if (!depot || depot.tipo === 'terminal_portuario' || unidade.local_id !== depot.id) return 0
  const applied = freeTime ?? depotFreeTime(depot, unidade.condition)
  return Math.max(0, daysBetween(unidade.hand_in_date, unidade.hand_out_date) - Number(applied))
}

const storageKey = (depotId: string, condition: string, size: ContainerSize | null) => `${depotId}:${condition}:${size ?? ''}`

function isStorageLine(line: Pick<CostServiceLine, 'natureza'>): boolean {
  return line.natureza === 'armazenagem'
}

/**
 * Tamanhos com linha de armazenagem própria em cada (depot, condição): a
 * unidade desse tamanho conta na linha dele, e a de outro tamanho (ou sem
 * tamanho) conta na linha sem tamanho. Decide pelas linhas do embarque, não
 * pelo catálogo, para a quantidade não mudar quando o catálogo muda.
 */
function sizesByLines(linhas: ReadonlyArray<Pick<CostServiceLine, 'natureza' | 'local_id' | 'condition' | 'container_type'>>): Map<string, Set<ContainerSize>> {
  const sizes = new Map<string, Set<ContainerSize>>()
  for (const line of linhas) {
    const size = sizeOf(line.container_type)
    if (!isStorageLine(line) || !line.condition || !size) continue
    const key = `${line.local_id}:${line.condition}`
    const set = sizes.get(key) ?? new Set<ContainerSize>()
    set.add(size)
    sizes.set(key, set)
  }
  return sizes
}

/** Tamanhos com serviço de armazenagem ativo no catálogo de cada (depot, condição). */
function sizesByCatalog(catalogo: ReadonlyArray<StorageCatalogService>, depotId: string, condition: string): Set<ContainerSize> {
  const sizes = new Set<ContainerSize>()
  for (const service of catalogo) {
    const size = sizeOf(service.container_type)
    if (service.natureza !== 'armazenagem' || service.active === false || service.depot_id !== depotId || !size) continue
    if (service.condition && service.condition !== condition) continue
    sizes.add(size)
  }
  return sizes
}

export type StorageUnitDays = {
  unit: EmptyUnit
  depot_id: string
  condition: string
  /** Tamanho da linha em que a unidade conta (nulo: a linha sem tamanho). */
  size: ContainerSize | null
  /** Dias no depot, contando entrada e saída. */
  totalDays: number
  freeTime: number
  chargeableDays: number
  /** A unidade conta numa linha de armazenagem já lançada. */
  launched: boolean
}

/**
 * Armazenagem de cada unidade de Depot: em que linha (depot, condição,
 * tamanho) ela conta, o free time aplicado e os dias cobráveis. É a conta da
 * quantidade das linhas, do Storage do ADR e do anexo impresso.
 */
export function armazenagemPorUnidade(
  unidades: readonly EmptyUnit[],
  depots: readonly StorageDepot[] = [],
  linhas: ReadonlyArray<CostServiceLine> = [],
): StorageUnitDays[] {
  const sizes = sizesByLines(linhas)
  const lineByKey = new Map<string, CostServiceLine>()
  for (const line of linhas) {
    if (isStorageLine(line) && line.condition) lineByKey.set(storageKey(line.local_id, line.condition, sizeOf(line.container_type)), line)
  }
  const result: StorageUnitDays[] = []
  for (const unit of unidades) {
    const depot = depots.find((item) => item.id === unit.local_id)
    if (!depot || depot.tipo === 'terminal_portuario' || !unit.local_id || !unit.condition) continue
    const unitSize = containerSize(unit.container_type)
    const size = unitSize && sizes.get(`${unit.local_id}:${unit.condition}`)?.has(unitSize) ? unitSize : null
    const line = lineByKey.get(storageKey(unit.local_id, unit.condition, size))
    const freeTime = line?.free_time_days ?? depotFreeTime(depot, unit.condition)
    const totalDays = daysBetween(unit.hand_in_date, unit.hand_out_date)
    result.push({
      unit,
      depot_id: unit.local_id,
      condition: unit.condition,
      size,
      totalDays,
      freeTime: Number(freeTime),
      chargeableDays: Math.max(0, totalDays - Number(freeTime)),
      launched: Boolean(line),
    })
  }
  return result
}

export type StorageGroup = { depot_id: string; condition: string; size: ContainerSize | null; quantidade: number }

function groupDays(rows: readonly StorageUnitDays[]): StorageGroup[] {
  const byKey = new Map<string, StorageGroup>()
  for (const row of rows) {
    const key = storageKey(row.depot_id, row.condition, row.size)
    const group = byKey.get(key) ?? { depot_id: row.depot_id, condition: row.condition, size: row.size, quantidade: 0 }
    group.quantidade += row.chargeableDays
    byKey.set(key, group)
  }
  return [...byKey.values()]
}

/** Dias cobráveis somados por (depot, condição, tamanho), pelas linhas do embarque. */
export function armazenagemPorDepotCondicao(
  unidades: readonly EmptyUnit[],
  depots: readonly StorageDepot[] = [],
  linhas: ReadonlyArray<CostServiceLine> = [],
): StorageGroup[] {
  return groupDays(armazenagemPorUnidade(unidades, depots, linhas))
}

/**
 * "Armazenagem a lançar" do Embarque: combinações (depot, condição, tamanho)
 * com dias cobráveis calculados pela lista de unidades e ainda sem linha de
 * armazenagem. O tamanho vem do catálogo: o depot que cobra 20' e 40' à parte
 * (606) tem uma combinação por tamanho; o que cobra igual, uma só. Zero dia
 * quer dizer que as unidades ficaram dentro do free time e não há o que lançar
 * (decisão de 2026-10-19).
 */
export function armazenagemALancar(
  unidades: readonly EmptyUnit[],
  depots: readonly StorageDepot[],
  linhas: ReadonlyArray<Pick<CostServiceLine, 'natureza' | 'local_id' | 'condition' | 'container_type'>>,
  catalogo: ReadonlyArray<StorageCatalogService> = [],
): StorageGroup[] {
  const launched = new Set(
    linhas.filter((line) => isStorageLine(line) && line.condition)
      .map((line) => storageKey(line.local_id, line.condition as string, sizeOf(line.container_type))),
  )
  const rows: StorageUnitDays[] = []
  for (const unit of unidades) {
    const depot = depots.find((item) => item.id === unit.local_id)
    if (!depot || depot.tipo === 'terminal_portuario' || !unit.local_id || !unit.condition) continue
    const unitSize = containerSize(unit.container_type)
    const size = unitSize && sizesByCatalog(catalogo, unit.local_id, unit.condition).has(unitSize) ? unitSize : null
    if (launched.has(storageKey(unit.local_id, unit.condition, size))) continue
    const totalDays = daysBetween(unit.hand_in_date, unit.hand_out_date)
    const freeTime = depotFreeTime(depot, unit.condition)
    rows.push({ unit, depot_id: unit.local_id, condition: unit.condition, size, totalDays, freeTime, chargeableDays: Math.max(0, totalDays - freeTime), launched: false })
  }
  return groupDays(rows).filter((item) => item.quantidade > 0)
}

/**
 * Serviço de armazenagem do catálogo para uma combinação (depot, condição,
 * tamanho): o da condição vence o sem condição (B12), e entre iguais o de nome
 * menor, para a escolha não depender da ordem do banco.
 */
export function servicoDeArmazenagem<T extends StorageCatalogService & { name?: string | null }>(
  catalogo: readonly T[],
  combinacao: Pick<StorageGroup, 'depot_id' | 'condition' | 'size'>,
): T | null {
  const candidates = catalogo
    .filter((service) => service.natureza === 'armazenagem' && service.active !== false && service.depot_id === combinacao.depot_id)
    .filter((service) => sizeOf(service.container_type) === combinacao.size)
    .filter((service) => !service.condition || service.condition === combinacao.condition)
    .sort((a, b) => Number(Boolean(b.condition)) - Number(Boolean(a.condition)) || String(a.name ?? '').localeCompare(String(b.name ?? '')))
  return candidates[0] ?? null
}

export function quantidadeEfetiva(
  linha: CostServiceLine,
  unidades: readonly EmptyUnit[],
  depots: readonly StorageDepot[] = [],
  linhas: ReadonlyArray<CostServiceLine> = [linha],
): number {
  if (linha.natureza !== 'armazenagem' || linha.quantidade_manual) return Number(linha.quantidade) || 0
  // A própria linha entra no contexto mesmo quando o chamador passa outras.
  const context = linhas.includes(linha) ? linhas : [...linhas, linha]
  const size = sizeOf(linha.container_type)
  return armazenagemPorDepotCondicao(unidades, depots, context)
    .find((row) => row.depot_id === linha.local_id && row.condition === linha.condition && row.size === size)?.quantidade ?? 0
}

// ADR 0033 §3: "O total é `quantidade × valor unitário`; não há percentual na
// linha." `vetoPercentual` já bloqueia percentual em linha nova; linhas
// legadas com percentual gravado (armazenagem com valor não nulo) agora
// recalculam pela fórmula da ADR em vez de manter o multiplicador antigo —
// decisão confirmada com o usuário em 2026-09-19.
export function totalLinha(
  linha: CostServiceLine,
  unidades: readonly EmptyUnit[] = [],
  depots: readonly StorageDepot[] = [],
  linhas: ReadonlyArray<CostServiceLine> = [linha],
): number {
  const quantity = quantidadeEfetiva(linha, unidades, depots, linhas)
  return quantity * Number(linha.valor_unitario || 0)
}

export function totalEmbarque(embarque: CostShipment): number {
  return embarque.linhas.reduce((sum, line) => sum + totalLinha(line, embarque.unidades, embarque.depots ?? [], embarque.linhas), 0)
}

/**
 * Totais de armazenagem do embarque para o ADR (revisão de 2026-11-06, C2 e C4):
 * - `containers`: unidades com dia cobrável. A unidade de Depot que ficou
 *   dentro do free time não gerou armazenagem e não conta;
 * - `days`: dias cobráveis, a soma das quantidades efetivas das linhas de
 *   armazenagem lançadas (a quantidade informada à mão vale) mais os dias
 *   calculados das combinações ainda sem linha. Bate com o total das linhas;
 * - `calculatedDays`: os mesmos dias pela lista de unidades, sem a quantidade
 *   à mão. Igual a `days` quando nenhuma linha tem quantidade à mão.
 */
export function totaisDeArmazenagem(
  unidades: readonly EmptyUnit[],
  depots: readonly StorageDepot[] = [],
  linhas: ReadonlyArray<CostServiceLine> = [],
): { containers: number; days: number; calculatedDays: number } {
  const rows = armazenagemPorUnidade(unidades, depots, linhas).filter((row) => row.chargeableDays > 0)
  const calculatedDays = rows.reduce((sum, row) => sum + row.chargeableDays, 0)
  const launchedDays = linhas.filter(isStorageLine)
    .reduce((sum, line) => sum + quantidadeEfetiva(line, unidades, depots, linhas), 0)
  const pendingDays = rows.filter((row) => !row.launched).reduce((sum, row) => sum + row.chargeableDays, 0)
  return { containers: rows.length, days: launchedDays + pendingDays, calculatedDays }
}

/**
 * Quantidade sugerida para uma linha que não é de armazenagem (decisão do dono
 * de 2026-11-06): as unidades do local da linha, do tamanho do serviço quando
 * ele tem um. É sugestão: a tela mostra e a pessoa aplica com um clique; o
 * sistema não presume que o serviço aconteceu (ADR 0033).
 */
export function unidadesDoLocal(
  unidades: readonly EmptyUnit[],
  localId: string | null | undefined,
  size: string | null | undefined,
): { total: number; vazio: number; material: number; porTamanho: Record<ContainerSize | 'sem', number> } {
  const wanted = sizeOf(size)
  const result = { total: 0, vazio: 0, material: 0, porTamanho: { '20': 0, '40': 0, sem: 0 } as Record<ContainerSize | 'sem', number> }
  if (!localId) return result
  for (const unit of unidades) {
    if (unit.local_id !== localId) continue
    const unitSize = containerSize(unit.container_type)
    if (wanted && unitSize !== wanted) continue
    result.total += 1
    if (unit.condition === 'material') result.material += 1
    else result.vazio += 1
    result.porTamanho[unitSize ?? 'sem'] += 1
  }
  return result
}

export function vetoTransporteSemRota(line: Pick<CostServiceLine, 'natureza' | 'destino_id'>): string | null {
  return line.natureza === 'transporte' && !line.destino_id ? 'Transporte exige rota.' : null
}

export function vetoArmazenagemForaDepot(line: Pick<CostServiceLine, 'natureza' | 'local_id'>, depots: readonly StorageDepot[]): string | null {
  const local = depots.find((depot) => depot.id === line.local_id)
  return line.natureza === 'armazenagem' && local?.tipo !== 'depot' ? 'Armazenagem exige um depot.' : null
}

export function vetoPercentual(line: Pick<CostServiceLine, 'natureza' | 'percentual'>): string | null {
  return line.percentual == null ? null : 'O percentual já está incorporado ao valor do serviço.'
}

export function vetoSegundaArmazenagem(line: CostServiceLine, lines: readonly CostServiceLine[]): string | null {
  if (line.natureza !== 'armazenagem') return null
  const size = sizeOf(line.container_type)
  // A própria linha em edição (mesmo id) não é duplicata dela mesma.
  const duplicate = lines.some((other) => other !== line && !(line.id != null && other.id === line.id) && other.natureza === 'armazenagem'
    && other.local_id === line.local_id && other.condition === line.condition && sizeOf(other.container_type) === size)
  return duplicate ? 'Já existe uma linha de armazenagem para este depot, condição e tamanho.' : null
}

export function veto(line: CostServiceLine, context: { depots?: readonly StorageDepot[]; lines?: readonly CostServiceLine[] } = {}): string | null {
  return vetoTransporteSemRota(line)
    ?? vetoArmazenagemForaDepot(line, context.depots ?? [])
    ?? vetoPercentual(line)
    ?? vetoSegundaArmazenagem(line, context.lines ?? [])
}

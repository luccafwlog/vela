import type { PortalOperationBL, PortalOperationContainer, PortalOperationLocalCharges } from '../services/portalOperation'
import { formatBRL } from './utils'

// Container achatado para a aba "Containers": cada container carrega os dados
// do B/L de origem, evitando que o usuario precise abrir o B/L para consultar.
export type PortalFlatContainer = PortalOperationContainer & {
  bl_id: string
  ce_mercante: string | null
  vessel_name: string | null
  voyage_number: string | null
  pol: string | null
  pod: string | null
}

export function flattenContainers(bls: PortalOperationBL[]): PortalFlatContainer[] {
  return bls.flatMap((bl) =>
    bl.containers.map((container) => ({
      ...container,
      bl_id: bl.bl_id,
      ce_mercante: bl.ce_mercante,
      vessel_name: bl.vessel_name,
      voyage_number: bl.voyage_number,
      pol: bl.pol,
      pod: bl.pod,
    })),
  )
}

// Situacao de devolucao dos containers, usada tanto na aba BLs (agregada por
// B/L) quanto na aba Containers (por container) e nos links do Painel.
// `no_free_time`: sem devolução e ainda dentro do free time (o cartão
// "Sem devolução, no free time" da aba Containers, que não inclui demurrage).
export type ReturnSituation = '' | 'todos_devolvidos' | 'sem_devolucao' | 'no_free_time' | 'em_demurrage' | 'sem_descarga'

// SOC é do cliente e não volta ao estoque: não conta como devolução pendente.
function awaitsReturn(container: PortalOperationContainer): boolean {
  return container.status !== 'soc' && container.return_date == null
}

function isInDemurrage(container: PortalOperationContainer): boolean {
  return container.return_date == null && (container.demurrage_days ?? 0) > 0
}

function isInFreeTime(container: PortalOperationContainer): boolean {
  return awaitsReturn(container) && container.status === 'dentro_free_time'
}

export function blMatchesReturnSituation(bl: PortalOperationBL, situation: ReturnSituation): boolean {
  if (!situation) return true
  switch (situation) {
    case 'todos_devolvidos':
      return bl.containers.length > 0 && !bl.containers.some(awaitsReturn)
    case 'sem_devolucao':
      return bl.containers.some(awaitsReturn)
    case 'no_free_time':
      return bl.containers.some(isInFreeTime)
    case 'em_demurrage':
      return bl.containers.some(isInDemurrage)
    case 'sem_descarga':
      return bl.containers.some((c) => c.status === 'sem_descarga')
  }
}

export function containerMatchesReturnSituation(
  container: PortalOperationContainer,
  situation: ReturnSituation,
): boolean {
  if (!situation) return true
  switch (situation) {
    case 'todos_devolvidos':
      return container.status === 'devolvido'
    case 'sem_devolucao':
      return awaitsReturn(container)
    case 'no_free_time':
      return isInFreeTime(container)
    case 'em_demurrage':
      return isInDemurrage(container)
    case 'sem_descarga':
      return container.status === 'sem_descarga'
  }
}

export function countContainersWithoutReturn(bls: PortalOperationBL[]): number {
  return flattenContainers(bls).filter(awaitsReturn).length
}

export function countContainersInDemurrage(bls: PortalOperationBL[]): number {
  return flattenContainers(bls).filter(isInDemurrage).length
}

/**
 * Devolução e demurrage do B/L, com as mesmas regras dos filtros: SOC não
 * volta ao estoque e fica fora da conta; demurrage é a que ainda corre.
 */
export function blReturnSummary(bl: PortalOperationBL) {
  const returnable = bl.containers.filter((container) => container.status !== 'soc')
  return {
    returnable: returnable.length,
    returned: returnable.filter((container) => container.return_date != null).length,
    awaiting: bl.containers.filter(awaitsReturn).length,
    inDemurrage: bl.containers.filter(isInDemurrage).length,
  }
}

/** Peso em toneladas com vírgula decimal: "64,5 t". */
export function formatTons(value: number) {
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} t`
}

const containerCount = (count: number) => `${count} ${count === 1 ? 'container' : 'containers'}`

/** Coluna Carga: "2 containers", "Carga solta · 64,5 t", "1 container + 12,5 t". */
export function blCargoLabel(bl: PortalOperationBL) {
  const weight = bl.bb_weight_ton != null && bl.bb_weight_ton > 0 ? bl.bb_weight_ton : null
  if (bl.cargo_mode === 'carga_solta' && bl.container_count === 0) return weight == null ? 'Carga solta' : `Carga solta · ${formatTons(weight)}`
  if (weight != null) return `${containerCount(bl.container_count)} + ${formatTons(weight)}`
  return bl.container_count === 0 ? 'Nenhum container' : containerCount(bl.container_count)
}

export type SituationTone = 'default' | 'warning' | 'danger'

/**
 * Situação do container em texto (tabela limpa): "Em demurrage" em vermelho,
 * "No free time · N dias" em âmbar com os dias que faltam, o resto em tinta
 * normal.
 */
export function containerSituation(container: PortalOperationContainer): { label: string; tone: SituationTone; title?: string } {
  switch (container.status) {
    case 'em_demurrage':
      return { label: 'Em demurrage', tone: 'danger' }
    case 'dentro_free_time': {
      if (container.free_time_days == null || container.usage_days == null) return { label: 'No free time', tone: 'warning' }
      // Dias de uso iguais ao free time: hoje é o último dia sem demurrage.
      const left = Math.max(0, container.free_time_days - container.usage_days)
      return { label: `No free time · ${left === 0 ? 'último dia' : left === 1 ? '1 dia' : `${left} dias`}`, tone: 'warning' }
    }
    case 'devolvido':
      return { label: 'Devolvido', tone: 'default' }
    case 'tarifa_indisponivel':
      return { label: 'Tarifa indisponível', tone: 'default', title: 'Free time oficial indisponível. Consulte o atendimento.' }
    case 'soc':
      return { label: 'SOC (sem devolução)', tone: 'default', title: 'Container do próprio cliente: sem devolução nem demurrage' }
    default:
      return { label: 'Sem descarga', tone: 'default' }
  }
}

/**
 * Taxas Locais e Pagamento do B/L (rodada 3): total e situação só com fatura
 * visível ao Cliente. Mesma regra na tela e na planilha.
 */
export function localChargesView(charges: PortalOperationLocalCharges | undefined): {
  total: number | null
  payment: { label: string; tone: 'warning' | 'paid' | 'default' } | null
} {
  if (!charges) return { total: null, payment: null }
  switch (charges.status) {
    case 'open':
      return { total: charges.total_brl, payment: { label: `${formatBRL(charges.balance_brl)} em aberto`, tone: 'warning' } }
    case 'paid':
      return { total: charges.total_brl, payment: { label: 'Pago', tone: 'paid' } }
    case 'awaiting_invoice':
      return { total: null, payment: { label: 'Aguardando fatura', tone: 'default' } }
    default:
      return { total: null, payment: null }
  }
}

/**
 * Viagens em que o Cliente tem carga, para o ícone de B/Ls em Chegadas e
 * saídas (ponto 2 de 2026-10-23). Sai da mesma lista que a tela BLs e
 * Containers mostra (`portal_list_operation_bls`: B/Ls do Cliente da sessão,
 * liberados no Portal, escopo decidido no banco), então o Portal não fica
 * sabendo de carga de outro Cliente. B/L cancelado não conta.
 */
export function voyageIdsWithCargo(bls: readonly PortalOperationBL[]): Set<number> {
  const ids = new Set<number>()
  for (const bl of bls) {
    if (bl.voyage_id != null && !bl.cancelled_at) ids.add(bl.voyage_id)
  }
  return ids
}

/** Filtros de Navio e Viagem da aba BLs na URL, para o link sobreviver ao recarregar. */
export const BL_VOYAGE_PARAMS = { vessel: 'navio', voyage: 'viagem' } as const

/** Caminho (sem o prefixo do Portal) da aba BLs filtrada pelo navio e pela viagem. */
export function blsOfVoyagePath(vesselName: string, voyage: string): string {
  const params = new URLSearchParams({ tab: 'bls', [BL_VOYAGE_PARAMS.vessel]: vesselName, [BL_VOYAGE_PARAMS.voyage]: voyage })
  return `/operacao?${params.toString()}`
}

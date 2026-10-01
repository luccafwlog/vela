import type { PortalOperationBL, PortalOperationContainer } from '../services/portalOperation'

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
export type ReturnSituation = '' | 'todos_devolvidos' | 'sem_devolucao' | 'em_demurrage' | 'sem_descarga'

// SOC é do cliente e não volta ao estoque: não conta como devolução pendente.
function awaitsReturn(container: PortalOperationContainer): boolean {
  return container.status !== 'soc' && container.return_date == null
}

function isInDemurrage(container: PortalOperationContainer): boolean {
  return container.return_date == null && (container.demurrage_days ?? 0) > 0
}

export function blMatchesReturnSituation(bl: PortalOperationBL, situation: ReturnSituation): boolean {
  if (!situation) return true
  switch (situation) {
    case 'todos_devolvidos':
      return bl.containers.length > 0 && !bl.containers.some(awaitsReturn)
    case 'sem_devolucao':
      return bl.containers.some(awaitsReturn)
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

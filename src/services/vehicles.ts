import type { DeleteDependencyReport } from './deleteDependencies'
import { deleteRecords } from './deleteRecords'

/** Exclui veiculos por id; o relatorio diz quais sairam e quais foram recusados. */
export function deleteVehicles(ids: number[], reason?: string): Promise<DeleteDependencyReport<number>> {
  return deleteRecords('vehicle', ids, { reason })
}

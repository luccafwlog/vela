import type { DeleteDependencyReport } from './deleteDependencies'
import { deleteRecords } from './deleteRecords'

/** Previa da exclusao de containers, calculada pelo banco. */
export function checkContainerDependencies(ids: number[]): Promise<DeleteDependencyReport<number>> {
  return deleteRecords('container', ids, { dryRun: true })
}

/** Exclui containers com os veiculos; cada um sai por inteiro ou volta com o motivo. */
export function deleteContainers(ids: number[]): Promise<DeleteDependencyReport<number>> {
  return deleteRecords('container', ids)
}

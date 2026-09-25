import type { DeleteDependencyReport } from './deleteDependencies'
import { deleteRecords } from './deleteRecords'

/**
 * Previa da exclusao de B/Ls, calculada pelo banco (`delete_records` em modo
 * previa): separa os que podem sair dos bloqueados, com o motivo. Usa as mesmas
 * regras da exclusao real, inclusive vinculos que a tela nao conhece.
 */
export function checkBlDependencies(ids: string[]): Promise<DeleteDependencyReport<string>> {
  return deleteRecords('bl', ids, { dryRun: true })
}

/**
 * Exclui B/Ls com containers, carga solta e veiculos. Cada B/L sai por inteiro
 * ou volta intacto com o motivo; o relatorio diz o que de fato saiu.
 */
export function deleteBls(ids: string[], reason?: string): Promise<DeleteDependencyReport<string>> {
  return deleteRecords('bl', ids, { reason })
}

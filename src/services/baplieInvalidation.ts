import { afterBaplieImportado, type QueryInvalidator } from './cacheEffects'

/** Adapter histórico; todos os caminhos usam o mesmo efeito de domínio. */
export async function invalidateBaplieDependentQueries(queryClient: QueryInvalidator, voyageId: string) {
  await afterBaplieImportado(queryClient, { voyageId })
}

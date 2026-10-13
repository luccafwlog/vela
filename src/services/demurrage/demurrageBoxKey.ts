/**
 * Chave da caixa como o banco a compara em `_demurrage_billed_container_keys`
 * (migration 214): Viagem do B/L da Invoice, Cliente da Invoice e número do
 * container sem espaços nas pontas, em maiúsculas.
 */
export function demurrageBoxKey(voyageId: number | null | undefined, customerId: number | null | undefined, containerNumber: string | null | undefined): string | null {
  const number = (containerNumber ?? '').trim().toUpperCase()
  if (voyageId == null || customerId == null || !number) return null
  return `${voyageId}|${customerId}|${number}`
}


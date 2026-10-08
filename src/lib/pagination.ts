/**
 * Texto único de paginação (contrato da etapa 01): "Exibindo 1–20 de 132", e
 * "Nenhum registro" quando a lista está vazia — nunca "Página 0 de 0". Use o
 * mesmo texto no topo e no rodapé da tabela.
 */
export function describePageRange({
  page,
  pageSize,
  totalCount,
  pageBase = 1,
}: {
  page: number
  pageSize: number
  totalCount: number
  pageBase?: 0 | 1
}) {
  if (totalCount <= 0) return 'Nenhum registro'
  const displayPage = pageBase === 0 ? page + 1 : page
  const start = (displayPage - 1) * pageSize + 1
  const end = Math.min(displayPage * pageSize, totalCount)
  return `Exibindo ${start.toLocaleString('pt-BR')}–${end.toLocaleString('pt-BR')} de ${totalCount.toLocaleString('pt-BR')}`
}

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

/**
 * Intervalo quando a busca parou de contar num teto (`floor`) e o total real é
 * maior: "Exibindo 10.001–10.050 de mais de 10.000". O fim vem das linhas que a
 * página trouxe, porque o total não é conhecido.
 */
export function describeOpenPageRange({
  page,
  pageSize,
  rowsOnPage,
  floor,
  pageBase = 1,
}: {
  page: number
  pageSize: number
  rowsOnPage: number
  floor: number
  pageBase?: 0 | 1
}) {
  if (rowsOnPage <= 0) return 'Nenhum registro'
  const displayPage = pageBase === 0 ? page + 1 : page
  const start = (displayPage - 1) * pageSize + 1
  const end = start + rowsOnPage - 1
  return `Exibindo ${start.toLocaleString('pt-BR')}–${end.toLocaleString('pt-BR')} de mais de ${floor.toLocaleString('pt-BR')}`
}

/**
 * Lista paginada com o filtro já trocado e a resposta a caminho: as linhas
 * ainda são do recorte anterior. Esmaece só depois de 150 ms, para a página
 * pré-carregada não piscar, e volta na hora quando as linhas novas chegam
 * (a transição sai junto com a classe).
 */
export const STALE_PAGE_CLASS = 'opacity-55 transition-opacity duration-150 delay-150 motion-reduce:transition-none'

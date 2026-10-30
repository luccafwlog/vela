/** Página do PostgREST (`max_rows` = 1000): leitura acima disso volta cortada. */
export const DEMURRAGE_PAGE = 1000

/**
 * Lê todas as páginas de uma consulta ordenada, até a página curta. A ordem
 * precisa terminar por uma chave única (`id`) para a página seguinte não
 * repetir nem pular linha.
 */
export async function readAllPages<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += DEMURRAGE_PAGE) {
    const { data, error } = await page(from, from + DEMURRAGE_PAGE - 1)
    if (error) throw error
    const chunk = (data ?? []) as T[]
    rows.push(...chunk)
    if (chunk.length < DEMURRAGE_PAGE) return rows
  }
}

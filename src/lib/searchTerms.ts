// Busca por vários B/Ls ou contêineres de uma vez (ponto 9 de 2026-10-23).
// O texto inteiro continua casando como sempre; além disso, quando o usuário
// cola dois ou mais termos separados por espaço, vírgula, ponto e vírgula ou
// quebra de linha, basta um termo casar o número do B/L ou do contêiner.
// Mesma regra de `search_term_tokens` no banco (migration 453).

/** Termos em minúsculas, só quando são dois ou mais; um termo só devolve []. */
export function searchTokens(query: string): string[] {
  const tokens = [...new Set(query.toLowerCase().split(/[\s,;]+/).filter(Boolean))]
  return tokens.length >= 2 ? tokens : []
}

/** Algum termo da lista colada aparece em algum dos números (B/L, contêiner). */
export function matchesAnyToken(query: string, ids: Array<string | null | undefined>): boolean {
  const tokens = searchTokens(query)
  if (!tokens.length) return false
  const values = ids.map((id) => (id ?? '').toLowerCase()).filter(Boolean)
  return tokens.some((token) => values.some((value) => value.includes(token)))
}

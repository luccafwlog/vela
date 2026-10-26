// Busca por vários B/Ls ou contêineres de uma vez (ponto 9 de 2026-10-23).
// O texto inteiro continua casando como sempre; além disso, quando o usuário
// cola dois ou mais números separados por espaço, vírgula, ponto e vírgula ou
// quebra de linha, basta um deles casar o número do B/L ou do contêiner.
// Só conta como termo da lista o que tem cara de número: pelo menos 4
// caracteres e pelo menos um dígito. Assim um nome de várias palavras
// ("IMPORTACAO E EXPORTACAO", "ACME 2") não vira lista e não traz todo B/L
// com a letra E ou o algarismo 2.
// Mesma regra de `search_term_tokens` no banco (migrations 453, 455 e 461).
//
// ponytail: cada termo vira um ILIKE '%termo%' sem índice, então o custo é
// termos × linhas; e nas buscas por GET do PostgREST (Faturas em `billing.ts`,
// `chargeOperationsService.ts`, `graniteCargo.ts`, `vaziosImportacaoImport.ts`)
// cada termo entra na URL, e uma lista de centenas de números pode estourar o
// tamanho da URL. Teto: no banco, a consulta de `authenticated` tem 8 s
// (migration 335); em medição sintética, 300 números sobre 200 mil linhas
// levaram 35 s (produção tinha 450 B/Ls em 2026-10-24). Upgrade: teto de termos
// com aviso na tela, casar o número inteiro por igualdade (usa o índice) antes
// do ILIKE, ou levar essas buscas para RPC (POST).
import { escapeFilterTerm } from './utils'

const MIN_TERM_LENGTH = 4
// Separadores da lista, enumerados para casar com `search_term_tokens` no banco
// (migration 461): espaços ASCII, os espaços Unicode (inclusive os não
// separáveis, comuns ao colar de planilha ou e-mail), vírgula e ponto e vírgula.
// O `\s` do banco depende do locale; enumerar deixa os dois lados iguais.
const SEPARATORS = /[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff,;]+/

/** Termo com cara de número de B/L, contêiner ou CE: 4+ caracteres e algum dígito. */
function isNumberLike(term: string) {
  return term.length >= MIN_TERM_LENGTH && /[0-9]/.test(term)
}

/** Termos em minúsculas, só quando são dois ou mais números; senão devolve []. */
export function searchTokens(query: string): string[] {
  // É lista quando há dois ou mais números antes de tirar os repetidos: a
  // coluna colada com o mesmo B/L em toda linha continua achando esse B/L.
  const terms = query.toLowerCase().split(SEPARATORS).filter(isNumberLike)
  return terms.length >= 2 ? [...new Set(terms)] : []
}

// A tela filtra cada linha com o mesmo texto: os termos saem uma vez por texto,
// não uma vez por linha (uma lista de 300 números sobre 5 mil linhas levava ~250 ms).
let lastQuery: string | null = null
let lastTokens: readonly string[] = []
function cachedTokens(query: string): readonly string[] {
  if (query !== lastQuery) {
    lastTokens = searchTokens(query)
    lastQuery = query
  }
  return lastTokens
}

/** Algum termo da lista colada aparece em algum dos números (B/L, contêiner). */
export function matchesAnyToken(query: string, ids: Array<string | null | undefined>): boolean {
  const tokens = cachedTokens(query)
  if (!tokens.length) return false
  const values = ids.map((id) => (id ?? '').toLowerCase()).filter(Boolean)
  return tokens.some((token) => values.some((value) => value.includes(token)))
}

/**
 * Cláusulas de `.or()` do PostgREST para a lista colada: cada termo em cada
 * coluna de número. Vazio quando o texto não é lista; o chamador mantém a
 * cláusula do texto inteiro.
 */
export function tokenIlikeClauses(query: string, columns: readonly string[]): string[] {
  return searchTokens(query)
    .map((token) => escapeFilterTerm(token))
    .filter(Boolean)
    .flatMap((token) => columns.map((column) => `${column}.ilike.%${token}%`))
}

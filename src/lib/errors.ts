/**
 * Junta os campos típicos de um erro do Supabase/Postgres (`code`, `message`,
 * `details`, `hint`) numa única string legível para exibição e correspondência.
 *
 * Preserva o casing original — fontes de exibição (toasts, "Motivo: ...") usam o
 * texto como está. Quem precisa fazer match por substring (`.includes('42501')`,
 * `.includes('permission denied')`) deve aplicar `.toLowerCase()` no ponto de uso.
 * Manter o casing aqui evita o fork histórico em que cada feature reimplementava
 * este helper com regras de casing divergentes.
 */
export function extractErrorText(error: unknown): string {
  if (!error) return ''
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error === 'object') {
    const candidate = error as {
      code?: string | null
      message?: string | null
      details?: string | null
      hint?: string | null
    }
    return [candidate.code, candidate.message, candidate.details, candidate.hint].filter(Boolean).join(' ').trim()
  }
  return ''
}
export type DbErrorKind = 'permissao' | 'sessao_expirada' | 'conflito' | 'limite' | 'validacao' | 'nao_encontrado' | 'desconhecido'
export type ClassifiedDbError = { kind: DbErrorKind; message: string }

type ErrorTableEntry = ClassifiedDbError & {
  /** Usa `error.message` (a mensagem de negocio do RAISE) em vez do texto fixo. */
  preserveMessage?: boolean
}

// 22023/P0002 sao os codigos que as RPCs do Portal (supabase/migrations_archive/116_portal_fase2_notifications_disputes_profile.sql,
// 117_portal_fase3_rate_limiting.sql) e varios RPCs internos (025, 108, 239, 242, 244, 248...) usam para
// RAISE EXCEPTION com mensagens de negocio prontas para o usuario final
// (ex.: "Esta fatura ja possui uma disputa em aberto.", "Depot exige entrada
// e saida validas.") — por isso preservam a mensagem, como 42501. 23514
// tambem e o codigo nativo de violacao de CHECK constraint do Postgres
// (ex.: "new row ... violates check constraint ..."), que exporia nome de
// tabela/coluna; o guard `raw` abaixo detecta esse caso e cai para a
// mensagem fixa mesmo com preserveMessage. 23503/22P02 sao violacoes de
// constraint cruas do Postgres e NAO preservam.
const ERROR_TABLE: Readonly<Record<string, ErrorTableEntry>> = {
  '42501': { kind: 'permissao', message: 'Sem permissao para esta acao. Solicite acesso administrativo.', preserveMessage: true },
  PGRST301: { kind: 'sessao_expirada', message: 'Sua sessao expirou. Entre novamente para continuar.' },
  '28000': { kind: 'sessao_expirada', message: 'Sua sessao expirou. Entre novamente para continuar.' },
  '23505': { kind: 'conflito', message: 'Este registro ja existe.', preserveMessage: true },
  '40001': { kind: 'conflito', message: 'Conflito de concorrencia. Tente novamente.' },
  '23503': { kind: 'validacao', message: 'Registro referenciado nao existe ou ainda esta em uso.' },
  '23514': { kind: 'validacao', message: 'Dados fora das regras do cadastro.', preserveMessage: true },
  '22P02': { kind: 'validacao', message: 'Valor em formato invalido.' },
  '22023': { kind: 'validacao', message: 'Dados invalidos para esta operacao.', preserveMessage: true },
  P0002: { kind: 'nao_encontrado', message: 'Registro nao encontrado.', preserveMessage: true },
  P0429: { kind: 'limite', message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
  '57014': { kind: 'limite', message: 'A consulta demorou demais. Reduza o periodo e tente novamente.' },
}

/**
 * Erros deterministicos: repetir a mesma request produz exatamente a mesma
 * falha. O TanStack Query repete 3 vezes com backoff exponencial por padrao, o
 * que transforma uma falha instantanea (RLS negando, select mal formado) em
 * ~7 segundos de spinner antes da tela mostrar o erro. Falhas transitorias
 * (rede caindo, `40001` de concorrencia) continuam sendo repetidas.
 *
 * `PGRST1xx`/`PGRST2xx` sao erros de construcao da query e de schema cache do
 * PostgREST — por exemplo `PGRST201` (embed ambiguo, quando duas foreign keys
 * ligam as mesmas tabelas) e `PGRST116` (single row esperado). Nenhum deles
 * muda sozinho entre tentativas.
 */
const NON_RETRIABLE_KINDS: ReadonlySet<DbErrorKind> = new Set<DbErrorKind>([
  'permissao', 'sessao_expirada', 'validacao', 'nao_encontrado', 'limite',
])

export function isRetriableDbError(error: unknown): boolean {
  const code = error && typeof error === 'object' ? String((error as { code?: unknown }).code ?? '') : ''
  if (/^PGRST[12]\d\d$/.test(code)) return false
  return !NON_RETRIABLE_KINDS.has(classifyDbError(error).kind)
}

export function classifyDbError(error: unknown): ClassifiedDbError {
  const fields = error instanceof Error
    ? { code: String((error as Error & { code?: unknown }).code ?? ''), message: error.message }
    : typeof error === 'string' ? { code: '', message: error }
      : error && typeof error === 'object'
        ? { code: String((error as { code?: unknown }).code ?? ''), message: String((error as { message?: unknown }).message ?? '') }
        : { code: '', message: '' }
  const known = ERROR_TABLE[fields.code]
  const raw = /permission denied for (?:table|view|function|relation|schema|sequence)/i.test(fields.message)
    || /violates (?:check|not-null|foreign key|unique) constraint/i.test(fields.message)
  if (known) {
    const preserve = known.preserveMessage && fields.message && !raw
    return { kind: known.kind, message: preserve ? fields.message : known.message }
  }
  if (/permission denied/i.test(fields.message)) {
    const permissao = ERROR_TABLE['42501']
    return { kind: permissao.kind, message: permissao.message }
  }
  return { kind: 'desconhecido', message: fields.message || 'Falha inesperada. Tente novamente.' }
}

/**
 * Mensagem segura para superfícies voltadas à pessoa usuária. Erros conhecidos
 * preservam a orientação de negócio; falhas desconhecidas nunca vazam texto de
 * banco, RPC ou infraestrutura.
 */
export function userFacingErrorMessage(
  error: unknown,
  fallback = 'Não foi possível concluir a operação. Tente novamente.',
): string {
  const classified = classifyDbError(error)
  return classified.kind === 'desconhecido' ? fallback : classified.message
}

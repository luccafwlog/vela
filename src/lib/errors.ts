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

export class DatabaseError extends Error {
  readonly code?: string
  readonly details?: string
  readonly hint?: string

  constructor(
    message: string,
    options?: { code?: string; details?: string; hint?: string; cause?: unknown },
  ) {
    super(message)
    this.name = 'DatabaseError'
    this.code = options?.code
    this.details = options?.details
    this.hint = options?.hint
    if (options?.cause !== undefined) {
      this.cause = options?.cause
    }
    Object.setPrototypeOf(this, DatabaseError.prototype)
  }
}

export function toError(error: unknown): Error {
  if (error instanceof Error) return error
  if (typeof error === 'string') return new Error(error)
  if (error && typeof error === 'object') {
    const candidate = error as {
      code?: string | null
      message?: string | null
      details?: string | null
      hint?: string | null
    }
    const message = candidate.message || extractErrorText(error) || 'Erro na operação do banco de dados'
    if (typeof candidate.code !== 'string' || !candidate.code) {
      return new Error(message, { cause: error })
    }
    return new DatabaseError(message, {
      code: candidate.code ?? undefined,
      details: candidate.details ?? undefined,
      hint: candidate.hint ?? undefined,
      cause: error,
    })
  }
  return new Error('Erro inesperado')
}

export function assertNoError(error: unknown): asserts error is null | undefined {
  if (error) throw toError(error)
}
export type DbErrorKind = 'permissao' | 'sessao_expirada' | 'conflito' | 'limite' | 'validacao' | 'nao_encontrado' | 'desconhecido'
export type ClassifiedDbError = { kind: DbErrorKind; message: string }

type ErrorTableEntry = ClassifiedDbError & {
  /** Usa `error.message` (a mensagem de negocio do RAISE) em vez do texto fixo. */
  preserveMessage?: boolean
  /**
   * O código também carrega textos internos (P0001 é o padrão de todo
   * `RAISE EXCEPTION` sem ERRCODE: guardas de migration, `effect_kind`,
   * `cargo_mode = carga_solta`). Mensagem com cara de identificador técnico
   * cai no texto fixo.
   */
  screenTechnical?: boolean
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
  '23505': { kind: 'conflito', message: 'Este registro já existe.', preserveMessage: true },
  '40001': { kind: 'conflito', message: 'Conflito de concorrencia. Tente novamente.' },
  // Duas gravações nos mesmos registros (ex.: duas planilhas da mesma Viagem).
  '40P01': { kind: 'conflito', message: 'Outra gravação estava usando os mesmos registros. Tente novamente.' },
  '55P03': { kind: 'conflito', message: 'Outra gravação estava usando os mesmos registros. Tente novamente.' },
  // Recusas de negócio das migrations 177 e 181 (CE em outro B/L, fatura viva,
  // Nº de Manifesto fora do formato): a mensagem do banco é a orientação.
  // Recusas de negócio das RPCs de importação e faturamento. A mensagem do
  // banco já nomeia o B/L, o container ou a Viagem em português; o texto fixo
  // só aparece quando ela falta ou parece técnica.
  // P0001: `RAISE EXCEPTION` sem ERRCODE (padrão do PL/pgSQL), usado pelas
  // RPCs de Programação, Granito, Base de Clientes, Liberação de CE etc.
  P0001: { kind: 'validacao', message: 'O sistema recusou a operação por uma regra de negócio.', preserveMessage: true, screenTechnical: true },
  // P0003: trava de faturamento (B/L sem cliente ou sem CE, Portal bloqueado,
  // Viagem com dados vinculados) — migrations 047, 051, 067, 083, 241.
  P0003: { kind: 'validacao', message: 'Operação bloqueada por uma pendência do B/L ou da Viagem.', preserveMessage: true, screenTechnical: true },
  // P0005: B/L do arquivo já está em outra Viagem (migration 213).
  P0005: { kind: 'conflito', message: 'Um B/L do arquivo já está em outra Viagem. Nenhum B/L do lote foi gravado.', preserveMessage: true },
  // P0006: container que sai pela reimportação ainda tem Invoice de
  // Demurrage ou veículos (migrations 194, 213).
  P0006: { kind: 'validacao', message: 'Um container que sai pelo arquivo ainda tem Invoice de Demurrage ou veículos.', preserveMessage: true },
  // P0008: container FCL em B/Ls de Clientes diferentes (migration 176).
  P0008: { kind: 'conflito', message: 'Um container FCL do arquivo está em B/Ls de Clientes diferentes. Corrija o Cliente ou o container do arquivo.', preserveMessage: true },
  // 55000 (object_not_in_prerequisite_state): recusas de estado das RPCs
  // ("Viagem cancelada", "fatura já emitida"); todas em português no banco.
  '55000': { kind: 'validacao', message: 'A operação não é possível no estado atual do registro.', preserveMessage: true, screenTechnical: true },
  P0010: { kind: 'conflito', message: 'Este CE Mercante já está em outro B/L.', preserveMessage: true },
  P0011: { kind: 'validacao', message: 'Há fatura emitida para este B/L.', preserveMessage: true },
  P0012: { kind: 'validacao', message: 'Nº de Manifesto Mercante inválido.', preserveMessage: true },
  '23503': { kind: 'validacao', message: 'Registro referenciado nao existe ou ainda esta em uso.' },
  '23514': { kind: 'validacao', message: 'Dados fora das regras do cadastro.', preserveMessage: true },
  '22P02': { kind: 'validacao', message: 'Valor em formato invalido.' },
  '22023': { kind: 'validacao', message: 'Dados invalidos para esta operacao.', preserveMessage: true },
  P0002: { kind: 'nao_encontrado', message: 'Registro nao encontrado.', preserveMessage: true },
  P0429: { kind: 'limite', message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
  // Texto das telas de consulta. Importação usa `importErrorMessage`, que
  // troca a orientação (dividir o arquivo, não reduzir período).
  '57014': { kind: 'limite', message: 'A consulta demorou demais. Reduza o período e tente novamente.' },
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
    || /row-level security policy/i.test(fields.message)
    || /violates (?:check|not-null|foreign key|unique) constraint/i.test(fields.message)
  if (known) {
    const preserve = known.preserveMessage && fields.message && !raw
      && !(known.screenTechnical && looksTechnical(fields.message))
    return { kind: known.kind, message: preserve ? fields.message : known.message }
  }
  if (/permission denied/i.test(fields.message)) {
    const permissao = ERROR_TABLE['42501']
    return { kind: permissao.kind, message: permissao.message }
  }
  return { kind: 'desconhecido', message: fields.message || 'Falha inesperada. Tente novamente.' }
}

function looksTechnical(message: string): boolean {
  return /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/.test(message) // snake_case: coluna, função, tabela
    || /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/.test(message) // REVISAO_OBSOLETA
    || /^(?:migration\b|\d{3}:)/i.test(message.trim()) // guardas de migration
    || /\b(?:function|relation|column|does not exist|null value|syntax error|invalid input)\b/i.test(message)
}

function errorField(error: unknown, field: 'details' | 'message'): string {
  let current: unknown = error
  // DatabaseError guarda `details`; um Error de serviço pode trazer o erro do
  // PostgREST em `cause`.
  for (let depth = 0; current && typeof current === 'object' && depth < 3; depth += 1) {
    const value = (current as Record<string, unknown>)[field]
    if (typeof value === 'string' && value) return value
    current = (current as { cause?: unknown }).cause
  }
  return ''
}

function errorCode(error: unknown): string {
  let current: unknown = error
  for (let depth = 0; current && typeof current === 'object' && depth < 3; depth += 1) {
    const value = (current as { code?: unknown }).code
    if (typeof value === 'string' && value) return value
    current = (current as { cause?: unknown }).cause
  }
  return ''
}

/**
 * Valor repetido de uma violação de unicidade, quando o Postgres o expõe em
 * `details` ("Key (bl_number)=(ABC123) already exists."). Só o valor sai; o
 * nome da coluna fica de fora.
 */
function duplicateKeyValue(error: unknown): string | null {
  const match = /\)=\((.*)\) already exists/.exec(errorField(error, 'details'))
  const value = match?.[1]?.trim()
  return value ? value : null
}

/**
 * 23505 cru (o texto do Postgres, não um RAISE de negócio) com o valor que já
 * existe, quando o banco o informa.
 */
function duplicateKeyMessage(error: unknown, classified: ClassifiedDbError): string {
  if (classified.message !== ERROR_TABLE['23505'].message) return classified.message
  const value = duplicateKeyValue(error)
  return value ? `Já existe um registro com o valor "${value}".` : classified.message
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
  if (classified.kind === 'desconhecido') return fallback
  return errorCode(error) === '23505' ? duplicateKeyMessage(error, classified) : classified.message
}

// Texto próprio das importações: a gravação do arquivo inteiro é uma
// transação, então uma trava ou um cancelamento desfaz tudo.
const IMPORT_CONCURRENCY_MESSAGE = 'Outra importação da mesma Viagem estava em andamento. Nada foi gravado: tente de novo.'
const IMPORT_OVERRIDES: Readonly<Record<string, string>> = {
  '40001': IMPORT_CONCURRENCY_MESSAGE,
  '40P01': IMPORT_CONCURRENCY_MESSAGE,
  '55P03': IMPORT_CONCURRENCY_MESSAGE,
  '57014': 'A importação demorou demais e foi cancelada. Nada foi gravado: tente de novo ou divida o arquivo em partes menores.',
}

/**
 * `userFacingErrorMessage` para telas de importação de arquivo: trava e
 * tempo esgotado ganham orientação de importação (não "reduza o período"), e
 * a chave repetida numa tabela de preparo (`tmp_*`) aponta a linha repetida
 * no próprio arquivo, não um registro já gravado.
 */
export function importErrorMessage(
  error: unknown,
  fallback = 'Não foi possível importar o arquivo. Tente novamente.',
): string {
  const code = errorCode(error)
  const override = IMPORT_OVERRIDES[code]
  if (override) return override
  if (code === '23505' && /unique constraint "tmp_/.test(errorField(error, 'message'))) {
    const value = duplicateKeyValue(error)
    return value
      ? `O valor "${value}" aparece mais de uma vez no arquivo. Deixe uma linha só para ele e importe de novo.`
      : 'Há uma linha repetida no arquivo. Deixe uma linha só para cada registro e importe de novo.'
  }
  return userFacingErrorMessage(error, fallback)
}

/**
 * Recusa de uma importação atômica (o arquivo inteiro numa transação): sempre
 * diz que nada foi gravado, sem repetir quando a mensagem do banco já diz.
 */
export function atomicImportRefusalMessage(error: unknown): string {
  const message = importErrorMessage(error, 'O banco recusou o arquivo.')
  return /\bgravad[oa]\b/i.test(message) ? message : `Nada foi gravado: ${message}`
}

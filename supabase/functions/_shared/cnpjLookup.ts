// Consulta de CNPJ na BrasilAPI para o Novo cliente (ADR 0126). A função
// `cnpj-lookup` é fina: lê o ambiente, confere a sessão interna e chama o
// handler daqui, que recebe tudo por `deps` para o teste rodar sem rede.
//
// Regras:
// - só usuário interno ativo (perfil em `user_profiles`); conta do Portal e
//   sessão anônima recebem 403;
// - o navegador não fala com a BrasilAPI: a CSP do Vela não libera o host, e
//   trocar de fornecedor fica só aqui;
// - resposta montada por lista positiva (sem sócios, telefone ou e-mail da
//   Receita): só o que o cadastro do Cliente usa;
// - falha, demora ou limite do fornecedor viram `indisponivel` com 200: o
//   cadastro segue à mão, e o Sentry não recebe a queda de um serviço de
//   terceiros como erro nosso (o log registra o motivo, sem o CNPJ).
import { corsHeaders } from './cors.ts'
import { SMALL_JSON_MAX_BYTES, readBoundedJsonBody } from './boundedBody.ts'

export const BRASILAPI_CNPJ_URL = 'https://brasilapi.com.br/api/cnpj/v1/'
/** Tempo máximo de espera pela BrasilAPI; acima disso o operador preenche à mão. */
export const CNPJ_LOOKUP_TIMEOUT_MS = 6000

export type CnpjLookupData = {
  cnpj: string
  razao_social: string
  nome_fantasia: string
  cep: string
  endereco: string
  cidade: string
  uf: string
  /** Situação cadastral na Receita ("ATIVA", "BAIXADA", "INAPTA"...). */
  situacao: string
}

export type CnpjLookupResponse =
  | { status: 'encontrado'; data: CnpjLookupData }
  | { status: 'nao_encontrado' }
  | { status: 'indisponivel' }

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

export type CnpjLookupDeps = {
  /** Papel interno da sessão (`portal_current_role`), ou null sem perfil ativo. */
  resolveRole: (authorization: string) => Promise<string | null>
  fetcher: Fetcher
  log?: (message: string, details?: Record<string, unknown>) => void
}

/** 14 posições, letras nas 12 primeiras (CNPJ alfanumérico), sem pontuação. */
export function normalizeLookupCnpj(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cnpj = value.replace(/[^0-9a-z]/gi, '').toUpperCase()
  return /^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj) ? cnpj : null
}

const text = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')

/**
 * Endereço numa linha, no formato da fatura: "AVENIDA PAULISTA, 1000 - ANDAR 4 - BELA VISTA".
 * O tipo do logradouro vem separado na Receita e só entra quando o logradouro
 * ainda não começa por ele.
 */
export function formatLookupAddress(raw: Record<string, unknown>): string {
  const kind = text(raw.descricao_tipo_de_logradouro)
  const street = text(raw.logradouro)
  const fullStreet = kind && street && !street.toUpperCase().startsWith(kind.toUpperCase()) ? `${kind} ${street}` : street
  const number = text(raw.numero)
  const head = [fullStreet, number].filter(Boolean).join(', ')
  return [head, text(raw.complemento), text(raw.bairro)].filter(Boolean).join(' - ')
}

export function toLookupData(cnpj: string, raw: Record<string, unknown>): CnpjLookupData {
  const zip = text(raw.cep).replace(/\D/g, '')
  return {
    cnpj,
    razao_social: text(raw.razao_social),
    nome_fantasia: text(raw.nome_fantasia),
    cep: zip.length === 8 ? zip : '',
    endereco: formatLookupAddress(raw),
    cidade: text(raw.municipio),
    uf: /^[A-Z]{2}$/.test(text(raw.uf).toUpperCase()) ? text(raw.uf).toUpperCase() : '',
    situacao: text(raw.descricao_situacao_cadastral).toUpperCase(),
  }
}

export async function handleCnpjLookup(req: Request, deps: CnpjLookupDeps): Promise<Response> {
  const origin = req.headers.get('Origin')
  const json = (status: number, body: unknown) =>
    new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } })
  if (req.method === 'OPTIONS') return json(204, null)
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const authorization = req.headers.get('Authorization') ?? ''
  const role = authorization ? await deps.resolveRole(authorization).catch(() => null) : null
  if (!role) return json(403, { error: 'A consulta de CNPJ é da equipe interna.' })

  const parsed = await readBoundedJsonBody(req, SMALL_JSON_MAX_BYTES)
  if (parsed.tooLarge) return json(413, { error: 'Requisição acima do tamanho permitido.' })
  const cnpj = normalizeLookupCnpj((parsed.value as { cnpj?: unknown } | null)?.cnpj)
  if (!cnpj) return json(422, { error: 'Informe um CNPJ com 14 posições.' })

  const log = deps.log ?? ((message, details) => console.warn(message, details ?? {}))
  let upstream: Response
  try {
    upstream = await deps.fetcher(`${BRASILAPI_CNPJ_URL}${cnpj}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'vela-cnpj-lookup' },
      signal: AbortSignal.timeout(CNPJ_LOOKUP_TIMEOUT_MS),
    })
  } catch (error) {
    log('cnpj-lookup: BrasilAPI sem resposta', { reason: error instanceof Error ? error.name : 'unknown' })
    return json(200, { status: 'indisponivel' } satisfies CnpjLookupResponse)
  }

  if (upstream.status === 404) {
    await upstream.body?.cancel()
    return json(200, { status: 'nao_encontrado' } satisfies CnpjLookupResponse)
  }
  if (!upstream.ok) {
    await upstream.body?.cancel()
    log('cnpj-lookup: BrasilAPI recusou', { status: upstream.status })
    return json(200, { status: 'indisponivel' } satisfies CnpjLookupResponse)
  }

  const raw = await upstream.json().catch(() => null) as Record<string, unknown> | null
  if (!raw || typeof raw !== 'object' || !text(raw.razao_social)) {
    log('cnpj-lookup: resposta da BrasilAPI fora do formato')
    return json(200, { status: 'indisponivel' } satisfies CnpjLookupResponse)
  }
  return json(200, { status: 'encontrado', data: toLookupData(cnpj, raw) } satisfies CnpjLookupResponse)
}

// Contrato de transporte 2.27.2. O chamador backend fornece fetch com mTLS.
// Sem configuração explícita/validada, nenhuma chamada é feita.
type PixTransportConfig = {
  enabled: boolean
  validated: boolean
  clientId: string
  clientSecret: string
  pixKey: string
  authHeader: 'Authorization' | 'auth'
  tokenFormat: 'bearer' | 'raw'
  fetchWithMtls: typeof fetch
}
type Cob = {
  txid: string
  revisao: number
  status: string
  calendario: { criacao: string; expiracao: number }
  valor: { original: string }
  pixCopiaECola?: string
}

export function expirationSeconds(createdAt: string, expiresAt: string): number {
  const seconds = Math.floor((Date.parse(expiresAt) - Date.parse(createdAt)) / 1000)
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new Error('Expiração Pix inválida.')
  return seconds
}

export async function itauPixRequest(
  config: PixTransportConfig,
  operation: { method: 'GET' | 'PUT' | 'PATCH'; txid: string; amount?: string; expiresAt?: string; createdAt?: string; cancel?: boolean },
): Promise<Cob> {
  if (!config.enabled || !config.validated || !config.clientId || !config.clientSecret || !config.pixKey) {
    throw new Error('Acesso Itaú não ativado e validado.')
  }
  if (!/^[a-zA-Z0-9]{26,35}$/.test(operation.txid)) throw new Error('TXID inválido.')
  if (operation.amount !== undefined && (!/^\d+\.\d{2}$/.test(operation.amount) || Number(operation.amount) <= 0)) {
    throw new Error('Valor Pix inválido.')
  }
  let body: Record<string, unknown> | undefined
  if (operation.method !== 'GET') {
    body = operation.cancel ? { status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' } : {
      ...(operation.amount === undefined ? {} : { valor: { original: operation.amount } }),
      ...(operation.expiresAt === undefined ? {} : { calendario: { expiracao: expirationSeconds(operation.createdAt ?? new Date().toISOString(), operation.expiresAt) } }),
      ...(operation.method === 'PUT' ? { chave: config.pixKey } : {}),
    }
    if (operation.method === 'PUT' && (!operation.amount || !operation.expiresAt)) throw new Error('Criação Pix exige valor e expiração.')
    if (operation.method === 'PATCH' && operation.expiresAt && !operation.createdAt) throw new Error('Renovação Pix exige data original de criação.')
  }
  const tokenResponse = await config.fetchWithMtls('https://sts.itau.com.br/api/oauth/token', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: config.clientId, client_secret: config.clientSecret }),
  })
  if (!tokenResponse.ok) throw new Error(`Autenticação Itaú recusada (${tokenResponse.status}).`)
  const token: unknown = await tokenResponse.json()
  if (!token || typeof token !== 'object' || !('access_token' in token) || typeof token.access_token !== 'string' || !token.access_token) {
    throw new Error('Resposta de autenticação Itaú inválida.')
  }
  const response = await config.fetchWithMtls(`https://pix-pj.api.itau.com/regulatorio-pix/v2/cob/${operation.txid}`, {
    method: operation.method, signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', [config.authHeader]: config.tokenFormat === 'bearer' ? `Bearer ${token.access_token}` : token.access_token },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  // Sem retry automático de escrita: timeout exige GET antes de repetir.
  if (!response.ok) throw new Error(`Operação Pix Itaú recusada (${response.status}).`)
  const cob = await response.json() as Partial<Cob>
  if (!cob || cob.txid !== operation.txid || !Number.isSafeInteger(cob.revisao) || (cob.revisao ?? -1) < 0 || typeof cob.status !== 'string' ||
      !cob.calendario || !Number.isFinite(Date.parse(cob.calendario.criacao)) || !Number.isSafeInteger(cob.calendario.expiracao) ||
      !cob.valor || typeof cob.valor.original !== 'string' || !/^\d+\.\d{2}$/.test(cob.valor.original) ||
      (operation.amount !== undefined && cob.valor.original !== operation.amount && cob.status === 'ATIVA') ||
      (operation.cancel && !['REMOVIDA_PELO_USUARIO_RECEBEDOR','CONCLUIDA'].includes(cob.status))) {
    throw new Error('Resposta Itaú não confirma a cobrança solicitada; consultar antes de repetir.')
  }
  return cob as Cob
}

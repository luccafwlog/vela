/** Falha do Supabase Auth que não é senha errada: limite de taxa, 5xx, rede. */
export class AuthUpstreamError extends Error {
  readonly status: number | undefined
  readonly code: string | undefined

  constructor(status: number | undefined, code: string | undefined) {
    super(`Supabase Auth indisponível (status ${status ?? '?'}, code ${code ?? '?'})`)
    this.name = 'AuthUpstreamError'
    this.status = status
    this.code = code
  }
}

type AuthErrorLike = { status?: unknown; code?: unknown; message?: unknown } | null | undefined

/**
 * Só a recusa da credencial conta no balde do CNPJ (o balde registra o que o
 * Cliente digitou). O GoTrue responde 400 `invalid_credentials`; versões
 * antigas mandam só a mensagem "Invalid login credentials".
 */
export function isInvalidCredentials(error: AuthErrorLike): boolean {
  if (!error) return false
  if (error.code === 'invalid_credentials') return true
  return error.status === 400 && typeof error.message === 'string'
    && error.message.toLowerCase().includes('invalid login credentials')
}

/** Sessão, `null` para credencial recusada, ou exceção para falha do Auth. */
export function sessionOrRefusal<TSession>(data: { session: TSession | null } | null, error: AuthErrorLike): TSession | null {
  if (!error) return data?.session ?? null
  if (isInvalidCredentials(error)) return null
  const status = typeof error.status === 'number' ? error.status : undefined
  const code = typeof error.code === 'string' ? error.code : undefined
  throw new AuthUpstreamError(status, code)
}

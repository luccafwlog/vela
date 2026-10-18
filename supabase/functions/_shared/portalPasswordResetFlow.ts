export const PORTAL_PASSWORD_RESET_QUARANTINE_MS = 15 * 60 * 1000

export type PortalPasswordResetDependencies = {
  now: () => number
  revokeSessions: (userId: string) => Promise<void>
  quarantineSessions: (userId: string, revokedUntil: string) => Promise<void>
  updatePassword: (userId: string, password: string) => Promise<void>
  completeReset: () => Promise<void>
}

// GoTrue e Postgres não compartilham uma transação. A ordem abaixo nega
// fechado: sessões antigas caem antes da troca; uma marca futura invalida
// qualquer token emitido durante a janela; a segunda revogação encerra a
// quarentena somente depois de a nova senha estar persistida.
export async function resetPortalPasswordFailClosed(
  userId: string,
  password: string,
  dependencies: PortalPasswordResetDependencies,
): Promise<void> {
  await dependencies.revokeSessions(userId)
  const revokedUntil = new Date(dependencies.now() + PORTAL_PASSWORD_RESET_QUARANTINE_MS).toISOString()
  await dependencies.quarantineSessions(userId, revokedUntil)
  await dependencies.updatePassword(userId, password)
  await dependencies.revokeSessions(userId)
  await dependencies.completeReset()
}

export type PasswordChangedNoticeDependencies = {
  /** Email de Recuperação e Cliente da conta, lidos depois da troca. */
  loadAccount: () => Promise<{ recoveryEmail: string | null; companyName: string | null; cnpj: string | null } | null>
  send: (input: { to: string; companyName: string; cnpjMasked: string; idempotencyKey: string }) => Promise<{ ok: boolean }>
}

function maskCnpj(value: string | null): string {
  const d = (value ?? '').replace(/[^0-9a-z]/gi, '').toUpperCase()
  return d.length === 14 ? `${d.slice(0, 2)}.***.***/${d.slice(8, 12)}-${d.slice(12)}` : '***'
}

// Aviso "sua senha foi alterada" (D12) ao Email de Recuperação. A senha já
// mudou quando ele sai: uma falha aqui fica no log e na tentativa, nunca
// desfaz nem falha a recuperação. Uma chave por recuperação (o convite).
export async function notifyPortalPasswordChanged(inviteId: number | string, dependencies: PasswordChangedNoticeDependencies): Promise<boolean> {
  try {
    const account = await dependencies.loadAccount()
    const to = account?.recoveryEmail?.trim()
    if (!to) return false
    const result = await dependencies.send({
      to,
      companyName: account?.companyName ?? 'sua empresa',
      cnpjMasked: maskCnpj(account?.cnpj ?? null),
      idempotencyKey: `senha_alterada:${inviteId}`,
    })
    return result.ok
  } catch (error) {
    console.error('[portal-password-reset] aviso de senha alterada não enviado', error instanceof Error ? error.message : String(error))
    return false
  }
}

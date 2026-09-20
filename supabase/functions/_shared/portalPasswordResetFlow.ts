export const PORTAL_PASSWORD_RESET_QUARANTINE_MS = 15 * 60 * 1000

export type PortalPasswordResetDependencies = {
  now: () => number
  revokeSessions: (userId: string) => Promise<void>
  quarantineSessions: (userId: string, revokedUntil: string) => Promise<void>
  updatePassword: (userId: string, password: string) => Promise<void>
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
}

export type PortalLoginAccount = {
  auth_user_id: string | null
  account_situation: string
} | null

export type PortalLoginIdentityDependencies<TSession> = {
  lookupEmail: (userId: string) => Promise<string | null>
  signIn: (email: string, password: string) => Promise<TSession | null>
  /** HMAC(pepper, senha): o que o GoTrue guarda para contas migradas. */
  derivePassword: (password: string) => Promise<string>
  /** Grava a senha derivada de uma conta que ainda entrava com a senha pura. */
  migrateLegacyPassword: (userId: string, derivedPassword: string) => Promise<void>
}

const INVALID_TECHNICAL_EMAIL = 'portal-login-unavailable@invalid'

export async function authenticatePortalLoginIdentity<TSession>(
  account: PortalLoginAccount,
  dummyUserId: string,
  password: string,
  dependencies: PortalLoginIdentityDependencies<TSession>,
): Promise<{ accepted: boolean; session: TSession | null }> {
  const accountEligible = Boolean(
    account && account.account_situation === 'ativo' && account.auth_user_id,
  )
  const lookupUserId = accountEligible ? account!.auth_user_id! : dummyUserId
  const technicalEmail = await dependencies.lookupEmail(lookupUserId)
  const email = technicalEmail ?? INVALID_TECHNICAL_EMAIL
  const derived = await dependencies.derivePassword(password)
  let session = await dependencies.signIn(email, derived)
  // Senha errada, conta inexistente e conta legada fazem as mesmas duas
  // tentativas; só a senha certa de conta migrada para na primeira.
  if (!session) {
    session = await dependencies.signIn(email, password)
    if (session && accountEligible && technicalEmail) {
      await dependencies.migrateLegacyPassword(lookupUserId, derived)
    }
  }

  if (!accountEligible || !technicalEmail || !session) return { accepted: false, session: null }
  return { accepted: true, session }
}

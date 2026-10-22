export type PortalLoginAccount = {
  auth_user_id: string | null
  account_situation: string
  /** O banco (current_portal_customer_id) exige active; o login também. */
  active: boolean
} | null

export type PortalLoginIdentityDependencies<TSession> = {
  lookupEmail: (userId: string) => Promise<string | null>
  signIn: (email: string, password: string) => Promise<TSession | null>
  /** HMAC(pepper, senha): o único formato que o GoTrue guarda (auditoria run-3). */
  derivePassword: (password: string) => Promise<string>
}

const INVALID_TECHNICAL_EMAIL = 'portal-login-unavailable@invalid'

export async function authenticatePortalLoginIdentity<TSession>(
  account: PortalLoginAccount,
  dummyUserId: string,
  password: string,
  dependencies: PortalLoginIdentityDependencies<TSession>,
): Promise<{ accepted: boolean; session: TSession | null }> {
  const accountEligible = Boolean(
    account && account.account_situation === 'ativo' && account.active && account.auth_user_id,
  )
  const lookupUserId = accountEligible ? account!.auth_user_id! : dummyUserId
  const technicalEmail = await dependencies.lookupEmail(lookupUserId)
  const email = technicalEmail ?? INVALID_TECHNICAL_EMAIL
  // Uma tentativa só, com a senha derivada, em todos os casos (senha certa,
  // errada e conta inexistente): sem a senha pura legada, que ficava aberta
  // no GoTrue direto (auditoria run-3).
  const session = await dependencies.signIn(email, await dependencies.derivePassword(password))

  if (!accountEligible || !technicalEmail || !session) return { accepted: false, session: null }
  return { accepted: true, session }
}

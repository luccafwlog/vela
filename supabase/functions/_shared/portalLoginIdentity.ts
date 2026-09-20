export type PortalLoginAccount = {
  auth_user_id: string | null
  account_situation: string
} | null

export type PortalLoginIdentityDependencies<TSession> = {
  lookupEmail: (userId: string) => Promise<string | null>
  signIn: (email: string, password: string) => Promise<TSession | null>
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
  const session = await dependencies.signIn(technicalEmail ?? INVALID_TECHNICAL_EMAIL, password)

  if (!accountEligible || !technicalEmail || !session) return { accepted: false, session: null }
  return { accepted: true, session }
}

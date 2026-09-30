// Decide se um user_id pode ser alvo de admin-users (update_credentials,
// deactivate). Só usuário interno com perfil; conta do Portal e o usuário
// sentinela do portal-login ficam de fora (auditoria run-2, #8).
export type InternalTargetFacts = {
  userId: string
  dummyUserId: string | null
  hasProfile: boolean
  isPortalAccount: boolean
}

export type InternalTargetDecision =
  | { ok: true }
  | { ok: false; status: 404 | 422; error: string }

const NOT_FOUND = { ok: false, status: 404, error: 'Usuário interno não encontrado.' } as const

export function decideInternalTarget(facts: InternalTargetFacts): InternalTargetDecision {
  if (!facts.userId) return { ok: false, status: 422, error: 'Usuário não informado.' }
  if (facts.dummyUserId && facts.userId === facts.dummyUserId) return NOT_FOUND
  if (facts.isPortalAccount) return NOT_FOUND
  if (!facts.hasProfile) return NOT_FOUND
  return { ok: true }
}

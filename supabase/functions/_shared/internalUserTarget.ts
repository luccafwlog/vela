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

// Conta com a marca Dev (ADR 0104): a senha e o e-mail só são trocados pela
// própria pessoa. Outro Administrativo que redefinisse a senha poderia entrar
// com ela e ligar a chave de envio (revisão da PR #1070, decisão do dono de
// 2026-10-27). Desativar e trocar o setor continuam com o Administrativo:
// nenhum dos dois liga a chave.
export const DEV_CREDENTIALS_REFUSAL = 'A conta com a marca Dev só tem o e-mail e a senha trocados pela própria pessoa.'

export function decideDevCredentialChange(facts: { targetIsDev: boolean; targetId: string; actorId: string }):
  | { ok: true }
  | { ok: false; status: 403; error: string } {
  if (facts.targetIsDev && facts.targetId !== facts.actorId) return { ok: false, status: 403, error: DEV_CREDENTIALS_REFUSAL }
  return { ok: true }
}

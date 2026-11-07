import type { AdminUserRow } from '../../services/adminUsers'

/** O setor que vale para os alertas: o papel antigo `operator` conta como Documentação. */
function team(role: string | null | undefined): string {
  return role === 'operator' ? 'documentacao' : role ?? ''
}

/**
 * A pessoa é a última ativa da equipe dela? Desativada, os alertas dessa equipe
 * não têm a quem avisar (decisão do dono de 2026-11-06; o mesmo critério dos
 * Pontos de atenção da aba Sistema, migration 605). A conta de integração não
 * conta como pessoa.
 */
export function isLastActiveOfTeam(user: Pick<AdminUserRow, 'id' | 'role' | 'active' | 'account_kind'>, users: readonly Pick<AdminUserRow, 'id' | 'role' | 'active' | 'account_kind'>[]): boolean {
  if (!user.active || user.account_kind === 'integracao') return false
  return !users.some((other) => other.id !== user.id && other.active && other.account_kind !== 'integracao' && team(other.role) === team(user.role))
}

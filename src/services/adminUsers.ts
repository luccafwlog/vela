import { supabase } from './supabase'
import { DEPARTMENT_LABELS } from '../lib/departmentLabel'
import type { Department } from './permissionMatrix'
import type { UserProfile, UserProfileRole } from '../types/database'

export type AdminUserRow = UserProfile & {
  email: string | null
  last_sign_in_at: string | null
  /** E-mail suprimido por devolução ou spam (migration 309, plano dos e-mails 2.8). */
  email_bounced?: boolean
}

export async function listAllUserProfiles(): Promise<AdminUserRow[]> {
  const { data, error } = await supabase.rpc('admin_list_users')
  if (error) throw error
  return (data ?? []) as AdminUserRow[]
}

export async function updateUserProfile(
  id: string,
  updates: { role?: UserProfileRole; active?: boolean },
): Promise<void> {
  const { error } = await supabase.from('user_profiles').update(updates).eq('id', id)
  if (error) throw error
}

/**
 * Devolve o setor anterior só se o registro ainda está com o setor que acabou de
 * ser gravado (`expectedRole`); se alguém o trocou no meio, não sobrescreve.
 * `true` quando voltou; `false` quando nenhuma linha estava mais com `expectedRole`.
 */
export async function restoreUserRole(
  id: string,
  expectedRole: UserProfileRole,
  previousRole: UserProfileRole,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_profiles')
    .update({ role: previousRole })
    .eq('id', id)
    .eq('role', expectedRole)
    .select('id')
  if (error) throw error
  return (data ?? []).length > 0
}

async function invokeAdminUsers(body: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (!error) return data
  // Em resposta não-2xx o supabase-js devolve `data` nulo e guarda o corpo em
  // error.context (um Response). Ler dali é o que faz "Já existe um usuário com
  // este e-mail" chegar à tela em vez da mensagem genérica.
  const context = (error as { context?: Response }).context
  const parsed = context ? await context.json().catch(() => null) as { error?: string } | null : null
  throw new Error(parsed?.error ?? 'Não foi possível concluir a operação.')
}

export async function createUser(input: {
  full_name: string
  email: string
  password: string
  role: UserProfileRole
}): Promise<void> {
  await invokeAdminUsers({ action: 'create', ...input })
}

export async function updateUserCredentials(input: {
  user_id: string
  email?: string
  password?: string
}): Promise<{ released: number; sessionEnded: boolean }> {
  const data = await invokeAdminUsers({ action: 'update_credentials', ...input }) as { released?: unknown; session_ended?: unknown } | null
  // `released`: supressões liberadas do endereço salvo (0 quando ele também é de Cliente).
  // `session_ended`: a credencial trocada era a de quem chamou, e o token dela já foi cortado (migration 419).
  return {
    released: typeof data?.released === 'number' ? data.released : 0,
    sessionEnded: data?.session_ended === true,
  }
}

// Desativar passa pela Edge Function porque encerrar a sessão exige service_role;
// reativar é só o flag e continua em updateUserProfile.
export async function deactivateUser(userId: string): Promise<void> {
  await invokeAdminUsers({ action: 'deactivate', user_id: userId })
}

export const PROFILE_LABELS: Record<UserProfileRole, string> = {
  admin: 'Admin (legado)',
  operator: 'Operador (legado)',
  ...DEPARTMENT_LABELS,
}

export const MANAGED_PROFILES: Department[] = ['administrativo', 'financeiro', 'operacoes', 'documentacao', 'equipamentos']

/**
 * Setor gerido de um papel: o legado `operator` é Documentação, como no resto
 * do sistema. O que cada setor pode está no catálogo `permissionMatrix.ts`.
 */
export function managedProfileOf(role: UserProfileRole): Department {
  if (role === 'operator') return 'documentacao'
  return (MANAGED_PROFILES as readonly string[]).includes(role) ? (role as Department) : 'documentacao'
}

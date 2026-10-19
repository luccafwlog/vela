import { supabase } from './supabase'
import { DEPARTMENT_LABELS } from '../lib/departmentLabel'
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
}): Promise<{ released: number }> {
  const data = await invokeAdminUsers({ action: 'update_credentials', ...input }) as { released?: unknown } | null
  // `released`: supressões liberadas do endereço salvo (0 quando ele também é de Cliente).
  return { released: typeof data?.released === 'number' ? data.released : 0 }
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

export const MANAGED_PROFILES: UserProfileRole[] = ['administrativo', 'financeiro', 'operacoes', 'documentacao', 'equipamentos']

// P14 (ADR 0085): leitura global para todos (só /admin é do Administrativo) e
// escrita global com autor e motivo no rastro; cada texto cita as exceções da
// lista fechada da ADR 0085 que valem para o perfil. A matriz completa está em
// docs/operations/seguranca.md#modelo-de-permissões-por-perfil.
export const PROFILE_SCOPES: Record<string, string> = {
  administrativo: 'Leitura e escrita globais, e todas as exceções: usuários e /admin, cancelar fatura, Invoice de Demurrage e baixa, cancelar e reativar Viagem e B/L, desativar e reativar cadastros, trocar o CNPJ do Portal, chave global de envio, Liberação de faturamento e intervalo da Régua; cobre a assinatura do ADR de Saída.',
  financeiro: 'Leitura e escrita globais, com autor e motivo no rastro. Exceções do perfil: baixa manual, conciliar Pix, registrar a Restituição, liquidar Ajuste de COD e Informar PTAX. Não envia Comunicados nem assina seção do ADR de Saída.',
  operacoes: 'Leitura e escrita globais, com autor e motivo no rastro. Assina as seções de Operações do ADR de Saída. Não registra baixa nem envia Comunicados.',
  documentacao: 'Leitura e escrita globais, com autor e motivo no rastro. Exceções do perfil: provisionar o Portal, gerir o Desbloqueio de CE e enviar Comunicados; assina as seções de Documentação do ADR de Saída.',
  equipamentos: 'Leitura e escrita globais, com autor e motivo no rastro. Exceções do perfil: enviar Comunicados, responder Disputas de Demurrage e Informar PTAX; assina as seções de Equipamentos do ADR de Saída.',
}

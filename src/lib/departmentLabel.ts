import type { UserProfileRole } from '../types/database'

/**
 * Nome de cada departamento gerido. Fonte única para o menu da conta, o
 * acesso restrito e a Administração (`PROFILE_LABELS`), para o mesmo perfil
 * não aparecer com dois nomes.
 */
export const DEPARTMENT_LABELS = {
  administrativo: 'Administrativo',
  financeiro: 'Financeiro',
  operacoes: 'Operações',
  documentacao: 'Documentação',
  equipamentos: 'Equipamentos',
} as const satisfies Partial<Record<UserProfileRole, string>>

/**
 * Nome do departamento exibido ao usuário interno (perfil e menu da conta).
 * O papel legado `operator` equivale a Documentação (docs/RASTREABILIDADE.md);
 * só a Administração mostra o sufixo "(legado)".
 */
export function departmentLabel(role: string | null | undefined): string {
  if (role === 'operator') return DEPARTMENT_LABELS.documentacao
  if (role && role in DEPARTMENT_LABELS) return DEPARTMENT_LABELS[role as keyof typeof DEPARTMENT_LABELS]
  return '—'
}

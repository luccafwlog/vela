import type { ComponentType } from 'react'
import {
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  CalendarClock,
  Car,
  Clock,
  FileSpreadsheet,
  Home,
  ListChecks,
  MapPin,
  Megaphone,
  Monitor,
  Mountain,
  ReceiptText,
  RefreshCw,
  Ship,
  ShieldCheck,
  Table2,
  UserCheck,
  Users,
} from 'lucide-react'
import { ContainersIcon, VaziosExpIcon, VaziosImpIcon } from '../shared/DomainIcon'
import type { OperationalCounts } from '../../hooks/useOperationalCounts'

export type NavItem = {
  to: string
  label: string
  icon: ComponentType<{ size?: number }>
  badge?: number
  alert?: boolean
  /** Abre em outra aba (Line Up na TV, fora do layout do Vela). */
  external?: boolean
}

export type NavGroupId = 'viagens' | 'importacao' | 'exportacao' | 'clientes' | 'alertas' | 'financeiro'

export type NavGroup = {
  id: NavGroupId
  label: string
  icon: ComponentType<{ size?: number }>
  items: NavItem[]
}

export const painelNavItem: NavItem = { to: '/painel', label: 'Painel', icon: Home }

// Desde 2026-11-01 (decisão do dono), as telas que só abriam por botão dentro
// de outra tela entram no grupo do seu assunto: Chegadas e Saídas e Line Up
// TV em Viagens; Informações do Portal (com Provisionamento e Comunicação) em
// Clientes; Regras de alertas em Alertas; Tabelas e Tarifas no Financeiro;
// Locais em Exportação.
export const voyagesNavItems: NavItem[] = [
  { to: '/viagens', label: 'Viagens', icon: Ship },
  { to: '/chegadas-saidas', label: 'Chegadas e Saídas', icon: CalendarClock },
  { to: '/line-up-tv/display', label: 'Line Up TV', icon: Monitor, external: true },
]

export const importNavItems: NavItem[] = [
  { to: '/baplie', label: 'Baplie EDI', icon: FileSpreadsheet },
  { to: '/bls', label: 'B/Ls', icon: FileSpreadsheet },
  { to: '/desbloqueio-ce', label: 'Desbloqueio de CE', icon: ShieldCheck },
  { to: '/containers', label: 'Containers', icon: ContainersIcon },
  { to: '/veiculos', label: 'Veículos', icon: Car },
  { to: '/vazios-importacao', label: 'Vazios IMP', icon: VaziosImpIcon },
  { to: '/revisao', label: 'Revisão', icon: AlertTriangle },
]

export const exportNavItems: NavItem[] = [
  { to: '/granito', label: 'Granito', icon: Mountain },
  { to: '/embarquevazios', label: 'Vazios EXP', icon: VaziosExpIcon },
  { to: '/embarquevazios/depots', label: 'Locais (depots e terminais)', icon: MapPin },
]

export const customersNavItems: NavItem[] = [
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/clientes/portal', label: 'Provisionamento do Portal', icon: UserCheck },
  { to: '/clientes/comunicacao', label: 'Comunicação', icon: Megaphone },
  { to: '/clientes/informacoes', label: 'Informações do Portal', icon: BookOpen },
]

export const alertsNavItems: NavItem[] = [
  { to: '/alertas', label: 'Alertas', icon: Bell },
  { to: '/alertas/regras', label: 'Regras de alertas', icon: ListChecks },
]

// Aponta para a tela, não para uma de suas abas: /admin abre a
// Administração completa e cada aba tem sua própria sub-rota.
export const adminNavItem: NavItem = { to: '/admin', label: 'Admin', icon: ShieldCheck }

export const financialNavItems: NavItem[] = [
  { to: '/taxas-locais', label: 'Taxas Locais', icon: ReceiptText },
  { to: '/taxas-locais/tabelas', label: 'Tabelas de Taxas Locais', icon: Table2 },
  { to: '/demurrage', label: 'Demurrage', icon: Clock },
  { to: '/demurrage/taxas', label: 'Tarifas de Demurrage', icon: Table2 },
  { to: '/reconciliacao', label: 'Conciliação PIX', icon: RefreshCw },
]

export const reportsNavItem: NavItem = { to: '/relatorios', label: 'Relatórios', icon: BarChart3 }

/**
 * Grupos do menu, na ordem da barra: Painel antes; Relatórios e Admin depois.
 * Os ícones dos grupos (Importação, Exportação, Financeiro) vêm de AppLayout.
 */
export function buildNavGroups(counts: OperationalCounts): Array<Omit<NavGroup, 'icon'>> {
  return [
    { id: 'viagens', label: 'Viagens', items: voyagesNavItems },
    {
      id: 'importacao',
      label: 'Importação',
      items: importNavItems.map((item) => (item.to === '/revisao' ? { ...item, badge: counts.pendingReview || undefined } : item)),
    },
    { id: 'exportacao', label: 'Exportação', items: exportNavItems },
    { id: 'clientes', label: 'Clientes', items: customersNavItems },
    {
      id: 'alertas',
      label: 'Alertas',
      items: alertsNavItems.map((item) => (item.to === '/alertas' ? { ...item, badge: counts.openAlerts || undefined } : item)),
    },
    { id: 'financeiro', label: 'Financeiro', items: buildFinancialNavItemsForCounts(counts) },
  ]
}

export function buildFinancialNavItemsForCounts(counts: OperationalCounts): NavItem[] {
  return financialNavItems.map((item) => {
    if (item.to === '/taxas-locais') return { ...item, badge: counts.chargeReviewRequired || undefined }
    return item
  })
}

export function getNavIndicator(items: NavItem[]): { type: 'none' } | { type: 'alert' } | { type: 'badge'; count: number } {
  if (items.some((item) => item.alert)) return { type: 'alert' }
  const totalBadge = items.reduce((sum, item) => sum + (item.badge ?? 0), 0)
  return totalBadge > 0 ? { type: 'badge', count: totalBadge } : { type: 'none' }
}

export function isPathActive(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`)
}

/**
 * Item do grupo que corresponde à tela: o de endereço mais longo que casa.
 * Sem isso, /taxas-locais/tabelas marcaria também Taxas Locais, e
 * /embarquevazios/depots marcaria Vazios EXP. Item externo nunca é a tela.
 */
export function activeNavItem(items: NavItem[], pathname: string): NavItem | null {
  return items
    .filter((item) => !item.external && isPathActive(pathname, item.to))
    .reduce<NavItem | null>((best, item) => (!best || item.to.length > best.to.length ? item : best), null)
}

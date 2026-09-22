import type { ComponentType } from 'react'
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Car,
  Clock,
  FileSpreadsheet,
  Home,
  Mountain,
  ReceiptText,
  RefreshCw,
  Ship,
  ShieldCheck,
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
}

export const importNavItems: NavItem[] = [
  { to: '/baplie', label: 'Baplie EDI', icon: FileSpreadsheet },
  { to: '/bls', label: 'BLs', icon: FileSpreadsheet },
  { to: '/containers', label: 'Containers', icon: ContainersIcon },
  { to: '/veiculos', label: 'Veículos', icon: Car },
  { to: '/vazios-importacao', label: 'Vazios IMP', icon: VaziosImpIcon },
  { to: '/revisao', label: 'Revisão', icon: AlertTriangle },
]

export const exportNavItems: NavItem[] = [
  { to: '/granito', label: 'Granito', icon: Mountain },
  { to: '/embarquevazios', label: 'Vazios EXP', icon: VaziosExpIcon },
]

export const primaryNavItems: NavItem[] = [
  { to: '/painel', label: 'Painel', icon: Home },
  { to: '/viagens', label: 'Viagens', icon: Ship },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/alertas', label: 'Alertas', icon: Bell },
]

// Aponta para a tela, não para uma de suas abas: /admin abre a
// Administração completa e cada aba tem sua própria sub-rota.
export const adminNavItem: NavItem = { to: '/admin', label: 'Admin', icon: ShieldCheck }

export const financialNavItems: NavItem[] = [
  { to: '/taxas-locais', label: 'Taxas Locais', icon: ReceiptText },
  { to: '/demurrage', label: 'Demurrage', icon: Clock },
  { to: '/reconciliacao', label: 'Conciliação PIX', icon: RefreshCw },
]

export const reportsNavItem: NavItem = { to: '/relatorios', label: 'Relatórios', icon: BarChart3 }

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

import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  DollarSign,
  FileSpreadsheet,
  LogOut,
  Menu,
  Package,
  User,
  UserCircle,
  X,
} from 'lucide-react'
import { ErrorBoundary } from '../ErrorBoundary'
import { useAuth } from '../../hooks/useAuth'
import { useOperationalCounts } from '../../hooks/useOperationalCounts'
import { HeaderInfoBar } from './HeaderInfoBar'
import { InternalNotificationBell } from './InternalNotificationBell'
import { cn } from '../../lib/utils'
import {
  adminNavItem,
  buildFinancialNavItemsForCounts,
  exportNavItems,
  financialNavItems,
  getNavIndicator,
  importNavItems,
  primaryNavItems,
  reportsNavItem,
  type NavItem,
} from './appLayoutNav'

const NAV_COLLAPSE_WIDTH = 1100

export function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { profile, signOut, isAdmin } = useAuth()
  const counts = useOperationalCounts()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [mobileImportOpen, setMobileImportOpen] = useState(false)
  const [desktopImportOpen, setDesktopImportOpen] = useState(false)
  const [mobileExportOpen, setMobileExportOpen] = useState(false)
  const [desktopExportOpen, setDesktopExportOpen] = useState(false)
  const [mobileFinancialOpen, setMobileFinancialOpen] = useState(false)
  const [desktopFinancialOpen, setDesktopFinancialOpen] = useState(false)
  const [isMobileNav, setIsMobileNav] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= NAV_COLLAPSE_WIDTH : false,
  )
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const userMenuButtonRef = useRef<HTMLButtonElement>(null)
  const userMenuFirstItemRef = useRef<HTMLButtonElement>(null)
  const primaryNavItemsWithBadges: NavItem[] = primaryNavItems.map((item) =>
    item.to === '/alertas' ? { ...item, badge: counts.openAlerts || undefined } : item,
  )
  const importNavItemsWithBadges: NavItem[] = importNavItems.map((item) =>
    item.to === '/revisao' ? { ...item, badge: counts.pendingReview || undefined } : item,
  )
  const exportNavItemsWithBadges: NavItem[] = exportNavItems
  const financialNavItemsWithBadges = buildFinancialNavItemsForCounts(counts)

  const isImportSectionActive = importNavItems.some((item) => isPathActive(location.pathname, item.to))
  const isExportSectionActive = exportNavItems.some((item) => isPathActive(location.pathname, item.to))
  const isFinancialSectionActive = financialNavItems.some((item) => isPathActive(location.pathname, item.to))

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${NAV_COLLAPSE_WIDTH}px)`)
    const syncMobileState = (matches: boolean) => {
      setIsMobileNav(matches)
      if (!matches) {
        setMobileNavOpen(false)
        setMobileImportOpen(false)
        setMobileExportOpen(false)
        setMobileFinancialOpen(false)
      } else {
        setDesktopImportOpen(false)
        setDesktopExportOpen(false)
        setDesktopFinancialOpen(false)
      }
    }

    syncMobileState(mediaQuery.matches)

    const handleChange = (event: MediaQueryListEvent) => syncMobileState(event.matches)
    mediaQuery.addEventListener('change', handleChange)

    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    if (userMenuOpen) userMenuFirstItemRef.current?.focus()
  }, [userMenuOpen])

  useEffect(() => {
    if (!userMenuOpen) return
    function handleOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) setUserMenuOpen(false)
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setUserMenuOpen(false)
      userMenuButtonRef.current?.focus()
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [userMenuOpen])

  function closeMobileMenus() {
    setMobileNavOpen(false)
    setMobileImportOpen(false)
    setDesktopImportOpen(false)
    setMobileExportOpen(false)
    setDesktopExportOpen(false)
    setMobileFinancialOpen(false)
    setDesktopFinancialOpen(false)
  }

  async function handleSignOut() {
    setUserMenuOpen(false)
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-shell">
      <a href="#app-main-content" className="app-skip-link">Ir para o conteúdo principal</a>

      <HeaderInfoBar />

      <header className="app-header">
        <div className="app-header__content">
          <button className="app-header__brand" onClick={() => navigate('/painel')} type="button">
            <img className="app-header__brand-logo" src="/branding/vela-mark-dark.svg" alt="Vela" />
            <div className="app-header__titles">
              <div className="app-header__eyebrow">Vela</div>
              <div className="app-header__subtitle">importação, exportação e faturamento</div>
            </div>
          </button>

          <div className="app-header__actions">
            <InternalNotificationBell />
            <div ref={userMenuRef} className="relative">
              <button
                ref={userMenuButtonRef}
                type="button"
                className="app-header__user-menu"
                aria-expanded={userMenuOpen}
                aria-controls="app-user-dropdown"
                onClick={() => setUserMenuOpen((current) => !current)}
              >
              <span className="app-user-pill__icon" aria-hidden="true">
                <User size={14} />
              </span>
              <span className="app-user-pill__name">{profile?.full_name ?? 'Usuário'}</span>
              </button>
              {userMenuOpen ? (
                <div id="app-user-dropdown" className="app-header__user-dropdown">
                  <button ref={userMenuFirstItemRef} type="button" onClick={() => { setUserMenuOpen(false); navigate('/perfil') }}>
                    <UserCircle size={14} aria-hidden="true" />
                    Meu perfil
                  </button>
                  <button type="button" onClick={() => void handleSignOut()}>
                    <LogOut size={14} aria-hidden="true" />
                    Sair
                  </button>
                </div>
              ) : null}
            </div>

          </div>
        </div>

      </header>

      <div className="app-nav-bar">
        <div className="app-nav-mobile-bar">
          <button
            type="button"
            className="app-nav-toggle"
            aria-expanded={mobileNavOpen}
            aria-controls="app-primary-navigation"
            onClick={() => setMobileNavOpen((current) => !current)}
          >
            {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
            Menu
          </button>
        </div>

        <nav id="app-primary-navigation" className={cn('app-nav-scroll', mobileNavOpen && 'app-nav-scroll--open')}>
          {primaryNavItemsWithBadges.slice(0, 2).map((item) => (
            <TopNavLink key={item.to} {...item} onNavigate={closeMobileMenus} />
          ))}

          <TopNavDropdownMenu
            label="Importação"
            icon={FileSpreadsheet}
            items={importNavItemsWithBadges}
            isActive={isImportSectionActive}
            isMobile={isMobileNav}
            desktopOpen={desktopImportOpen}
            mobileOpen={mobileImportOpen}
            onOpenDesktop={() => setDesktopImportOpen(true)}
            onCloseDesktop={() => setDesktopImportOpen(false)}
            onToggleMobile={() => setMobileImportOpen((current) => !current)}
            onNavigate={closeMobileMenus}
          />

          <TopNavDropdownMenu
            label="Exportação"
            icon={Package}
            items={exportNavItemsWithBadges}
            isActive={isExportSectionActive}
            isMobile={isMobileNav}
            desktopOpen={desktopExportOpen}
            mobileOpen={mobileExportOpen}
            onOpenDesktop={() => setDesktopExportOpen(true)}
            onCloseDesktop={() => setDesktopExportOpen(false)}
            onToggleMobile={() => setMobileExportOpen((current) => !current)}
            onNavigate={closeMobileMenus}
          />

          {primaryNavItemsWithBadges.slice(2).map((item) => (
            <TopNavLink key={item.to} {...item} onNavigate={closeMobileMenus} />
          ))}

          <TopNavDropdownMenu
            label="Financeiro"
            icon={DollarSign}
            items={financialNavItemsWithBadges}
            isActive={isFinancialSectionActive}
            isMobile={isMobileNav}
            desktopOpen={desktopFinancialOpen}
            mobileOpen={mobileFinancialOpen}
            onOpenDesktop={() => setDesktopFinancialOpen(true)}
            onCloseDesktop={() => setDesktopFinancialOpen(false)}
            onToggleMobile={() => setMobileFinancialOpen((current) => !current)}
            onNavigate={closeMobileMenus}
          />

          <TopNavLink {...reportsNavItem} onNavigate={closeMobileMenus} />

          {isAdmin && <TopNavLink {...adminNavItem} onNavigate={closeMobileMenus} />}
        </nav>
      </div>

      <main id="app-main-content" className="app-main">
        <ErrorBoundary variant="route" resetKey={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  )
}

function TopNavLink({
  to,
  label,
  icon: Icon,
  badge,
  alert,
  onNavigate,
}: {
  to: string
  label: string
  icon: React.ComponentType<{ size?: number }>
  badge?: number
  alert?: boolean
  onNavigate?: () => void
}) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) => cn('app-nav-link', isActive && 'active')}
    >
      <Icon size={18} />
      {label}
      {alert ? <NavAlertDot /> : badge ? <NavBadge count={badge} /> : null}
    </NavLink>
  )
}

function TopNavDropdownMenu({
  label,
  icon: Icon,
  items,
  isActive,
  isMobile,
  desktopOpen,
  mobileOpen,
  onOpenDesktop,
  onCloseDesktop,
  onToggleMobile,
  onNavigate,
}: {
  label: string
  icon: React.ComponentType<{ size?: number }>
  items: NavItem[]
  isActive: boolean
  isMobile: boolean
  desktopOpen: boolean
  mobileOpen: boolean
  onOpenDesktop: () => void
  onCloseDesktop: () => void
  onToggleMobile: () => void
  onNavigate?: () => void
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const isOpen = isMobile ? mobileOpen : desktopOpen
  const indicator = getNavIndicator(items)

  return (
    <div
      className={cn('app-nav-dropdown', isActive && 'active', isOpen && 'open')}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
        if (isMobile) return
        onCloseDesktop()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && isOpen) {
          event.stopPropagation()
          if (isMobile) {
            onToggleMobile()
          } else {
            onCloseDesktop()
          }
          triggerRef.current?.focus()
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={cn('app-nav-link', 'app-nav-link--button', (isActive || isOpen) && 'active')}
        aria-expanded={isOpen}
        aria-controls={`app-nav-${label.toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '-')}`}
        onClick={() => {
          if (isMobile) {
            onToggleMobile()
          } else {
            if (isOpen) onCloseDesktop()
            else onOpenDesktop()
          }
        }}
      >
        <Icon size={18} />
        {label}
        {indicator.type === 'alert' ? <NavAlertDot label={`${label}: alerta pendente`} /> : null}
        {indicator.type === 'badge' ? <NavBadge count={indicator.count} /> : null}
        <ChevronDown size={16} className="app-nav-dropdown__chevron" />
      </button>

      <div id={`app-nav-${label.toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '-')}`} className="app-nav-dropdown__menu" aria-label={label}>
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) => cn('app-nav-dropdown__item', isActive && 'active')}
          >
            <item.icon size={16} />
            {item.label}
            {item.alert ? <NavAlertDot /> : item.badge ? <NavBadge count={item.badge} /> : null}
          </NavLink>
        ))}
      </div>
    </div>
  )
}

function NavAlertDot({ label = 'Alerta pendente' }: { label?: string }) {
  return <span className="app-nav-alert-dot" aria-label={label} />
}

function NavBadge({ count, label }: { count: number; label?: string }) {
  const display = count > 99 ? '99+' : count
  return (
    <span
      className="app-nav-badge"
      aria-label={label ? `${display} ${label}` : String(display)}
    >
      {display}
    </span>
  )
}

function isPathActive(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`)
}

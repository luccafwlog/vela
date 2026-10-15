import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Check,
  ChevronDown,
  DollarSign,
  FileSpreadsheet,
  LogOut,
  Menu,
  Package,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelTop,
  User,
  UserCircle,
  X,
} from 'lucide-react'
import { ErrorBoundary } from '../ErrorBoundary'
import { useAuth } from '../../hooks/useAuth'
import { useOperationalCounts } from '../../hooks/useOperationalCounts'
import { AppVersionBadge } from './AppVersionBadge'
import { HeaderInfoBar } from './HeaderInfoBar'
import { InternalNotificationBell } from './InternalNotificationBell'
import { NAV_COLLAPSE_WIDTH, useMobileNav } from './useMobileNav'
import { NAV_POSITION_OPTIONS, useNavPosition, type NavPosition } from './useNavPosition'
import { cn } from '../../lib/utils'
import { departmentLabel } from '../../lib/departmentLabel'
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

const NAV_POSITION_ICONS: Record<NavPosition, React.ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' }>> = {
  top: PanelTop,
  fixed: PanelLeft,
  collapsed: PanelLeftClose,
  expandable: PanelLeftOpen,
}

export function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { profile, signOut, isAdmin } = useAuth()
  const counts = useOperationalCounts()
  const { open: mobileNavOpen, setOpen: setMobileNavOpen, toggleRef: mobileNavToggleRef, navRef: mobileNavRef } = useMobileNav()
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
  const focusAccountAfterLayoutRef = useRef(false)
  const [navPosition, setNavPosition] = useNavPosition()
  // A lateral só existe acima de 1100 px; abaixo, toda posição usa o Menu.
  const sidebar = navPosition !== 'top' && !isMobileNav
  // Na lateral fixa e na expansível os grupos são lista aberta no próprio
  // menu (o mesmo comportamento do Menu do celular); na recolhida abrem ao lado.
  const sidebarGroupsAsList = sidebar && navPosition !== 'collapsed'
  const groupsAsList = isMobileNav || sidebarGroupsAsList
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

  // Na lateral em lista, o grupo da tela atual abre ao chegar nela ou ao
  // trocar para essa posição; depois a pessoa abre e fecha como quiser.
  const sidebarListKey = sidebarGroupsAsList ? location.pathname : null
  const [openedForSidebarKey, setOpenedForSidebarKey] = useState<string | null>(null)
  if (sidebarListKey !== openedForSidebarKey) {
    setOpenedForSidebarKey(sidebarListKey)
    if (sidebarListKey !== null) {
      if (isImportSectionActive) setMobileImportOpen(true)
      if (isExportSectionActive) setMobileExportOpen(true)
      if (isFinancialSectionActive) setMobileFinancialOpen(true)
    }
  }

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${NAV_COLLAPSE_WIDTH}px)`)
    const syncMobileState = (matches: boolean, resetGroups = true) => {
      setIsMobileNav(matches)
      // O menu em si fecha em useMobileNav; aqui só os grupos internos.
      if (!resetGroups) return
      if (!matches) {
        setMobileImportOpen(false)
        setMobileExportOpen(false)
        setMobileFinancialOpen(false)
      } else {
        setDesktopImportOpen(false)
        setDesktopExportOpen(false)
        setDesktopFinancialOpen(false)
      }
    }

    // Na montagem não há grupo aberto pela pessoa para fechar; o da tela
    // atual, aberto na lateral, continua aberto.
    syncMobileState(mediaQuery.matches, false)

    const handleChange = (event: MediaQueryListEvent) => syncMobileState(event.matches)
    mediaQuery.addEventListener('change', handleChange)

    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  // Trocar a posição remonta a conta em outro lugar da tela; o foco vai para
  // o novo botão da conta, de onde a escolha foi feita.
  useEffect(() => {
    if (!focusAccountAfterLayoutRef.current) return
    focusAccountAfterLayoutRef.current = false
    userMenuButtonRef.current?.focus()
  }, [navPosition])

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
    setDesktopImportOpen(false)
    setDesktopExportOpen(false)
    setDesktopFinancialOpen(false)
    // Na lateral em lista, os grupos continuam como a pessoa deixou.
    if (sidebarGroupsAsList) return
    setMobileImportOpen(false)
    setMobileExportOpen(false)
    setMobileFinancialOpen(false)
  }

  function chooseNavPosition(next: NavPosition) {
    setUserMenuOpen(false)
    closeMobileMenus()
    if (next === navPosition) {
      userMenuButtonRef.current?.focus()
      return
    }
    focusAccountAfterLayoutRef.current = true
    setNavPosition(next)
  }

  async function handleSignOut() {
    setUserMenuOpen(false)
    await signOut()
    navigate('/login', { replace: true })
  }

  const userName = profile?.full_name ?? 'Usuário'

  const navigationItems = (
    <>
      {primaryNavItemsWithBadges.slice(0, 2).map((item) => (
        <TopNavLink key={item.to} {...item} onNavigate={closeMobileMenus} />
      ))}

      <TopNavDropdownMenu
        label="Importação"
        icon={FileSpreadsheet}
        items={importNavItemsWithBadges}
        isActive={isImportSectionActive}
        isMobile={groupsAsList}
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
        isMobile={groupsAsList}
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
        isMobile={groupsAsList}
        desktopOpen={desktopFinancialOpen}
        mobileOpen={mobileFinancialOpen}
        onOpenDesktop={() => setDesktopFinancialOpen(true)}
        onCloseDesktop={() => setDesktopFinancialOpen(false)}
        onToggleMobile={() => setMobileFinancialOpen((current) => !current)}
        onNavigate={closeMobileMenus}
      />

      <TopNavLink {...reportsNavItem} onNavigate={closeMobileMenus} />

      {isAdmin && <TopNavLink {...adminNavItem} onNavigate={closeMobileMenus} />}
    </>
  )

  const brand = (
    <button className="app-header__brand" onClick={() => navigate('/painel')} type="button" aria-label="Vela — ir para o Painel">
      <img className="app-header__brand-logo" src="/branding/vela-mark-dark.svg" alt="" />
      <span className="app-header__wordmark" aria-hidden="true">Vela</span>
    </button>
  )

  // A posição do menu muda só aqui, no menu da conta.
  const accountMenu = (
    <div ref={userMenuRef} className="relative">
      <button
        ref={userMenuButtonRef}
        type="button"
        className="app-header__user-menu"
        aria-expanded={userMenuOpen}
        aria-controls="app-user-dropdown"
        data-label={sidebar ? userName : undefined}
        onClick={() => setUserMenuOpen((current) => !current)}
      >
        <span className="app-user-pill__icon" aria-hidden="true">
          <User size={16} />
        </span>
        {sidebar ? (
          <span className="app-user-pill__text">
            <span className="app-user-pill__name">{userName}</span>
            <span className="app-user-pill__meta">{departmentLabel(profile?.role)}</span>
          </span>
        ) : (
          <span className="app-user-pill__name">{userName}</span>
        )}
        <ChevronDown size={14} aria-hidden="true" className="app-header__user-chevron" />
      </button>
      {userMenuOpen ? (
        <div id="app-user-dropdown" className="app-header__user-dropdown">
          <div className="app-header__user-identity">
            <span className="app-header__user-identity-name">{userName}</span>
            <span className="app-header__user-identity-meta">{departmentLabel(profile?.role)}</span>
          </div>
          <button ref={userMenuFirstItemRef} type="button" onClick={() => { setUserMenuOpen(false); navigate('/perfil') }}>
            <UserCircle size={16} aria-hidden="true" />
            Meu perfil
          </button>
          <div className="app-header__user-section" role="group" aria-labelledby="app-nav-position-title">
            <span id="app-nav-position-title" className="app-header__user-section-title">Posição do menu</span>
            {NAV_POSITION_OPTIONS.map((option) => {
              const Icon = NAV_POSITION_ICONS[option.value]
              const selected = option.value === navPosition
              return (
                <button key={option.value} type="button" aria-pressed={selected} onClick={() => chooseNavPosition(option.value)}>
                  <Icon size={16} aria-hidden="true" />
                  <span className="app-header__user-option">
                    {option.label}
                    <span className="app-header__user-option-hint">{option.hint}</span>
                  </span>
                  {selected ? <Check size={16} aria-hidden="true" className="app-header__user-option-check" /> : null}
                </button>
              )
            })}
            {isMobileNav && navPosition !== 'top' ? (
              <p className="app-header__user-note">Nesta largura de tela o menu fica no botão Menu.</p>
            ) : null}
          </div>
          <button type="button" className="app-header__user-signout" onClick={() => void handleSignOut()}>
            <LogOut size={16} aria-hidden="true" />
            Sair
          </button>
          <AppVersionBadge />
        </div>
      ) : null}
    </div>
  )

  const main = (
    <main id="app-main-content" className="app-main">
      <ErrorBoundary variant="route" resetKey={location.pathname}>
        <Outlet />
      </ErrorBoundary>
    </main>
  )

  if (sidebar) {
    return (
      <div className={cn('app-shell app-shell--vela app-shell--sidebar', `app-shell--sidebar-${navPosition}`)}>
        <a href="#app-main-content" className="app-skip-link">Ir para o conteúdo principal</a>

        <aside className={cn('app-sidebar', `app-sidebar--${navPosition}`)} aria-label="Menu do Vela">
          <div className="app-sidebar__panel">
            <div className="app-sidebar__brand">{brand}</div>
            <nav id="app-primary-navigation" aria-label="Navegação principal" className="app-sidebar__nav">
              {navigationItems}
            </nav>
            <div className="app-sidebar__footer">
              <InternalNotificationBell variant="sidebar" />
              {accountMenu}
            </div>
          </div>
        </aside>

        <div className="app-shell__column">
          <HeaderInfoBar />
          {main}
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell app-shell--vela">
      <a href="#app-main-content" className="app-skip-link">Ir para o conteúdo principal</a>

      <HeaderInfoBar />

      {/* Uma barra só (etapa 02): marca, navegação e conta. Abaixo de 1100 px
          a navegação vira a lista do botão Menu, aberta logo abaixo da barra. */}
      <header className="app-header">
        <div className="app-header__content">
          {brand}

          <nav
            ref={mobileNavRef}
            id="app-primary-navigation"
            aria-label="Navegação principal"
            className={cn('app-nav-scroll', mobileNavOpen && 'app-nav-scroll--open')}
          >
            {navigationItems}
          </nav>

          <div className="app-header__actions">
            <InternalNotificationBell />
            {accountMenu}

            <button
              ref={mobileNavToggleRef}
              type="button"
              className="app-nav-toggle"
              aria-expanded={mobileNavOpen}
              aria-controls="app-primary-navigation"
              onClick={() => setMobileNavOpen((current) => !current)}
            >
              {mobileNavOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
              <span className="app-nav-toggle__label">Menu</span>
            </button>
          </div>
        </div>
      </header>

      {main}
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
      data-label={label}
    >
      <Icon size={16} aria-hidden="true" />
      <span className="app-nav-link__label">{label}</span>
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
        data-label={label}
        onClick={() => {
          if (isMobile) {
            onToggleMobile()
          } else {
            if (isOpen) onCloseDesktop()
            else onOpenDesktop()
          }
        }}
      >
        <Icon size={16} aria-hidden="true" />
        <span className="app-nav-link__label">{label}</span>
        {indicator.type === 'alert' ? <NavAlertDot /> : null}
        {indicator.type === 'badge' ? <NavBadge count={indicator.count} /> : null}
        <ChevronDown size={14} aria-hidden="true" className="app-nav-dropdown__chevron" />
      </button>

      <div id={`app-nav-${label.toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '-')}`} className="app-nav-dropdown__menu" aria-label={label}>
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) => cn('app-nav-dropdown__item', isActive && 'active')}
          >
            <item.icon size={16} aria-hidden="true" />
            {item.label}
            {item.alert ? <NavAlertDot /> : item.badge ? <NavBadge count={item.badge} /> : null}
          </NavLink>
        ))}
      </div>
    </div>
  )
}

// O ponto e o número são só visuais; o leitor de tela recebe o mesmo fato
// por extenso, junto do nome do link ou do grupo.
function NavAlertDot({ label = 'alerta pendente' }: { label?: string }) {
  return (
    <>
      <span className="app-nav-alert-dot" aria-hidden="true" />
      <span className="sr-only">{`, ${label}`}</span>
    </>
  )
}

function NavBadge({ count }: { count: number }) {
  const display = count > 99 ? '99+' : String(count)
  return (
    <>
      <span className="app-nav-badge" aria-hidden="true">{display}</span>
      <span className="sr-only">{`, ${display} ${count === 1 ? 'pendente' : 'pendentes'}`}</span>
    </>
  )
}

function isPathActive(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`)
}

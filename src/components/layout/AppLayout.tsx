import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell,
  Check,
  ChevronDown,
  DollarSign,
  ExternalLink,
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
  Users,
  Ship,
  X,
} from 'lucide-react'
import { ErrorBoundary } from '../ErrorBoundary'
import { useAuth } from '../../hooks/useAuth'
import { useOperationalCounts } from '../../hooks/useOperationalCounts'
import { AppVersionBadge } from './AppVersionBadge'
import { InternalNotificationBell } from './InternalNotificationBell'
import { NAV_COLLAPSE_WIDTH, useMobileNav } from './useMobileNav'
import { NAV_POSITION_OPTIONS, useNavPosition, type NavPosition } from './useNavPosition'
import { cn } from '../../lib/utils'
import { departmentLabel } from '../../lib/departmentLabel'
import {
  activeNavItem,
  adminNavItem,
  buildNavGroups,
  getNavIndicator,
  painelNavItem,
  reportsNavItem,
  type NavGroupId,
  type NavItem,
} from './appLayoutNav'

const NAV_GROUP_ICONS: Record<NavGroupId, React.ComponentType<{ size?: number }>> = {
  viagens: Ship,
  importacao: FileSpreadsheet,
  exportacao: Package,
  clientes: Users,
  alertas: Bell,
  financeiro: DollarSign,
}

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
  // Grupos abertos: na lista (Menu do celular e lateral em lista) vários ao
  // mesmo tempo; no menu suspenso da barra, um por vez.
  const [mobileOpenGroups, setMobileOpenGroups] = useState<ReadonlySet<NavGroupId>>(() => new Set())
  const [desktopOpenGroup, setDesktopOpenGroup] = useState<NavGroupId | null>(null)
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
  const navGroups = buildNavGroups(counts)
  const activeGroupId = navGroups.find((group) => activeNavItem(group.items, location.pathname))?.id ?? null
  const setMobileGroup = (id: NavGroupId, open: boolean) => setMobileOpenGroups((current) => {
    if (current.has(id) === open) return current
    const next = new Set(current)
    if (open) next.add(id)
    else next.delete(id)
    return next
  })

  // Na lateral em lista, o grupo da tela atual abre ao chegar nela ou ao
  // trocar para essa posição; depois a pessoa abre e fecha como quiser.
  const sidebarListKey = sidebarGroupsAsList ? location.pathname : null
  const [openedForSidebarKey, setOpenedForSidebarKey] = useState<string | null>(null)
  if (sidebarListKey !== openedForSidebarKey) {
    setOpenedForSidebarKey(sidebarListKey)
    if (sidebarListKey !== null && activeGroupId) setMobileGroup(activeGroupId, true)
  }

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${NAV_COLLAPSE_WIDTH}px)`)
    const syncMobileState = (matches: boolean, resetGroups = true) => {
      setIsMobileNav(matches)
      // O menu em si fecha em useMobileNav; aqui só os grupos internos.
      if (!resetGroups) return
      if (!matches) setMobileOpenGroups(new Set())
      else setDesktopOpenGroup(null)
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
    setDesktopOpenGroup(null)
    // Na lateral em lista, os grupos continuam como a pessoa deixou.
    if (sidebarGroupsAsList) return
    setMobileOpenGroups(new Set())
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
      <TopNavLink {...painelNavItem} onNavigate={closeMobileMenus} />

      {navGroups.map((group) => (
        <TopNavDropdownMenu
          key={group.id}
          label={group.label}
          icon={NAV_GROUP_ICONS[group.id]}
          items={group.items}
          pathname={location.pathname}
          isActive={group.id === activeGroupId}
          isMobile={groupsAsList}
          desktopOpen={desktopOpenGroup === group.id}
          mobileOpen={mobileOpenGroups.has(group.id)}
          onOpenDesktop={() => setDesktopOpenGroup(group.id)}
          onCloseDesktop={() => setDesktopOpenGroup((current) => (current === group.id ? null : current))}
          onToggleMobile={() => setMobileGroup(group.id, !mobileOpenGroups.has(group.id))}
          onNavigate={closeMobileMenus}
        />
      ))}

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
          {main}
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell app-shell--vela">
      <a href="#app-main-content" className="app-skip-link">Ir para o conteúdo principal</a>

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
  pathname,
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
  pathname: string
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
  // O item da tela é o de endereço mais longo: /taxas-locais/tabelas não
  // marca também Taxas Locais.
  const current = activeNavItem(items, pathname)

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
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={cn('app-nav-dropdown__item', current === item && 'active')}
            aria-current={current === item ? 'page' : undefined}
            {...(item.external ? { target: '_blank', rel: 'noreferrer' } : {})}
          >
            <item.icon size={16} aria-hidden="true" />
            {item.label}
            {item.external ? <><ExternalLink size={12} aria-hidden="true" /><span className="sr-only"> (abre em outra aba)</span></> : null}
            {item.alert ? <NavAlertDot /> : item.badge ? <NavBadge count={item.badge} /> : null}
          </Link>
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

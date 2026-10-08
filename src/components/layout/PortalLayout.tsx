import { NavLink, Outlet } from 'react-router-dom'
import { Building2, BookOpen, FileText, LayoutDashboard, LogOut, Menu, Package, ShieldCheck, User, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { usePortalAuth } from '../../hooks/usePortalAuth'
import { usePortalScope } from '../../hooks/usePortalScope'
import { isPortalReadOnly, portalPath } from '../../services/portalScope'
import { NotificationBell } from '../portal/NotificationBell'
import { cn, formatCnpjCpf } from '../../lib/utils'
import { useMobileNav } from './useMobileNav'

export function PortalLayout() {
  const { overview: authOverview, signOut, isSigningOut } = usePortalAuth()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)
  const overview = scope.overview ?? authOverview
  const customerName = overview?.customer_name ?? 'Cliente'
  const customerDocument = formatCnpjCpf(overview?.customer_cnpj_cpf)
  const portalNavItems = [
    { to: portalPath(scope), label: 'Painel', icon: LayoutDashboard, end: true },
    { to: portalPath(scope, '/billing'), label: 'Faturas', icon: FileText, end: false },
    { to: portalPath(scope, '/operacao'), label: 'BLs e Containers', icon: Package, end: false },
    { to: portalPath(scope, '/desbloqueio-ce'), label: 'Desbloqueio de CE', icon: ShieldCheck, end: false },
    { to: portalPath(scope, '/informacoes'), label: 'Informações', icon: BookOpen, end: false },
    { to: portalPath(scope, '/perfil'), label: 'Perfil', icon: User, end: false },
  ]
  const { open: mobileNavOpen, setOpen: setMobileNavOpen, toggleRef: mobileNavToggleRef, navRef: mobileNavRef } = useMobileNav()

  // Uma barra de 64 px (etapa 02): marca FWLOG, navegação e conta. O atalho
  // de perfil por ícone saiu porque repetia o item Perfil da navegação. No
  // Modo Inspeção a saída é a faixa persistente do wrapper ("Sair da
  // inspeção"); o shell não repete um segundo "Sair" com outro destino.
  return (
    <div className="app-shell app-shell--portal">
      <a href="#portal-main-content" className="app-skip-link">Ir para o conteúdo principal</a>
      <header className="app-header">
        <div className="app-header__content">
          <NavLink to={portalPath(scope)} className="app-header__brand">
            <img className="app-header__brand-logo app-header__brand-logo--fwlog" src="/branding/fwlog-logo-white.png" alt="Portal Fwlog" />
          </NavLink>

          <nav
            ref={mobileNavRef}
            id="portal-primary-navigation"
            className={cn('app-nav-scroll', mobileNavOpen && 'app-nav-scroll--open')}
            aria-label="Portal"
          >
            {mobileNavOpen ? (
              <div className="app-nav-account">
                <span className="app-nav-account__name">{customerName}</span>
                {customerDocument ? <span className="app-nav-account__meta">CNPJ {customerDocument}</span> : null}
              </div>
            ) : null}
            {portalNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMobileNavOpen(false)}
                className={({ isActive }) => cn('app-nav-link', isActive && 'active')}
              >
                <item.icon size={16} aria-hidden="true" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="app-header__actions">
            <NotificationBell />

            <div className="app-user-pill" title={customerDocument ? `${customerName} · CNPJ ${customerDocument}` : customerName}>
              <span className="app-user-pill__icon" aria-hidden="true">
                <Building2 size={16} />
              </span>
              <span className="app-user-pill__name">{customerName}</span>
            </div>

            {!readOnly ? (
              <Button
                className="app-header__logout"
                variant="ghost"
                loading={isSigningOut}
                loadingLabel="Saindo..."
                onClick={() => void signOut()}
              >
                <LogOut size={16} aria-hidden="true" />
                Sair
              </Button>
            ) : null}

            <button
              ref={mobileNavToggleRef}
              type="button"
              className="app-nav-toggle"
              aria-expanded={mobileNavOpen}
              aria-controls="portal-primary-navigation"
              onClick={() => setMobileNavOpen((current) => !current)}
            >
              {mobileNavOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
              <span className="app-nav-toggle__label">Menu</span>
            </button>
          </div>
        </div>
      </header>

      <main id="portal-main-content" className="app-main">
        <Outlet />
      </main>
    </div>
  )
}

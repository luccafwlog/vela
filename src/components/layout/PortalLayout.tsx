import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Building2, FileText, LayoutDashboard, LogOut, Menu, Package, User, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { usePortalAuth } from '../../hooks/usePortalAuth'
import { usePortalScope } from '../../hooks/usePortalScope'
import { isPortalReadOnly, portalPath } from '../../services/portalScope'
import { NotificationBell } from '../portal/NotificationBell'
import { cn, formatCnpjCpf } from '../../lib/utils'

export function PortalLayout() {
  const { overview: authOverview, signOut } = usePortalAuth()
  const scope = usePortalScope()
  const navigate = useNavigate()
  const readOnly = isPortalReadOnly(scope)
  const overview = scope.overview ?? authOverview
  const portalNavItems = [
    { to: portalPath(scope), label: 'Painel', icon: LayoutDashboard, end: true },
    { to: portalPath(scope, '/billing'), label: 'Faturas', icon: FileText, end: false },
    { to: portalPath(scope, '/operacao'), label: 'BLs e Containers', icon: Package, end: false },
    { to: portalPath(scope, '/perfil'), label: 'Perfil', icon: User, end: false },
  ]
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className="app-shell">
      <a href="#portal-main-content" className="app-skip-link">Ir para o conteúdo principal</a>
      <header className="app-header">
        <div className="app-header__content">
          <NavLink to={portalPath(scope)} className="app-header__brand">
            <img className="app-header__brand-logo" src="/branding/fwlog-logo-white.png" alt="Portal Fwlog" />
            <div className="app-header__titles">
              <div className="app-header__eyebrow">Portal do cliente</div>
              <div className="app-header__subtitle">faturas e operação</div>
            </div>
          </NavLink>

          <div className="app-header__actions">
            <NotificationBell />

            <NavLink
              to={portalPath(scope, '/perfil')}
              aria-label="Perfil"
              className="portal-profile-link"
            >
              <User size={14} />
            </NavLink>

            <div className="app-user-pill" title={formatCnpjCpf(overview?.customer_cnpj_cpf)}>
              <span className="app-user-pill__icon" aria-hidden="true">
                <Building2 size={14} />
              </span>
              <span className="app-user-pill__name">{overview?.customer_name ?? 'Cliente'}</span>
            </div>

            <Button className="app-header__logout" variant="ghost" onClick={() => readOnly ? navigate('/clientes/portal') : void signOut()}>
              <LogOut size={16} />
              Sair
            </Button>
          </div>
        </div>
      </header>

      <div className="app-nav-bar">
        <div className="app-nav-mobile-bar">
          <button
            type="button"
            className="app-nav-toggle"
            aria-expanded={mobileNavOpen}
            aria-controls="portal-primary-navigation"
            onClick={() => setMobileNavOpen((current) => !current)}
          >
            {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
            Menu
          </button>
        </div>

        <nav
          id="portal-primary-navigation"
          className={cn('app-nav-scroll', mobileNavOpen && 'app-nav-scroll--open')}
          aria-label="Portal"
        >
          {portalNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMobileNavOpen(false)}
              className={({ isActive }) => cn('app-nav-link', isActive && 'active')}
            >
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <main id="portal-main-content" className="app-main">
        <Outlet />
      </main>
    </div>
  )
}

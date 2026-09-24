import { Suspense, useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { portalRouteTitle } from './lib/portalPageTitle'
import { PortalProtectedRoute } from './components/layout/PortalProtectedRoute'
import { PortalLayout } from './components/layout/PortalLayout'
import { PortalScopeProvider } from './hooks/usePortalScope'
import { lazyPage } from './lib/lazyPage'
import { matchRoutePreload, type RoutePreloadTable } from './lib/routePreload'
import { markStartupStage, redactVercelTelemetryEvent, vercelTelemetryEnabled } from './lib/telemetry'

const PortalLogin = lazyPage(() => import('./pages/PortalLogin'), 'PortalLogin')
const PortalBilling = lazyPage(() => import('./pages/PortalBilling'), 'PortalBilling')
const PortalOperacao = lazyPage(() => import('./pages/PortalOperacao'), 'PortalOperacao')
const PortalDashboard = lazyPage(() => import('./pages/PortalDashboard'), 'PortalDashboard')
const PortalForgotPassword = lazyPage(() => import('./pages/PortalForgotPassword'), 'PortalForgotPassword')
const PortalResetPassword = lazyPage(() => import('./pages/PortalResetPassword'), 'PortalResetPassword')
const PortalAtivacao = lazyPage(() => import('./pages/PortalAtivacao'), 'PortalAtivacao')
const PortalConfirmarEmail = lazyPage(() => import('./pages/PortalConfirmarEmail'), 'PortalConfirmarEmail')
const PortalProfile = lazyPage(() => import('./pages/PortalProfile'), 'PortalProfile')

function RouteLoading() {
  return (
    <main className="px-6 py-10">
      <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] px-5 py-4 text-sm text-[var(--app-muted)] shadow-[var(--app-shadow)]">
        Carregando tela...
      </div>
    </main>
  )
}

function withSuspense(node: ReactNode) {
  return <Suspense fallback={<RouteLoading />}>{node}</Suspense>
}

function DocumentTitle() {
  const { pathname } = useLocation()
  useEffect(() => {
    document.title = portalRouteTitle(pathname)
  }, [pathname])
  return null
}

const defaultPreload = PortalDashboard.preload

const routePreloads: RoutePreloadTable = [
  ['/portal/login', PortalLogin.preload], ['/portal/esqueci-senha', PortalForgotPassword.preload],
  ['/portal/recuperar-senha', PortalResetPassword.preload], ['/portal/ativar', PortalAtivacao.preload],
  ['/portal/confirmar-email', PortalConfirmarEmail.preload], ['/portal', PortalDashboard.preload],
  ['/portal/billing', PortalBilling.preload], ['/portal/operacao', PortalOperacao.preload],
  ['/portal/perfil', PortalProfile.preload], ['*', defaultPreload],
]

function RoutePreloader() {
  const { pathname } = useLocation()
  useEffect(() => {
    const preload = matchRoutePreload(pathname, routePreloads)
    preload?.()
      .then(() => markStartupStage('route-chunk'))
      .catch(() => {})
  }, [pathname])
  return null
}

export default function AppPortal() {
  return (
    <>
      <DocumentTitle />
      <RoutePreloader />
      <Routes>
        <Route path="/portal/login" element={withSuspense(<PortalLogin />)} />
        <Route path="/portal/esqueci-senha" element={withSuspense(<PortalForgotPassword />)} />
        <Route path="/portal/recuperar-senha" element={withSuspense(<PortalResetPassword />)} />
        <Route path="/portal/ativar" element={withSuspense(<PortalAtivacao />)} />
        <Route path="/portal/confirmar-email" element={withSuspense(<PortalConfirmarEmail />)} />
        <Route element={<PortalProtectedRoute />}>
          <Route element={<PortalScopeProvider />}>
            <Route element={<PortalLayout />}>
              <Route path="/portal" element={withSuspense(<PortalDashboard />)} />
              <Route path="/portal/billing" element={withSuspense(<PortalBilling />)} />
              <Route path="/portal/operacao" element={withSuspense(<PortalOperacao />)} />
              <Route path="/portal/perfil" element={withSuspense(<PortalProfile />)} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/portal" replace />} />
      </Routes>
      {vercelTelemetryEnabled && <Analytics beforeSend={redactVercelTelemetryEvent} />}
    </>
  )
}

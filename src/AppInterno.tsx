import { Suspense, useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { routeTitle } from './lib/pageTitle'
import { AppLayout } from './components/layout/AppLayout'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import { lazyPage } from './lib/lazyPage'
import { matchRoutePreload, type RoutePreloadTable } from './lib/routePreload'
import { resolveLegacyFaturamentoRedirect, resolveTaxasLocaisRedirect, toRouteTarget } from './lib/routeRedirects'
import { markStartupStage, redactVercelTelemetryEvent } from './lib/telemetry'

const Login = lazyPage(() => import('./pages/Login'), 'Login')
const PortalDashboard = lazyPage(() => import('./pages/PortalDashboard'), 'PortalDashboard')
const PortalBilling = lazyPage(() => import('./pages/PortalBilling'), 'PortalBilling')
const PortalOperacao = lazyPage(() => import('./pages/PortalOperacao'), 'PortalOperacao')
const PortalProfile = lazyPage(() => import('./pages/PortalProfile'), 'PortalProfile')
const PortalInspection = lazyPage(() => import('./pages/PortalInspection'), 'PortalInspection')
const Painel = lazyPage(() => import('./pages/Painel'), 'Painel')
const Viagens = lazyPage(() => import('./pages/Viagens'), 'Viagens')
const Bls = lazyPage(() => import('./pages/Bls'), 'Bls')
const Containers = lazyPage(() => import('./pages/Containers'), 'Containers')
const Veiculos = lazyPage(() => import('./pages/Veiculos'), 'Veiculos')
const BlDetalhe = lazyPage(() => import('./pages/BlDetalhe'), 'BlDetalhe')
const Revisao = lazyPage(() => import('./pages/Revisao'), 'Revisao')
const Clientes = lazyPage(() => import('./pages/Clientes'), 'Clientes')
const ClientesPortal = lazyPage(() => import('./pages/ClientesPortal'), 'ClientesPortal')
const ClientesComunicacao = lazyPage(() => import('./pages/ClientesComunicacao'), 'ClientesComunicacao')
const ClienteFicha = lazyPage(() => import('./pages/ClienteFicha'), 'ClienteFicha')
const TaxasLocais = lazyPage(() => import('./pages/TaxasLocais'), 'TaxasLocais')
const TaxasLocaisTabelas = lazyPage(() => import('./pages/TaxasLocaisTabelas'), 'TaxasLocaisTabelas')
const Alertas = lazyPage(() => import('./pages/Alertas'), 'Alertas')
const AlertasRegras = lazyPage(() => import('./pages/AlertasRegras'), 'AlertasRegras')
const Relatorios = lazyPage(() => import('./pages/Relatorios'), 'Relatorios')
const Demurrage = lazyPage(() => import('./pages/Demurrage'), 'Demurrage')
const DemurrageRates = lazyPage(() => import('./pages/DemurrageRates'), 'DemurrageRates')
const Reconciliacao = lazyPage(() => import('./pages/Reconciliacao'), 'Reconciliacao')
const Granite = lazyPage(() => import('./pages/Granite'), 'Granite')
const GraniteRates = lazyPage(() => import('./pages/GraniteRates'), 'GraniteRates')
const EmbarqueVazios = lazyPage(() => import('./pages/EmbarqueVazios'), 'EmbarqueVazios')
const DepotCadastro = lazyPage(() => import('./pages/DepotCadastro'), 'DepotCadastro')
const VaziosImportacao = lazyPage(() => import('./pages/VaziosImportacao'), 'VaziosImportacao')
const BaplieEDI = lazyPage(() => import('./pages/Baplie'), 'Baplie')
const ChegadasSaidas = lazyPage(() => import('./pages/ChegadasSaidas'), 'ChegadasSaidas')
const Admin = lazyPage(() => import('./pages/Admin'), 'Admin')
const Profile = lazyPage(() => import('./pages/Profile'), 'Profile')
const NaoEncontrado = lazyPage(() => import('./pages/NaoEncontrado'), 'NaoEncontrado')
const LineUpTVDisplay = lazyPage(() => import('./pages/LineUpTVDisplay'), 'LineUpTVDisplay')

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
    document.title = routeTitle(pathname)
  }, [pathname])
  return null
}

function LegacyFaturamentoRedirect() {
  const { search } = useLocation()
  return <Navigate to={toRouteTarget(resolveLegacyFaturamentoRedirect(search))} replace />
}

function LegacyCargaSoltaRedirect() {
  const { blId } = useParams<{ blId: string }>()
  return <Navigate to={blId ? `/bls/${blId}` : '/bls'} replace />
}

function TaxasLocaisRoute() {
  const { search } = useLocation()
  const redirect = resolveTaxasLocaisRedirect(search)
  return redirect ? <Navigate to={toRouteTarget(redirect)} replace /> : withSuspense(<TaxasLocais />)
}

const defaultPreload = Painel.preload

const routePreloads: RoutePreloadTable = [
  ['/login', Login.preload], ['/line-up-tv/display', LineUpTVDisplay.preload],
  ['/clientes/portal/inspecao/:customerId', PortalInspection.preload],
  ['/painel', Painel.preload], ['/viagens/:voyageId', Viagens.preload], ['/viagens', Viagens.preload],
  ['/bls/:blId', BlDetalhe.preload], ['/bls', Bls.preload], ['/containers', Containers.preload],
  ['/veiculos', Veiculos.preload], ['/revisao', Revisao.preload],
  ['/clientes/comunicacao', ClientesComunicacao.preload], ['/clientes/portal', ClientesPortal.preload], ['/clientes/:cnpj', ClienteFicha.preload], ['/clientes', Clientes.preload],
  ['/taxas-locais/tabelas', TaxasLocaisTabelas.preload], ['/taxas-locais', TaxasLocais.preload],
  ['/faturamento', TaxasLocais.preload], ['/alertas/regras', AlertasRegras.preload], ['/alertas', Alertas.preload],
  ['/relatorios', Relatorios.preload], ['/demurrage', Demurrage.preload], ['/reconciliacao', Reconciliacao.preload],
  ['/granito/taxas', GraniteRates.preload], ['/granito', Granite.preload], ['/demurrage/taxas', DemurrageRates.preload],
  ['/embarquevazios/depots', DepotCadastro.preload], ['/embarquevazios', EmbarqueVazios.preload],
  ['/vazios-importacao', VaziosImportacao.preload], ['/baplie', BaplieEDI.preload], ['/chegadas-saidas', ChegadasSaidas.preload],
  ['/perfil', Profile.preload], ['/admin/:tab', Admin.preload], ['/admin', Admin.preload],
  ['/', defaultPreload], ['*', defaultPreload],
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

export default function AppInterno() {
  return (
    <>
      <DocumentTitle />
      <RoutePreloader />
      <Routes>
        <Route path="/login" element={withSuspense(<Login />)} />
        <Route element={<ProtectedRoute />}>
          <Route path="/line-up-tv/display" element={withSuspense(<LineUpTVDisplay />)} />
          <Route path="/clientes/portal/inspecao/:customerId/*" element={withSuspense(<PortalInspection />)}>
            <Route index element={withSuspense(<PortalDashboard />)} />
            <Route path="billing" element={withSuspense(<PortalBilling />)} />
            <Route path="operacao" element={withSuspense(<PortalOperacao />)} />
            <Route path="perfil" element={withSuspense(<PortalProfile />)} />
          </Route>
          <Route element={<AppLayout />}>
            <Route index element={<Navigate to="/painel" replace />} />
            <Route path="/painel" element={withSuspense(<Painel />)} />
            <Route path="/viagens" element={withSuspense(<Viagens />)} />
            <Route path="/viagens/:voyageId" element={withSuspense(<Viagens />)} />
            <Route path="/bls" element={withSuspense(<Bls />)} />
            <Route path="/bls/:blId" element={withSuspense(<BlDetalhe />)} />
            <Route path="/containers" element={withSuspense(<Containers />)} />
            <Route path="/veiculos" element={withSuspense(<Veiculos />)} />
            <Route path="/revisao" element={withSuspense(<Revisao />)} />
            <Route path="/clientes" element={withSuspense(<Clientes />)} />
            <Route path="/clientes/portal" element={withSuspense(<ClientesPortal />)} />
            <Route element={<ProtectedRoute permission="customer_communications" />}>
              <Route path="/clientes/comunicacao" element={withSuspense(<ClientesComunicacao />)} />
            </Route>
            <Route path="/clientes/:cnpj" element={withSuspense(<ClienteFicha />)} />
            <Route path="/taxas-locais/tabelas" element={withSuspense(<TaxasLocaisTabelas />)} />
            <Route path="/taxas-locais" element={<TaxasLocaisRoute />} />
            <Route path="/faturamento" element={<LegacyFaturamentoRedirect />} />
            <Route path="/alertas/regras" element={withSuspense(<AlertasRegras />)} />
            <Route path="/alertas" element={withSuspense(<Alertas />)} />
            <Route path="/relatorios" element={withSuspense(<Relatorios />)} />
            <Route path="/demurrage" element={withSuspense(<Demurrage />)} />
            <Route path="/demurrage/invoices" element={<Navigate to="/demurrage" replace />} />
            <Route path="/demurrage/reconciliacao" element={<Navigate to="/reconciliacao" replace />} />
            <Route path="/reconciliacao" element={withSuspense(<Reconciliacao />)} />
            <Route path="/granito" element={withSuspense(<Granite />)} />
            <Route path="/granito/taxas" element={withSuspense(<GraniteRates />)} />
            <Route path="/demurrage/taxas" element={withSuspense(<DemurrageRates />)} />
            <Route path="/embarquevazios" element={withSuspense(<EmbarqueVazios />)} />
            <Route path="/embarquevazios/depots" element={withSuspense(<DepotCadastro />)} />
            <Route path="/vazios" element={<Navigate to="/embarquevazios" replace />} />
            <Route path="/carga-solta" element={<Navigate to="/bls" replace />} />
            <Route path="/carga-solta/:blId" element={<LegacyCargaSoltaRedirect />} />
            <Route path="/manifestos" element={<Navigate to="/bls" replace />} />
            <Route path="/vazios-importacao" element={withSuspense(<VaziosImportacao />)} />
            <Route path="/baplie" element={withSuspense(<BaplieEDI />)} />
            <Route path="/chegadas-saidas" element={withSuspense(<ChegadasSaidas />)} />
            <Route path="/perfil" element={withSuspense(<Profile />)} />
            <Route path="*" element={withSuspense(<NaoEncontrado />)} />
          </Route>
        </Route>
        <Route element={<ProtectedRoute adminOnly />}>
          <Route element={<AppLayout />}>
            <Route path="/admin" element={withSuspense(<Admin />)} />
            <Route path="/admin/:tab" element={withSuspense(<Admin />)} />
          </Route>
        </Route>
      </Routes>
      <Analytics beforeSend={redactVercelTelemetryEvent} />
    </>
  )
}

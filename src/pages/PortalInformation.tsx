import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Banknote, Container, Clock, Users, Headphones, Search } from 'lucide-react'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Field, Select } from '../components/ui/Input'
import { TabButton } from '../components/ui/TabButton'
import { TabList } from '../components/ui/TabList'
import { usePortalInformation } from '../hooks/usePortalInformation'
import { usePortalScope } from '../hooks/usePortalScope'
import { isPortalServicePort, normalizeInformationPort, portalServicePorts } from '../services/informationPort'
import { portalPath } from '../services/portalScope'
import { ReturnSection } from '../components/portal/information/ReturnSection'
import { LocalFeesSection, DemurrageSection } from '../components/portal/information/ReferenceSections'
import { AgentsSection, ContactsSection } from '../components/portal/information/ContactSections'
import { TrackingSection } from '../components/portal/information/TrackingSection'

const sections = [
  { key: 'taxas', title: 'Taxas Locais', description: 'Tabelas oficiais de importação e itens por perfil de carga.', icon: Banknote },
  { key: 'devolucao', title: 'Devolução', description: 'Depots, agendamento e orientação para seus containers.', icon: Container },
  { key: 'demurrage', title: 'Demurrage', description: 'Tarifa geral, períodos de cobrança e orientações.', icon: Clock },
  { key: 'agentes', title: 'Agentes por porto', description: 'Contatos dos agentes nos portos de atendimento.', icon: Users },
  { key: 'atendimento', title: 'Contato', description: 'Canais e orientações para falar com a FWLOG.', icon: Headphones },
  { key: 'tracking', title: 'Tracking', description: 'Consulte seu B/L no site oficial do armador.', icon: Search },
]

export function PortalInformation() {
  const scope = usePortalScope()
  const navigate = useNavigate()
  const { section } = useParams()
  const [params, setParams] = useSearchParams()
  const query = usePortalInformation()
  const current = sections.find((item) => item.key === section)
  const requestedPod = normalizeInformationPort(params.get('pod')) ?? ''
  const restrictedPorts = current?.key === 'taxas' || current?.key === 'devolucao'
  const pod = restrictedPorts && !isPortalServicePort(requestedPod) ? '' : requestedPod
  const suffix = params.toString() ? `?${params}` : ''
  const path = (key = '') => portalPath(scope, `/informacoes${key ? `/${key}` : ''}${suffix}`)
  const tabId = (key: string) => `informacoes-tab-${key}`

  // Filtro por POD na URL, em linha com os filtros da própria seção (sem
  // cartão em volta).
  const podFilter = current && ['taxas', 'devolucao', 'agentes'].includes(current.key) && query.data ? (
    <div className="w-full sm:w-72">
      <Field label="Porto de destino (POD)">
        <Select value={pod} onChange={(event) => setParams((previous) => { const next = new URLSearchParams(previous); if (event.target.value) next.set('pod', event.target.value); else next.delete('pod'); next.delete('containerId'); next.delete('bl'); return next })}>
          <option value="">{restrictedPorts ? 'Todos os portos atendidos' : 'Todos os portos'}</option>
          {(restrictedPorts ? portalServicePorts : query.data.ports).map((port) => <option key={port.code} value={port.code}>{port.code} · {port.name}</option>)}
        </Select>
      </Field>
    </div>
  ) : null

  return <>
    <PageHeader title="Central de Informações" description="Consulte informações de importação, devolução e atendimento." />
    {section && !current ? <EmptyState title="Seção não encontrada" action={<Link to={path()} className="app-btn app-btn--secondary app-btn--sm">Abrir Central de Informações</Link>} /> : <>
      {current ? (
        // As seções viram abas (rodada 2): a página de entrada com os seis
        // cartões continua para quem chega pelo menu.
        <TabList label="Seções de informações" className="mb-4">
          {sections.map((item) => <TabButton key={item.key} id={tabId(item.key)} controls="informacoes-panel" active={current.key === item.key} label={item.title} onClick={() => navigate(path(item.key))} />)}
        </TabList>
      ) : <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{sections.map((item) => <Card key={item.key} className="p-0"><Link to={path(item.key)} className="flex h-full flex-col gap-2 rounded-2xl p-5 hover:bg-[var(--app-surface-hover)]"><item.icon size={22} className="text-[var(--app-link)]" /><h2 className="font-semibold">{item.title}</h2><p className="text-sm text-[var(--app-muted)]">{item.description}</p></Link></Card>)}</div>}
      {query.isLoading ? <EmptyState title="Carregando informações..." /> : query.error ? <Card><InlineError message="Não foi possível carregar as informações. Tente novamente em instantes." /><Button className="mt-4" variant="secondary" onClick={() => void query.refetch()}>Tentar novamente</Button></Card> : query.data && current ? <div id="informacoes-panel" role="tabpanel" aria-labelledby={tabId(current.key)} className="grid gap-4">
        {current.key === 'taxas' && <LocalFeesSection information={query.data} pod={pod} filters={podFilter} />}
        {current.key === 'devolucao' && <ReturnSection information={query.data} pod={pod} filters={podFilter} />}
        {current.key === 'demurrage' && <DemurrageSection information={query.data} />}
        {current.key === 'agentes' && <AgentsSection information={query.data} pod={pod} filters={podFilter} />}
        {current.key === 'atendimento' && <ContactsSection information={query.data} />}
        {current.key === 'tracking' && <TrackingSection information={query.data} />}
      </div> : !query.data ? <EmptyState title="Informações indisponíveis" /> : null}
    </>}
  </>
}

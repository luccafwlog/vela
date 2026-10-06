import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Banknote, Container, Clock, Users, Headphones, Search } from 'lucide-react'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Field, Select } from '../components/ui/Input'
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
  { key: 'tracking', title: 'Tracking', description: 'Copie seu B/L e consulte o site oficial do armador.', icon: Search },
]

export function PortalInformation() {
  const scope = usePortalScope()
  const { section } = useParams()
  const [params, setParams] = useSearchParams()
  const query = usePortalInformation()
  const current = sections.find((item) => item.key === section)
  const requestedPod = normalizeInformationPort(params.get('pod')) ?? ''
  const restrictedPorts = current?.key === 'taxas' || current?.key === 'devolucao'
  const pod = restrictedPorts && !isPortalServicePort(requestedPod) ? '' : requestedPod
  const suffix = params.toString() ? `?${params}` : ''
  const path = (key = '') => portalPath(scope, `/informacoes${key ? `/${key}` : ''}${suffix}`)
  return <>
    <PageHeader title={current?.title ?? 'Central de Informações'} description="Consulte informações de importação, devolução e atendimento." action={current && <Link to={path()} className="text-sm text-[var(--app-link)] underline">Todas as informações</Link>} />
    {section && !current ? <EmptyState title="Seção não encontrada" action={<Link to={path()}>Abrir Central de Informações</Link>} /> : <>
      {current ? <nav aria-label="Seções de informações" className="mb-5 flex flex-wrap gap-2">{sections.map((item) => <Link key={item.key} to={path(item.key)} aria-current={current.key === item.key ? 'page' : undefined} className={`rounded-lg border border-[var(--app-border)] px-3 py-2 text-sm ${current.key === item.key ? 'bg-[var(--app-surface-hover)] font-semibold' : 'bg-[var(--app-surface)]'}`}>{item.title}</Link>)}</nav> : <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{sections.map((item) => <Card key={item.key} className="p-0"><Link to={path(item.key)} className="flex h-full flex-col gap-2 rounded-2xl p-5 hover:bg-[var(--app-surface-hover)]"><item.icon size={22} className="text-[var(--app-link)]" /><h2 className="font-semibold">{item.title}</h2><p className="text-sm text-[var(--app-muted)]">{item.description}</p></Link></Card>)}</div>}
      {query.isLoading ? <EmptyState title="Carregando informações..." /> : query.error ? <Card><InlineError message="Não foi possível carregar as informações. Tente novamente em instantes." /><Button className="mt-4" variant="secondary" onClick={() => void query.refetch()}>Tentar novamente</Button></Card> : query.data && current ? <div className="grid gap-4">
        {['taxas', 'devolucao', 'agentes'].includes(current.key) && <Card><Field label="Porto de destino (POD)"><Select value={pod} onChange={(event) => setParams((previous) => { const next = new URLSearchParams(previous); if (event.target.value) next.set('pod', event.target.value); else next.delete('pod'); next.delete('containerId'); next.delete('bl'); return next })}><option value="">{restrictedPorts ? 'Todos os portos atendidos' : 'Todos os portos'}</option>{(restrictedPorts ? portalServicePorts : query.data.ports).map((port) => <option key={port.code} value={port.code}>{port.code} · {port.name}</option>)}</Select></Field></Card>}
        {current.key === 'taxas' && <LocalFeesSection information={query.data} pod={pod} />}
        {current.key === 'devolucao' && <ReturnSection information={query.data} pod={pod} />}
        {current.key === 'demurrage' && <DemurrageSection information={query.data} />}
        {current.key === 'agentes' && <AgentsSection information={query.data} pod={pod} />}
        {current.key === 'atendimento' && <ContactsSection information={query.data} />}
        {current.key === 'tracking' && <TrackingSection information={query.data} />}
      </div> : !query.data ? <EmptyState title="Informações indisponíveis" /> : null}
    </>}
  </>
}

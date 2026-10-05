import { MapPin } from 'lucide-react'
import { Link } from 'react-router-dom'
import { usePortalScope } from '../../../hooks/usePortalScope'
import { normalizeInformationPort } from '../../../services/informationPort'
import { portalPath } from '../../../services/portalScope'

type Section = 'taxas' | 'devolucao' | 'demurrage' | 'agentes' | 'atendimento' | 'tracking'
export function InformationLinks({ sections = ['taxas', 'devolucao', 'demurrage', 'tracking'], pod, bl, containerId }: { sections?: Section[]; pod?: string | null; bl?: string | null; containerId?: number }) {
  const scope = usePortalScope()
  const params = new URLSearchParams()
  if (pod) params.set('pod', normalizeInformationPort(pod) ?? pod)
  if (bl) params.set('bl', bl)
  if (containerId != null) params.set('containerId', String(containerId))
  const labels: Record<Section, string> = { taxas: 'Consultar Taxas Locais', devolucao: 'Onde devolver', demurrage: 'Consultar Demurrage', agentes: 'Agentes do porto', atendimento: 'Contato', tracking: 'Tracking do B/L' }
  return <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">{sections.map((section) => <Link key={section} to={portalPath(scope, `/informacoes/${section}${params.size ? `?${params}` : ''}`)} className="inline-flex min-h-8 items-center gap-1 whitespace-nowrap text-[var(--app-link)] underline underline-offset-4" onClick={(event) => event.stopPropagation()}>{section === 'devolucao' && <MapPin size={14} className="shrink-0" aria-hidden="true" />}{labels[section]}</Link>)}</div>
}

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
  const labels: Record<Section, string> = { taxas: 'Consultar Taxas Locais', devolucao: 'Onde devolver', demurrage: 'Consultar Demurrage', agentes: 'Agentes do porto', atendimento: 'Atendimento', tracking: 'Tracking do B/L' }
  return <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">{sections.map((section) => <Link key={section} to={portalPath(scope, `/informacoes/${section}${params.size ? `?${params}` : ''}`)} className="text-[var(--app-link)] underline" onClick={(event) => event.stopPropagation()}>{labels[section]}</Link>)}</div>
}

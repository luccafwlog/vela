import { Badge } from '../../ui/Badge'
import { Card, InlineError } from '../../ui/Card'
import { formatDate } from '../../../lib/utils'
import type { ReturnGuidance } from '../../../services/portalInformation'
import { DepotCards } from './DepotCards'

export function ReturnGuidanceView({ guidance }: { guidance: ReturnGuidance }) {
  if (guidance.status === 'soc') return <Card><p>SOC: container do próprio cliente, não exige devolução.</p></Card>
  if (guidance.status === 'unavailable') return <InlineError message="A indicação de devolução está indisponível. Confirme com o atendimento antes de encaminhar o container." />
  return <div className="grid gap-4">
    <Card>
      <Badge tone={guidance.status === 'specific' ? 'blue' : 'slate'}>{guidance.status === 'specific' ? 'Indicação específica' : 'Regra geral do porto'}</Badge>
      <p className="mt-2 text-sm">{guidance.status === 'specific' ? 'Devolva somente em um dos depots indicados abaixo.' : 'Consulte abaixo os depots disponíveis para o porto de destino.'}</p>
      <p className="mt-1 text-sm text-[var(--app-muted)]">{guidance.container_number} · B/L {guidance.bl_id} · {guidance.pod}</p>
      {guidance.return_date && <p className="mt-2 text-sm">Devolução registrada em {formatDate(guidance.return_date)}.</p>}
      {guidance.updated_at && <p className="mt-2 text-xs text-[var(--app-muted)]">Orientação atualizada em {formatDate(guidance.updated_at)}</p>}
    </Card>
    <DepotCards depots={guidance.depots} />
  </div>
}

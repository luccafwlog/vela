import { useSearchParams } from 'react-router-dom'
import { Card, EmptyState, InlineError } from '../../ui/Card'
import { Button } from '../../ui/Button'
import { Field, Select } from '../../ui/Input'
import { usePortalOperationBls } from '../../../hooks/usePortalOperation'
import { usePortalReturnGuidance } from '../../../hooks/usePortalInformation'
import { normalizeInformationPort } from '../../../services/informationPort'
import type { PortalInformation } from '../../../services/portalInformation'
import { DepotCards } from './DepotCards'
import { ReturnGuidanceView } from './ReturnGuidanceView'

export function ReturnSection({ information, pod }: { information: PortalInformation; pod: string }) {
  const [params, setParams] = useSearchParams()
  const operation = usePortalOperationBls()
  const blFilter = params.get('bl') ?? ''
  const containers = (operation.data ?? []).filter((bl) => (!pod || (normalizeInformationPort(bl.pod) ?? bl.pod) === (normalizeInformationPort(pod) ?? pod)) && (!blFilter || bl.bl_id === blFilter)).flatMap((bl) => bl.containers.map((container) => ({ ...container, bl: bl.bl_id })))
  const requestedId = Number(params.get('containerId'))
  const selectedId = !operation.error && containers.some((container) => container.id === requestedId) ? requestedId : null
  const guidance = usePortalReturnGuidance(selectedId)
  const changeContainer = (value: string) => setParams((previous) => { const next = new URLSearchParams(previous); if (value) next.set('containerId', value); else next.delete('containerId'); return next })
  return <div className="grid gap-4">
    <Card>
      <h2 className="text-base font-semibold">Devolução de containers</h2>
      <p className="my-3 text-sm text-[var(--app-muted)]">Selecione um container da sua operação para confirmar se existe uma indicação específica. Confira horários, restrições e agendamento antes da entrega.</p>
      {blFilter && <div className="mb-3"><p className="mb-2 text-sm text-[var(--app-muted)]">Consulta limitada ao B/L {blFilter}.</p><Button variant="secondary" onClick={() => setParams((previous) => { const next = new URLSearchParams(previous); next.delete('bl'); next.delete('containerId'); return next })}>Consultar todos os B/Ls</Button></div>}
      {operation.isLoading ? <p role="status">Carregando seus containers...</p> : operation.error ? <><InlineError message="Falha ao consultar seus containers. Tente novamente em instantes." /><Button className="mt-3" variant="secondary" onClick={() => void operation.refetch()}>Tentar novamente</Button></> : <Field label="Container da operação"><Select value={selectedId ?? ''} onChange={(event) => changeContainer(event.target.value)}><option value="">Consultar depots do porto</option>{containers.map((container) => <option key={`${container.bl}-${container.id}`} value={container.id}>{container.container_number} · B/L {container.bl}</option>)}</Select></Field>}
      {!operation.isLoading && !operation.error && !containers.length && <p className="mt-3 text-sm text-[var(--app-muted)]">Nenhum container visível para os filtros atuais.</p>}
      {params.has('containerId') && selectedId == null && !operation.isLoading && !operation.error && <InlineError message="Container indisponível na sua operação. Selecione uma unidade da lista para consultar a orientação." />}
    </Card>
    {selectedId != null ? guidance.isLoading ? <EmptyState title="Carregando orientação..." /> : guidance.error ? <Card><InlineError message="Falha ao consultar a orientação de devolução. Confirme com o atendimento antes da entrega." /><Button className="mt-3" variant="secondary" onClick={() => void guidance.refetch()}>Tentar novamente</Button></Card> : guidance.data ? <ReturnGuidanceView guidance={guidance.data} /> : <EmptyState title="Orientação indisponível" /> : !params.has('containerId') && <DepotCards depots={information.depots.filter((depot) => depot.active && depot.published && (!pod || depot.ports.includes(pod)))} />}
  </div>
}

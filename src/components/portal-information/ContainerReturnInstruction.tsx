import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useInternalPortalInformation, useInternalReturnGuidance, useSetContainerReturnInstruction } from '../../hooks/usePortalInformation'
import { Button } from '../ui/Button'
import { Field, Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'
import type { PortalDepot, ReturnGuidance } from '../../services/portalInformation'

export function ContainerReturnInstruction({ containerId, containerNumber, onClose }: { containerId: number; containerNumber: string; onClose: () => void }) {
  const catalog = useInternalPortalInformation()
  const guidance = useInternalReturnGuidance(containerId)
  const { profile, isAdmin } = useAuth()
  const canEdit = profile?.active === true && (isAdmin || profile.role === 'equipamentos')
  // Availability can change without changing the persisted instruction timestamp.
  // Keep drafts on ordinary refetches, reset only when their choices become stale.
  const formKey = guidance.data && catalog.data ? JSON.stringify([
    containerId, guidance.data.updated_at, guidance.data.status, guidance.data.pod,
    guidance.data.depots.map(depot => depot.id).sort(),
    catalog.data.depots.filter(depot => depot.active && depot.published && depot.ports.includes(guidance.data.pod)).map(depot => depot.id).sort(),
  ]) : String(containerId)
  return <Modal open title={`Devolução · ${containerNumber}`} onClose={onClose}>
    {catalog.isLoading || guidance.isLoading ? <p>Carregando orientação de devolução...</p> : catalog.error || guidance.error || !catalog.data || !guidance.data ? <p role="alert">Não foi possível consultar a orientação de devolução. Feche e tente novamente.</p> :
      <InstructionForm key={formKey} containerId={containerId} guidance={guidance.data} depots={catalog.data?.depots ?? []} canEdit={canEdit} onClose={onClose} />}
  </Modal>
}

function InstructionForm({ containerId, guidance, depots, canEdit, onClose }: { containerId: number; guidance: ReturnGuidance; depots: PortalDepot[]; canEdit: boolean; onClose: () => void }) {
  const available = depots.filter(d => d.active && d.published && d.ports.includes(guidance.pod))
  const [selected, setSelected] = useState<string[]>(guidance.status === 'specific' ? guidance.depots.filter(depot => available.some(option => option.id === depot.id)).map(depot => depot.id) : [])
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const save = useSetContainerReturnInstruction()
  if (guidance.status === 'soc') return <p>Container SOC: não exige devolução.</p>
  async function submit() {
    if (!reason.trim()) return
    setError(null)
    try { await save.mutateAsync({ containerId, depotIds: selected, reason: reason.trim() }); onClose() }
    catch { setError('Não foi possível salvar a indicação. Revise os dados e tente novamente.') }
  }
  return <div className="grid gap-4">
    <p className="text-sm text-slate-400">Porto de destino: {guidance.pod || 'Não informado'}. A indicação é compartilhada entre os B/Ls da mesma viagem.</p>
    {guidance.status === 'unavailable' ? <p role="status">A indicação existente está indisponível. O cliente recebe orientação para entrar em contato; os demais depots não são liberados automaticamente.</p> : <p>{guidance.status === 'specific' ? 'Indicação específica' : 'Regra geral: depots ativos e publicados do porto de destino.'}</p>}
    {!canEdit ? <div>{guidance.depots.map(d => <div key={d.id}><p className="font-medium">{d.name}</p>{d.instructions ? <p className="whitespace-pre-wrap text-sm">{d.instructions}</p> : null}{d.restrictions ? <p className="whitespace-pre-wrap text-sm">Restrições: {d.restrictions}</p> : null}</div>)}{guidance.reason ? <p className="text-sm text-slate-400">Justificativa interna: {guidance.reason}</p> : null}</div> : <>
      <fieldset className="grid gap-2"><legend className="mb-2 font-semibold">Depots indicados</legend>
        {available.length ? available.map(d => <div key={d.id}><label className="flex items-center gap-2"><input type="checkbox" checked={selected.includes(d.id)} onChange={e => setSelected(e.target.checked ? [...selected, d.id] : selected.filter(id => id !== d.id))} />{d.name}</label>{d.instructions ? <p className="ml-6 whitespace-pre-wrap text-sm text-slate-400">{d.instructions}</p> : null}{d.restrictions ? <p className="ml-6 whitespace-pre-wrap text-sm text-slate-400">Restrições: {d.restrictions}</p> : null}</div>) : <p>Nenhum depot ativo e publicado para este porto.</p>}
      </fieldset>
      <p className="text-sm text-slate-400">Sem seleção, a indicação específica é retirada e a regra geral é restaurada.</p>
      <Field label="Justificativa" required hint="Registro interno de auditoria; não aparece no Portal."><Textarea value={reason} onChange={e => setReason(e.target.value)} /></Field>
      {error ? <p role="alert">{error}</p> : null}
      <div className="flex flex-wrap gap-2"><Button loading={save.isPending} disabled={!reason.trim()} onClick={() => void submit()}>Salvar indicação</Button><Button variant="secondary" disabled={save.isPending} onClick={onClose}>Cancelar</Button></div>
    </>}
  </div>
}

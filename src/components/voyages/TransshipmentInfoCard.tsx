import { useState, type FormEvent } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useRevertVoyageOmission, useUpdateVoyageOmission, useVoyageTransshipments } from '../../hooks/useTransshipments'
import type { VoyageOmission } from '../../services/transshipments'
import { Button } from '../ui/Button'
import { Field, Input, Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'

const display = (value: string | null) => value?.trim() || '—'
const displayDate = (value: string | null) => value ? new Intl.DateTimeFormat('pt-BR').format(new Date(value)) : '—'

export function TransshipmentInfoCard({ voyageId }: { voyageId: number }) {
  const { data } = useVoyageTransshipments(voyageId)
  if (!data?.omissions.length) return null

  return (
    <section className="grid gap-3 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4">
      <h3 className="text-sm font-semibold text-[var(--app-text-strong)]">Informações de Transbordo</h3>
      {data.omissions.map((omission) => (
        <OmissionInfo
          key={omission.id}
          voyageId={voyageId}
          omission={omission}
          blCount={data.transshipments.filter((item) => item.omissionId === omission.id).length}
        />
      ))}
    </section>
  )
}

function OmissionInfo({ voyageId, omission, blCount }: { voyageId: number; omission: VoyageOmission; blCount: number }) {
  const { user, isAdmin } = useAuth()
  const update = useUpdateVoyageOmission(voyageId)
  const revert = useRevertVoyageOmission(voyageId)
  const [editing, setEditing] = useState(false)
  const [revertOpen, setRevertOpen] = useState(false)
  const [revertJustification, setRevertJustification] = useState('')
  const [vessel, setVessel] = useState(omission.onwardVesselName ?? '')
  const [carrier, setCarrier] = useState(omission.onwardCarrier ?? '')
  const [voyageNumber, setVoyageNumber] = useState(omission.onwardVoyageNumber ?? '')
  const [etd, setEtd] = useState(omission.onwardEtd?.slice(0, 10) ?? '')
  const [eta, setEta] = useState(omission.onwardEta?.slice(0, 10) ?? '')
  const [reason, setReason] = useState(omission.reason ?? '')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!user?.id) return
    await update.mutateAsync({
      omissionId: omission.id,
      onwardVesselName: vessel.trim() || null,
      onwardCarrier: carrier.trim() || null,
      onwardVoyageNumber: voyageNumber.trim() || null,
      onwardEtd: etd || null,
      onwardEta: eta || null,
      reason: reason.trim() || null,
      changedBy: user.id,
    })
    setEditing(false)
  }

  async function submitRevert(event: FormEvent) {
    event.preventDefault()
    if (!user?.id || !revertJustification.trim()) return
    await revert.mutateAsync({
      omissionId: omission.id,
      justification: revertJustification.trim(),
      changedBy: user.id,
    })
    setRevertOpen(false)
    setRevertJustification('')
  }

  return (
    <div className="grid gap-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">{omission.omittedPod} · Porto de Transbordo — {omission.dischargePod}</div>
        {!editing ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" className="app-btn--sm" onClick={() => setEditing(true)}>Complementar</Button>
            {isAdmin ? <Button variant="danger" className="app-btn--sm" onClick={() => setRevertOpen(true)}>Reverter omissão</Button> : null}
          </div>
        ) : null}
      </div>
      {editing ? (
        <form className="grid gap-3 md:grid-cols-2" onSubmit={submit}>
          <Field label="Navio de Transbordo"><Input value={vessel} onChange={(event) => setVessel(event.target.value)} /></Field>
          <Field label="Armador de Transbordo"><Input value={carrier} onChange={(event) => setCarrier(event.target.value)} /></Field>
          <Field label="Viagem de Transbordo"><Input value={voyageNumber} onChange={(event) => setVoyageNumber(event.target.value)} /></Field>
          <Field label="Motivo"><Input value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
          <Field label="ETD de Transbordo"><Input type="date" value={etd} onChange={(event) => setEtd(event.target.value)} /></Field>
          <Field label="ETA de Transbordo"><Input type="date" value={eta} onChange={(event) => setEta(event.target.value)} /></Field>
          <div className="flex gap-2 md:col-span-2">
            <Button type="submit" loading={update.isPending}>Salvar informações</Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>Voltar</Button>
          </div>
        </form>
      ) : (
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Info label="Navio" value={display(omission.onwardVesselName)} />
          <Info label="Armador" value={display(omission.onwardCarrier)} />
          <Info label="Viagem" value={display(omission.onwardVoyageNumber)} />
          <Info label="ETD" value={displayDate(omission.onwardEtd)} />
          <Info label="ETA" value={displayDate(omission.onwardEta)} />
          <Info label="Motivo" value={display(omission.reason)} />
        </dl>
      )}
      <Modal open={revertOpen} title="Reverter omissão de escala" onClose={() => setRevertOpen(false)}>
        <form className="grid gap-4" onSubmit={submitRevert}>
          <div className="app-panel app-panel--padded text-sm">
            Esta ação removerá a omissão e os registros de transbordo de {blCount} B/L(s). Clientes com link a um B/L afetado serão notificados da correção.
          </div>
          <Field label="Justificativa" required>
            <Textarea
              value={revertJustification}
              onChange={(event) => setRevertJustification(event.target.value)}
              required
              autoFocus
              rows={4}
            />
          </Field>
          {revert.isError ? <p className="text-sm text-red-500">Falha ao reverter a omissão. Verifique se algum B/L está em COD.</p> : null}
          <div className="app-modal__actions">
            <Button variant="secondary" type="button" onClick={() => setRevertOpen(false)}>Voltar</Button>
            <Button variant="danger" loading={revert.isPending} type="submit" disabled={!revertJustification.trim()}>Reverter omissão</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-[var(--app-muted)]">{label}</dt><dd className="font-medium text-[var(--app-text-strong)]">{value}</dd></div>
}

import { useState, type FormEvent } from 'react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useAuth } from '../../hooks/useAuth'
import { useOmitEscala } from '../../hooks/useTransshipments'

type OmitEscalaModalProps = {
  open: boolean
  onClose: () => void
  voyageId: number
  omittedPod: string
  candidateDischargePods: string[]
  blCount: number
}

export function OmitEscalaModal({
  open,
  onClose,
  voyageId,
  omittedPod,
  candidateDischargePods,
  blCount,
}: OmitEscalaModalProps) {
  const { user } = useAuth()
  const omit = useOmitEscala(voyageId)
  const [dischargePod, setDischargePod] = useState(candidateDischargePods[0] ?? '')
  const [reason, setReason] = useState('')
  const [onwardVesselName, setOnwardVesselName] = useState('')
  const [onwardCarrier, setOnwardCarrier] = useState('')
  const [onwardVoyageNumber, setOnwardVoyageNumber] = useState('')
  const [onwardEtd, setOnwardEtd] = useState('')
  const [onwardEta, setOnwardEta] = useState('')
  const [prevTarget, setPrevTarget] = useState<string | null>(null)
  const [isConfirming, setIsConfirming] = useState(false)

  if (open && omittedPod !== prevTarget) {
    setPrevTarget(omittedPod)
    setDischargePod(candidateDischargePods[0] ?? '')
    setReason('')
    setOnwardVesselName('')
    setOnwardCarrier('')
    setOnwardVoyageNumber('')
    setOnwardEtd('')
    setOnwardEta('')
    setIsConfirming(false)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user?.id || !dischargePod) return
    setIsConfirming(true)
  }

  async function handleConfirm() {
    if (!user?.id || !dischargePod) return
    await omit.mutateAsync({
      voyageId,
      omittedPod,
      dischargePod,
      reason: reason.trim() || null,
      onwardVesselName: onwardVesselName.trim() || null,
      onwardCarrier: onwardCarrier.trim() || null,
      onwardVoyageNumber: onwardVoyageNumber.trim() || null,
      onwardEtd: onwardEtd || null,
      onwardEta: onwardEta || null,
      changedBy: user.id,
    })
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={`Omitir escala de ${omittedPod}`}>
      <form className="grid gap-4" onSubmit={handleSubmit}>
        {isConfirming ? (
          <>
            <div className="app-panel app-panel--padded grid gap-2 text-sm">
              <p className="font-semibold text-[var(--app-text-strong)]">Confirme a omissão da escala:</p>
              <p>{omittedPod} → {dischargePod} · {blCount} B/Ls afetados · clientes com vínculo serão notificados</p>
            </div>
            <div className="app-modal__actions">
              <Button variant="secondary" type="button" onClick={() => setIsConfirming(false)}>
                Voltar
              </Button>
              <Button autoFocus loading={omit.isPending} type="button" onClick={handleConfirm}>
                Confirmar omissão
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="app-panel app-panel--padded text-sm">
              A carga de {omittedPod} sera descarregada no porto escolhido e entrara em transbordo por B/L.
            </div>
            <Field label="Porto de Transbordo">
              <select className="app-input" value={dischargePod} onChange={(event) => setDischargePod(event.target.value)} required>
                {candidateDischargePods.map((pod) => (
                  <option key={pod} value={pod}>
                    {pod}
                  </option>
                ))}
              </select>
            </Field>
            <fieldset className="grid gap-3 rounded-xl border border-[var(--app-border)] p-3">
              <legend className="px-1 text-sm font-semibold text-[var(--app-text-strong)]">
                Dados de transbordo (complete quando conhecidos)
              </legend>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Navio de Transbordo">
                  <Input value={onwardVesselName} onChange={(event) => setOnwardVesselName(event.target.value)} />
                </Field>
                <Field label="Armador de Transbordo">
                  <Input value={onwardCarrier} onChange={(event) => setOnwardCarrier(event.target.value)} />
                </Field>
                <Field label="Viagem de Transbordo">
                  <Input value={onwardVoyageNumber} onChange={(event) => setOnwardVoyageNumber(event.target.value)} />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="ETD de Transbordo">
                    <Input type="date" value={onwardEtd} onChange={(event) => setOnwardEtd(event.target.value)} />
                  </Field>
                  <Field label="ETA de Transbordo">
                    <Input type="date" value={onwardEta} onChange={(event) => setOnwardEta(event.target.value)} />
                  </Field>
                </div>
              </div>
            </fieldset>
            <Field label="Motivo (opcional)">
              <Input value={reason} onChange={(event) => setReason(event.target.value)} />
            </Field>
          </>
        )}
        {omit.isError ? <p className="text-sm text-red-500">Falha ao omitir a escala.</p> : null}
        {!isConfirming ? (
          <div className="app-modal__actions">
            <Button variant="secondary" type="button" onClick={onClose}>
              Voltar
            </Button>
            <Button autoFocus loading={omit.isPending} type="submit" disabled={!dischargePod}>
              Omitir escala
            </Button>
          </div>
        ) : null}
      </form>
    </Modal>
  )
}

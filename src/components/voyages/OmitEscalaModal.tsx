import { useState, type FormEvent } from 'react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useAuth } from '../../hooks/useAuth'
import { useOmitEscala } from '../../hooks/useTransshipments'
import { userFacingErrorMessage } from '../../lib/errors'

type OmitEscalaModalProps = {
  open: boolean
  onClose: () => void
  voyageId: number
  omittedPod: string
  candidateDischargePods: string[]
  affectedBlNumbers: string[]
}

export function OmitEscalaModal({
  open,
  onClose,
  voyageId,
  omittedPod,
  candidateDischargePods,
  affectedBlNumbers,
}: OmitEscalaModalProps) {
  const { user } = useAuth()
  const omit = useOmitEscala(voyageId)
  // 02-viagens-adr:15: o porto omitido não é Porto de Transbordo (o banco também recusa).
  const dischargeOptions = candidateDischargePods.filter((pod) => pod.trim().toUpperCase() !== omittedPod.trim().toUpperCase())
  const [dischargePod, setDischargePod] = useState(dischargeOptions[0] ?? '')
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
    setDischargePod(dischargeOptions[0] ?? '')
    setReason('')
    setOnwardVesselName('')
    setOnwardCarrier('')
    setOnwardVoyageNumber('')
    setOnwardEtd('')
    setOnwardEta('')
    setIsConfirming(false)
  }

  // Reabrir a janela não repete a recusa da tentativa anterior.
  function close() {
    omit.reset()
    onClose()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user?.id || !dischargePod) return
    // A recusa anterior fica no formulário para orientar a correção; a nova
    // confirmação começa sem ela.
    omit.reset()
    setIsConfirming(true)
  }

  async function handleConfirm() {
    if (!user?.id || !dischargePod) return
    try {
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
    } catch {
      return // A recusa do banco aparece na janela (`omit.error`).
    }
    onClose()
  }

  return (
    <Modal open={open} onClose={close} title={`Omitir escala de ${omittedPod}`} size="md">
      <form className="grid gap-4" onSubmit={handleSubmit}>
        {isConfirming ? (
          <>
            <div className="app-panel app-panel--padded grid gap-2 text-sm">
              <p className="font-semibold text-[var(--app-text-strong)]">Confirme a omissão da escala:</p>
              <p>Escala omitida: {omittedPod}</p>
              <p>Porto de descarga: {dischargePod}</p>
              <p>
                Transbordo: {[onwardVesselName, onwardCarrier, onwardVoyageNumber].filter(Boolean).join(' · ') || 'dados ainda não informados'}
                {onwardEtd ? ` · ETD ${onwardEtd}` : ''}
                {onwardEta ? ` · ETA ${onwardEta}` : ''}
              </p>
              {reason.trim() ? <p>Motivo: {reason.trim()}</p> : null}
              <details className="rounded-lg border border-[var(--app-border)] p-2">
                <summary className="cursor-pointer font-medium">
                  Ver B/Ls afetados ({affectedBlNumbers.length})
                </summary>
                {affectedBlNumbers.length > 0 ? (
                  <ul className="mt-2 max-h-40 list-disc space-y-1 overflow-y-auto pl-5">
                    {affectedBlNumbers.map((blNumber) => <li key={blNumber}>{blNumber}</li>)}
                  </ul>
                ) : <p className="mt-2">Nenhum B/L está vinculado a esta escala.</p>}
              </details>
              <p className="text-xs text-[var(--app-muted)]">
                Os B/Ls listados passam a seguir em transbordo e clientes vinculados recebem uma notificação no Portal.
                Qualquer setor pode reverter a omissão, com justificativa; a reversão mantém o histórico da omissão e também notifica os clientes.
              </p>
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
              {dischargeOptions.length === 0 ? (
                <p className="text-sm text-[var(--app-warning-fg)]" role="alert">
                  Nenhuma outra escala brasileira nesta viagem. Cadastre antes a escala onde a carga será descarregada.
                </p>
              ) : null}
              <select className="app-input" value={dischargePod} onChange={(event) => setDischargePod(event.target.value)} required>
                {dischargeOptions.map((pod) => (
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
        {omit.isError ? (
          <p className="text-sm text-[var(--app-danger-fg)]" role="alert">
            {userFacingErrorMessage(omit.error, 'Falha ao omitir a escala. Tente novamente.')}
          </p>
        ) : null}
        {!isConfirming ? (
          <div className="app-modal__actions">
            <Button variant="secondary" type="button" onClick={close}>
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

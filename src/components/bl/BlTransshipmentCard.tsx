import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Modal } from '../ui/Modal'
import type { BlDisposition, VoyageOmission } from '../../services/transshipments'

export function BlTransshipmentCard({ omission, disposition, saving, onCod, onRestore }: {
  omission: VoyageOmission
  disposition: BlDisposition
  saving: boolean
  onCod?: (justification: string) => void
  onRestore?: (justification: string) => void
}) {
  const [pendingAction, setPendingAction] = useState<'cod' | 'restore' | null>(null)
  const [justification, setJustification] = useState('')
  const justificationRef = useRef<HTMLTextAreaElement>(null)
  const values = [omission.onwardVesselName, omission.onwardCarrier, omission.onwardVoyageNumber, omission.onwardEtd?.slice(0, 10), omission.onwardEta?.slice(0, 10)]
  const isCod = pendingAction === 'cod'
  const actionHandler = isCod ? onCod : onRestore
  const closeDialog = () => {
    setPendingAction(null)
    setJustification('')
  }
  const confirmAction = () => {
    const value = justification.trim()
    if (!value || !actionHandler) return
    actionHandler(value)
    closeDialog()
  }

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Transbordo / COD</h3>
          <span className="rounded-full bg-[var(--app-surface-muted)] px-2 py-1 text-xs font-semibold uppercase">
            {disposition === 'cod' ? `COD ${omission.dischargePod}` : 'Transbordo'}
          </span>
        </div>
        <p className="mt-2 text-xs text-[var(--app-muted)]">Escala omitida em {omission.omittedPod}; descarga em {omission.dischargePod}.</p>
        <p className="mt-2 text-sm">
          {values.map((value, index) => <span key={`${value ?? 'empty'}-${index}`}>{index ? ' · ' : ''}{value || '—'}</span>)}
        </p>
        <Link className="mt-2 inline-block text-xs font-semibold text-[#58a6ff] hover:underline" to={`/viagens/${omission.voyageId}`}>
          Registro global da omissão →
        </Link>
        {disposition === 'transshipment' && onCod ? (
          <div className="mt-3">
            <Button variant="secondary" className="app-btn--sm" disabled={saving} onClick={() => { setJustification(''); setPendingAction('cod') }}>Marcar COD</Button>
          </div>
        ) : disposition === 'cod' && onRestore ? (
          <div className="mt-3">
            <Button variant="secondary" className="app-btn--sm" loading={saving} onClick={() => { setJustification(''); setPendingAction('restore') }}>Reverter para transbordo</Button>
          </div>
        ) : null}
      </Card>
      <Modal
        open={pendingAction !== null}
        title={isCod ? 'Confirmar COD' : 'Confirmar reversão de COD'}
        onClose={closeDialog}
        initialFocusRef={justificationRef}
        className="w-[min(100%,520px)]"
      >
        <div className="grid gap-4">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--app-text)' }}>
            {isCod
              ? 'Esta ação altera o destino final do B/L para o porto de descarga e notifica o cliente quando houver cliente vinculado.'
              : 'Esta ação restaura o destino original do B/L e notifica o cliente sobre a correção quando houver cliente vinculado.'}
          </p>
          <div className="grid gap-2">
            <label className="text-sm font-semibold" htmlFor="cod-justification">Justificativa</label>
            <textarea
              id="cod-justification"
              ref={justificationRef}
              className="min-h-24 w-full rounded border border-[#30363d] bg-[var(--app-surface-muted)] p-2 text-sm text-[var(--app-text)]"
              value={justification}
              onChange={(event) => setJustification(event.target.value)}
              placeholder="Explique o motivo da alteração"
              required
              rows={4}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={closeDialog}>Voltar</Button>
            <Button variant="primary" disabled={!justification.trim()} onClick={confirmAction}>
              {isCod ? 'Confirmar COD' : 'Confirmar reversão'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

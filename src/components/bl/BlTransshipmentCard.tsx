import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Route } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Modal } from '../ui/Modal'
import { Field } from '../ui/Input'
import { formatDate } from '../../lib/utils'
import type { BlDisposition, VoyageOmission } from '../../services/transshipments'

/**
 * Omissão de escala na ficha do B/L. O registro global (porto de transbordo,
 * navio e datas) vem da Viagem e é só consulta; a ação individual deste B/L é
 * marcar COD ou reverter para transbordo, com justificativa.
 */
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
  const isCod = pendingAction === 'cod'
  const actionHandler = isCod ? onCod : onRestore
  const inCod = disposition === 'cod'
  const onward = [
    { label: 'Navio', value: omission.onwardVesselName },
    { label: 'Armador', value: omission.onwardCarrier },
    { label: 'Viagem', value: omission.onwardVoyageNumber },
    { label: 'ETD', value: omission.onwardEtd ? formatDate(omission.onwardEtd) : null },
    { label: 'ETA', value: omission.onwardEta ? formatDate(omission.onwardEta) : null },
  ]
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
      <Card className="app-bl-omission">
        <div className="app-bl-section-head">
          <h2 className="app-bl-section-title">
            <Route size={16} aria-hidden="true" />
            {inCod ? `COD para ${omission.dischargePod}` : 'Transbordo'}
          </h2>
          <Link className="app-bl-link app-bl-section-head__link" to={`/viagens/${omission.voyageId}`}>
            Registro global da omissão
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
        <p className="app-bl-omission__summary">
          A escala em <strong>{omission.omittedPod}</strong> foi omitida e a carga descarregou em <strong>{omission.dischargePod}</strong>.{' '}
          {inCod
            ? `Destino final alterado para ${omission.dischargePod}: a Taxa Local foi recalculada nesse porto.`
            : `Segue em transbordo até ${omission.omittedPod}; o destino final e a Taxa Local não mudam.`}
        </p>
        {!inCod ? (
          <dl className="app-bl-facts app-bl-facts--inline" aria-label="Seguimento em transbordo">
            {onward.map((item) => (
              <div key={item.label} className="app-bl-facts__item">
                <dt>{item.label}</dt>
                <dd>{item.value || <span className="app-bl-facts__missing">A informar</span>}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {!inCod && onCod ? (
          <div className="app-bl-omission__actions">
            <Button variant="secondary" disabled={saving} onClick={() => { setJustification(''); setPendingAction('cod') }}>Marcar COD</Button>
          </div>
        ) : inCod && onRestore ? (
          <div className="app-bl-omission__actions">
            <Button variant="secondary" loading={saving} onClick={() => { setJustification(''); setPendingAction('restore') }}>Reverter para transbordo</Button>
          </div>
        ) : null}
      </Card>
      <Modal
        open={pendingAction !== null}
        title={isCod ? 'Marcar COD' : 'Reverter COD para transbordo'}
        onClose={closeDialog}
        initialFocusRef={justificationRef}
        size="sm"
      >
        <div className="grid gap-4">
          {isCod ? (
            <ul className="app-bl-consequences">
              <li>Esta ação altera o destino final do B/L para {omission.dischargePod} e recalcula a Taxa Local nesse porto.</li>
              <li>Se o B/L já foi faturado, a diferença vira um Ajuste de COD para o Financeiro.</li>
              <li>O B/L sai do Manifesto Mercante do porto omitido; o CE Mercante não muda.</li>
              <li>O sistema notifica o cliente quando houver cliente vinculado.</li>
            </ul>
          ) : (
            <ul className="app-bl-consequences">
              <li>Esta ação restaura o destino original do B/L ({omission.omittedPod}).</li>
              <li>O sistema notifica o cliente sobre a correção quando houver cliente vinculado.</li>
            </ul>
          )}
          <Field label="Justificativa" required>
            {/* Textarea nativo: a primitiva não repassa ref, e o foco inicial do modal precisa dele. */}
            <textarea
              ref={justificationRef}
              className="app-input app-input--full app-textarea"
              value={justification}
              onChange={(event) => setJustification(event.target.value)}
              placeholder="Explique o motivo da alteração"
              rows={4}
            />
          </Field>
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

import { useId, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import type { AgencyReportDepartmentKey } from '../../types/database'

// Assinar (primeira saida) so pede confirmacao; reabrir um sign-off ja dado
// exige justificativa auditada (ADR 0029, mesmo padrao da resolucao de secao).
export function DepartmentSignoffControl({
  department,
  label,
  signed,
  attribution,
  canSignoff,
  sectionsPending,
  isPending,
  compact = false,
  onChange,
}: {
  department: AgencyReportDepartmentKey
  label: string
  signed: boolean
  attribution?: string | null
  canSignoff: boolean
  sectionsPending: boolean
  isPending?: boolean
  compact?: boolean
  onChange: (department: AgencyReportDepartmentKey, signed: boolean, justification?: string) => void
}) {
  const [action, setAction] = useState<'sign' | 'reopen' | null>(null)
  const [justification, setJustification] = useState('')
  const textareaId = useId()

  const openAction = () => {
    setJustification('')
    setAction(signed ? 'reopen' : 'sign')
  }
  const closeAction = () => {
    setAction(null)
    setJustification('')
  }
  const confirmAction = () => {
    if (action === 'reopen' && !justification.trim()) return
    onChange(department, action !== 'reopen', action === 'reopen' ? justification.trim() : undefined)
    closeAction()
  }

  return (
    <div className={compact ? 'flex flex-wrap items-center justify-end gap-2' : 'app-panel app-panel--padded grid gap-2'}>
      {!compact ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-[var(--app-text)]">{label}</span>
          <span className={`app-badge ${signed ? 'app-badge--green' : 'app-badge--slate'}`}>
            {signed ? 'Assinado' : 'Pendente'}
          </span>
        </div>
      ) : null}
      {compact && attribution ? <span className="text-xs text-[var(--app-muted-soft)]">{attribution}</span> : null}
      {!compact && attribution ? <span className="text-xs text-[var(--app-muted)]">{attribution}</span> : null}
      {compact ? <span className={`app-badge ${signed ? 'app-badge--green' : 'app-badge--yellow'}`}>{signed ? 'Assinado' : 'Aguardando assinatura'}</span> : null}
      {canSignoff ? (
        <Button
          variant={signed ? 'danger' : 'primary'}
          className={compact ? 'app-btn--sm' : undefined}
          disabled={isPending || (!signed && sectionsPending)}
          title={!signed && sectionsPending ? 'Resolva todas as seções do departamento (ou marque "Nada a declarar") para assinar.' : undefined}
          onClick={openAction}
        >
          {signed ? 'Reabrir' : 'Assinar'}
        </Button>
      ) : null}

      <Modal open={action !== null} title={action === 'reopen' ? 'Reabrir sign-off departamental' : 'Confirmar sign-off departamental'} onClose={closeAction}>
        <p className="text-sm text-[var(--app-text)]">
          {action === 'reopen'
            ? <>Reabrir o sign-off de <strong>{label}</strong> exige justificativa e fica no histórico.</>
            : <>Assinar por <strong>{label}</strong>, confirmando que todas as suas seções refletem a realidade da escala?</>}
        </p>
        {action === 'reopen' ? (
          <label htmlFor={textareaId} className="mt-3 grid gap-2 text-sm">
            Justificativa
            <textarea
              id={textareaId}
              value={justification}
              onChange={(event) => setJustification(event.target.value)}
              autoFocus
              className="min-h-24 rounded border border-[var(--app-border)] bg-transparent p-2"
            />
          </label>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={closeAction}>Voltar</Button>
          <Button variant={action === 'reopen' ? 'danger' : 'primary'} disabled={action === 'reopen' && !justification.trim()} onClick={confirmAction}>Confirmar</Button>
        </div>
      </Modal>
    </div>
  )
}

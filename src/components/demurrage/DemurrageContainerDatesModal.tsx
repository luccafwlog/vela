import { useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { ImportNotice } from '../shared/ImportParts'
import { validateContainerDates, type ContainerDatesErrors, type ContainerDatesInput } from './demurrageFormRules'
import { DEMURRAGE_INVOICE_STATUS_LABELS, statusLabel } from '../../lib/statusLabels'
import { formatDate } from '../../lib/utils'
import type { DemurrageContainerRow } from '../../services/demurrage/demurrageContainers'

type Props = {
  container: DemurrageContainerRow | null
  loading: boolean
  error?: string | null
  onClose: () => void
  onSubmit: (input: ContainerDatesInput) => void
}

function ContainerDatesForm({ container, loading, error, onClose, onSubmit }: Omit<Props, 'container'> & { container: DemurrageContainerRow }) {
  const [discharge, setDischarge] = useState(container.discharge_date ?? '')
  const [ret, setRet] = useState(container.return_date ?? '')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<ContainerDatesErrors>({})
  const formRef = useRef<HTMLFormElement>(null)
  const removing = Boolean(container.return_date) && !ret
  const billed = container.billed_in ?? []
  const bl = container.bl

  function submit() {
    const result = validateContainerDates(container, { discharge, ret, reason })
    setErrors(result.errors)
    if (result.input) onSubmit(result.input)
    // O foco vai ao primeiro campo com erro, onde está a mensagem.
    else requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
  }

  return (
    <form ref={formRef} className="app-dem-form" noValidate onSubmit={(event) => { event.preventDefault(); submit() }}>
      <dl className="app-dem-facts">
        <div><dt>B/L</dt><dd className="app-dem-code">{container.bl_id ?? '—'}</dd></div>
        <div><dt>Cliente</dt><dd>{bl?.customer?.name ?? 'Não vinculado'}</dd></div>
        <div><dt>Gravado hoje</dt><dd className="tabular-nums">Descarga {container.discharge_date ? formatDate(container.discharge_date) : '—'} · Devolução {container.return_date ? formatDate(container.return_date) : '—'}</dd></div>
      </dl>
      <div className="app-dem-form__grid">
        <Field label="Data de descarga" required error={errors.discharge}>
          <Input type="date" value={discharge} onChange={(event) => { setDischarge(event.target.value); setErrors((current) => ({ ...current, discharge: undefined, ret: undefined })) }} />
        </Field>
        <Field label="Data de devolução" error={errors.ret} hint={container.return_date ? 'Em branco remove a devolução gravada.' : undefined}>
          <Input type="date" value={ret} min={discharge || undefined} onChange={(event) => { setRet(event.target.value); setErrors((current) => ({ ...current, ret: undefined, reason: undefined })) }} />
        </Field>
      </div>
      {removing ? (
        <Field label="Motivo da remoção" required error={errors.reason} hint="Fica no Histórico. A devolução sai de todos os B/Ls que dividem o container nesta Viagem.">
          <Input value={reason} onChange={(event) => { setReason(event.target.value); setErrors((current) => ({ ...current, reason: undefined })) }} />
        </Field>
      ) : null}
      <p className="app-dem-note">As datas valem para todos os B/Ls ativos que dividem este container na Viagem, e o status de Demurrage é recalculado pelo banco.</p>
      {billed.length ? (
        <ImportNotice tone="warning" title={`Este container está ${billed.length > 1 ? 'nas Invoices' : 'na Invoice'} ${billed.map((ref) => `${ref.doc_number} (${statusLabel(DEMURRAGE_INVOICE_STATUS_LABELS, ref.status)})`).join(', ')}`}>
          <p>
            Se a mudança alterar o valor, a Invoice sem pagamento é cancelada e reemitida com as datas novas. Paga, com desconto ou com disputa aberta, ela sai da Régua e o alerta pede tratamento à mão.
          </p>
        </ImportNotice>
      ) : null}
      {error ? <p className="app-dem-form__error" role="alert">{error} As datas não foram alteradas.</p> : null}
      <div className="app-dem-form__actions">
        <Button type="button" variant="ghost" onClick={onClose}>Voltar</Button>
        <Button type="submit" loading={loading} loadingLabel="Salvando…">Salvar datas</Button>
      </div>
    </form>
  )
}

export function DemurrageContainerDatesModal({ container, ...props }: Props) {
  return (
    <Modal open={container != null} onClose={props.onClose} title={container ? `Datas do container ${container.container_number}` : 'Datas do container'} size="md">
      {container ? <ContainerDatesForm key={container.id} container={container} {...props} /> : null}
    </Modal>
  )
}

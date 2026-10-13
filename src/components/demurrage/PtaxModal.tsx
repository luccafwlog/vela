import { useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { DEMURRAGE_ROE_MARKUP } from '../../services/demurrage/demurrageKpis'
import { fmtBRL } from '../../services/demurrage/demurragePresentation'
import { PTAX_PLAUSIBLE_RANGE, isPlausiblePtax, parsePtaxInput } from './demurrageFormRules'

type Props = {
  open: boolean
  value: string
  loading: boolean
  error?: string | null
  /** Total em BRL hoje das Invoices emitidas e não pagas (o que será recalculado). */
  openTotalBrl?: number | null
  onValueChange: (value: string) => void
  onClose: () => void
  onSubmit: (ptax: number) => void
}

/**
 * Recálculo manual (`recalculate_demurrage_invoices_manual`): a PTAX de venda
 * vira ROE com o markup de 1,065 no banco e todas as Invoices emitidas e não
 * pagas passam a usar esse câmbio. Invoice paga não muda.
 */
export function PtaxModal({ open, value, loading, error = null, openTotalBrl = null, onValueChange, onClose, onSubmit }: Props) {
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [confirmedOutOfRange, setConfirmedOutOfRange] = useState<string | null>(null)
  const ptax = parsePtaxInput(value)
  const roe = ptax ? (ptax * DEMURRAGE_ROE_MARKUP).toFixed(4).replace('.', ',') : null

  // Erro e confirmação são do envio anterior; reabrir o modal começa limpo.
  useEffect(() => {
    if (open) {
      setFieldError(null)
      setConfirmedOutOfRange(null)
    }
  }, [open])

  function submit() {
    if (!ptax) {
      setFieldError('Informe a PTAX de venda, maior que zero, só com números e vírgula (ex.: 5,4321).')
      return
    }
    if (!isPlausiblePtax(ptax) && confirmedOutOfRange !== value) {
      setConfirmedOutOfRange(value)
      setFieldError(`PTAX fora da faixa usual (${PTAX_PLAUSIBLE_RANGE.min} a ${PTAX_PLAUSIBLE_RANGE.max}). Confira o valor; para usar mesmo assim, clique de novo em Recalcular Invoices.`)
      return
    }
    setFieldError(null)
    onSubmit(ptax)
  }

  return (
    <Modal open={open} onClose={() => { if (!loading) onClose() }} title="Informar PTAX" size="sm">
      <form className="app-dem-form" noValidate onSubmit={(event) => { event.preventDefault(); submit() }}>
        <p className="app-dem-note">
          Use quando o BCB estiver fora ou o recálculo automático falhar. Todas as Invoices emitidas e não pagas passam a usar este câmbio; as pagas não mudam.
        </p>
        <Field label="PTAX (cotação de venda)" required error={fieldError ?? undefined} hint={roe ? `ROE = PTAX × 1,065 = ${roe}` : 'Sem o markup; o banco aplica 1,065.'}>
          <Input inputMode="decimal" value={value} onChange={(event) => { onValueChange(event.target.value); setFieldError(null); setConfirmedOutOfRange(null) }} placeholder="5,4321" autoComplete="off" />
        </Field>
        {openTotalBrl != null ? <p className="app-dem-note">Hoje, as Invoices aguardando pagamento somam {fmtBRL(openTotalBrl)}.</p> : null}
        {error ? <p className="app-dem-form__error" role="alert">{error} Nenhuma Invoice foi recalculada.</p> : null}
        <div className="app-dem-form__actions">
          <Button type="button" variant="ghost" disabled={loading} onClick={onClose}>Voltar</Button>
          <Button type="submit" loading={loading} loadingLabel="Recalculando…">Recalcular Invoices</Button>
        </div>
      </form>
    </Modal>
  )
}

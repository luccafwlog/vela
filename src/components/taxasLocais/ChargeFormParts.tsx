import { AlertTriangle, Info, OctagonAlert } from 'lucide-react'
import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'
import { Input } from '../ui/Input'
import { markLabelableControl } from '../ui/labelableControls'
import type { ChargeNote } from './chargePresentation'

export type ChargeChange = { field: string; before: string; after: string }

const NOTE_ICON = { danger: OctagonAlert, warning: AlertTriangle, info: Info }

/** Uma consequência do cadastro no cálculo, em texto e ícone (não só cor). */
export function ChargeNoteLine({ note, className }: { note: ChargeNote; className?: string }) {
  const Icon = NOTE_ICON[note.tone]
  return (
    <p className={cn('app-rates-note', `app-rates-note--${note.tone}`, className)}>
      <Icon size={14} aria-hidden="true" className="app-rates-note__icon" />
      <span>
        <span className="sr-only">{note.tone === 'info' ? 'Informação: ' : 'Atenção: '}</span>
        {note.text}
      </span>
    </p>
  )
}

export function ChargeNoteList({ notes, className }: { notes: ChargeNote[]; className?: string }) {
  if (!notes.length) return null
  return (
    <div className={cn('app-rates-notes', className)}>
      {notes.map((note) => <ChargeNoteLine key={note.text} note={note} />)}
    </div>
  )
}

/**
 * Alterações da edição, campo a campo, logo acima do botão de salvar: a
 * conferência que antes pedia um segundo diálogo sobre o formulário.
 */
export function ChargeChanges({ changes, consequence }: { changes: ChargeChange[]; consequence: string }) {
  if (!changes.length) return <p className="app-rates-help" role="status">Nenhuma alteração ainda.</p>
  return (
    <section className="app-rates-changes" aria-label="Alterações a salvar" role="status">
      <h3 className="app-rates-changes__title">
        {changes.length === 1 ? '1 alteração' : `${changes.length} alterações`}
      </h3>
      <dl className="app-rates-changes__list">
        {changes.map((change) => (
          <div key={change.field} className="app-rates-changes__row">
            <dt>{change.field}</dt>
            <dd>
              <span className="app-rates-changes__before">{change.before || '—'}</span>
              <span aria-hidden="true"> → </span>
              <span className="sr-only"> passa a </span>
              <strong>{change.after || '—'}</strong>
            </dd>
          </div>
        ))}
      </dl>
      <p className="app-rates-help">{consequence}</p>
    </section>
  )
}

/** Campo de valor com a moeda à esquerda e a unidade à direita ("R$ … por container"). */
export const MoneyInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { prefix: string; suffix?: string }>(
  function MoneyInput({ prefix, suffix, className, ...props }, ref) {
    return (
      <span className="app-rates-money">
        <span className="app-rates-money__affix" aria-hidden="true">{prefix}</span>
        <Input ref={ref} inputMode="decimal" autoComplete="off" className={cn('app-rates-money__input', className)} {...props} />
        {suffix ? <span className="app-rates-money__affix app-rates-money__affix--suffix" aria-hidden="true">{suffix}</span> : null}
      </span>
    )
  },
)

markLabelableControl(MoneyInput)

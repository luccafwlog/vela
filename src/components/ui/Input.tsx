import { cloneElement, forwardRef, isValidElement, useId, type InputHTMLAttributes, type ReactElement, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'
import { isLabelableControl, markLabelableControl } from './labelableControls'

const base = 'app-input'

function hasWidthOverride(className?: string) {
  return /\b(?:w|min-w|max-w)-[^\s]+/.test(className ?? '')
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(base, !hasWidthOverride(className) && 'app-input--full', className)} {...props} />
})

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(base, 'app-select', !hasWidthOverride(className) && 'app-input--full', className)} {...props} />
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(base, 'app-input--full', 'app-textarea', className)} {...props} />
})

export function Field({
  label,
  children,
  error,
  required,
  hint,
}: {
  label: string
  children: React.ReactNode
  error?: string
  required?: boolean
  hint?: string
}) {
  const generatedId = useId()
  const hintId = hint ? `${generatedId}-hint` : undefined
  const errorId = error ? `${generatedId}-error` : undefined
  const child = isValidElement(children) ? children as ReactElement<Record<string, unknown>> : null
  const describedBy = [child?.props['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined
  // O rótulo só aponta para o controle por `htmlFor` quando o filho repassa
  // `id` a um elemento rotulável; os demais filhos (Combobox, grupos) seguem
  // envolvidos pelo `<label>`, como antes.
  const labelable = child !== null && isLabelableControl(child.type)
  const controlId = labelable ? (child.props.id as string | undefined) ?? `${generatedId}-control` : undefined
  const control = child
    ? cloneElement(child, {
        ...(labelable ? { id: controlId } : {}),
        required: child.props.required ?? (required || undefined),
        'aria-required': child.props['aria-required'] ?? (required || undefined),
        'aria-invalid': child.props['aria-invalid'] ?? (error ? true : undefined),
        'aria-describedby': describedBy,
      })
    : children
  const labelText = (
    <>
      {label}
      {required && <span className="app-field__required" aria-hidden="true"> *</span>}
    </>
  )
  const extras = (
    <>
      {hint ? <span id={hintId} className="app-field__hint">{hint}</span> : null}
      {error ? <span id={errorId} className="app-field__error" role="alert">{error}</span> : null}
    </>
  )
  if (labelable) {
    // Ajuda, erro e botões internos (Mostrar senha) ficam fora do `<label>`:
    // não entram no nome do campo nem movem o foco ao serem clicados.
    return (
      <div className="app-field">
        <label className="app-field__label" htmlFor={controlId}>{labelText}</label>
        {control}
        {extras}
      </div>
    )
  }
  return (
    <label className="app-field">
      <span className="app-field__label">{labelText}</span>
      {control}
      {extras}
    </label>
  )
}

markLabelableControl(Input)
markLabelableControl(Select)
markLabelableControl(Textarea)

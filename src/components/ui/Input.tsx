import { cloneElement, forwardRef, isValidElement, useId, type InputHTMLAttributes, type ReactElement, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

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

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(base, 'app-input--full', 'app-textarea', className)} {...props} />
}

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
  const control = child
    ? cloneElement(child, {
        required: child.props.required ?? (required || undefined),
        'aria-required': child.props['aria-required'] ?? (required || undefined),
        'aria-invalid': child.props['aria-invalid'] ?? (error ? true : undefined),
        'aria-describedby': describedBy,
      })
    : children
  return (
    <label className="app-field">
      <span className="app-field__label">
        {label}
        {required && <span className="app-field__required" aria-hidden="true"> *</span>}
      </span>
      {control}
      {hint ? <span id={hintId} className="app-field__hint">{hint}</span> : null}
      {error ? <span id={errorId} className="app-field__error" role="alert">{error}</span> : null}
    </label>
  )
}

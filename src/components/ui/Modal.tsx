import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import { Button } from './Button'

export function Modal({
  open,
  title,
  children,
  onClose,
  initialFocusRef,
  className,
  bodyClassName,
}: {
  open: boolean
  title: string
  children: React.ReactNode
  onClose: () => void
  initialFocusRef?: { readonly current: HTMLElement | null }
  className?: string
  bodyClassName?: string
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return
    const currentDialog = dialog
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null

    function getFocusable() {
      return currentDialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      )
    }

    const focusable = getFocusable()
    const first = focusable[0]

    ;(initialFocusRef?.current ?? first)?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { onCloseRef.current(); return }
      if (e.key !== 'Tab') return
      const focusable = getFocusable()
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (focusable.length === 0) { e.preventDefault(); return }
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last?.focus() }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first?.focus() }
      }
    }

    currentDialog.addEventListener('keydown', onKeyDown)
    return () => {
      currentDialog.removeEventListener('keydown', onKeyDown)
      previousActiveElement?.focus()
    }
  }, [initialFocusRef, open])

  if (!open) return null

  return (
    <div className="app-modal-backdrop">
      <div
        ref={dialogRef}
        className={['app-modal', className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="app-modal__header">
          <h2 id={titleId} className="app-modal__title">{title}</h2>
          <Button variant="ghost" className="app-modal__close" onClick={onClose} aria-label="Fechar modal">
            <X size={18} />
          </Button>
        </div>
        <div className={['app-modal__body', bodyClassName].filter(Boolean).join(' ')}>{children}</div>
      </div>
    </div>
  )
}

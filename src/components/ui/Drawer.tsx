import type { ReactNode } from 'react'
import { Modal } from './Modal'

/**
 * Painel lateral para consultar ou ajustar um registro sem perder a lista,
 * os filtros e a seleção. Reaproveita o Modal (foco preso, Escape, retorno do
 * foco, rolagem do corpo) com a geometria de `.app-drawer`; abaixo de 640px
 * ocupa a tela inteira. Promovido a partir do padrão do `ReviewDrawer`.
 */
export function Drawer({
  open,
  title,
  onClose,
  children,
  initialFocusRef,
  className,
  bodyClassName,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  initialFocusRef?: { readonly current: HTMLElement | null }
  className?: string
  bodyClassName?: string
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      initialFocusRef={initialFocusRef}
      className={['app-drawer', className].filter(Boolean).join(' ')}
      bodyClassName={bodyClassName}
    >
      {children}
    </Modal>
  )
}

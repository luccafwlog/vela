import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '../../lib/utils'

export type BlMenuItem = {
  key: string
  label: string
  icon?: ReactNode
  /** Ação do item; ignorada quando `to` é informado. */
  onSelect?: () => void
  to?: string
  danger?: boolean
  disabled?: boolean
}

type Position = { top: number; left: number }

/**
 * Botão com menu suspenso ("Importar", "Mais ações") da lista e da ficha do
 * B/L. O painel é `position: fixed` para não ser recortado pela rolagem da
 * tabela; abre focando o primeiro item, percorre com setas, Home e End, fecha
 * com Escape ou Tab e devolve o foco ao botão quando o fechamento veio do
 * teclado ou de um item.
 *
 * ponytail: menu local da etapa 05, sobre a classe `app-floating-menu` que a
 * página já usava. O design system ainda não tem menu (pendência da 01); quando
 * tiver, este componente vira um consumidor dele.
 */
export function BlMenu({
  label,
  trigger,
  items,
  triggerClassName,
  align = 'end',
  menuId,
}: {
  /** Nome acessível do botão. */
  label: string
  /** Conteúdo visível do botão (ícone, texto). */
  trigger: ReactNode
  items: BlMenuItem[]
  triggerClassName?: string
  /** `end` alinha a borda direita do menu ao botão; `start`, a esquerda. */
  align?: 'start' | 'end'
  menuId?: string
}) {
  const [position, setPosition] = useState<Position | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef(false)
  const open = position !== null
  const enabledItems = items.filter((item) => !item.disabled)

  function openMenu() {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setPosition({ top: rect.bottom + 4, left: align === 'end' ? rect.right : rect.left })
  }

  function close(focusTrigger: boolean) {
    returnFocus.current = focusTrigger
    setPosition(null)
  }

  useEffect(() => {
    if (open) {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus()
      return
    }
    if (returnFocus.current) triggerRef.current?.focus()
    returnFocus.current = false
  }, [open])

  // Mantém o painel inteiro dentro da janela, inclusive a 360 px.
  useLayoutEffect(() => {
    if (!position || !menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const width = rect.width
    const desiredLeft = align === 'end' ? position.left - width : position.left
    const left = Math.min(Math.max(desiredLeft, 4), Math.max(4, window.innerWidth - width - 4))
    const top = Math.min(Math.max(position.top, 4), Math.max(4, window.innerHeight - rect.height - 4))
    const anchoredLeft = align === 'end' ? left + width : left
    if (top !== position.top || anchoredLeft !== position.left) setPosition({ top, left: anchoredLeft })
  }, [position, align])

  useEffect(() => {
    if (!open) return
    const dismiss = () => close(false)
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close(true)
    }
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) dismiss()
    }
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onPointer)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onPointer)
    }
  }, [open])

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])
    const index = nodes.indexOf(document.activeElement as HTMLElement)
    const focusAt = (next: number) => nodes[(next + nodes.length) % nodes.length]?.focus()
    if (event.key === 'ArrowDown') { event.preventDefault(); focusAt(index + 1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); focusAt(index - 1) }
    else if (event.key === 'Home') { event.preventDefault(); focusAt(0) }
    else if (event.key === 'End') { event.preventDefault(); focusAt(nodes.length - 1) }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) }
    else if (event.key === 'Tab') close(false)
  }

  if (!enabledItems.length && !items.length) return null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            openMenu()
          }
        }}
      >
        {trigger}
      </button>
      {position ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className={cn('app-floating-menu', align === 'start' && 'app-floating-menu--start')}
          style={{ top: position.top, left: position.left }}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item) => {
            const className = item.danger ? 'app-floating-menu__danger' : undefined
            const content = (
              <>
                {item.icon}
                <span>{item.label}</span>
              </>
            )
            if (item.to && !item.disabled) {
              return (
                <Link key={item.key} role="menuitem" className={className} to={item.to} onClick={() => close(false)}>
                  {content}
                </Link>
              )
            }
            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className={className}
                aria-disabled={item.disabled || undefined}
                disabled={item.disabled}
                onClick={() => {
                  close(true)
                  item.onSelect?.()
                }}
              >
                {content}
              </button>
            )
          })}
        </div>
      ) : null}
    </>
  )
}

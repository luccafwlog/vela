import type { KeyboardEvent, ReactNode } from 'react'
import { cn } from '../../lib/utils'

const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown'])
const PREVIOUS_KEYS = new Set(['ArrowLeft', 'ArrowUp'])

/**
 * Faixa de abas do padrão único (sublinhado): `role="tablist"`, filete
 * inferior e navegação por setas, Home e End com ativação automática. As
 * abas continuam sendo `TabButton`; a aba ativa deve estar refletida na URL
 * pela página dona.
 */
export function TabList({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'))
    const current = tabs.indexOf(document.activeElement as HTMLButtonElement)
    if (current < 0 || tabs.length < 2) return
    let next: number
    if (NEXT_KEYS.has(event.key)) next = (current + 1) % tabs.length
    else if (PREVIOUS_KEYS.has(event.key)) next = (current - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    tabs[next].focus()
    tabs[next].click()
  }

  return (
    <div role="tablist" aria-label={label} className={cn('app-tablist', className)} onKeyDown={onKeyDown}>
      {children}
    </div>
  )
}

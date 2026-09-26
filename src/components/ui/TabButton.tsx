import { useEffect, useRef } from 'react'
import { revealInTabStrip } from '../../lib/tabStrip'

// Botão de aba reutilizável. Antes duplicado identicamente em Faturamento,
// TaxasLocais e Relatorios — unificado aqui para consistência.
export function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)

  // No celular a faixa de abas rola na horizontal (index.css, "Celular e
  // toque"); a aba ativa precisa aparecer mesmo quando é a última.
  useEffect(() => {
    if (active && ref.current) revealInTabStrip(ref.current)
  }, [active])

  return (
    <button
      ref={ref}
      className={`app-tab ${active ? 'app-tab--active' : ''}`}
      onClick={onClick}
      type="button"
      role="tab"
      aria-selected={active}
    >
      {label}
    </button>
  )
}

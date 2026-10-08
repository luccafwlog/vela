import { useEffect, useRef } from 'react'
import { revealInTabStrip } from '../../lib/tabStrip'

// Botão de aba reutilizável. Antes duplicado identicamente em Faturamento,
// TaxasLocais e Relatorios — unificado aqui para consistência. Use dentro de
// `TabList` para ganhar o filete e a navegação por setas.
export function TabButton({
  active,
  label,
  onClick,
  count,
  countLabel,
  id,
  controls,
}: {
  active: boolean
  label: string
  onClick: () => void
  /** Contagem da aba (pendências, registros); omitida quando ainda não carregou. */
  count?: number | null
  /** Leitura da contagem para leitor de tela; padrão "N registro(s)". */
  countLabel?: string
  id?: string
  /** Id do painel controlado pela aba. */
  controls?: string
}) {
  const ref = useRef<HTMLButtonElement>(null)

  // No celular a faixa de abas rola na horizontal (index.css, "Celular e
  // toque"); a aba ativa precisa aparecer mesmo quando é a última.
  useEffect(() => {
    if (active && ref.current) revealInTabStrip(ref.current)
  }, [active])

  return (
    <button
      ref={ref}
      id={id}
      className={`app-tab ${active ? 'app-tab--active' : ''}`}
      onClick={onClick}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={controls}
    >
      {label}
      {typeof count === 'number' ? (
        <span className="app-tab__count">
          <span aria-hidden="true">{count}</span>
          <span className="sr-only">{`, ${countLabel ?? `${count} ${count === 1 ? 'registro' : 'registros'}`}`}</span>
        </span>
      ) : null}
    </button>
  )
}

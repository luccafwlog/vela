import type { ReactNode } from 'react'
import { CircleCheck, CirclePlus, Layers } from 'lucide-react'

export type StatusTextTone = 'default' | 'warning' | 'danger' | 'muted' | 'paid'

/**
 * Situação em texto simples, sem selo colorido (regra 5, tabela limpa de
 * 2026-10-14): âmbar só no que pede ação, vermelho no que já venceu ou falhou, cinza no que encerrou sem efeito e
 * "Paga" com o ícone ✓ verde antes da palavra, em toda tela que mostra paga.
 */
export function StatusText({ tone = 'default', children }: { tone?: StatusTextTone; children: ReactNode }) {
  return (
    <span className={`app-status-text app-status-text--${tone}`}>
      {tone === 'paid' ? <CircleCheck size={14} aria-hidden="true" className="app-status-text__icon" /> : null}
      {children}
    </span>
  )
}

/** Marca de fatura consolidada: ícone pequeno ao lado do número, com o nome ao passar o mouse. */
export function ConsolidatedMark() {
  return (
    <span className="app-consolidated-mark" role="img" aria-label="Consolidada" title="Consolidada">
      <Layers size={14} aria-hidden="true" />
    </span>
  )
}

/**
 * Marca de Invoice complementar: o mesmo ícone pequeno da consolidada, ao lado
 * do número, com a Invoice que ela completa ao passar o mouse
 * ("Complementa a DEM-2026-0001").
 */
export function ComplementMark({ of }: { of: string }) {
  const label = `Complementa a ${of}`
  return (
    <span className="app-consolidated-mark" role="img" aria-label={label} title={label}>
      <CirclePlus size={14} aria-hidden="true" />
    </span>
  )
}

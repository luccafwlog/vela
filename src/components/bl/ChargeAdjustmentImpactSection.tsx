import { describeImpact } from '../../lib/chargeAdjustmentImpact'
import type { BlChargeImpact } from '../../services/charges/chargeOperationsService'

/** Seção **Taxas alteradas à mão** das prévias de importação (ADR 0111, D6). Nada quando nenhum B/L tem alteração. */
export function ChargeAdjustmentImpactSection({ impact }: { impact: readonly BlChargeImpact[] | null | undefined }) {
  const lines = describeImpact(impact ?? [])
  if (lines.length === 0) return null
  return (
    <section aria-label="Taxas alteradas à mão" className="grid gap-1 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-3">
      <h3 className="text-sm font-semibold text-[var(--app-text-strong)]">Taxas alteradas à mão</h3>
      <ul className="grid gap-0.5 text-sm text-[var(--app-text)]">
        {lines.map((line) => <li key={line}>{line}</li>)}
      </ul>
    </section>
  )
}

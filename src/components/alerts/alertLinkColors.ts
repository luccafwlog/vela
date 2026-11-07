import type { AlertLinkKind } from '../../services/alertRulesMap'

/** Cor de cada ligação, nos tokens da identidade. */
export const ALERT_LINK_COLORS: Record<AlertLinkKind, { color: string; dash?: string; arrow: boolean }> = {
  vira: { color: 'var(--app-red)', arrow: true },
  segura: { color: 'var(--app-gold-strong)', dash: '7 4', arrow: true },
  atrapalha: { color: 'var(--app-muted)', dash: '2 4', arrow: true },
  depois: { color: 'var(--app-blue)', arrow: true },
  mesma_causa: { color: 'var(--app-navy)', dash: '9 3 2 3', arrow: false },
}

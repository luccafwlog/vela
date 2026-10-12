import type { DemurrageDunningDisplay } from '../../services/demurrageDunning'
import { formatDate } from '../../lib/utils'

type Props = {
  display?: DemurrageDunningDisplay
  loading?: boolean
  error?: boolean
}

export function DemurrageDunningStatus({ display, loading = false, error = false }: Props) {
  if (loading) {
    return <div data-testid="demurrage-dunning-status" className="app-dem-dunning app-dem-dunning--muted">Verificando a Régua…</div>
  }
  if (error || !display) {
    return <div data-testid="demurrage-dunning-status" className="app-dem-dunning app-dem-dunning--warning">Régua indisponível</div>
  }

  return (
    <div data-testid="demurrage-dunning-status" className={display.pauseReason ? 'app-dem-dunning app-dem-dunning--warning' : 'app-dem-dunning'}>
      <div className="app-dem-dunning__label">{display.statusLabel}</div>
      {display.lastAttemptAt && !display.pauseReason ? (
        <div className="app-dem-dunning__meta">Último envio: {formatDate(display.lastAttemptAt)}</div>
      ) : null}
    </div>
  )
}

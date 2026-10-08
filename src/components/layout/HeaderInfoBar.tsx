import { useNavigate } from 'react-router-dom'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useOperationalAlerts } from '../../hooks/useOperationalAlerts'
import { useRoeHeaderRate } from '../../hooks/useRoeHeaderRate'

function formatRate(value: number | null): string {
  if (value === null) return '—'
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })
}

function formatEffectiveDate(value: string | null): string {
  if (!value) return '—'
  const [year, month, day] = value.split('-')
  return year && month && day ? `${day}/${month}/${year}` : value
}


export function HeaderInfoBar() {
  const navigate = useNavigate()
  const rates = useRoeHeaderRate()
  const alerts = useOperationalAlerts()

  const hasDemurrage = alerts.demurrageOverdue > 0

  const ratesHint = rates.unavailable
    ? 'Cotação PTAX indisponível no momento — tente atualizar mais tarde.'
    : rates.offline && rates.cachedAt
      ? `Cotação em cache de ${new Intl.DateTimeFormat('pt-BR').format(new Date(rates.cachedAt))}.`
      : 'Cotação PTAX Venda mais recente do Banco Central e ROE com spread fixo de 1,065.'

  const overdueLabel = `${alerts.demurrageOverdue} demurrage${alerts.demurrageOverdue !== 1 ? 's' : ''} vencido${alerts.demurrageOverdue !== 1 ? 's' : ''}`

  // Faixa de avisos de até 28 px (etapa 02): o aviso operacional à esquerda
  // nunca é cortado; o câmbio cede espaço e some abaixo de 768 px. A versão
  // da build foi para o menu da conta.
  return (
    <div className="app-market-strip">
      <div className="app-market-strip__content">
        <div className="app-market-strip__left">
          {hasDemurrage && (
            <button
              type="button"
              className="hib-alert-btn"
              onClick={() => navigate('/demurrage')}
              title={`${overdueLabel} — abrir Demurrage`}
            >
              <AlertTriangle size={14} aria-hidden="true" />
              {overdueLabel}
            </button>
          )}
        </div>

        <div className="app-market-strip__center" title={ratesHint}>
          {rates.loading ? (
            <span className="hib-currency-label">Carregando câmbio…</span>
          ) : rates.unavailable ? (
            <span className="hib-currency-label hib-currency-label--warning">Câmbio indisponível</span>
          ) : (
            <>
              <span className="hib-currency-label">PTAX venda</span>
              <span className="hib-currency-value">R$ {formatRate(rates.ptax)}</span>
              <span className="hib-sep" aria-hidden="true">·</span>
              <span className="hib-currency-label">ROE (PTAX × 1,065)</span>
              <span className="hib-currency-value">R$ {formatRate(rates.roe)}</span>
              <span className="hib-currency-label">{formatEffectiveDate(rates.effectiveDate)}</span>
              {rates.offline ? (
                <span className="hib-currency-label hib-currency-label--warning">em cache</span>
              ) : null}
            </>
          )}
          <button
            type="button"
            className="hib-alert-btn app-market-refresh"
            aria-label="Atualizar cotação PTAX"
            onClick={() => void rates.refresh()}
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}

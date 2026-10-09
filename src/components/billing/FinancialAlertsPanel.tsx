import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { getAlertTypeLabel, getEffectiveAlertType, type AlertQueueRow } from '../../services/alerts'
import { financialAlertAction } from './financialAlertAction'

const VISIBLE = 4

/**
 * Alertas financeiros em aberto no topo de /taxas-locais. Cada alerta diz o
 * tipo, a mensagem e leva ao lugar onde se resolve (a fatura abre no detalhe
 * desta página). Erro de consulta não some: avisa que a lista não foi lida.
 */
export function FinancialAlertsPanel({
  alerts,
  loading = false,
  error = false,
  onOpenInvoice,
  onOpenValidacao,
}: {
  alerts: AlertQueueRow[]
  loading?: boolean
  error?: boolean
  onOpenInvoice: (invoiceId: number) => void
  onOpenValidacao: (blId: string) => void
}) {
  if (loading) {
    return <div className="app-fin-alerts app-fin-alerts--loading" aria-busy="true"><span className="sr-only">Carregando alertas financeiros…</span></div>
  }
  if (error) {
    return (
      <div className="app-fin-alerts" role="status">
        <p className="app-fin-alerts__title"><AlertTriangle size={16} aria-hidden="true" />Não foi possível consultar os alertas financeiros.</p>
        <Link className="app-fin-alerts__link" to="/alertas">Abrir Alertas<ArrowRight size={14} aria-hidden="true" /></Link>
      </div>
    )
  }
  if (!alerts.length) return null

  return (
    <section className="app-fin-alerts" aria-labelledby="fin-alerts-title">
      <h2 id="fin-alerts-title" className="app-fin-alerts__title">
        <AlertTriangle size={16} aria-hidden="true" />
        {alerts.length} alerta{alerts.length !== 1 ? 's' : ''} financeiro{alerts.length !== 1 ? 's' : ''} em aberto
      </h2>
      <ul className="app-fin-alerts__list">
        {alerts.slice(0, VISIBLE).map((alert) => {
          const action = financialAlertAction(alert)
          return (
            <li key={alert.item_id ?? alert.id} className="app-fin-alerts__item">
              <span className="app-fin-alerts__type">{getAlertTypeLabel(getEffectiveAlertType(alert))}</span>
              <span className="app-fin-alerts__message">{alert.message}</span>
              {action?.kind === 'invoice' ? (
                <button type="button" className="app-fin-alerts__link" onClick={() => onOpenInvoice(action.invoiceId)}>
                  Abrir fatura<ArrowRight size={14} aria-hidden="true" />
                </button>
              ) : action?.kind === 'validacao' ? (
                <button type="button" className="app-fin-alerts__link" onClick={() => onOpenValidacao(action.blId)}>
                  Ver na Validação<ArrowRight size={14} aria-hidden="true" />
                </button>
              ) : action ? (
                <Link className="app-fin-alerts__link" to={action.to}>Abrir<ArrowRight size={14} aria-hidden="true" /></Link>
              ) : null}
            </li>
          )
        })}
      </ul>
      {alerts.length > VISIBLE ? (
        <Link className="app-fin-alerts__link" to="/alertas">
          Ver os outros {alerts.length - VISIBLE} em Alertas<ArrowRight size={14} aria-hidden="true" />
        </Link>
      ) : null}
    </section>
  )
}

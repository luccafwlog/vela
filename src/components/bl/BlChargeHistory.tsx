import { Block } from '../ui/Block'
import { Button } from '../ui/Button'
import { NoValue } from '../ui/NoValue'
import { useBlChargeHistory } from '../../hooks/useLocalCharges'
import { formatDateTime } from '../../lib/utils'
import { historyChangePhrase, historyInvoiceEffect } from './blChargeAdjustmentPresentation'

/** Bloco "Histórico das taxas", logo abaixo da tabela de Taxas Locais (ADR 0111, D10). */
export function BlChargeHistory({ blId }: { blId: string }) {
  const { data, isLoading, isError, refetch } = useBlChargeHistory(blId)
  const events = data ?? []

  return (
    <Block title="Histórico das taxas" flush>
      <div className="app-table-scroll">
        <table className="app-table app-table--compact">
          <caption className="sr-only">Histórico das alterações à mão nas Taxas Locais do B/L</caption>
          <thead>
            <tr>
              <th scope="col">Quando</th>
              <th scope="col" className="app-table__text-head">Quem</th>
              <th scope="col" className="app-table__text-head">Taxa</th>
              <th scope="col" className="app-table__text-head">O que mudou</th>
              <th scope="col" className="app-table__text-head">Justificativa</th>
              <th scope="col" className="app-table__text-head">Efeito na fatura</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td className="text-[var(--app-muted)]" colSpan={6}>Carregando histórico…</td></tr>
            ) : isError ? (
              <tr>
                <td colSpan={6}>
                  <span role="alert">Não foi possível carregar o histórico das taxas.</span>{' '}
                  <Button variant="secondary" className="app-btn--sm" onClick={() => void refetch()}>Tentar novamente</Button>
                </td>
              </tr>
            ) : events.length ? (
              events.map((event) => (
                <tr key={event.id}>
                  <td className="whitespace-nowrap tabular-nums">{formatDateTime(event.created_at)}</td>
                  <td className="app-table__text">{event.actor ? (event.actor_name ?? 'Usuário') : 'Sistema'}</td>
                  <td className="app-table__text">{event.charge_name ?? <NoValue label="B/L inteiro" />}</td>
                  <td className="app-table__text app-table__text--wrap">{historyChangePhrase(event)}</td>
                  <td className="app-table__text app-table__text--wrap">{event.justification ?? <NoValue label="Sem justificativa" />}</td>
                  <td className="app-table__text">{historyInvoiceEffect(event)}</td>
                </tr>
              ))
            ) : (
              <tr><td className="text-[var(--app-muted)]" colSpan={6}>Nenhuma alteração à mão nas taxas deste B/L.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Block>
  )
}

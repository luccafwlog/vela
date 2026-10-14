import { Block } from '../ui/Block'
import { StatusText } from '../ui/StatusText'
import { NoValue } from '../ui/NoValue'
import { useBlLocalChargeLines, useInvoicedSubtotalForBl } from '../../hooks/useLocalCharges'
import { formatBRL, formatDateTime, formatUSD } from '../../lib/utils'
import { isBlFinanciallyLocked } from '../../lib/chargeStatus'
import type { LocalChargeLine } from '../../services/charges/chargeOperationsService'
import { applicationBasisLabel, detectarDivergenciaComFatura, groupChargeLinesByTable, sumChargeLines } from './conferenciaCalculo'

function formatQuantity(value: number | null): string | null {
  const amount = Number(value ?? 0)
  if (!Number.isFinite(amount)) return null
  return amount.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}

// O motor grava total_value_brl (e por vezes unit_value_brl) como NULL em
// linhas USD — a moeda da linha é quem decide a coluna a ler, não se o valor
// USD é diferente de zero (uma linha USD de valor 0 continua sendo USD).
function lineUnitValue(line: LocalChargeLine) {
  if (line.currency === 'USD') return formatUSD(line.unit_value_usd ?? 0)
  return formatBRL(line.unit_value_brl)
}

function lineTotalValue(line: LocalChargeLine) {
  if (line.currency === 'USD') return formatUSD(line.total_value_usd ?? 0)
  return formatBRL(line.total_value_brl)
}

// Idem para os totais agregados: um grupo ou B/L só em USD soma totalBrl=0,
// e headlinear "R$ 0,00" nesse caso esconderia o valor real atrás do detalhe
// em cinza. Só mistura as duas moedas quando ambas têm valor de fato.
function renderTotal(totalBrl: number, totalUsd: number) {
  if (totalBrl === 0 && totalUsd !== 0) {
    return <span>{formatUSD(totalUsd)}</span>
  }
  return (
    <span>
      {formatBRL(totalBrl)}
      {totalUsd !== 0 ? <> · {formatUSD(totalUsd)}</> : null}
    </span>
  )
}

// Conferência de cálculo: mostra COMO se chegou ao valor, não só qual é. Cada
// grupo nomeia a tabela de cobrança que produziu suas linhas (migration 369),
// porque a escolha da tabela segue o porto de descarga e é a primeira coisa a
// conferir quando o valor parece errado. Nasce aberta: quem expande o B/L na
// Validação está ali justamente para conferir.
export function ConferenciaCalculo({
  blId,
  financialStatus,
  calculatedAt,
}: {
  blId: string
  financialStatus: string | null
  calculatedAt?: string | null
}) {
  const { data, isLoading, isError } = useBlLocalChargeLines(blId)
  const lines = data ?? []
  const groups = groupChargeLinesByTable(lines)
  const total = sumChargeLines(lines)
  const invoiced = isBlFinanciallyLocked(financialStatus)
  const { data: faturado } = useInvoicedSubtotalForBl(blId, invoiced)
  const divergencia = invoiced && lines.length > 0 ? detectarDivergenciaComFatura(total, faturado ?? null) : null

  return (
    <Block
      title="Conferência do cálculo"
      headingLevel={4}
      flush
      aside={(
        <span>
          {calculatedAt ? `calculado em ${formatDateTime(calculatedAt)}` : 'sem cálculo registrado'}
          {lines.length > 0 ? <> · {renderTotal(total.totalBrl, total.totalUsd)}</> : null}
        </span>
      )}
    >
      {invoiced && lines.length > 0 ? <p className="app-block__body app-facts__detail">Linhas que compuseram a fatura emitida.</p> : null}
      {divergencia ? (
        <p className="app-block__body" role="status">
          <StatusText tone="warning">O total calculado não bate com o que a fatura registrou.</StatusText>{' '}
          Cálculo {renderTotal(divergencia.calculado.totalBrl, divergencia.calculado.totalUsd)} · fatura{' '}
          {renderTotal(divergencia.faturado.totalBrl, divergencia.faturado.totalUsd ?? 0)}. Em fatura consolidada, o
          detalhamento por item é congelado como uma linha agregada quando a soma não fecha com o saldo do B/L; o
          que vale para o Cliente é o valor da fatura.
        </p>
      ) : null}

      {isLoading ? (
        <p className="app-block__body app-facts__detail" role="status">Carregando linhas de cálculo…</p>
      ) : isError ? (
        <p className="app-block__body" role="alert"><StatusText tone="warning">Falha ao carregar as linhas de cálculo deste B/L.</StatusText></p>
      ) : lines.length === 0 ? (
        <p className="app-block__body app-facts__detail">
          Nenhuma linha de taxa calculada para este B/L. Recalcule para conferir o valor.
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.key}>
            <div className="app-block__body flex items-baseline justify-between gap-3">
              <span>
                <strong>{group.title}</strong>
                {group.kind === 'sem_tabela' ? <> <StatusText tone="warning">Anomalia</StatusText></> : null}
                {group.subtitle ? <span className="app-facts__detail"> · {group.subtitle}</span> : null}
              </span>
              <strong>{renderTotal(group.totalBrl, group.totalUsd)}</strong>
            </div>
            <table className="app-table app-table--dense app-table--nested w-full">
              <caption className="sr-only">{`Linhas de ${group.title}`}</caption>
              <thead>
                <tr>
                  <th scope="col" className="app-table__text-head">Taxa</th>
                  <th scope="col" className="app-table__text-head">Base</th>
                  <th scope="col">Qtd.</th>
                  <th scope="col">Unitário</th>
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {group.lines.map((line) => (
                  <tr key={line.id}>
                    <td className="app-table__text app-table__text--wrap">
                      {line.charge_name}
                      {line.override_applied ? <> <StatusText tone="muted">tarifa negociada</StatusText></> : null}
                      {line.status === 'review_required' ? <> <StatusText tone="warning">{line.review_reason ?? 'em revisão'}</StatusText></> : null}
                    </td>
                    <td className="app-table__text">{applicationBasisLabel(line.application_basis) ?? <NoValue label="Sem base" />}</td>
                    <td className="tabular-nums">{formatQuantity(line.quantity) ?? <NoValue label="Sem quantidade" />}</td>
                    <td className="whitespace-nowrap tabular-nums">{lineUnitValue(line)}</td>
                    <td className="whitespace-nowrap tabular-nums">{lineTotalValue(line)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </Block>
  )
}

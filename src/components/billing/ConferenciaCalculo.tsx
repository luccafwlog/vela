import { Badge } from '../ui/Badge'
import { NoValue } from '../ui/NoValue'
import { useBlLocalChargeLines, useInvoicedSubtotalForBl } from '../../hooks/useLocalCharges'
import { formatBRL, formatUSD } from '../../lib/utils'
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
    return <span className="text-[var(--app-text-strong)]">{formatUSD(totalUsd)}</span>
  }
  return (
    <span className="text-[var(--app-text-strong)]">
      {formatBRL(totalBrl)}
      {totalUsd !== 0 ? <span className="ml-2 text-xs text-[var(--app-muted)]">{formatUSD(totalUsd)}</span> : null}
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
}: {
  blId: string
  financialStatus: string | null
}) {
  const { data, isLoading, isError } = useBlLocalChargeLines(blId)
  const lines = data ?? []
  const groups = groupChargeLinesByTable(lines)
  const total = sumChargeLines(lines)
  const invoiced = financialStatus === 'invoiced'
  const { data: faturado } = useInvoicedSubtotalForBl(blId, invoiced)
  const divergencia = invoiced && lines.length > 0 ? detectarDivergenciaComFatura(total, faturado ?? null) : null

  return (
    <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <div className="app-metric-tile__label">Conferência de cálculo</div>
        {lines.length > 0 ? <div className="text-sm font-medium">{renderTotal(total.totalBrl, total.totalUsd)}</div> : null}
      </div>
      <div className="mb-3 text-xs text-[var(--app-muted)]">
        {invoiced
          ? 'Linhas que compuseram a fatura emitida.'
          : 'Linhas calculadas para este B/L, pela tabela de cobrança de cada origem.'}
      </div>

      {divergencia ? (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <div className="font-medium text-amber-800">O total calculado não bate com o que a fatura registrou.</div>
          <div className="mt-1 text-amber-700">
            Cálculo {renderTotal(divergencia.calculado.totalBrl, divergencia.calculado.totalUsd)} · fatura{' '}
            {renderTotal(divergencia.faturado.totalBrl, divergencia.faturado.totalUsd ?? 0)}. Em fatura consolidada, o
            detalhamento por item é congelado como uma linha agregada quando a soma não fecha com o saldo do B/L — o
            que vale para o cliente é o valor da fatura.
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <div className="text-sm text-[var(--app-muted)]">Carregando linhas de cálculo...</div>
      ) : isError ? (
        <div className="text-sm text-red-600">Falha ao carregar as linhas de cálculo deste B/L.</div>
      ) : lines.length === 0 ? (
        <div className="text-sm text-[var(--app-muted)]">
          Nenhuma linha de taxa calculada para este B/L. Recalcule as taxas para conferir o valor.
        </div>
      ) : (
        <div className="grid gap-4">
          {groups.map((group) => (
            <div key={group.key}>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <div className="whitespace-normal text-sm font-medium text-[var(--app-text-strong)]">
                  {group.title}
                  {group.kind === 'sem_tabela' ? (
                    <Badge tone="red" className="ml-2">
                      Anomalia
                    </Badge>
                  ) : null}
                </div>
                <div className="text-sm">{renderTotal(group.totalBrl, group.totalUsd)}</div>
              </div>
              {group.subtitle ? <div className="mb-2 text-xs text-[var(--app-muted)]">{group.subtitle}</div> : null}
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-[var(--app-muted)]">
                    <th scope="col" className="py-1 pr-3 font-medium">Item</th>
                    <th scope="col" className="py-1 pr-3 font-medium">Qtd.</th>
                    <th scope="col" className="py-1 pr-3 font-medium">Unitário</th>
                    <th scope="col" className="py-1 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {group.lines.map((line) => {
                    const basis = applicationBasisLabel(line.application_basis)
                    return (
                      <tr key={line.id} className="border-t border-[var(--app-border)]">
                        <td className="py-1.5 pr-3">
                          <div className="whitespace-normal text-[var(--app-text-strong)]">{line.charge_name}</div>
                          <div className="whitespace-normal text-xs text-[var(--app-muted)]">
                            {basis ? <span>{basis}</span> : null}
                            {line.override_applied ? <span className="ml-2 text-amber-600">tarifa negociada</span> : null}
                            {line.status === 'review_required' ? (
                              <span className="ml-2 text-amber-600">{line.review_reason ?? 'em revisão'}</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="py-1.5 pr-3 align-top">{formatQuantity(line.quantity) ?? <NoValue label="Sem quantidade" />}</td>
                        <td className="py-1.5 pr-3 align-top">{lineUnitValue(line)}</td>
                        <td className="py-1.5 text-right align-top text-[var(--app-text-strong)]">{lineTotalValue(line)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

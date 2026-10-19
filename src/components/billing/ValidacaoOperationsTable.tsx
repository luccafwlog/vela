import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Calculator, CheckSquare, ChevronDown, ChevronRight, FileCheck2, FileText, Link2, Square, UserRound } from 'lucide-react'
import { Block, Fact, FactList } from '../ui/Block'
import { StatusText } from '../ui/StatusText'
import { Button } from '../ui/Button'
import { RowActionButton } from '../ui/RowActionButton'
import { EmptyState, InlineError } from '../ui/Card'
import { CopyValue } from '../ui/CopyValue'
import { NoValue } from '../ui/NoValue'
import { useBlLocalChargeLines } from '../../hooks/useLocalCharges'
import { formatBRL, formatCnpjCpf } from '../../lib/utils'
import { bandText, CALM_CODES, type ReasonEvent } from './validacaoBand'
import { formatPortDisplayName } from '../../lib/voyageFormat'
import { isCustomerReconciliationResolved } from '../../services/customerReconciliation'
import type { LocalChargeOperationalRow } from '../../services/charges/chargeOperationsService'
import { ConferenciaCalculo } from './ConferenciaCalculo.tsx'
import { getBillingBlock, isBlLockedForRecalc } from './validacaoPipeline'

type ReconciliationQueueItem = {
  id: number
  bl_id: string
  customer_id: number | null
  current_customer_name: string | null
  cnpj_cpf: string | null
  manifest_customer_name: string | null
  detection_type: string | null
}

export function ValidacaoOperationsTable({
  rows,
  isLoading,
  hasError,
  selectedRowIds,
  areAllRowsSelected,
  expandedBlId,
  reconciliationQueue,
  reasonEvents,
  onToggleAllRows,
  onToggleRow,
  onToggleExpandedRow,
  onIssueSingleInvoice,
  onRecalculateRow,
}: {
  rows: LocalChargeOperationalRow[]
  isLoading: boolean
  hasError: boolean
  selectedRowIds: string[]
  areAllRowsSelected: boolean
  expandedBlId: string | null
  reconciliationQueue: ReconciliationQueueItem[]
  /** Fato do histórico que explica o motivo, por B/L (ex.: falha da emissão automática). */
  reasonEvents?: ReadonlyMap<string, ReasonEvent>
  onToggleAllRows: () => void
  onToggleRow: (blId: string) => void
  onToggleExpandedRow: (blId: string) => void
  onIssueSingleInvoice: (row: LocalChargeOperationalRow) => void
  onRecalculateRow?: (row: LocalChargeOperationalRow) => void
}) {
  const columns = 8
  return (
    <>
      {hasError ? <InlineError message="Falha ao carregar operação de taxas locais." /> : null}
      <div className="app-table-scroll">
        <table className="app-table app-table--compact">
          <caption className="sr-only">B/Ls da operação de taxas locais</caption>
          <thead>
            <tr>
              <th scope="col">
                <button className="app-table__icon-button" type="button" onClick={onToggleAllRows} title="Selecionar todos" aria-label="Selecionar todos os B/Ls">
                  {areAllRowsSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                </button>
              </th>
              <th scope="col"><span className="sr-only">Abrir detalhes</span></th>
              <th scope="col">B/L</th>
              {/* Abaixo de 1024 px, Cliente e Navio / Viagem saem da linha e ficam na expansão. */}
              <th scope="col" className="app-table__text-head hidden lg:table-cell">Cliente</th>
              <th scope="col" className="app-table__text-head hidden lg:table-cell">Navio / Viagem</th>
              <th scope="col">Motivo</th>
              <th scope="col">Subtotal</th>
              <th scope="col"><span className="sr-only">Ação</span></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={columns}>Carregando operação…</td>
              </tr>
            ) : null}
            {!isLoading && rows.length === 0 ? (
              <tr>
                <td colSpan={columns} className="p-0">
                  {hasError ? <span className="sr-only">Sem dados: a consulta falhou.</span> : <EmptyState title="Nenhum B/L encontrado." description="Ajuste os filtros de viagem, POD ou motivo." />}
                </td>
              </tr>
            ) : null}
            {rows.map((row) => {
              const isExpanded = expandedBlId === row.id
              const reconciliationPending = !isCustomerReconciliationResolved(row.customer_reconciliation_status)
              const queueItem = reconciliationPending ? (reconciliationQueue.find((q) => q.bl_id === row.id) ?? null) : null
              const block = getBillingBlock(row)
              const voyage = [row.voyage?.vessel?.name, row.voyage?.voyage_number].filter(Boolean).join(' / ')
              return (
                <Fragment key={row.id}>
                  <tr>
                    <td>
                      <button className="app-table__icon-button" type="button" onClick={() => onToggleRow(row.id)} title="Selecionar B/L" aria-label={`Selecionar B/L ${row.id}`}>
                        {selectedRowIds.includes(row.id) ? <CheckSquare size={14} /> : <Square size={14} />}
                      </button>
                    </td>
                    <td>
                      <button
                        className="app-table__icon-button"
                        type="button"
                        onClick={() => onToggleExpandedRow(row.id)}
                        aria-label={`${isExpanded ? 'Recolher' : 'Expandir'} detalhes do B/L ${row.id}`}
                        aria-expanded={isExpanded}
                        aria-controls={`validacao-${row.id}`}
                      >
                        {isExpanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                      </button>
                    </td>
                    <td className="whitespace-nowrap">
                      <CopyValue value={row.id} label="número do B/L">
                        <Link className="app-invoices__bl" to={`/bls/${encodeURIComponent(row.id)}`}>{row.id}</Link>
                      </CopyValue>
                    </td>
                    <td className="app-table__text hidden lg:table-cell" title={row.customer?.name ?? undefined}>
                      {row.customer?.name ?? (queueItem?.manifest_customer_name ? <StatusText tone="muted">{queueItem.manifest_customer_name}</StatusText> : <NoValue label="Sem Cliente" />)}
                    </td>
                    <td className="app-table__text hidden lg:table-cell" title={voyage || undefined}>{voyage || <NoValue label="Sem navio e viagem" />}</td>
                    <td className="whitespace-nowrap" title={block.detail}>{block.label}</td>
                    <td className="whitespace-nowrap tabular-nums">{formatBRL(row.totals.total_brl)}</td>
                    <td className="whitespace-nowrap"><ResolveAction row={row} code={block.code} onIssue={onIssueSingleInvoice} onRecalculate={onRecalculateRow} iconOnly /></td>
                  </tr>
                  {isExpanded ? (
                    <tr id={`validacao-${row.id}`} data-row-detail>
                      <td colSpan={columns}>
                        <div className="grid items-start gap-4 xl:grid-cols-2">
                          <Block title="Situação do B/L" headingLevel={4}>
                            <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 ${block.code === 'pronto' ? 'border-[var(--app-success-border)] bg-[var(--app-success-bg)] text-[var(--app-success-fg)]' : CALM_CODES.has(block.code) ? 'border-[var(--app-border)] bg-[var(--app-surface)]' : 'border-[var(--app-warning-border)] bg-[var(--app-warning-bg)] text-[var(--app-warning-fg)]'}`}>
                              <p className="font-semibold">{bandText(block, reasonEvents?.get(row.id))}</p>
                              <ResolveAction row={row} code={block.code} onIssue={onIssueSingleInvoice} onRecalculate={onRecalculateRow} />
                            </div>
                            <FactList>
                              {/* Só abaixo de 1024 px, onde a coluna Navio / Viagem some da tabela. */}
                              <Fact label="Navio / Viagem" className="app-facts__item--narrow-only">{voyage || <NoValue label="Sem navio e viagem" />}</Fact>
                              <Fact label="Trecho">{formatPortDisplayName(row.pol)} → {formatPortDisplayName(row.pod)}</Fact>
                              <Fact label="CE Mercante">{row.ce_mercante?.trim() ? <CopyValue value={row.ce_mercante} label="CE Mercante" /> : <NoValue label="CE Mercante não informado" />}</Fact>
                              <Fact label="Cliente" detail={!row.customer?.id && queueItem?.manifest_customer_name ? 'Nome no manifesto; sem Cliente vinculado' : null}>
                                {row.customer?.name ?? queueItem?.manifest_customer_name ?? <NoValue label="Sem Cliente vinculado" />}
                              </Fact>
                              <Fact label="CNPJ">
                                {(row.customer?.cnpj_cpf ?? queueItem?.cnpj_cpf) ? <CopyValue value={formatCnpjCpf((row.customer?.cnpj_cpf ?? queueItem?.cnpj_cpf)!)} label="CNPJ/CPF" /> : <NoValue label="Sem CNPJ" />}
                              </Fact>
                            </FactList>
                            {row.charge_status === 'review_required' ? <ReviewRequiredReasons blId={row.id} holdReason={row.billing_hold_reason} /> : null}
                          </Block>
                          <ConferenciaCalculo blId={row.id} financialStatus={row.financial_status} calculatedAt={row.charges_calculated_at} />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

/**
 * Uma ação por linha, a que resolve o motivo: Recalcular, Vincular na Revisão,
 * Cadastrar CE, Abrir Cliente ou Emitir (lote 1 da identidade). Na linha da
 * tabela, só o ícone (`iconOnly`, regra 9); na faixa da linha aberta, com texto.
 */
function ResolveAction({
  row,
  code,
  onIssue,
  onRecalculate,
  iconOnly = false,
}: {
  row: LocalChargeOperationalRow
  code: string
  onIssue: (row: LocalChargeOperationalRow) => void
  onRecalculate?: (row: LocalChargeOperationalRow) => void
  iconOnly?: boolean
}) {
  const link = (to: string, label: string, Icon: typeof ArrowRight) => iconOnly
    ? <Link className="app-btn app-btn--secondary app-btn--icon" to={to} aria-label={label} title={label}><Icon size={15} aria-hidden="true" /></Link>
    : <Link className="app-btn app-btn--secondary app-btn--sm" to={to}>{label} <ArrowRight size={14} aria-hidden="true" /></Link>
  if (code === 'pronto' && row.customer?.id && !isBlLockedForRecalc(row.financial_status)) {
    return iconOnly
      ? <RowActionButton label="Emitir" icon={FileCheck2} variant="primary" onClick={() => onIssue(row)} />
      : <Button className="app-btn--sm" onClick={() => onIssue(row)}>Emitir</Button>
  }
  if (code === 'sem_cliente') {
    return link(`/revisao?bl=${encodeURIComponent(row.id)}`, 'Vincular na Revisão', Link2)
  }
  if (code === 'aguardando_ce') {
    return link(`/bls/${encodeURIComponent(row.id)}`, 'Cadastrar CE', FileText)
  }
  if (code === 'portal_nao_provisionado') {
    // Conhecer o bloqueio não é o mesmo que poder resolvê-lo: a ficha aplica a própria permissão.
    if (!row.customer?.cnpj_cpf) return null
    return link(`/clientes/${encodeURIComponent(row.customer.cnpj_cpf)}`, 'Abrir Cliente', UserRound)
  }
  if (code === 'calculo_incompleto' && !isBlLockedForRecalc(row.financial_status)) {
    return iconOnly
      ? <RowActionButton label="Recalcular" icon={Calculator} onClick={() => onRecalculate?.(row)} />
      : <Button variant="secondary" className="app-btn--sm" onClick={() => onRecalculate?.(row)}>Recalcular</Button>
  }
  return null
}


function ReviewRequiredReasons({ blId, holdReason }: { blId: string; holdReason: string | null }) {
  const { data, isLoading } = useBlLocalChargeLines(blId)
  const pendingLines = (data ?? []).filter(
    (line) => line.status === 'review_required' && (line.review_reason ?? '').trim().length > 0,
  )

  return (
    <div className="rounded-lg border border-[var(--app-warning-border)] bg-[var(--app-warning-bg)] p-4 text-[var(--app-text)]">
      <div className="mb-2 text-sm font-semibold text-[var(--app-warning-fg)]">
        Pendências de revisão das taxas
      </div>
      {holdReason ? (
        <div className="mb-2 text-sm">
          <span className="font-medium">Bloqueio:</span> {holdReason}
        </div>
      ) : null}
      {isLoading ? (
        <div className="text-sm text-[var(--app-muted)]">Carregando motivos…</div>
      ) : pendingLines.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {pendingLines.map((line) => (
            <li key={line.id}>
              <span className="font-medium">{line.charge_name}:</span> {line.review_reason}
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-[var(--app-muted)]">Nenhum motivo detalhado encontrado nas linhas de cálculo.</div>
      )}
    </div>
  )
}




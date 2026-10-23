import { Fragment, useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Link2 } from 'lucide-react'
import { Block, Fact, FactList } from '../ui/Block'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/Card'
import { CopyValue } from '../ui/CopyValue'
import { Field, Input, Select } from '../ui/Input'
import { NoValue } from '../ui/NoValue'
import { RowActionButton } from '../ui/RowActionButton'
import { SkeletonTable } from '../ui/Skeleton'
import { StatusText } from '../ui/StatusText'
import { TableFooterPagination } from '../ui/TableFooterPagination'
import { RowToggle } from './PixPendingPanel'
import { useAuth } from '../../hooks/useAuth'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { extractErrorText } from '../../lib/errors'
import { formatBRL, formatCnpjCpf } from '../../lib/utils'
import { afterPixConciliado } from '../../services/cacheEffects'
import { queryKeys } from '../../services/queryKeys'
import {
  listItauPixReceiptCandidates,
  listItauPixReceipts,
  settleItauPixReceipt,
  type ItauPixReceipt,
  type ItauPixReceiptCandidate,
  type ItauPixReceiptFilters,
} from '../../services/reconciliacao'
import {
  HISTORY_PAGE_SIZES,
  countActiveReceivedFilters,
  receivedStateFromSearch,
  withReceivedFilter,
  withReceivedPage,
  withReceivedPageSize,
  withoutReceivedFilters,
  type ReceivedFilterKey,
} from '../../pages/reconciliacaoState'
import {
  bankExtraFields,
  formatBrasiliaInstant,
  parsePixAmountFilter,
  pluralize,
  receiptInvoice,
  receiptOriginLabel,
  receiptSituation,
} from './pixReconciliationPresentation'

type OpenInvoice = (source: 'local' | 'demurrage', invoiceId: number) => void

const sourceLabel = (source: 'local' | 'demurrage') => (source === 'demurrage' ? 'Demurrage' : 'Taxas Locais')

/** Data e hora de Brasília na célula da tabela, sem o "às" da frase. */
const cellInstant = (value: string | null | undefined) => formatBrasiliaInstant(value).replace(' às', '')

function payerLine(receipt: Pick<ItauPixReceipt, 'payerName' | 'payerDocument'>): string | null {
  const document = receipt.payerDocument ? formatCnpjCpf(receipt.payerDocument) : null
  return receipt.payerName ?? document
}

/**
 * Aba Pix recebidos (ADR 0100): todo Pix que o Itaú informou na consulta de
 * recebimentos, inclusive o que não veio de uma cobrança do Vela (chave
 * digitada, QR de outro sistema na mesma chave). Só o Pix de cobrança do Vela
 * em análise pede ação, e ela é feita em Pendências; para os demais, dar a
 * baixa numa fatura é opção de quem concilia, na linha aberta. Filtros,
 * página e tamanho ficam na URL com o prefixo `pix`.
 */
export function PixReceivedPanel({ onOpenInvoice }: { onOpenInvoice: OpenInvoice }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const state = receivedStateFromSearch(searchParams)
  const search = useDebouncedValue(state.search.trim())
  const amount = parsePixAmountFilter(useDebouncedValue(state.amount))
  const amountInvalid = Number.isNaN(amount)
  const [openId, setOpenId] = useState<string | null>(null)

  const filters: ItauPixReceiptFilters = {
    from: state.from,
    to: state.to,
    situation: state.situation,
    origin: state.origin,
    amount: amountInvalid ? null : amount,
    search,
    page: state.page,
    pageSize: state.pageSize,
  }
  const activeCount = countActiveReceivedFilters(state)

  const query = useQuery({
    queryKey: [...queryKeys.reconciliation.itauPixReceipts(), filters],
    queryFn: () => listItauPixReceipts(filters),
    enabled: !amountInvalid,
    // A consulta do Itaú grava Pix novos a cada minuto.
    refetchInterval: 60_000,
  })

  // Valor ilegível não consulta: a tabela não mostra o recorte anterior como se fosse este.
  const page = amountInvalid ? undefined : query.data
  const rows = page?.rows ?? []
  const totalCount = page?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / state.pageSize))
  const failed = !amountInvalid && Boolean(query.error)
  const pastEnd = Boolean(page) && state.page > totalPages
  const payerVisible = page?.payerVisible ?? false
  const columns = payerVisible ? 7 : 6

  const update = (next: (params: URLSearchParams) => URLSearchParams) => setSearchParams((params) => next(params), { replace: true })
  useEffect(() => {
    if (pastEnd) setSearchParams((params) => withReceivedPage(params, totalPages), { replace: true })
  }, [pastEnd, totalPages, setSearchParams])
  const setFilter = (key: ReceivedFilterKey, value: string) => update((params) => withReceivedFilter(params, key, value))

  const empty = !query.isLoading && !failed && !pastEnd && !amountInvalid && rows.length === 0
  const emptyState = activeCount > 0 ? (
    <EmptyState
      title="Nenhum Pix neste recorte"
      description="Nenhum Pix recebido bate com os filtros."
      action={<Button variant="secondary" onClick={() => update(withoutReceivedFilters)}>Limpar filtros</Button>}
    />
  ) : (
    <EmptyState
      title="Nenhum Pix recebido ainda"
      description="Os Pix que o Itaú informa na consulta de recebimentos aparecem aqui, inclusive os que não vieram de uma cobrança do Vela."
    />
  )

  return (
    <div className="grid min-w-0 gap-4 pt-1">
      <div className="grid gap-3" role="group" aria-label="Filtros dos Pix recebidos">
        <div className="app-filter-grid">
          <Field label="Recebido de">
            <Input type="date" value={state.from} max={state.to || undefined} onChange={(e) => setFilter('from', e.target.value)} />
          </Field>
          <Field label="Recebido até">
            <Input type="date" value={state.to} min={state.from || undefined} onChange={(e) => setFilter('to', e.target.value)} />
          </Field>
          <Field label="Situação">
            <Select value={state.situation} onChange={(e) => setFilter('situation', e.target.value)}>
              <option value="">Todas</option>
              <option value="received">Sem baixa</option>
              <option value="settled">Com baixa</option>
              <option value="review">Em análise</option>
              <option value="handled">Tratado</option>
            </Select>
          </Field>
          <Field label="Origem">
            <Select value={state.origin} onChange={(e) => setFilter('origin', e.target.value)}>
              <option value="">Todas</option>
              <option value="vela">{receiptOriginLabel('vela')}</option>
              <option value="none">{receiptOriginLabel('none')}</option>
              <option value="other">{receiptOriginLabel('other')}</option>
              <option value="test">{receiptOriginLabel('test')}</option>
            </Select>
          </Field>
          <Field label="Valor" error={amountInvalid ? 'Valor ilegível: use 1.234,56.' : undefined}>
            <Input type="text" inputMode="decimal" placeholder="0,00" value={state.amount} onChange={(e) => setFilter('amount', e.target.value)} />
          </Field>
          <Field label="Buscar">
            <Input
              type="text"
              placeholder={payerVisible ? 'Pagador, identificador ou fatura' : 'Identificador ou fatura'}
              value={state.search}
              onChange={(e) => setFilter('search', e.target.value)}
            />
          </Field>
          {activeCount > 0 ? (
            <div className="self-end">
              <Button variant="ghost" onClick={() => update(withoutReceivedFilters)}>Limpar filtros</Button>
            </div>
          ) : null}
        </div>
      </div>

      <Block
        title="Pix recebidos"
        flush
        aside={(
          <span aria-live="polite">
            {page && !failed
              ? `${pluralize(page.total, 'Pix', 'Pix')} · ${formatBRL(page.totalAmount)}${activeCount ? ' no recorte' : ''}`
              : failed ? 'Lista indisponível' : amountInvalid ? 'Corrija o valor do filtro' : 'Carregando…'}
          </span>
        )}
      >
        {failed ? (
          <div role="alert" className="app-block__body grid justify-items-start gap-2">
            <p>Não foi possível carregar os Pix recebidos: {extractErrorText(query.error)}</p>
            <Button variant="secondary" className="app-btn--sm" onClick={() => void query.refetch()}>Tentar novamente</Button>
          </div>
        ) : null}
        {page && !payerVisible ? (
          <p className="app-block__body">O pagador e a mensagem dele aparecem só para o Financeiro e o Administrativo.</p>
        ) : null}

        <div className="app-table-scroll">
          <table className="app-table app-table--compact">
            <caption className="sr-only">Pix recebidos pelo Itaú</caption>
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">Detalhe do Pix</span></th>
                <th scope="col">Recebido em</th>
                <th scope="col">Valor</th>
                {payerVisible ? <th scope="col" className="app-table__text-head">Pagador</th> : null}
                <th scope="col">Origem</th>
                <th scope="col">Situação</th>
                <th scope="col">Fatura</th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading && !amountInvalid ? (
                <tr><td colSpan={columns} className="p-0"><SkeletonTable rows={6} cols={columns} /></td></tr>
              ) : null}
              {empty ? <tr><td colSpan={columns} className="p-0">{emptyState}</td></tr> : null}
              {rows.map((receipt) => (
                <ReceiptRow
                  key={receipt.endToEndId}
                  receipt={receipt}
                  payerVisible={payerVisible}
                  columns={columns}
                  open={openId === receipt.endToEndId}
                  onToggle={() => setOpenId((current) => (current === receipt.endToEndId ? null : receipt.endToEndId))}
                  onOpenInvoice={onOpenInvoice}
                />
              ))}
            </tbody>
          </table>
        </div>

        {page && !pastEnd ? (
          <TableFooterPagination
            page={state.page}
            pageSize={state.pageSize}
            totalCount={totalCount}
            totalPages={totalPages}
            pageSizes={HISTORY_PAGE_SIZES}
            onPageChange={(next) => update((params) => withReceivedPage(params, next))}
            onPageSizeChange={(size) => update((params) => withReceivedPageSize(params, size))}
          />
        ) : null}
      </Block>
    </div>
  )
}

function ReceiptRow({ receipt, payerVisible, columns, open, onToggle, onOpenInvoice }: {
  receipt: ItauPixReceipt
  payerVisible: boolean
  columns: number
  open: boolean
  onToggle: () => void
  onOpenInvoice: OpenInvoice
}) {
  const situation = receiptSituation(receipt)
  const invoice = receiptInvoice(receipt)
  const payer = payerLine(receipt)
  const detailId = `pix-received-${receipt.endToEndId}`
  const when = cellInstant(receipt.paidAt)
  return (
    <Fragment>
      <tr>
        <td className="w-px">
          <RowToggle open={open} controls={detailId} label={`detalhe do Pix de ${formatBRL(receipt.amount)} recebido em ${when}`} onClick={onToggle} />
        </td>
        <td className="whitespace-nowrap tabular-nums">{when}</td>
        <td className="whitespace-nowrap tabular-nums">{formatBRL(receipt.amount)}</td>
        {payerVisible ? (
          <td className="app-table__text" title={[receipt.payerName, receipt.payerDocument ? formatCnpjCpf(receipt.payerDocument) : null].filter(Boolean).join(' · ') || undefined}>
            {payer ?? <NoValue label="Pagador não informado pelo Itaú" />}
          </td>
        ) : null}
        <td className="whitespace-nowrap">{receiptOriginLabel(receipt.origin)}</td>
        <td className="whitespace-nowrap">{situation.needsAction ? <StatusText tone="warning">{situation.label}</StatusText> : situation.label}</td>
        <td className="whitespace-nowrap">
          {invoice?.docNumber ? (
            <button type="button" className="app-link" onClick={() => onOpenInvoice(invoice.source, invoice.invoiceId)}>{invoice.docNumber}</button>
          ) : (
            <NoValue label="Sem fatura" />
          )}
        </td>
      </tr>
      {open ? (
        <tr id={detailId} data-row-detail>
          <td colSpan={columns}>
            <ReceiptDetail receipt={receipt} payerVisible={payerVisible} onOpenInvoice={onOpenInvoice} />
          </td>
        </tr>
      ) : null}
    </Fragment>
  )
}

function ReceiptDetail({ receipt, payerVisible, onOpenInvoice }: { receipt: ItauPixReceipt; payerVisible: boolean; onOpenInvoice: OpenInvoice }) {
  const { can } = useAuth()
  // Conciliar é do Financeiro e do Administrativo (ADR 0085, D5; migration 442).
  const canSettle = can('settle_financial_adjustments') && receipt.situation === 'received'
  const extra = payerVisible ? bankExtraFields(receipt.raw) : []
  const mono = 'font-[var(--app-font-mono)] break-all'
  return (
    <div className="grid gap-3">
      <FactList columns={3}>
        <Fact label="Identificador do Pix">
          <CopyValue value={receipt.endToEndId} label="identificador do Pix"><span className={mono}>{receipt.endToEndId}</span></CopyValue>
        </Fact>
        <Fact label="Identificador da cobrança">
          {receipt.txid ? <span className={mono}>{receipt.txid}</span> : <NoValue label="Pix sem identificador da cobrança" />}
        </Fact>
        <Fact label="Chave Pix">{receipt.pixKey ?? <NoValue label="Chave não informada" />}</Fact>
        <Fact label="Recebido em">{formatBrasiliaInstant(receipt.paidAt)}</Fact>
        <Fact label="Gravado no Vela em">{formatBrasiliaInstant(receipt.recordedAt)}</Fact>
        <Fact label="Origem">{receiptOriginLabel(receipt.origin)}</Fact>
        {payerVisible ? (
          <>
            <Fact label="Pagador">{receipt.payerName ?? <NoValue label="Nome não informado pelo Itaú" />}</Fact>
            <Fact label="CPF ou CNPJ do pagador">
              {receipt.payerDocument
                ? <CopyValue value={receipt.payerDocument} label="CPF ou CNPJ do pagador">{formatCnpjCpf(receipt.payerDocument)}</CopyValue>
                : <NoValue label="Documento não informado pelo Itaú" />}
            </Fact>
            <Fact label="Mensagem do pagador">{receipt.payerMessage ?? <NoValue label="Sem mensagem" />}</Fact>
          </>
        ) : null}
        {receipt.settled?.docNumber ? (
          <Fact label="Fatura da baixa">{receipt.settled.docNumber} ({sourceLabel(receipt.settled.source)}) · {receiptSituation(receipt).label}</Fact>
        ) : null}
        {receipt.charge?.docNumber && receipt.charge.docNumber !== receipt.settled?.docNumber ? (
          <Fact label="Cobrança do Vela">{receipt.charge.docNumber} ({sourceLabel(receipt.charge.source)})</Fact>
        ) : null}
        {receipt.reason ? <Fact label="Motivo da análise">{receipt.reason}</Fact> : null}
        {receipt.handledNote ? <Fact label="Tratamento">{receipt.handledNote}</Fact> : null}
        {extra.map((field) => <Fact key={field.label} label={field.label}>{field.value}</Fact>)}
      </FactList>
      {receipt.situation === 'review' ? (
        <p>Pix de cobrança do Vela que não deu baixa automática: trate em Pendências, no bloco Pix em análise.</p>
      ) : null}
      {canSettle ? <SettleReceipt receipt={receipt} onOpenInvoice={onOpenInvoice} /> : null}
    </div>
  )
}

type SettleFeedback = { tone: 'success' | 'danger'; text: string }

/**
 * Baixa opcional do Pix recebido numa fatura aberta. Sem número, a lista traz
 * as de mesmo valor e as do Cliente com o documento do pagador; com número,
 * só a fatura procurada. O banco confere de novo e usa o valor e o horário do
 * Pix, com o identificador na referência bancária.
 */
function SettleReceipt({ receipt, onOpenInvoice }: { receipt: ItauPixReceipt; onOpenInvoice: OpenInvoice }) {
  const queryClient = useQueryClient()
  const [typed, setTyped] = useState('')
  const [docNumber, setDocNumber] = useState('')
  const [feedback, setFeedback] = useState<SettleFeedback | null>(null)

  const candidatesQuery = useQuery({
    queryKey: ['itau-pix-receipt-candidates', receipt.endToEndId, docNumber],
    queryFn: () => listItauPixReceiptCandidates(receipt.endToEndId, docNumber),
  })

  const settleMutation = useMutation({
    mutationFn: (candidate: ItauPixReceiptCandidate) => settleItauPixReceipt(receipt.endToEndId, candidate),
    onMutate: () => setFeedback(null),
    onSuccess: async (result, candidate) => {
      setFeedback({ tone: 'success', text: `${result.docNumber ?? candidate.docNumber}: baixa gravada com o Pix de ${formatBRL(receipt.amount)}.` })
      await afterPixConciliado(queryClient)
    },
    onError: (error) => setFeedback({ tone: 'danger', text: `Nenhuma baixa foi gravada: ${extractErrorText(error)}` }),
  })

  function search(event: FormEvent) {
    event.preventDefault()
    setDocNumber(typed.trim())
  }

  const candidates = candidatesQuery.data ?? []
  return (
    <div className="grid gap-3">
      <p>
        <strong>Baixar numa fatura (opcional).</strong>
        {' '}Sem número, aparecem as faturas abertas com o mesmo valor do Pix ou do Cliente com o documento do pagador.
        {' '}A baixa usa o valor e o horário do Pix e grava o identificador do Pix como referência bancária.
      </p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={search}>
        <Field label="Número da fatura">
          <Input type="text" placeholder="INV-2026-0001 ou DEM-…" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Field>
        <Button type="submit" variant="secondary">Procurar</Button>
        {docNumber ? <Button type="button" variant="ghost" onClick={() => { setTyped(''); setDocNumber('') }}>Ver sugestões</Button> : null}
      </form>
      {feedback ? (
        feedback.tone === 'danger'
          ? <p role="alert"><StatusText tone="warning">{feedback.text}</StatusText></p>
          : <p role="status">{feedback.text}</p>
      ) : null}
      {candidatesQuery.isLoading ? <p role="status">Procurando faturas…</p> : null}
      {candidatesQuery.error ? (
        <p role="alert"><StatusText tone="warning">Não foi possível procurar as faturas: {extractErrorText(candidatesQuery.error)}</StatusText></p>
      ) : null}
      {candidatesQuery.data && !candidates.length ? (
        <p>{docNumber ? `Nenhuma fatura aberta com o número ${docNumber}.` : 'Nenhuma fatura aberta com o mesmo valor ou do Cliente do pagador. Procure pelo número.'}</p>
      ) : null}
      {candidates.length ? (
        <table className="app-table app-table--compact app-table--nested">
          <caption className="sr-only">Faturas abertas para o Pix de {formatBRL(receipt.amount)}</caption>
          <thead>
            <tr>
              <th scope="col">Fatura</th>
              <th scope="col">Origem</th>
              <th scope="col" className="app-table__text-head">Cliente</th>
              <th scope="col">Em aberto</th>
              <th scope="col"><span className="sr-only">Ação</span></th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => {
              const settling = settleMutation.isPending && settleMutation.variables?.invoiceId === candidate.invoiceId
                && settleMutation.variables?.source === candidate.source
              return (
                <tr key={`${candidate.source}-${candidate.invoiceId}`}>
                  <td className="whitespace-nowrap">
                    <button type="button" className="app-link" onClick={() => onOpenInvoice(candidate.source, candidate.invoiceId)}>{candidate.docNumber}</button>
                  </td>
                  <td className="whitespace-nowrap">{sourceLabel(candidate.source)}</td>
                  <td className="app-table__text" title={candidate.sameCustomer ? 'Mesmo CPF ou CNPJ do pagador' : candidate.customerName ?? undefined}>
                    {candidate.customerName ?? <NoValue label="Sem Cliente" />}
                  </td>
                  <td className="whitespace-nowrap tabular-nums" title={candidate.sameAmount ? 'Mesmo valor do Pix' : 'Valor diferente do Pix'}>
                    {candidate.sameAmount ? formatBRL(candidate.openAmount) : <StatusText tone="warning">{formatBRL(candidate.openAmount)}</StatusText>}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <RowActionButton
                      label={`Baixar o Pix na fatura ${candidate.docNumber}`}
                      title="Baixar nesta fatura"
                      icon={Link2}
                      loading={settling}
                      disabled={settleMutation.isPending}
                      onClick={() => settleMutation.mutate(candidate)}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}

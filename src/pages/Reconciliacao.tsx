import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Printer, RefreshCw, RotateCcw, Upload } from 'lucide-react'
import type { DragEvent } from 'react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, PageHeader } from '../components/ui/Card'
import { Field, Textarea } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { formatResultCount, summarizeReconciliation } from '../lib/operationalState'
import { parsePixExtractFile } from '../services/demurrage/demurrageKpis'
import {
  confirmUnifiedPixReconciliation,
  createPixImportKey,
  getItauPixMonitor,
  getPixLineIdentity,
  linkPixReconciliationCandidate,
  listPixReconciliationCandidates,
  listPixReconciliationExceptions,
  matchUnifiedPixTransactions,
  persistUnresolvedPixMatches,
  resolvePixReconciliationException,
  reverseDemurragePayment,
} from '../services/reconciliacao'
import { getInvoiceDetail as getDemurrageDetail } from '../services/demurrage/demurrageInvoices'
import { InvoiceDetailModal } from '../components/billing/InvoiceDetailModal'
import { ReconciliationHistoryTable } from '../components/billing/ReconciliationHistoryTable'
import { InvoiceDocument as DemurrageInvoiceDoc, type DemurrageInvoiceDocumentDetail } from '../components/demurrage/InvoiceDocument'
import type { ItauPixMonitorCharge, PixReconciliationCandidate, PixReconciliationException, UnifiedPixConfirmationResult, UnifiedPixMatch } from '../services/reconciliacao'
import { queryKeys } from '../services/queryKeys'
import { formatDateTime } from '../lib/utils'

function fmtBRL(v: number) {
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function getAmountStatus(match: UnifiedPixMatch): { tone: 'green' | 'yellow' | 'red'; label: string; detail: string } {
  const diff = match.transaction.amount - match.amount
  if (Math.abs(diff) <= 0.01) {
    return { tone: 'green', label: 'Integral', detail: 'Valor bate com o saldo/documento' }
  }
  if (diff < 0 && match.source === 'local') {
    return { tone: 'yellow', label: 'Parcial', detail: `Saldo restante apos baixa: ${fmtBRL(Math.abs(diff))}` }
  }
  return { tone: 'red', label: 'Excesso', detail: `Diferenca: ${fmtBRL(Math.abs(diff))}` }
}

const ITAU_CHARGE_STATUS: Record<ItauPixMonitorCharge['status'], string> = {
  pending_create: 'Aguardando emissão',
  pending_update: 'Aguardando alteração',
  pending_expire_check: 'Conferindo vencimento',
  pending_cancel: 'Cancelamento pendente',
  active: 'Ativa',
  cancelled: 'Cancelada',
  concluded: 'Paga',
  expired: 'Vencida',
}

function itauChargeTone(charge: ItauPixMonitorCharge): 'red' | 'yellow' | 'slate' {
  if (charge.uncertain || charge.lastError) return 'red'
  return charge.status === 'active' ? 'slate' : 'yellow'
}

// Monitoramento das cobranças Itaú: com a chave ligada, a baixa é automática e
// esta lista mostra só o que ainda depende do banco ou de análise.
function ItauPixMonitorCard() {
  const monitorQuery = useQuery({
    queryKey: queryKeys.reconciliation.itauPixMonitor(),
    queryFn: getItauPixMonitor,
    refetchInterval: 60_000,
  })
  const monitor = monitorQuery.data

  return (
    <Card className="mb-6">
      <div className="flex flex-col gap-2 border-b border-[#30363d] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-white">Cobranças Pix Itaú</div>
          <div className="mt-1 text-xs text-slate-400">
            {monitor?.provider === 'itau'
              ? `Baixa automática ligada. Última consulta de recebimentos: ${monitor.polledUntil ? formatDateTime(monitor.polledUntil) : 'ainda não feita'}.`
              : 'Desligada: as faturas usam o QR estático e a baixa vem do extrato abaixo.'}
          </div>
        </div>
        {monitor ? (
          <div className="flex flex-wrap gap-2">
            <Badge tone="green">{monitor.counts.active ?? 0} ativa(s)</Badge>
            <Badge tone={monitor.charges.length ? 'yellow' : 'slate'}>{monitor.charges.length} pedem atenção</Badge>
            <Badge tone={monitor.receipts.length ? 'red' : 'slate'}>{monitor.receipts.length} recebimento(s) em análise</Badge>
          </div>
        ) : null}
      </div>
      {monitorQuery.isLoading ? (
        <div className="p-4 text-sm text-slate-400">Carregando cobranças...</div>
      ) : monitorQuery.isError ? (
        <div className="p-4 text-sm text-red-300">Não foi possível carregar as cobranças Itaú.</div>
      ) : monitor && (monitor.charges.length || monitor.receipts.length) ? (
        <div className="divide-y divide-[#30363d]">
          {monitor.receipts.map((receipt) => (
            <div key={receipt.endToEndId} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-semibold text-white">Pix recebido sem baixa · {fmtBRL(receipt.amount)}</div>
                <div className="text-xs text-slate-400">{receipt.reason ?? 'Em análise'} · {formatDateTime(receipt.paidAt)}</div>
              </div>
              <div className="font-mono text-xs text-slate-500" title={receipt.endToEndId}>{receipt.txid}</div>
            </div>
          ))}
          {monitor.charges.map((charge) => (
            <div key={charge.id} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="font-semibold text-white">{charge.docNumber ?? 'Fatura removida'}</span>
                <span className="ml-2 text-xs text-slate-400">
                  {charge.source === 'demurrage' ? 'Demurrage' : 'Fatura'} · {fmtBRL(charge.amount)}
                </span>
                {charge.lastError ? <div className="mt-1 text-xs text-red-300">{charge.lastError}</div> : null}
              </div>
              <div className="flex items-center gap-2">
                {charge.attempts > 1 ? <span className="text-xs text-slate-500">{charge.attempts} tentativas</span> : null}
                <Badge tone={itauChargeTone(charge)}>
                  {charge.uncertain ? 'Resposta incerta' : ITAU_CHARGE_STATUS[charge.status]}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-4 text-sm text-slate-500">Nada pendente com o Itaú.</div>
      )}
    </Card>
  )
}

export function Reconciliacao() {
  const { isAdmin } = useAuth()

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Card>
          <PageHeader
            title="Acesso restrito"
            description="A Conciliação PIX é uma operação administrativa e não está disponível para este perfil."
          />
        </Card>
      </div>
    )
  }

  return <ReconciliacaoContent />
}

function ReconciliacaoContent() {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const { isAdmin } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const [matches, setMatches] = useState<UnifiedPixMatch[] | null>(null)
  const [confirmationResult, setConfirmationResult] = useState<UnifiedPixConfirmationResult | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [selectedInvoice, setSelectedInvoice] = useState<{ invoiceId: number; paymentId: number | null } | null>(null)
  const [selectedDemurrageId, setSelectedDemurrageId] = useState<number | null>(null)
  const [selectedExceptionId, setSelectedExceptionId] = useState<number | null>(null)
  const [demurrageReason, setDemurrageReason] = useState('')

  const pendingExceptionsQuery = useQuery({
    queryKey: queryKeys.reconciliation.pixExceptions(),
    queryFn: () => listPixReconciliationExceptions(),
    enabled: isAdmin,
  })

  const candidatesQuery = useQuery({
    queryKey: ['pix-reconciliation-candidates', selectedExceptionId],
    queryFn: () => listPixReconciliationCandidates(selectedExceptionId!),
    enabled: selectedExceptionId != null,
  })

  const demurrageDetailQuery = useQuery({
    queryKey: ['demurrage-invoice-detail', 'reconciliacao', selectedDemurrageId],
    queryFn: () => getDemurrageDetail(selectedDemurrageId!),
    enabled: selectedDemurrageId != null,
  })

  const matchMutation = useMutation({
    mutationFn: async (file: File) => {
      const transactions = await parsePixExtractFile(file)
      if (!transactions.length) throw new Error('Nenhuma transacao PIX encontrada.')
      const [importKey, found] = await Promise.all([
        createPixImportKey(file),
        matchUnifiedPixTransactions(transactions),
      ])
      const persisted = isAdmin ? await persistUnresolvedPixMatches(importKey, found) : []
      const idsByLine = new Map(persisted.map((item) => [item.lineNumber, item.id]))
      return found.map((match) => ({
        ...match,
        exceptionId: idsByLine.get(getPixLineIdentity(match.transaction)),
      }))
    },
    onSuccess: (found) => {
      setMatches(found)
      if (!found.length) showToast('Nenhuma correspondencia encontrada.', 'info')
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const linkCandidateMutation = useMutation({
    mutationFn: async ({ exception, candidate }: { exception: PixReconciliationException; candidate: PixReconciliationCandidate }) => {
      await linkPixReconciliationCandidate(exception.id, candidate)
      const match: UnifiedPixMatch = {
        transaction: {
          txid: exception.txid,
          cnpj: exception.cnpj,
          date: exception.paidAt ?? '',
          amount: exception.amount,
          lineNumber: exception.lineNumber,
        },
        source: candidate.source,
        invoiceId: candidate.invoiceId,
        docNumber: candidate.docNumber,
        customerName: '',
        customerCnpj: exception.cnpj,
        amount: candidate.amount,
        ambiguous: false,
        matchType: 'txid',
        exceptionId: exception.id,
      }
      const result = await confirmUnifiedPixReconciliation([match])
      await resolvePixReconciliationException(exception.id, {
        source: candidate.source,
        invoiceId: candidate.source === 'local' ? candidate.invoiceId : undefined,
        demurrageInvoiceId: candidate.source === 'demurrage' ? candidate.invoiceId : undefined,
        txid: exception.txid,
      })
      return result
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reconciliation.pixExceptions() })
      void queryClient.invalidateQueries({ queryKey: ['demurrage-invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['reconciliation-history'] })
      showToast(`Pendência conciliada: ${result.local + result.demurrage} pagamento(s).`, 'success')
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const retryExceptionMutation = useMutation({
    mutationFn: async (exception: PixReconciliationException) => {
      const [match] = await matchUnifiedPixTransactions([{
        txid: exception.txid,
        cnpj: exception.cnpj,
        date: exception.paidAt ?? '',
        amount: exception.amount,
        lineNumber: exception.lineNumber,
      }])
      if (!match || match.ambiguous || match.source === 'unmatched') {
        throw new Error('A pendencia ainda nao tem uma correspondencia segura.')
      }
      const result = await confirmUnifiedPixReconciliation([match])
      await resolvePixReconciliationException(exception.id, {
        source: match.source,
        invoiceId: match.source === 'local' ? match.invoiceId : undefined,
        demurrageInvoiceId: match.source === 'demurrage' ? match.invoiceId : undefined,
        txid: match.transaction.txid,
      })
      return result
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reconciliation.pixExceptions() })
      void queryClient.invalidateQueries({ queryKey: ['demurrage-invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['reconciliation-history'] })
      showToast(`Pendencia conciliada: ${result.local + result.demurrage} pagamento(s).`, 'success')
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  function processFile(file: File) {
    setMatches(null)
    setConfirmationResult(null)
    matchMutation.mutate(file)
  }

  const confirmMutation = useMutation({
    mutationFn: () => confirmUnifiedPixReconciliation((matches ?? []).filter((m) => !m.ambiguous)),
    onSuccess: (result) => {
      const { local, demurrage } = result
      void queryClient.invalidateQueries({ queryKey: ['demurrage-invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['demurrage-kpis'] })
      void queryClient.invalidateQueries({ queryKey: ['bls'] })
      void queryClient.invalidateQueries({ queryKey: ['bl-detail'] })
      void queryClient.invalidateQueries({ queryKey: ['customer-detail'] })
      void queryClient.invalidateQueries({ queryKey: ['reconciliation-history'] })
      void queryClient.invalidateQueries({ queryKey: queryKeys.reconciliation.pixExceptions() })
      setConfirmationResult(result)
      setMatches(null)
      showToast(`Conciliação concluída: ${local} fatura(s), ${demurrage} demurrage.`, 'success')
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const demurrageReversalMutation = useMutation({
    mutationFn: async () => {
      if (selectedDemurrageId == null) throw new Error('Nenhuma demurrage selecionada.')
      const reason = demurrageReason.trim()
      if (!reason) throw new Error('Informe a justificativa para cancelar a baixa.')
      await reverseDemurragePayment(selectedDemurrageId, reason)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['demurrage-invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['reconciliation-history'] })
      setSelectedDemurrageId(null)
      setDemurrageReason('')
      showToast('Baixa de demurrage cancelada.', 'success')
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const unmatched = (matches ?? []).filter((m) => m.source === 'unmatched')
  const unambiguous = (matches ?? []).filter((m) => m.source !== 'unmatched' && !m.ambiguous)
  const ambiguous = (matches ?? []).filter((m) => m.source !== 'unmatched' && m.ambiguous)
  const reconciliationSummary = summarizeReconciliation({
    safe: unambiguous.length,
    ambiguous: ambiguous.length,
    total: matches?.length ?? 0,
  })

  return (
    <>
      <PageHeader
        title="Conciliação PIX"
        description="Conciliação automática de pagamentos PIX de todas as faturas (Container, Break Bulk, Granito e Demurrage)."
      />

      <ItauPixMonitorCard />

      <div
        role="button"
        tabIndex={0}
        className={`mb-6 cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-colors ${dragOver ? 'border-blue-400 bg-blue-400/10' : 'border-[#30363d] hover:border-[#58a6ff]'}`}
        onDragOver={(e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) void processFile(f) }}
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click() }}
      >
        <Upload className="mx-auto mb-3 text-slate-500" size={32} />
        <div className="text-sm text-slate-400">Arraste ou clique para selecionar o extrato PIX do Itaú</div>
        <div className="mt-1 text-xs text-slate-500">Arquivo "QR Codes recebidos" .xlsx</div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void processFile(f) }} />
      </div>

      {matchMutation.isPending ? <Card className="text-center text-sm text-slate-400">Processando extrato...</Card> : null}

      {confirmationResult ? (
        <Card className="mb-4">
          <div className="border-b border-[#30363d] p-4">
            <div className="text-sm font-semibold text-white">Pagamentos confirmados</div>
            <div className="mt-1 text-xs text-slate-400">
              {confirmationResult.local} fatura(s) local(is) e {confirmationResult.demurrage} demurrage conciliada(s).
            </div>
          </div>
          <div className="divide-y divide-[#30363d]">
            {confirmationResult.items.map((item) => (
              <div key={`${item.source}-${item.invoice_id}-${item.doc_number}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  {/* `invoice_id` e a chave surrogate da linha; o operador cita
                      a fatura pelo doc_number, que ja e o titulo. */}
                  <div className="font-semibold text-white">{item.doc_number}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={item.source === 'demurrage' ? 'blue' : 'green'}>
                    {item.source === 'demurrage' ? 'Demurrage' : 'Fatura'}
                  </Badge>
                  <Badge tone="green">{item.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {isAdmin ? (
        <Card className="mb-4">
          <div className="border-b border-[#30363d] p-4">
            <div className="text-sm font-semibold text-white">
              Pendencias PIX persistidas ({pendingExceptionsQuery.data?.length ?? 0})
            </div>
            <div className="mt-1 text-xs text-slate-400">
              Linhas sem conciliacao segura ficam salvas por importacao e numero da linha, inclusive sem TXID.
            </div>
          </div>
          {pendingExceptionsQuery.isLoading ? (
            <div className="p-4 text-sm text-slate-400">Carregando pendencias...</div>
          ) : pendingExceptionsQuery.isError ? (
            <div className="p-4 text-sm text-red-300">Nao foi possivel carregar as pendencias PIX.</div>
          ) : pendingExceptionsQuery.data?.length ? (
            <div className="divide-y divide-[#30363d]">
              {pendingExceptionsQuery.data.map((exception) => (
                <div key={exception.id} className="flex flex-col gap-3 px-4 py-3 text-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-semibold text-white">
                      Linha {exception.lineNumber} · {exception.txid || 'TXID ausente'}
                    </div>
                    <div className="text-xs text-slate-400">
                      {exception.reason === 'ambiguous' ? 'Ambigua' : 'Sem documento candidato'} · {fmtBRL(exception.amount)}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      loading={retryExceptionMutation.isPending && retryExceptionMutation.variables?.id === exception.id}
                      onClick={() => retryExceptionMutation.mutate(exception)}
                    >
                      Tentar conciliar
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setSelectedExceptionId((current) => current === exception.id ? null : exception.id)}
                    >
                      Escolher candidata
                    </Button>
                  </div>
                  </div>
                  {selectedExceptionId === exception.id ? (
                    <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                      <div className="text-xs text-slate-400">Vinculo nao confirma a baixa; a baixa so fecha apos settlement/baixa autoritativa.</div>
                      {candidatesQuery.isLoading ? <div className="mt-2 text-xs text-slate-500">Carregando candidatas...</div> : null}
                      {candidatesQuery.isError ? <div className="mt-2 text-xs text-red-300">Não foi possível carregar candidatas.</div> : null}
                      {!candidatesQuery.isLoading && !candidatesQuery.isError && !candidatesQuery.data?.length ? (
                        <div className="mt-2 text-xs text-slate-500">Nenhuma candidata segura para o TXID desta linha.</div>
                      ) : null}
                      {candidatesQuery.data?.map((candidate) => (
                        <div key={`${candidate.source}-${candidate.invoiceId}`} className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                          <div>
                            <span className="font-semibold text-white">{candidate.docNumber}</span>
                            <span className="ml-2 text-xs text-slate-400">{candidate.source === 'demurrage' ? 'Demurrage' : 'Fatura'} · {fmtBRL(candidate.amount)}</span>
                          </div>
                          <Button
                            variant="secondary"
                            loading={linkCandidateMutation.isPending && linkCandidateMutation.variables?.candidate.invoiceId === candidate.invoiceId}
                            onClick={() => linkCandidateMutation.mutate({ exception, candidate })}
                          >
                            Vincular candidata
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 text-sm text-slate-500">Nenhuma pendencia PIX persistida.</div>
          )}
        </Card>
      ) : null}

      {matches !== null ? (
        <>
          <Card className="mb-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-white">{reconciliationSummary.status}</div>
                <div className="mt-1 text-xs text-slate-400">{reconciliationSummary.risk}</div>
              </div>
              <Badge tone={ambiguous.length ? 'yellow' : unambiguous.length ? 'green' : 'slate'}>
                {formatResultCount(matches.length, 'item analisado', 'itens analisados')}
              </Badge>
            </div>
          </Card>

          <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card className="p-4 text-center">
              <div className="text-xs text-slate-500">Correspondencias</div>
              <div className="text-2xl font-bold text-white">{unambiguous.length}</div>
            </Card>
            <Card className="p-4 text-center">
              <div className="text-xs text-slate-500">Ambiguas (ignoradas)</div>
              <div className="text-2xl font-bold text-amber-400">{ambiguous.length}</div>
            </Card>
            <Card className="p-4 text-center">
              <div className="text-xs text-slate-500">Sem candidato</div>
              <div className="text-2xl font-bold text-slate-300">{unmatched.length}</div>
            </Card>
            <Card className="p-4 text-center">
              <div className="text-xs text-slate-500">Total</div>
              <div className="text-2xl font-bold text-slate-300">{matches.length}</div>
            </Card>
          </div>

          {matches.length === 0 ? (
            <Card className="mb-4">
              <EmptyState
                title="Nenhuma correspondencia encontrada."
                description="O extrato foi lido, mas nenhum TXID bateu com invoices abertas. Confira arquivo, periodo e status das invoices."
              />
            </Card>
          ) : null}

          {unambiguous.length > 0 ? (
            <Card className="mb-4">
              <div className="border-b border-[#30363d] p-4">
                <div className="text-sm font-semibold text-white">Correspondencias confirmadas ({unambiguous.length})</div>
                <div className="mt-1 text-xs text-slate-400">
                  Origem: extrato PIX. Campo conferido: TXID unico, data parseada e valor compativel com o documento aberto.
                </div>
              </div>
              <div className="app-table-scroll">
                <table className="app-table app-table--compact min-w-[760px] text-sm">
                  <caption className="sr-only">Correspondências confirmadas do extrato PIX</caption>
                  <thead className="text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th scope="col" className="px-3 py-2">Tipo</th>
                      <th scope="col" className="px-3 py-2">Documento</th>
                      <th scope="col" className="px-3 py-2">Cliente</th>
                      <th scope="col" className="px-3 py-2">PIX</th>
                      <th scope="col" className="px-3 py-2">Saldo/Doc.</th>
                      <th scope="col" className="px-3 py-2">Match</th>
                      <th scope="col" className="px-3 py-2">Txid PIX</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#30363d]">
                    {unambiguous.map((m, i) => {
                      const amountStatus = getAmountStatus(m)
                      return (
                        <tr key={`${m.invoiceId}-${m.source}-${i}`}>
                          <td className="px-3 py-2">
                            {m.source === 'demurrage' ? <Badge tone="blue">Demurrage</Badge> : <Badge tone="green">Fatura</Badge>}
                          </td>
                          <td className="px-3 py-2 font-semibold text-white">{m.docNumber}</td>
                          <td className="px-3 py-2 text-slate-300">{m.customerName}</td>
                          <td className="px-3 py-2 text-emerald-400">{fmtBRL(m.transaction.amount)}</td>
                          <td className="px-3 py-2 text-slate-300">{fmtBRL(m.amount)}</td>
                          <td className="px-3 py-2">
                            <Badge tone={amountStatus.tone}>{amountStatus.label}</Badge>
                            <div className="mt-1 text-[11px] text-slate-500">{amountStatus.detail}</div>
                          </td>
                          <td className="max-w-[180px] truncate px-3 py-2 font-mono text-xs text-slate-400" title={m.transaction.txid}>{m.transaction.txid}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          {ambiguous.length > 0 ? (
            <Card className="mb-4 border-amber-400/30 bg-amber-400/5">
              <div className="border-b border-amber-400/20 p-4">
                <div className="text-sm font-semibold text-amber-200">Ambiguas - ignoradas na confirmacao ({ambiguous.length})</div>
                <div className="mt-1 text-xs text-amber-100/80">
                  Origem: extrato PIX. Campo de ambiguidade: TXID/valor aponta para mais de um documento possivel. Risco residual: baixa indevida se confirmado sem revisao humana.
                </div>
              </div>
              <div className="divide-y divide-[#30363d]">
                {ambiguous.map((m, i) => (
                  <div key={`${m.invoiceId}-ambig-${i}`} className="grid gap-2 px-4 py-3 text-sm text-amber-100 md:grid-cols-[1.4fr,1fr,1fr]">
                    <div>
                      <div className="font-mono text-xs">{m.transaction.txid}</div>
                      <div className="text-xs text-amber-100/75">Documento candidato: {m.docNumber}</div>
                      <div className="text-xs text-amber-100/75">Candidatos: {m.candidateCount ?? 1}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-amber-100/70">Confere</div>
                      <div>{fmtBRL(m.transaction.amount)} no extrato</div>
                      <div className="text-xs text-amber-100/75">Documento: {fmtBRL(m.amount)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-amber-100/70">Motivo</div>
                      <div>{m.ambiguityReason ?? (m.source === 'demurrage' ? 'Valor diferente ou documento duplicado' : 'Valor acima do saldo ou documento duplicado')}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {unmatched.length > 0 ? (
            <Card className="mb-4">
              <div className="border-b border-[#30363d] p-4">
                <div className="text-sm font-semibold text-white">Sem documento candidato ({unmatched.length})</div>
                <div className="mt-1 text-xs text-slate-400">
                  Estas transacoes permanecem visiveis para conferencia e nao entram na confirmacao.
                </div>
              </div>
              <div className="divide-y divide-[#30363d]">
                {unmatched.map((match, index) => (
                  <div key={`${match.transaction.txid}-unmatched-${index}`} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-3">
                    <div className="font-mono text-xs text-slate-300">{match.transaction.txid}</div>
                    <div className="text-slate-300">{fmtBRL(match.transaction.amount)}</div>
                    <div className="text-slate-400">{match.transaction.date || 'Data nao identificada'}</div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMatches(null)}>Limpar</Button>
            <Button
              disabled={!unambiguous.length}
              loading={confirmMutation.isPending}
              onClick={() => void confirmMutation.mutate()}
            >
              <RefreshCw size={15} />
              Confirmar {unambiguous.length} pagamento(s)
            </Button>
          </div>
        </>
      ) : null}

      <div className="mt-8">
        <h2 className="app-panel__title mb-4">Histórico de pagamentos</h2>
        <ReconciliationHistoryTable
          onSelectLocalInvoice={(id, paymentId) => setSelectedInvoice({ invoiceId: id, paymentId })}
          onSelectDemurrageInvoice={(id) => setSelectedDemurrageId(id)}
        />
      </div>

      <InvoiceDetailModal
        invoiceId={selectedInvoice?.invoiceId ?? null}
        onClose={() => setSelectedInvoice(null)}
        enablePaymentReversal
        paymentId={selectedInvoice?.paymentId ?? null}
      />

      <Modal
        open={selectedDemurrageId != null}
        onClose={() => { setSelectedDemurrageId(null); setDemurrageReason('') }}
        title={`Fatura Demurrage ${demurrageDetailQuery.data?.invoice?.doc_number ?? ''}`}
      >
        <div className="p-2">
          {isAdmin ? (
            <div className="mb-3 rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
              <Field label="Justificativa para cancelar a baixa (obrigatória)">
                <Textarea
                  value={demurrageReason}
                  onChange={(e) => setDemurrageReason(e.target.value)}
                  placeholder="Descreva o motivo do cancelamento desta baixa."
                />
              </Field>
              <div className="mt-3 flex justify-end">
                <Button
                  variant="danger"
                  onClick={() => demurrageReversalMutation.mutate()}
                  loading={demurrageReversalMutation.isPending}
                  disabled={!demurrageReason.trim()}
                >
                  <RotateCcw size={16} />Cancelar baixa
                </Button>
              </div>
            </div>
          ) : (
            <div className="mb-3 rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-sm text-slate-400">
              Apenas administradores podem cancelar a baixa de um pagamento.
            </div>
          )}
          {demurrageDetailQuery.isLoading ? (
            <div className="p-4 text-sm text-slate-400">Carregando...</div>
          ) : demurrageDetailQuery.data ? (
            <>
              <div className="mb-3 flex justify-end">
                {demurrageDetailQuery.data.invoice.status === 'paid' ? (
                  <Button onClick={() => window.print()}><Printer size={16} />Imprimir recibo</Button>
                ) : null}
              </div>
              <div className="invoice-print-content">
                <DemurrageInvoiceDoc
                  detail={{ ...demurrageDetailQuery.data.invoice, items: demurrageDetailQuery.data.items } satisfies DemurrageInvoiceDocumentDetail}
                  type="receipt"
                />
              </div>
            </>
          ) : (
            <div className="p-4 text-sm text-slate-400">Falha ao carregar.</div>
          )}
        </div>
      </Modal>
    </>
  )
}

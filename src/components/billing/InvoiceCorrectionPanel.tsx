import { useInvoiceCorrectionSummary, useRetryInvoiceBasisChanges } from '../../hooks/useBillingLedger'
import { formatBRL } from '../../lib/utils'
import { useAuth } from '../../hooks/useAuth'
import { Card } from '../ui/Card'

// ADR 0077 (decisão de 2026-10-02): ninguém digita correção. Quando a
// correção do B/L reduz uma fatura com pagamento, o sistema abate o saldo e
// registra a restituição do excedente. O retry recupera falha da mesma operação.
export function InvoiceCorrectionPanel({ invoiceId }: { invoiceId: number }) {
  const summary = useInvoiceCorrectionSummary(invoiceId)
  const retry = useRetryInvoiceBasisChanges()
  const { isAdmin } = useAuth()
  const pending = summary.data?.pending_bl_ids ?? []
  const corrections = summary.data?.corrections ?? []
  if (!summary.error && corrections.length === 0 && pending.length === 0) return null
  return <Card>
    <h2 className="mb-3 text-base font-semibold">Ajustes pela correção do B/L</h2>
    <p>A fatura emitida preserva total e itens. A redução abate primeiro o saldo aberto; o que passar dele é restituído ao Cliente.</p>
    {summary.error ? <p role="alert">Não foi possível consultar os ajustes. Recarregue a página.</p> : null}
    {pending.map((blId) => <div key={blId} className="mt-3 rounded border p-3">
      <p>A correção financeira do B/L {blId} não foi concluída. Revise as pendências antes de tentar novamente.</p>
      {isAdmin ? <button type="button" disabled={retry.isPending} onClick={() => retry.mutate(blId)}>
        Tentar aplicar correção
      </button> : null}
    </div>)}
    {retry.error ? <p role="alert">Não foi possível aplicar a correção. A pendência foi preservada.</p> : null}
    {corrections.map((item) => <div key={item.id} className="mt-3 rounded border p-3">
      <strong>B/L {item.bl_id} · redução de {formatBRL(item.amount_brl)}</strong>
      <p>Abatido do saldo: {formatBRL(item.offset_brl)} · Restituição: {formatBRL(item.refund_brl)}.</p>
      <p>{item.reason}</p>
    </div>)}
  </Card>
}

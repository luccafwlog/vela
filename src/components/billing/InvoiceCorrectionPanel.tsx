import { useInvoiceCorrectionSummary } from '../../hooks/useBillingLedger'
import { formatBRL } from '../../lib/utils'
import { Card } from '../ui/Card'

// ADR 0077 (decisão de 2026-10-02): ninguém digita correção. Quando a
// correção do B/L reduz uma fatura com pagamento, o sistema abate o saldo e
// registra a restituição do excedente; aqui fica só o histórico.
export function InvoiceCorrectionPanel({ invoiceId }: { invoiceId: number }) {
  const summary = useInvoiceCorrectionSummary(invoiceId)
  const corrections = summary.data?.corrections ?? []
  if (!summary.error && corrections.length === 0) return null
  return <Card>
    <h2 className="mb-3 text-base font-semibold">Ajustes pela correção do B/L</h2>
    <p>A fatura emitida preserva total e itens. A redução abate primeiro o saldo aberto; o que passar dele é restituído ao Cliente.</p>
    {summary.error ? <p role="alert">Não foi possível consultar os ajustes. Recarregue a página.</p> : null}
    {corrections.map((item) => <div key={item.id} className="mt-3 rounded border p-3">
      <strong>B/L {item.bl_id} · redução de {formatBRL(item.amount_brl)}</strong>
      <p>Abatido do saldo: {formatBRL(item.offset_brl)} · Restituição: {formatBRL(item.refund_brl)}.</p>
      <p>{item.reason}</p>
    </div>)}
  </Card>
}

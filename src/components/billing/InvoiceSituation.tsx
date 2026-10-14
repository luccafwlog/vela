import { StatusText } from '../ui/StatusText'
import { invoiceSituation } from '../../lib/invoiceSituation'

/** Situação da fatura de Taxas Locais em texto, com o ✓ em Paga (ver `invoiceSituation`). */
export function InvoiceSituation({ status }: { status: string | null | undefined }) {
  const { label, tone } = invoiceSituation(status)
  return <StatusText tone={tone}>{label}</StatusText>
}

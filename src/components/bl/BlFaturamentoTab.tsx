import { BlCobrancasSection } from './BlCobrancasTab'
import { BlDemurrageSection, type BlDemurrageInvoiceSummary } from './BlDemurrageSection'
import { isContainerCargoMode } from '../../lib/cargoMode'
import { resolveCargoMode } from '../../pages/blDetalheHelpers'
import type { InvoiceLinkInfo } from '../../services/billing'
import type { BLDetail } from '../../types/database'

// Faturamento do B/L: Taxas Locais (com a fatura ativa no cabeçalho) e
// Demurrage. O vínculo de cliente fica na Visão Geral.
export function BlFaturamentoTab({ active, bl, activeInvoice = null, demurrageInvoices }: { active: boolean; bl: BLDetail; activeInvoice?: InvoiceLinkInfo | null; demurrageInvoices?: BlDemurrageInvoiceSummary[] }) {
  if (!active) return null
  return (
    <div className="grid gap-5">
      <BlCobrancasSection bl={bl} activeInvoice={activeInvoice} />
      {isContainerCargoMode(resolveCargoMode(bl)) ? <BlDemurrageSection bl={bl} invoices={demurrageInvoices} /> : null}
    </div>
  )
}

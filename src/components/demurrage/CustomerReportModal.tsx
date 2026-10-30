import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CustomerSummaryReport } from './CustomerSummaryReport'
import { Button } from '../ui/Button'
import { InlineError } from '../ui/Card'
import { Field, Select } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { fetchCustomerDemurrageDetail } from '../../services/demurrage/demurrageKpis'
import { customerUnbilledBoxes, type CustomerExposureRow } from '../../services/demurrage/demurrageCustomerExposure'
import type { BoardGroup } from '../../services/demurrage/demurrageBoard'

type Props = {
  open: boolean
  rows: CustomerExposureRow[]
  groups: readonly BoardGroup[]
  /** Cliente já escolhido (o da linha aberta), ou o primeiro da lista. */
  initialCustomerId?: number | null
  onClose: () => void
}

/** Extrato de um Cliente (ADR 0112, D12): escolhe o Cliente e imprime. */
export function CustomerReportModal({ open, rows, groups, initialCustomerId, onClose }: Props) {
  const [customerId, setCustomerId] = useState<number | null>(initialCustomerId ?? rows[0]?.customer_id ?? null)
  const customer = rows.find((row) => row.customer_id === customerId) ?? null
  const invoicesQuery = useQuery({
    queryKey: ['demurrage-customer-detail', customerId],
    queryFn: () => fetchCustomerDemurrageDetail(customerId!),
    enabled: open && customerId != null,
  })

  return (
    <Modal open={open} onClose={onClose} title="Extrato de Demurrage do Cliente">
      <div className="customer-report-print-content p-2">
        <div className="print-hidden mb-2 flex flex-wrap items-end justify-between gap-2">
          <Field label="Cliente">
            <Select value={customerId ?? ''} onChange={(event) => setCustomerId(event.target.value ? Number(event.target.value) : null)}>
              {rows.map((row) => <option key={row.customer_id} value={row.customer_id}>{row.customer_name}</option>)}
            </Select>
          </Field>
          <Button variant="secondary" disabled={!customer || !invoicesQuery.data} onClick={() => window.print()}>Imprimir</Button>
        </div>
        {invoicesQuery.error ? <InlineError message="Não foi possível carregar as Invoices deste Cliente." /> : null}
        {invoicesQuery.isLoading ? <p className="app-dem-meta" role="status">Carregando o extrato…</p> : null}
        {customer && invoicesQuery.data ? (
          <CustomerSummaryReport statement={{
            customer: { id: customer.customer_id, name: customer.customer_name, cnpj_cpf: customer.cnpj_cpf },
            invoices: invoicesQuery.data,
            boxes: customerUnbilledBoxes(groups, customer.customer_id),
          }} />
        ) : null}
      </div>
    </Modal>
  )
}

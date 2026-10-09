import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/Card'
import { Combobox, type ComboOption } from '../ui/Combobox'
import { Field, Input } from '../ui/Input'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { VoyageCombobox } from '../shared/VoyageCombobox'
import { listBillingCustomers } from '../../services/billing'
import { formatBRL, formatCnpjCpf } from '../../lib/utils'
import { userFacingErrorMessage } from '../../lib/errors'
import { useConsolidatableReceivables, useCreateConsolidatedInvoice } from '../../hooks/useBillingLedger'
import { isReceivableSelectable, summarizeConsolidation } from './consolidatedInvoiceSelection'

const fmtBRL = (value: number | null | undefined) => formatBRL(value)

type Props = { open: boolean; onClose: () => void }

export function ConsolidatedInvoiceModal({ open, onClose }: Props) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [customerKey, setCustomerKey] = useState(0)
  const [voyageId, setVoyageId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [error, setError] = useState('')

  const { data: receivables, isLoading, error: receivablesError } = useConsolidatableReceivables({
    customerId,
    voyageId,
    search: search.trim() || null,
  })
  const createMutation = useCreateConsolidatedInvoice()

  const rows = receivables ?? []
  const summary = summarizeConsolidation(rows, selected)
  const selectedTotal = summary.total
  const eligibleCount = summary.eligibleCount

  function reset() {
    setCustomerId(null)
    setCustomerName('')
    setCustomerKey((key) => key + 1)
    setVoyageId(null)
    setSearch('')
    setSelected([])
    setError('')
  }

  function close() {
    reset()
    onClose()
  }

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function submit() {
    setError('')
    if (!customerId) {
      setError('Selecione um cliente.')
      return
    }
    if (selected.length === 0) {
      setError('Selecione ao menos um B/L com saldo aberto.')
      return
    }
    const selectedRows = rows.filter((row) => selected.includes(row.receivable_id) && isReceivableSelectable(row))
    if (selectedRows.length !== selected.length) {
      setError('A seleção mudou. Atualize a lista e selecione novamente os B/Ls elegíveis.')
      return
    }
    const confirmed = await confirm({
      title: 'Emitir fatura consolidada',
      message: `Emitir uma fatura consolidada de ${fmtBRL(selectedTotal)} para ${customerName}?`,
      confirmLabel: 'Emitir consolidada',
      affected: {
        summary: `${selectedRows.length} B/L(s) · ${fmtBRL(selectedTotal)} em saldos abertos`,
        items: selectedRows.map((row) => `B/L ${row.bl_id} · ${fmtBRL(row.balance_brl)} · ${[row.vessel_name, row.voyage_number].filter(Boolean).join(' ') || 'viagem não informada'}`),
      },
      consequence: 'Cria a invoice consolidada, vincula os recebíveis selecionados e registra o evento financeiro na mesma transação. Enquanto estiver ativa, esses saldos não poderão entrar em outra invoice.',
      reversibility: 'A invoice não pode ser apagada. Sem pagamentos, o perfil Administrativo pode cancelá-la; se ficar obsoleta, os recebíveis podem ser consolidados novamente. Pagamentos seguem o fluxo próprio de estorno.',
    })
    if (!confirmed) return
    try {
      const result = await createMutation.mutateAsync({
        customerId,
        receivableIds: selectedRows.map((row) => row.receivable_id),
      })
      showToast(`Consolidada ${result.invoice_number} emitida (${fmtBRL(result.total_brl)}).`, 'success')
      close()
    } catch (e) {
      setError(`${userFacingErrorMessage(e, 'Falha ao emitir consolidada.')} Nada foi emitido.`)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Nova fatura consolidada"
      className="invoice-create-dialog"
      bodyClassName="invoice-create-dialog__body"
    >
      <div className="invoice-create-modal" data-testid="consolidated-invoice-main">
        <section className="invoice-create-modal__filters" data-testid="consolidated-invoice-filters">
          <div className="invoice-create-modal__filters-grid">
            <div className="invoice-create-modal__field--customer">
              <Combobox
                key={`consolidated-customer-${customerKey}`}
                label="Cliente"
                placeholder="Nome ou CNPJ"
                onValueChange={(value) => {
                  if (customerId != null && value !== customerName) {
                    setCustomerId(null)
                    setCustomerName('')
                    setVoyageId(null)
                    setSearch('')
                    setSelected([])
                  }
                }}
                fetchOptions={async (query) => (await listBillingCustomers(query)).map((row): ComboOption => ({ value: String(row.id), label: row.name, meta: formatCnpjCpf(row.cnpj_cpf) }))}
                onSelectOption={(option) => {
                  setCustomerId(Number(option.value))
                  setCustomerName(option.label)
                  setVoyageId(null)
                  setSearch('')
                  setSelected([])
                  setError('')
                }}
              />
            </div>

            <div className="invoice-create-modal__field--voyage">
              <VoyageCombobox
                clearable
                label="Viagem"
                selectedVoyageId={voyageId}
                disabled={!customerId}
                onSelect={(id) => {
                  setVoyageId(id)
                  setSelected([])
                }}
              />
            </div>

            <div className="invoice-create-modal__field--bl">
              <Field label="Buscar B/L">
                <Input
                  placeholder="Filtrar por B/L..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  disabled={!customerId}
                />
              </Field>
            </div>
          </div>

          {error ? <p role="alert" className="app-invoice-detail__alert">{error}</p> : null}
        </section>

        <section className="invoice-create-modal__table-section" data-testid="consolidated-invoice-table">
          <div className="invoice-create-modal__table-scroll">
            {!customerId ? (
              <EmptyState title="Selecione um cliente" description="Selecione um cliente para ver B/Ls com saldo aberto." />
            ) : receivablesError ? (
              <p role="alert" className="app-invoice-detail__alert app-invoice-detail__error">Não foi possível consultar os B/Ls deste Cliente. Feche e abra de novo antes de emitir.</p>
            ) : isLoading ? (
              <EmptyState title="Consultando B/Ls…" description="Buscando B/Ls com saldo aberto." />
            ) : rows.length === 0 ? (
              <EmptyState title="Nenhum B/L para consolidar" description="Este Cliente não tem B/L com saldo aberto e CE Mercante nos filtros atuais." />
            ) : (
              <table className="app-table app-table--compact app-invoice-detail__table">
                <caption className="sr-only">B/Ls do Cliente com saldo aberto</caption>
                <thead>
                  <tr>
                    <th scope="col"><span className="sr-only">Selecionar</span></th>
                    <th scope="col">B/L</th>
                    <th scope="col">Navio / Viagem</th>
                    <th scope="col">Fatura individual</th>
                    <th scope="col" className="app-invoice-detail__num">Saldo</th>
                    <th scope="col">Pode consolidar</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const eligible = isReceivableSelectable(r)
                    return (
                      <tr key={r.receivable_id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Selecionar B/L ${r.bl_id}`}
                            checked={selected.includes(r.receivable_id)}
                            disabled={!eligible}
                            onChange={() => toggle(r.receivable_id)}
                          />
                        </td>
                        <td className="app-invoice-detail__code">{r.bl_id}</td>
                        <td>
                          {[r.vessel_name, r.voyage_number].filter(Boolean).join(' ') || '—'}
                        </td>
                        <td>{r.individual_invoice_number ?? '—'}</td>
                        <td className="app-invoice-detail__num">{fmtBRL(r.balance_brl)}</td>
                        <td>
                          {eligible ? (
                            <Badge tone="success">Sim</Badge>
                          ) : (
                            <span className="app-invoice-detail__note">Não: {r.eligibility_reason}</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <div className="invoice-create-modal__footer" data-testid="consolidated-invoice-footer">
          <p className="app-manual-invoice__total" aria-live="polite">
            <span>{selected.length} de {eligibleCount} B/Ls que podem ser consolidados</span>
            <strong className="app-manual-invoice__num">{fmtBRL(selectedTotal)}</strong>
          </p>
          <div className="app-manual-invoice__actions">
            <Button variant="ghost" onClick={close}>
              Voltar
            </Button>
            <Button
              variant="primary"
              onClick={submit}
              loading={createMutation.isPending}
              loadingLabel="Emitindo…"
              disabled={selected.length === 0}
            >
              Emitir consolidada
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/Card'
import { Field, Input } from '../ui/Input'
import { useToast } from '../ui/Toast'
import { VoyageCombobox } from '../shared/VoyageCombobox'
import { useBillingCustomers } from '../../hooks/useBilling'
import { useConsolidatableReceivables, useCreateConsolidatedInvoice } from '../../hooks/useBillingLedger'
import { isReceivableSelectable, summarizeConsolidation } from './consolidatedInvoiceSelection'

function fmtBRL(v: number | null | undefined) {
  return 'R$ ' + Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type Props = { open: boolean; onClose: () => void }

export function ConsolidatedInvoiceModal({ open, onClose }: Props) {
  const { showToast } = useToast()
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [voyageId, setVoyageId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [error, setError] = useState('')

  const { data: customerOptions } = useBillingCustomers(customerSearch)
  const { data: receivables, isLoading } = useConsolidatableReceivables({
    customerId,
    voyageId,
    search: search.trim() || null,
  })
  const createMutation = useCreateConsolidatedInvoice()

  const rows = receivables ?? []
  const summary = summarizeConsolidation(rows, selected)
  const selectedTotal = summary.total
  const eligibleCount = summary.eligibleCount

  const pickerRef = useRef<HTMLDivElement>(null)

  // Fecha o dropdown de cliente ao clicar fora ou apertar Escape.
  useEffect(() => {
    if (!pickerOpen) return
    function onPointerDown(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setPickerOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [pickerOpen])

  function clearCustomer() {
    setCustomerId(null)
    setCustomerSearch('')
    setVoyageId(null)
    setSearch('')
    setSelected([])
    setPickerOpen(false)
  }

  function reset() {
    setCustomerId(null)
    setCustomerSearch('')
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
    try {
      const result = await createMutation.mutateAsync({
        customerId,
        receivableIds: selected,
      })
      showToast(`Consolidada ${result.invoice_number} emitida (${fmtBRL(result.total_brl)}).`, 'success')
      close()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Falha ao emitir consolidada.'
      setError(message)
      showToast(message, 'error')
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Nova Consolidada"
      className="invoice-create-dialog"
      bodyClassName="invoice-create-dialog__body"
    >
      <div className="invoice-create-modal" data-testid="consolidated-invoice-main">
        <section className="invoice-create-modal__filters" data-testid="consolidated-invoice-filters">
          <div className="invoice-create-modal__filters-grid">
            {/* Customer picker (not wrapped in Field: dropdown buttons must not live inside a <label>) */}
            <div className="app-field invoice-create-modal__field--customer">
              <span className="app-field__label">
                Cliente<span className="app-field__required" aria-hidden="true"> *</span>
              </span>
              <div ref={pickerRef} className="invoice-search-field">
                <Input
                  placeholder="Buscar cliente..."
                  role="combobox"
                  aria-expanded={pickerOpen}
                  autoComplete="off"
                  value={customerSearch}
                  onChange={(e) => {
                    setCustomerId(null)
                    setVoyageId(null)
                    setSelected([])
                    setCustomerSearch(e.target.value)
                    setPickerOpen(true)
                  }}
                  onClick={() => setPickerOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && pickerOpen) {
                      e.stopPropagation()
                      setPickerOpen(false)
                    }
                  }}
                  style={customerId ? { paddingRight: 34 } : undefined}
                />
                {customerId && (
                  <button
                    type="button"
                    className="invoice-search-field__clear"
                    aria-label="Limpar cliente"
                    onClick={clearCustomer}
                  >
                    ×
                  </button>
                )}
                {pickerOpen && (customerOptions?.length ?? 0) > 0 && (
                  <div className="invoice-search-field__menu" role="listbox">
                    {customerOptions!.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        role="option"
                        aria-selected={c.id === customerId}
                        className={`invoice-search-field__option${c.id === customerId ? ' invoice-search-field__option--active' : ''}`}
                        onClick={() => {
                          setCustomerId(c.id)
                          setVoyageId(null)
                          setSearch('')
                          setCustomerSearch(c.name)
                          setPickerOpen(false)
                          setSelected([])
                        }}
                      >
                        <div className="invoice-search-field__option-name">{c.name}</div>
                        <div className="invoice-search-field__option-meta">{c.cnpj_cpf}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
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

          {error && <div style={{ color: 'var(--app-danger, #dc2626)', fontSize: 13 }}>{error}</div>}
        </section>

        <section className="invoice-create-modal__table-section" data-testid="consolidated-invoice-table">
          <div className="invoice-create-modal__table-scroll">
            {!customerId ? (
              <EmptyState title="Selecione um cliente" description="Selecione um cliente para ver B/Ls com saldo aberto." />
            ) : isLoading ? (
              <EmptyState title="Carregando..." description="Buscando B/Ls com saldo aberto." />
            ) : rows.length === 0 ? (
              <EmptyState title="Sem B/Ls" description="Cliente não possui B/Ls abertos para consolidar." />
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--app-border)' }}>
                    <th style={{ padding: '8px' }}></th>
                    <th style={{ padding: '8px' }}>B/L</th>
                    <th style={{ padding: '8px' }}>Navio/Viagem</th>
                    <th style={{ padding: '8px' }}>Individual</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>Saldo</th>
                    <th style={{ padding: '8px' }}>Elegibilidade</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const eligible = isReceivableSelectable(r)
                    return (
                      <tr
                        key={r.receivable_id}
                        style={{ borderBottom: '1px solid var(--app-border)', opacity: eligible ? 1 : 0.6 }}
                      >
                        <td style={{ padding: '8px' }}>
                          <input
                            type="checkbox"
                            aria-label={`Selecionar B/L ${r.bl_id}`}
                            checked={selected.includes(r.receivable_id)}
                            disabled={!eligible}
                            onChange={() => toggle(r.receivable_id)}
                          />
                        </td>
                        <td style={{ padding: '8px', fontWeight: 600 }}>{r.bl_id}</td>
                        <td style={{ padding: '8px' }}>
                          {[r.vessel_name, r.voyage_number].filter(Boolean).join(' ') || '—'}
                        </td>
                        <td style={{ padding: '8px' }}>{r.individual_invoice_number ?? '—'}</td>
                        <td style={{ padding: '8px', textAlign: 'right' }}>{fmtBRL(r.balance_brl)}</td>
                        <td style={{ padding: '8px' }}>
                          {eligible ? (
                            <Badge tone="green">Elegível</Badge>
                          ) : (
                            <span style={{ fontSize: 12, opacity: 0.8 }}>{r.eligibility_reason}</span>
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
          <div style={{ fontSize: 13 }}>
            {selected.length} de {eligibleCount} elegíveis · <strong>{fmtBRL(selectedTotal)}</strong>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={close}>
              Voltar
            </Button>
            <Button
              variant="primary"
              onClick={submit}
              loading={createMutation.isPending}
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

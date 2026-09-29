import { useMemo, useState } from 'react'
import { FilePlus2 } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/Card'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { usePortalConsolidatableReceivables, usePortalCreateConsolidation } from '../../hooks/usePortalBilling'
import { isReceivableSelectable, summarizeConsolidation } from '../billing/consolidatedInvoiceSelection'
import { formatBRL } from '../../lib/utils'
import { usePortalScope } from '../../hooks/usePortalScope'
import { isPortalReadOnly } from '../../services/portalScope'

type Props = {
  open: boolean
  onClose: () => void
  onCreated?: (invoiceId: number | null) => void
}

// Modal de emissão de fatura consolidada para o cliente do portal. A seleção
// opera sobre os receivables abertos do próprio cliente (modelo ledger), com
// elegibilidade por linha — espelhando o ConsolidatedInvoiceModal interno.
export function PortalConsolidatedModal({ open, onClose, onCreated }: Props) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { data: receivables, isLoading } = usePortalConsolidatableReceivables()
  const createMutation = usePortalCreateConsolidation()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)
  const [selected, setSelected] = useState<number[]>([])

  const rows = useMemo(() => receivables ?? [], [receivables])
  const summary = useMemo(() => summarizeConsolidation(rows, selected), [rows, selected])

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function close() {
    setSelected([])
    onClose()
  }

  async function submit() {
    if (selected.length === 0) {
      showToast('Selecione ao menos um B/L para consolidar.', 'error')
      return
    }
    const selectedRows = rows.filter((row) => selected.includes(row.receivable_id) && isReceivableSelectable(row))
    if (selectedRows.length !== selected.length) {
      showToast('A seleção mudou. Atualize a lista e selecione novamente os B/Ls elegíveis.', 'error')
      return
    }
    const confirmed = await confirm({
      title: 'Emitir fatura consolidada',
      message: `Emitir uma fatura consolidada de ${formatBRL(selectedRows.reduce((total, row) => total + Number(row.balance_brl ?? 0), 0))} para sua empresa?`,
      confirmLabel: 'Consolidar e emitir',
      affected: {
        summary: `${selectedRows.length} B/L(s) · ${formatBRL(selectedRows.reduce((total, row) => total + Number(row.balance_brl ?? 0), 0))} em saldos abertos`,
        items: selectedRows.map((row) => `B/L ${row.bl_id} · ${formatBRL(row.balance_brl)} · ${[row.vessel_name, row.voyage_number].filter(Boolean).join(' ') || 'viagem não informada'}`),
      },
      consequence: 'Cria a fatura consolidada, vincula os recebíveis selecionados e registra o evento financeiro. A invoice emitida ficará disponível no Portal e esses saldos não poderão entrar em outra invoice ativa.',
      reversibility: 'O Portal não permite apagar ou cancelar invoices. Se a consolidada ficar obsoleta, os recebíveis elegíveis podem ser consolidados novamente; pagamentos seguem o fluxo de estorno.',
    })
    if (!confirmed) return
    try {
      const payload = await createMutation.mutateAsync({ receivableIds: selectedRows.map((row) => row.receivable_id) })
      showToast('Fatura consolidada emitida com sucesso.', 'success')
      setSelected([])
      onCreated?.(Number(payload.invoice_id ?? 0) || null)
      onClose()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao consolidar cobranças.', 'error')
    }
  }

  return (
    <Modal open={open} onClose={close} title="Gerar fatura consolidada">
      <div className="grid gap-4">
        <p className="text-sm text-[var(--app-muted)]">
          Selecione os B/Ls em aberto para emitir uma única fatura consolidada. Apenas itens elegíveis podem ser
          selecionados.
        </p>

        <div className="app-table-scroll">
          {isLoading ? (
            <EmptyState title="Carregando..." description="Buscando B/Ls com saldo aberto." />
          ) : rows.length === 0 ? (
            <EmptyState title="Sem B/Ls" description="Você não possui B/Ls com saldo aberto para consolidar." />
          ) : (
            <table className="app-table app-table--compact min-w-[640px] text-left text-sm">
              <caption className="sr-only">B/Ls com saldo aberto para consolidação</caption>
              <thead>
                <tr>
                  <th scope="col" className="px-3 py-2">Sel.</th>
                  <th scope="col" className="px-3 py-2">B/L</th>
                  <th scope="col" className="px-3 py-2">Navio/Viagem</th>
                  <th scope="col" className="px-3 py-2">Individual</th>
                  <th scope="col" className="px-3 py-2">Saldo</th>
                  <th scope="col" className="px-3 py-2">Elegibilidade</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const eligible = isReceivableSelectable(r)
                  return (
                    <tr key={r.receivable_id} style={{ opacity: eligible ? 1 : 0.6 }}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Selecionar B/L ${r.bl_id}`}
                          checked={selected.includes(r.receivable_id)}
                          disabled={!eligible || readOnly}
                          onChange={() => toggle(r.receivable_id)}
                        />
                      </td>
                      <td className="px-3 py-2 font-semibold">{r.bl_id}</td>
                      <td className="px-3 py-2">{[r.vessel_name, r.voyage_number].filter(Boolean).join(' / ') || '—'}</td>
                      <td className="px-3 py-2">{r.individual_invoice_number ?? '—'}</td>
                      <td className="px-3 py-2">{formatBRL(r.balance_brl)}</td>
                      <td className="px-3 py-2">
                        {eligible ? (
                          <Badge tone="green">Elegível</Badge>
                        ) : (
                          <span className="text-xs opacity-80">{r.eligibility_reason}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--app-border)] pt-4">
          <div className="text-sm">
            {summary.selectedCount} de {summary.eligibleCount} elegíveis · <strong>{formatBRL(summary.total)}</strong>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={close}>
              Voltar
            </Button>
            <Button onClick={submit} loading={createMutation.isPending} disabled={summary.selectedCount === 0 || readOnly} title={readOnly ? 'Ação do cliente — indisponível em Modo Inspeção' : undefined}>
              <FilePlus2 size={16} />
              Consolidar e emitir
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

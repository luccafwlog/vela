import { useState } from 'react'
import { Pencil, Plus, Trash2, Users } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card, EmptyState, InlineError } from '../ui/Card'
import { Input } from '../ui/Input'
import { useConfirm, useConfirmWithReason } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import {
  useCustomerDemurrageAgreements,
  useDeleteCustomerDemurrageAgreement,
  useToggleCustomerDemurrageAgreementActive,
} from '../../hooks/useCustomerDemurrageAgreements'
import { formatCnpjCpf, formatDate, formatUSD } from '../../lib/utils'
import { CustomerDemurrageAgreementModal } from './CustomerDemurrageAgreementModal'
import type { CustomerDemurrageAgreementListItem } from '../../types/customerDemurrageAgreements'

export function CustomerDemurrageAgreementsTab({ canEdit }: { canEdit: boolean }) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const confirmWithReason = useConfirmWithReason()

  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedAgreement, setSelectedAgreement] = useState<CustomerDemurrageAgreementListItem | null>(null)

  const { data: agreements, isLoading, error } = useCustomerDemurrageAgreements()
  const deleteMutation = useDeleteCustomerDemurrageAgreement()
  const toggleMutation = useToggleCustomerDemurrageAgreementActive()

  const filtered = (agreements ?? []).filter((a) => {
    if (!search.trim()) return true
    const term = search.toLowerCase()
    const name = a.customer?.name?.toLowerCase() ?? ''
    const cnpj = a.customer?.cnpj_cpf?.toLowerCase() ?? ''
    return name.includes(term) || cnpj.includes(term)
  })

  function handleOpenNew() {
    setSelectedAgreement(null)
    setModalOpen(true)
  }

  function handleOpenEdit(agreement: CustomerDemurrageAgreementListItem) {
    setSelectedAgreement(agreement)
    setModalOpen(true)
  }

  async function handleDelete(agreement: CustomerDemurrageAgreementListItem) {
    const customerName = agreement.customer?.name ?? `Cliente #${agreement.customer_id}`
    const reason = await confirmWithReason({
      title: 'Excluir Acordo de Demurrage',
      message: `Excluir o acordo de Demurrage de ${customerName}?`,
      consequence: 'Cálculos novos de Demurrage deste cliente voltam a usar a tarifa padrão.',
      reversibility: 'Não é possível desfazer; cadastre o acordo de novo se precisar.',
      tone: 'danger',
      confirmLabel: 'Excluir',
    })
    if (reason === null) return

    deleteMutation.mutate(
      { id: agreement.id, reason, customerId: agreement.customer_id },
      {
        onSuccess: () => showToast('Acordo removido com sucesso.', 'success'),
        onError: (err) => showToast(err instanceof Error ? err.message : 'Erro ao remover acordo.', 'error'),
      },
    )
  }

  async function handleToggleActive(agreement: CustomerDemurrageAgreementListItem) {
    const nextActive = !agreement.active
    const customerName = agreement.customer?.name ?? `Cliente #${agreement.customer_id}`
    const confirmed = await confirm({
      title: `${nextActive ? 'Ativar' : 'Desativar'} acordo de Demurrage`,
      message: `${nextActive ? 'Ativar' : 'Desativar'} o acordo de Demurrage de ${customerName}?`,
      confirmLabel: nextActive ? 'Ativar acordo' : 'Desativar acordo',
      affected: {
        summary: `${customerName} · ${agreement.free_days} dias de Free Time · ${formatDate(agreement.valid_from)} a ${agreement.valid_to ? formatDate(agreement.valid_to) : 'sem data final'}`,
      },
      changes: [{ field: 'Status', before: agreement.active ? 'Ativo' : 'Inativo', after: nextActive ? 'Ativo' : 'Inativo' }],
      consequence: nextActive
        ? 'Os cálculos passam a considerar este acordo quando a data de descarga estiver dentro da vigência.'
        : 'Os cálculos deixam de considerar este acordo e usam as regras padrão aplicáveis ao cliente.',
      reversibility: 'O status pode ser alternado novamente; invoices já emitidas mantêm seu ciclo financeiro e histórico.',
    })
    if (!confirmed) return
    toggleMutation.mutate(
      { id: agreement.id, active: nextActive, customerId: agreement.customer_id },
      {
        onSuccess: () => showToast(`Acordo ${!agreement.active ? 'ativado' : 'inativado'}.`, 'success'),
        onError: (err) => showToast(err instanceof Error ? err.message : 'Falha ao alterar status.', 'error'),
      },
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-md flex-1">
          <Input
            placeholder="Buscar por cliente ou CNPJ..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {canEdit ? (
          <Button onClick={handleOpenNew}>
            <Plus size={16} />
            Novo Acordo
          </Button>
        ) : null}
      </div>

      {error ? (
        <InlineError message="Falha ao carregar os acordos de Demurrage." />
      ) : isLoading ? (
        <Card className="py-12 text-center text-slate-400">Carregando acordos...</Card>
      ) : filtered.length === 0 ? (
        <div className="space-y-4">
          <EmptyState
            icon={Users}
            title="Nenhum acordo de Demurrage encontrado"
            description={
              search
                ? 'Tente ajustar os termos de busca.'
                : 'Cadastre condições especiais de free time e tarifas customizadas por cliente.'
            }
          />
          {canEdit && !search ? (
            <div className="text-center">
              <Button onClick={handleOpenNew} variant="secondary">
                <Plus size={16} />
                Cadastrar primeiro acordo
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="app-table-scroll">
            <table className="app-table w-full text-left text-sm">
              <caption className="sr-only">Acordos de demurrage por cliente</caption>
              <thead className="bg-[#0d1117] text-xs uppercase text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3">Cliente</th>
                  <th scope="col" className="px-4 py-3">Free Time</th>
                  <th scope="col" className="px-4 py-3">Tarifa P1</th>
                  <th scope="col" className="px-4 py-3">Tarifa P2</th>
                  <th scope="col" className="px-4 py-3">Vigência</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Observações</th>
                  {canEdit ? <th scope="col" className="px-4 py-3 text-right">Ações</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-[#161b22]/50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{item.customer?.name ?? `Cliente #${item.customer_id}`}</div>
                      <div className="text-xs text-slate-400">
                        {item.customer?.cnpj_cpf ? formatCnpjCpf(item.customer.cnpj_cpf) : '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-semibold text-white">
                      {item.free_days} dias
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {item.p1_usd != null ? (
                        formatUSD(item.p1_usd)
                      ) : (
                        <span className="text-xs italic text-slate-500">Tabela geral</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {item.p2_usd != null ? (
                        formatUSD(item.p2_usd)
                      ) : (
                        <span className="text-xs italic text-slate-500">Tabela geral</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300">
                      <div>{formatDate(item.valid_from)}</div>
                      <div className="text-slate-500">
                        até {item.valid_to ? formatDate(item.valid_to) : 'indeterminado'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => canEdit && void handleToggleActive(item)}
                        disabled={!canEdit}
                        className={canEdit ? 'cursor-pointer' : 'cursor-default'}
                        title={canEdit ? 'Clique para alternar status' : undefined}
                      >
                        <Badge tone={item.active ? 'green' : 'slate'}>
                          {item.active ? 'Ativo' : 'Inativo'}
                        </Badge>
                      </button>
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-xs text-slate-400" title={item.notes ?? ''}>
                      {item.notes ?? '—'}
                    </td>
                    {canEdit ? (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(item)}
                            className="rounded p-1 text-slate-400 hover:bg-[#21262d] hover:text-white"
                            title="Editar acordo"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(item)}
                            className="rounded p-1 text-slate-400 hover:bg-[#21262d] hover:text-rose-400"
                            title="Excluir acordo"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {modalOpen ? (
        <CustomerDemurrageAgreementModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          initialAgreement={selectedAgreement}
        />
      ) : null}
    </div>
  )
}

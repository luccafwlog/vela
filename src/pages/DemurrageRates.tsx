import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { TabButton } from '../components/ui/TabButton'
import { useConfirmWithReason } from '../components/ui/ConfirmDialog'
import { Field, Input } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import type { DemurrageRate } from '../types/database'
import {
  useDeleteDemurrageRate,
  useDemurrageRates,
  useSaveDemurrageRate,
  useToggleDemurrageRateActive,
} from '../hooks/useDemurrageRates'
import { CustomerDemurrageAgreementsTab } from '../components/demurrage/CustomerDemurrageAgreementsTab'
import { formatDate, formatUSD } from '../lib/utils'

type DemurrageRateForm = Omit<DemurrageRate, 'id' | 'created_at' | 'updated_at' | 'valid_from'> & {
  valid_from: string | null
}

const EMPTY_FORM: DemurrageRateForm = {
  container_type: '',
  free_days: 21,
  p1_day_from: 22,
  p1_day_to: 30,
  p1_usd: 0,
  p2_day_from: 31,
  p2_usd: 0,
  valid_from: null,
  valid_to: null,
  active: true,
  notes: null,
}

export function DemurrageRates() {
  const { isAdmin } = useAuth()
  const { showToast } = useToast()
  const confirmWithReason = useConfirmWithReason()
  const [searchParams, setSearchParams] = useSearchParams()
  const currentTab = searchParams.get('tab') === 'acordos' ? 'acordos' : 'padrao'
  const [tab, setTab] = useState<'padrao' | 'acordos'>(currentTab)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<DemurrageRateForm & { id?: number }>(EMPTY_FORM)

  const { data: rates, isLoading, error } = useDemurrageRates()
  const saveMutation = useSaveDemurrageRate()
  const deleteMutation = useDeleteDemurrageRate()
  const toggleMutation = useToggleDemurrageRateActive()

  function handleSelectTab(nextTab: 'padrao' | 'acordos') {
    setTab(nextTab)
    setSearchParams((params) => {
      if (nextTab === 'acordos') params.set('tab', 'acordos')
      else params.delete('tab')
      return params
    }, { replace: true })
  }

  function openNew() {
    setForm({ ...EMPTY_FORM })
    setModalOpen(true)
  }

  function openEdit(rate: DemurrageRate) {
    setForm({ ...rate })
    setModalOpen(true)
  }

  function field<K extends keyof DemurrageRateForm>(key: K) {
    return (value: DemurrageRateForm[K]) => setForm((prev) => ({ ...prev, [key]: value }))
  }

  function handleSave() {
    if (!form.container_type) {
      showToast('Informe o tipo de container.', 'error')
      return
    }
    saveMutation.mutate(form, {
      onSuccess: () => {
        showToast(form.id ? 'Tarifa atualizada.' : 'Tarifa criada.', 'success')
        setModalOpen(false)
      },
      onError: () => showToast('Falha ao salvar tarifa.', 'error'),
    })
  }

  async function handleDelete(id: number) {
    const reason = await confirmWithReason({ title: 'Excluir tarifa de Demurrage', message: 'Excluir esta tarifa de Demurrage?', consequence: 'A tarifa sai do cadastro e não entra em cálculos novos.', reversibility: 'Não é possível desfazer; cadastre de novo se precisar.', tone: 'danger', confirmLabel: 'Excluir' })
    if (reason === null) return
    deleteMutation.mutate({ id, reason }, {
      onSuccess: () => showToast('Tarifa removida.', 'success'),
      onError: () => showToast('Falha ao remover tarifa.', 'error'),
    })
  }

  function handleToggleActive(rate: DemurrageRate) {
    toggleMutation.mutate(
      { id: rate.id, active: !rate.active },
      { onError: () => showToast('Falha ao alterar status.', 'error') },
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tarifas de Demurrage"
        description="Gerencie a tabela geral por tipo de container e acordos comerciais customizados por cliente."
        action={isAdmin && tab === 'padrao' ? (
          <Button onClick={openNew}>
            <Plus size={16} />
            Nova Tarifa
          </Button>
        ) : undefined}
      />

      <div className="flex flex-wrap gap-2" role="tablist">
        <TabButton active={tab === 'padrao'} label="Tabela Padrão (Armador)" onClick={() => handleSelectTab('padrao')} />
        <TabButton active={tab === 'acordos'} label="Acordos de Clientes" onClick={() => handleSelectTab('acordos')} />
      </div>

      {tab === 'acordos' ? (
        <CustomerDemurrageAgreementsTab canEdit={isAdmin} />
      ) : (
        <>
          {error ? <InlineError message="Erro ao carregar tarifas de demurrage." /> : null}

          <Card className="overflow-hidden p-0">
            <div className="app-table-scroll">
              <table className="app-table app-table--compact min-w-[800px] text-left text-sm whitespace-nowrap">
                <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-3">Tipo Container</th>
                    <th scope="col" className="px-4 py-3">Free time</th>
                    <th scope="col" className="px-4 py-3">P1 (dias)</th>
                    <th scope="col" className="px-4 py-3">P1 USD/dia</th>
                    <th scope="col" className="px-4 py-3">P2 (dias)</th>
                    <th scope="col" className="px-4 py-3">P2 USD/dia</th>
                    <th scope="col" className="px-4 py-3">Vigência</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                    {isAdmin && <th scope="col" className="px-4 py-3 w-20">Ações</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363d]">
                  {isLoading && (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                        Carregando...
                      </td>
                    </tr>
                  )}
                  {!isLoading && !rates?.length && (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                        Nenhuma tarifa cadastrada.
                      </td>
                    </tr>
                  )}
                  {(rates ?? []).map((rate) => (
                    <tr key={rate.id} className="hover:bg-[#21262d]/60">
                  <td className="px-4 py-3 font-mono font-semibold">{rate.container_type}</td>
                  <td className="px-4 py-3">{rate.free_days}</td>
                  <td className="px-4 py-3">
                    {rate.p1_day_from}–{rate.p1_day_to}
                  </td>
                  <td className="px-4 py-3">{formatUSD(rate.p1_usd ?? 0)}</td>
                  <td className="px-4 py-3">{rate.p2_day_from}+</td>
                  <td className="px-4 py-3">{formatUSD(rate.p2_usd ?? 0)}</td>
                  <td className="px-4 py-3 text-slate-400">
                    {rate.valid_from ? formatDate(rate.valid_from) : '—'} {rate.valid_to ? `→ ${formatDate(rate.valid_to)}` : ''}
                  </td>
                  <td className="px-4 py-3">
                    {isAdmin ? (
                      <button onClick={() => handleToggleActive(rate)} className="app-status-toggle">
                        <Badge tone={rate.active ? 'green' : 'slate'}>{rate.active ? 'Ativo' : 'Inativo'}</Badge>
                      </button>
                    ) : (
                      <Badge tone={rate.active ? 'green' : 'slate'}>{rate.active ? 'Ativo' : 'Inativo'}</Badge>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => openEdit(rate)}
                          className="app-table__icon-button app-table__icon-button--sm"
                          title="Editar"
                          aria-label="Editar tarifa"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => handleDelete(rate.id)}
                          disabled={deleteMutation.isPending && deleteMutation.variables?.id === rate.id}
                          className="app-table__icon-button app-table__icon-button--danger app-table__icon-button--sm"
                          title="Excluir"
                          aria-label="Excluir tarifa"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? 'Editar Tarifa' : 'Nova Tarifa'}>
        <div className="space-y-4">
          <Field label="Tipo de Container (ex: 20GP, 40HC, 40RF)">
            <Input
              value={form.container_type}
              onChange={(e) => field('container_type')(e.target.value.toUpperCase())}
              placeholder="20GP"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Free time">
              <Input
                type="number"
                value={String(form.free_days)}
                onChange={(e) => field('free_days')(Number(e.target.value))}
              />
            </Field>
            <Field label="P1 Início (dia)">
              <Input
                type="number"
                value={String(form.p1_day_from)}
                onChange={(e) => field('p1_day_from')(Number(e.target.value))}
              />
            </Field>
            <Field label="P1 Fim (dia)">
              <Input
                type="number"
                value={String(form.p1_day_to)}
                onChange={(e) => field('p1_day_to')(Number(e.target.value))}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="P1 USD/dia">
              <Input
                type="number"
                value={String(form.p1_usd)}
                onChange={(e) => field('p1_usd')(Number(e.target.value))}
              />
            </Field>
            <Field label="P2 Início (dia)">
              <Input
                type="number"
                value={String(form.p2_day_from)}
                onChange={(e) => field('p2_day_from')(Number(e.target.value))}
              />
            </Field>
            <Field label="P2 USD/dia">
              <Input
                type="number"
                value={String(form.p2_usd)}
                onChange={(e) => field('p2_usd')(Number(e.target.value))}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Válido de">
              <Input
                type="date"
                value={form.valid_from ?? ''}
                onChange={(e) => field('valid_from')(e.target.value || null)}
              />
            </Field>
            <Field label="Válido até">
              <Input
                type="date"
                value={form.valid_to ?? ''}
                onChange={(e) => field('valid_to')(e.target.value || null)}
              />
            </Field>
          </div>
          <Field label="Observações">
            <Input
              value={form.notes ?? ''}
              onChange={(e) => field('notes')(e.target.value || null)}
              placeholder="Opcional"
            />
          </Field>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Voltar
            </Button>
            <Button onClick={handleSave} loading={saveMutation.isPending}>
              Salvar
            </Button>
          </div>
        </div>
      </Modal>
        </>
      )}
    </div>
  )
}

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input, Select } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { listGraniteRates, upsertGraniteRate, deleteGraniteRate } from '../services/graniteCharges'
import type { GraniteRate } from '../types/database'

const EMPTY_FORM: Omit<GraniteRate, 'id' | 'created_at'> = {
  description: '',
  charge_type: 'per_ton',
  unit_value: 0,
  currency: 'BRL',
  valid_from: null,
  valid_to: null,
  active: true,
}

export function GraniteRates() {
  const queryClient = useQueryClient()
  const { isAdmin } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<Omit<GraniteRate, 'id' | 'created_at'> & { id?: string }>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const { data: rates, isLoading, error } = useQuery({
    queryKey: ['granite-rates'],
    queryFn: listGraniteRates,
  })

  function openNew() {
    setForm({ ...EMPTY_FORM })
    setModalOpen(true)
  }

  function openEdit(rate: GraniteRate) {
    setForm({ ...rate })
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.description || !form.charge_type || form.unit_value === undefined) return
    setSaving(true)
    try {
      await upsertGraniteRate(form)
      await queryClient.invalidateQueries({ queryKey: ['granite-rates'] })
      showToast('Taxa salva.', 'success')
      setModalOpen(false)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao salvar taxa.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!(await confirm({ title: 'Excluir taxa de Granito', message: 'Excluir esta taxa de Granito?', consequence: 'A taxa sai do cadastro e não entra em cálculos novos. O banco recusa se ela já foi usada.', reversibility: 'Não é possível desfazer; cadastre de novo se precisar.', tone: 'danger', confirmLabel: 'Excluir' }))) return
    setDeletingId(id)
    try {
      await deleteGraniteRate(id)
      await queryClient.invalidateQueries({ queryKey: ['granite-rates'] })
      showToast('Taxa excluida.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao excluir.', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleToggleActive(rate: GraniteRate) {
    try {
      await upsertGraniteRate({ ...rate, active: !rate.active })
      await queryClient.invalidateQueries({ queryKey: ['granite-rates'] })
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao atualizar.', 'error')
    }
  }

  const chargeTypeLabel: Record<GraniteRate['charge_type'], string> = {
    per_kg: 'Por kg',
    per_ton: 'Por tonelada',
    per_bl: 'Por B/L (fixo)',
    fixed: 'Fixo global',
  }

  return (
    <>
      <PageHeader
        title="Tabela de Taxas — Granito"
        description="Taxas aplicadas ao peso real dos B/Ls de granito."
        action={
          isAdmin ? (
            <Button onClick={openNew}>
              <Plus size={16} />
              Nova taxa
            </Button>
          ) : null
        }
      />

      <Card className="overflow-hidden p-0">
        {error ? <InlineError message="Erro ao carregar taxas." /> : null}

        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[800px] text-left text-sm whitespace-nowrap">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3">Descrição</th>
                <th scope="col" className="px-4 py-3">Tipo</th>
                <th scope="col" className="px-4 py-3">Valor Unitário</th>
                <th scope="col" className="px-4 py-3">Moeda</th>
                <th scope="col" className="px-4 py-3">Vigência</th>
                <th scope="col" className="px-4 py-3">Status</th>
                {isAdmin ? <th scope="col" className="px-4 py-3">Ações</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {isLoading ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-400" colSpan={7}>Carregando...</td>
                </tr>
              ) : null}
              {!isLoading && !rates?.length ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-400" colSpan={7}>
                    Nenhuma taxa cadastrada. Clique em "Nova taxa" para começar.
                  </td>
                </tr>
              ) : null}
              {(rates ?? []).map((rate) => (
                <tr key={rate.id} className="hover:bg-[#21262d]/60">
                  <td className="px-4 py-3 font-semibold text-white">{rate.description}</td>
                  <td className="px-4 py-3">{chargeTypeLabel[rate.charge_type]}</td>
                  <td className="px-4 py-3">
                    {Number(rate.unit_value).toLocaleString('pt-BR', { minimumFractionDigits: 4 })}
                  </td>
                  <td className="px-4 py-3">{rate.currency}</td>
                  <td className="px-4 py-3 text-slate-400">
                    {rate.valid_from ?? '—'} {rate.valid_from || rate.valid_to ? 'a' : ''} {rate.valid_to ?? ''}
                  </td>
                  <td className="px-4 py-3">
                    {isAdmin ? (
                      <button
                        className={`app-badge cursor-pointer ${rate.active ? 'app-badge--green' : 'app-badge--slate'}`}
                        onClick={() => handleToggleActive(rate)}
                      >
                        {rate.active ? 'Ativa' : 'Inativa'}
                      </button>
                    ) : (
                      <span className={`app-badge ${rate.active ? 'app-badge--green' : 'app-badge--slate'}`}>
                        {rate.active ? 'Ativa' : 'Inativa'}
                      </span>
                    )}
                  </td>
                  {isAdmin ? (
                    <td className="px-4 py-3">
                      <button className="app-table__action mr-2" onClick={() => openEdit(rate)}>Editar</button>
                      <button
                        className="text-red-400 hover:text-red-300 text-xs disabled:opacity-40"
                        onClick={() => handleDelete(rate.id)}
                        disabled={deletingId === rate.id}
                        aria-label="Excluir taxa"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? 'Editar taxa' : 'Nova taxa'}>
        <div className="grid gap-4">
          <Field label="Descricao">
            <Input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Ex: Taxa de agenciamento"
            />
          </Field>

          <Field label="Tipo de cobranca">
            <Select
              value={form.charge_type}
              onChange={(e) => setForm((f) => ({ ...f, charge_type: e.target.value as GraniteRate['charge_type'] }))}
            >
              <option value="per_kg">Por kg (peso real × valor)</option>
              <option value="per_ton">Por tonelada (peso real / 1000 × valor)</option>
              <option value="per_bl">Por B/L (fixo por conhecimento)</option>
              <option value="fixed">Fixo global</option>
            </Select>
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Valor unitario">
              <Input
                type="number"
                step="0.0001"
                min="0"
                value={form.unit_value}
                onChange={(e) => setForm((f) => ({ ...f, unit_value: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Moeda">
              <Select value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>
                <option value="BRL">BRL</option>
                <option value="USD">USD</option>
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Vigencia de (opcional)">
              <Input
                type="date"
                value={form.valid_from ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, valid_from: e.target.value || null }))}
              />
            </Field>
            <Field label="Vigencia ate (opcional)">
              <Input
                type="date"
                value={form.valid_to ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, valid_to: e.target.value || null }))}
              />
            </Field>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="rate-active"
              checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
            />
            <label htmlFor="rate-active" className="text-sm text-slate-300">Taxa ativa</label>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Voltar</Button>
            <Button disabled={!form.description} loading={saving} onClick={handleSave}>
              Salvar
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

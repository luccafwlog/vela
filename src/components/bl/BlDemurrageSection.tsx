import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { afterDatasContainerAlteradas } from '../../services/cacheEffects'
import { Save } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Field, Input } from '../ui/Input'
import { useConfirm } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import { useCustomerDemurrageAgreements } from '../../hooks/useCustomerDemurrageAgreements'
import { selectAgreementForDischargeDate } from '../../services/demurrage/customerDemurrageAgreements'
import { saveBlDemurrageConfig } from '../../services/blDemurrageConfig'
import { calculateDemurrage, ensureDemurrageRatesLoaded } from '../../services/demurrage/demurrageRates'
import { updateContainerReturnDate } from '../../services/demurrage/demurrageContainers'
import { queryKeys } from '../../services/queryKeys'
import { formatDate } from '../../lib/utils'
import type { BLDetail } from '../../types/database'

// Seção consolidada de demurrage do B/L: config geral (free time + P1/P2) e
// tabela por container com devolução editável e demurrage calculado.
export function BlDemurrageSection({ bl }: { bl: BLDetail }) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()

  // Sem cliente vinculado nao ha acordo a aplicar. O `enabled` e o que impede
  // a consulta de voltar com os acordos de TODOS os clientes (o filtro por
  // cliente so entra quando ha customerId) e o `.find()` abaixo casar, pela
  // data, o acordo negociado de outro cliente com este B/L.
  const { data: customerAgreements } = useCustomerDemurrageAgreements(
    { customerId: bl.customer_id ?? undefined, activeOnly: true },
    bl.customer_id != null,
  )

  // --- Config form state ---
  const [freeTime, setFreeTime] = useState<string>(
    bl.free_time_override != null ? String(bl.free_time_override) : '',
  )
  const [p1, setP1] = useState<string>(
    bl.demurrage_rate_override_p1_usd != null ? String(Number(bl.demurrage_rate_override_p1_usd)) : '',
  )
  const [p2, setP2] = useState<string>(
    bl.demurrage_rate_override_p2_usd != null ? String(Number(bl.demurrage_rate_override_p2_usd)) : '',
  )
  const [savingConfig, setSavingConfig] = useState(false)

  // Re-baseia os campos de config quando o B/L (re)carrega — padrão "adjusting
  // state when props change" do React, em vez de useEffect.
  const [prevBl, setPrevBl] = useState<BLDetail | null>(null)
  if (bl !== prevBl) {
    setPrevBl(bl)
    setFreeTime(bl.free_time_override != null ? String(bl.free_time_override) : '')
    setP1(bl.demurrage_rate_override_p1_usd != null ? String(Number(bl.demurrage_rate_override_p1_usd)) : '')
    setP2(bl.demurrage_rate_override_p2_usd != null ? String(Number(bl.demurrage_rate_override_p2_usd)) : '')
  }

  // --- Per-container return date state ---
  const [returnDates, setReturnDates] = useState<Record<number, string>>({})
  const [savingReturnDate, setSavingReturnDate] = useState<number | null>(null)
  const [ratesReady, setRatesReady] = useState(false)
  const [ratesError, setRatesError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ensureDemurrageRatesLoaded()
      .then(() => {
        if (active) setRatesReady(true)
      })
      .catch((error: unknown) => {
        if (active) setRatesError(error instanceof Error ? error.message : 'Tarifas de Demurrage indisponíveis.')
      })
    return () => {
      active = false
    }
  }, [])

  async function handleSaveDemurrageConfig() {
    if (!user) return

    const freeTimeVal = freeTime.trim() ? Number(freeTime) : null
    // Validate P1/P2
    const p1Val = p1.trim() ? Number(p1.replace(',', '.')) : null
    const p2Val = p2.trim() ? Number(p2.replace(',', '.')) : null
    if ([freeTimeVal, p1Val, p2Val].some((value) => value != null && !Number.isFinite(value))) {
      showToast('Valores invalidos para override de demurrage.', 'error')
      return
    }

    const changes = [
      {
        field: 'Free Time',
        before: bl.free_time_override != null ? `${bl.free_time_override} dias` : 'Padrão',
        after: freeTimeVal != null ? `${freeTimeVal} dias` : 'Padrão',
      },
      {
        field: 'Tarifa P1 (USD)',
        before: bl.demurrage_rate_override_p1_usd != null ? `USD ${Number(bl.demurrage_rate_override_p1_usd)}` : 'Padrão',
        after: p1Val != null ? `USD ${p1Val}` : 'Padrão',
      },
      {
        field: 'Tarifa P2 (USD)',
        before: bl.demurrage_rate_override_p2_usd != null ? `USD ${Number(bl.demurrage_rate_override_p2_usd)}` : 'Padrão',
        after: p2Val != null ? `USD ${p2Val}` : 'Padrão',
      },
    ].filter((c) => c.before !== c.after)

    if (changes.length === 0) {
      showToast('Nenhuma alteração para salvar.', 'info')
      return
    }

    const confirmed = await confirm({
      title: 'Salvar configuração de Demurrage',
      message: `Salvar os overrides de Demurrage do B/L ${bl.id}?`,
      confirmLabel: 'Salvar alterações',
      changes,
      consequence: 'Os valores configurados sobrescreverão os acordos e a tabela padrão no cálculo de demurrage dos containers deste B/L.',
      reversibility: 'Os valores de override podem ser editados ou limpos a qualquer momento.',
    })
    if (!confirmed) return

    setSavingConfig(true)
    try {
      await saveBlDemurrageConfig({
        blId: bl.id,
        expectedUpdatedAt: bl.updated_at ?? null,
        freeTime: freeTimeVal,
        p1: p1Val,
        p2: p2Val,
        changedBy: user.id,
      })
      await queryClient.invalidateQueries({ queryKey: queryKeys.bls.detail(bl.id) })
      showToast('Config de demurrage salva.', 'success')
      return
    } catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : ''
      if (code === 'PT409' || code === '40001') {
        await queryClient.invalidateQueries({ queryKey: queryKeys.bls.detail(bl.id) })
        showToast(
          'Este B/L foi alterado por outro usuario. Os dados foram recarregados; revise e salve novamente.',
          'error',
        )
      } else {
        showToast('Falha ao salvar config de demurrage.', 'error')
      }
      return
    } finally {
      setSavingConfig(false)
    }
  }

  async function handleSaveReturnDate(containerId: number) {
    const returnDate = returnDates[containerId] ?? null
    const container = bl.bl_containers?.find((c) => c.id === containerId)
    const beforeDate = container?.return_date ? formatDate(container.return_date) : 'Sem devolução'
    const afterDate = returnDate ? formatDate(returnDate) : 'Sem devolução'

    if (beforeDate === afterDate) {
      showToast('Nenhuma alteração na data de devolução.', 'info')
      return
    }

    const confirmed = await confirm({
      title: 'Salvar data de devolução',
      message: `Atualizar data de devolução do container ${container?.container_number ?? containerId}?`,
      confirmLabel: 'Salvar data',
      changes: [{ field: 'Data de devolução', before: beforeDate, after: afterDate }],
      consequence: 'O cálculo de Demurrage deste container considerará a devolução nesta data para apuração de dias excedentes e valores devidos.',
      reversibility: 'A data pode ser alterada ou desfeita novamente.',
    })
    if (!confirmed) return

    setSavingReturnDate(containerId)
    try {
      await updateContainerReturnDate(containerId, returnDate || null)
      await afterDatasContainerAlteradas(queryClient)
      setReturnDates((current) => {
        const next = { ...current }
        delete next[containerId]
        return next
      })
      showToast('Data de devolucao salva.', 'success')
    } catch {
      showToast('Erro ao salvar data de devolucao.', 'error')
    } finally {
      setSavingReturnDate(null)
    }
  }

  return (
    <div className="grid gap-5">
      {/* Config: free time + P1/P2 overrides */}
      <Card>
        <h2 className="mb-4 text-lg font-semibold text-white">Config de demurrage</h2>
        <p className="mb-4 text-sm text-slate-400">
          Deixe em branco para usar os valores padrão da tabela de taxas.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Free time override (dias)">
            <Input
              value={freeTime}
              onChange={(e) => setFreeTime(e.target.value)}
              placeholder={bl.free_time_override != null ? String(bl.free_time_override) : 'Padrão da tabela'}
            />
          </Field>
          <Field label="Taxa P1 override (USD/dia)">
            <Input
              value={p1}
              onChange={(e) => setP1(e.target.value)}
              placeholder={bl.demurrage_rate_override_p1_usd != null ? String(Number(bl.demurrage_rate_override_p1_usd)) : 'Padrão da tabela'}
            />
          </Field>
          <Field label="Taxa P2 override (USD/dia)">
            <Input
              value={p2}
              onChange={(e) => setP2(e.target.value)}
              placeholder={bl.demurrage_rate_override_p2_usd != null ? String(Number(bl.demurrage_rate_override_p2_usd)) : 'Padrão da tabela'}
            />
          </Field>
        </div>
        <div className="mt-4">
          <Button type="button" variant="secondary" onClick={() => void handleSaveDemurrageConfig()} loading={savingConfig}>
            <Save size={15} />
            Salvar config de demurrage
          </Button>
        </div>
      </Card>

      {/* Per-container table */}
      <Card>
        <h2 className="mb-4 text-lg font-semibold text-white">Demurrage por container</h2>
        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[600px] text-left text-sm">
            <thead className="bg-[#0d1117] text-xs uppercase text-slate-500">
              <tr>
                <th scope="col" className="py-2">Container</th>
                <th scope="col" className="py-2">Descarga</th>
                <th scope="col" className="py-2">Data de devolução</th>
                <th scope="col" className="py-2">Demurrage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {bl.bl_containers?.length ? (
                bl.bl_containers.map((container) => {
                  const returnDateVal = returnDates[container.id] ?? container.return_date ?? ''
                  let demCalc = null
                  let demError = ratesError
                  if (container.discharge_date && returnDateVal && ratesReady) {
                    try {
                      const matchingAgreement = selectAgreementForDischargeDate(
                        customerAgreements ?? [],
                        container.discharge_date,
                      )
                      demCalc = calculateDemurrage(
                        container.type,
                        container.discharge_date,
                        returnDateVal,
                        bl.free_time_override,
                        bl.demurrage_rate_override_p1_usd,
                        bl.demurrage_rate_override_p2_usd,
                        matchingAgreement,
                      )
                    } catch (error) {
                      demError = error instanceof Error ? error.message : 'Falha ao calcular Demurrage.'
                    }
                  }
                  return (
                    <tr key={container.id}>
                      <td className="py-2 font-semibold text-white">{container.container_number}</td>
                      <td className="py-2 text-slate-300">
                        {container.discharge_date ? (
                          formatDate(container.discharge_date)
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-2">
                        <div className="flex items-center gap-1">
                          <input
                            type="date"
                            className="rounded border border-[#30363d] bg-[#161b22] px-1 py-0.5 text-xs text-white"
                            value={returnDateVal}
                            onChange={(e) =>
                              setReturnDates((prev) => ({ ...prev, [container.id]: e.target.value }))
                            }
                          />
                          <button
                            type="button"
                            title="Salvar devolução"
                            aria-label="Salvar devolução"
                            className="rounded bg-blue-700 px-1.5 py-0.5 text-xs text-white hover:bg-blue-600 disabled:opacity-50"
                            disabled={savingReturnDate === container.id}
                            onClick={() => void handleSaveReturnDate(container.id)}
                          >
                            {savingReturnDate === container.id ? '...' : <Save size={12} />}
                          </button>
                        </div>
                      </td>
                      <td className="py-2">
                        {demError ? (
                          <span className="text-xs text-red-400">{demError}</span>
                        ) : demCalc ? (
                          demCalc.status === 'within_free_time' ? (
                            <span className="rounded bg-green-900/50 px-1.5 py-0.5 text-xs text-green-400">
                              Free time
                            </span>
                          ) : (
                            <span
                              className="rounded bg-red-900/50 px-1.5 py-0.5 text-xs text-red-400"
                              title={`P1: ${demCalc.days_p1}d × $${demCalc.rate_p1_usd} | P2: ${demCalc.days_p2}d × $${demCalc.rate_p2_usd}`}
                            >
                              {demCalc.total_days - demCalc.free_days}d — ${demCalc.total_usd.toFixed(2)}
                            </span>
                          )
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td className="py-3 text-slate-400" colSpan={4}>
                    Nenhum container vinculado a este B/L.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

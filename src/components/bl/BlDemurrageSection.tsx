import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { afterDatasContainerAlteradas } from '../../services/cacheEffects'
import { Save } from 'lucide-react'
import { Link } from 'react-router-dom'
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
import { formatDate, formatUSD } from '../../lib/utils'
import { DEMURRAGE_INVOICE_STATUS_LABELS, statusLabel } from '../../lib/statusLabels'
import type { BLDetail } from '../../types/database'

// Seção consolidada de demurrage do B/L: config geral (free time + P1/P2) e
// tabela por container com devolução editável e demurrage calculado.
export type BlDemurrageInvoiceSummary = { id: number; doc_number: string | null; status: string | null; total_usd: number | null }

export function BlDemurrageSection({ bl, invoices }: { bl: BLDetail; invoices?: BlDemurrageInvoiceSummary[] }) {
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
      showToast('Valores inválidos nas condições de Demurrage.', 'error')
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
      title: 'Salvar condições de Demurrage',
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
      showToast('Condições de Demurrage salvas.', 'success')
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
        showToast('Falha ao salvar as condições de Demurrage.', 'error')
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
      // A escrita já foi confirmada; uma falha na releitura não deve expor a data antiga.
      queryClient.setQueryData<BLDetail>(queryKeys.bls.detail(bl.id), (cached) => cached && ({
        ...cached,
        bl_containers: cached.bl_containers?.map((item) => item.id === containerId
          ? { ...item, return_date: returnDate || null }
          : item),
      }))
      await afterDatasContainerAlteradas(queryClient)
      setReturnDates((current) => {
        const next = { ...current }
        if (current[containerId] === returnDate) delete next[containerId]
        return next
      })
      showToast('Data de devolução salva.', 'success')
    } catch {
      showToast('Erro ao salvar a data de devolução.', 'error')
    } finally {
      setSavingReturnDate(null)
    }
  }

  const containers = bl.bl_containers ?? []

  return (
    <Card className="app-bl-sheet">
      <section className="app-bl-sheet__section" aria-labelledby="bl-demurrage">
      <div className="app-bl-section-head">
        <h2 id="bl-demurrage" className="app-bl-section-title">Demurrage</h2>
        <Link className="app-bl-link app-bl-section-head__link" to={`/demurrage?busca=${encodeURIComponent(bl.id)}`}>Abrir em Demurrage</Link>
      </div>

      {invoices?.length ? (
        <ul className="app-bl-invoice-list" aria-label="Faturas de Demurrage do B/L">
          {invoices.map((invoice) => (
            <li key={invoice.id}>
              <span className="app-bl-code">{invoice.doc_number ?? `#${invoice.id}`}</span>
              <span>{statusLabel(DEMURRAGE_INVOICE_STATUS_LABELS, invoice.status, 'Situação não informada')}</span>
              {invoice.total_usd != null ? <span className="tabular-nums">{formatUSD(invoice.total_usd)}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <h3 className="app-bl-subsection-title">Condições deste B/L</h3>
      <p className="app-bl-facts__sub mb-3">Em branco, vale o acordo do Cliente ou a tabela de Demurrage. Preenchido, substitui os dois neste B/L.</p>
      <div className="grid gap-3 md:grid-cols-[repeat(3,minmax(0,1fr))_auto] md:items-end">
        <Field label="Free time (dias)">
          <Input inputMode="numeric" value={freeTime} onChange={(e) => setFreeTime(e.target.value)} placeholder="Padrão" />
        </Field>
        <Field label="Tarifa P1 (USD/dia)">
          <Input inputMode="decimal" value={p1} onChange={(e) => setP1(e.target.value)} placeholder="Padrão" />
        </Field>
        <Field label="Tarifa P2 (USD/dia)">
          <Input inputMode="decimal" value={p2} onChange={(e) => setP2(e.target.value)} placeholder="Padrão" />
        </Field>
        <Button type="button" variant="secondary" onClick={() => void handleSaveDemurrageConfig()} loading={savingConfig} loadingLabel="Salvando…">
          <Save size={15} aria-hidden="true" />
          Salvar condições
        </Button>
      </div>

      <h3 className="app-bl-subsection-title mt-5">Devolução por container</h3>
      <div className="app-table-scroll">
        <table className="app-table app-table--compact app-bl-subtable min-w-[640px]">
          <thead>
            <tr>
              <th scope="col">Container</th>
              <th scope="col">Descarga</th>
              <th scope="col">Devolução</th>
              <th scope="col">Demurrage prevista</th>
            </tr>
          </thead>
          <tbody>
            {containers.length ? (
              containers.map((container) => {
                const returnDateVal = returnDates[container.id] ?? container.return_date ?? ''
                const returnDateChanged = returnDateVal !== (container.return_date ?? '')
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
                    <td className="app-bl-code text-[var(--app-text-strong)]">{container.container_number}</td>
                    <td>{container.discharge_date ? formatDate(container.discharge_date) : <span className="text-[var(--app-muted)]">—</span>}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <Input
                          type="date"
                          aria-label={`Devolução do container ${container.container_number}`}
                          className="max-w-[11rem]"
                          value={returnDateVal}
                          onChange={(e) => setReturnDates((prev) => ({ ...prev, [container.id]: e.target.value }))}
                        />
                        {returnDateChanged ? (
                          <Button
                            type="button"
                            variant="secondary"
                            className="app-btn--sm"
                            loading={savingReturnDate === container.id}
                            aria-label={`Salvar devolução do container ${container.container_number}`}
                            onClick={() => void handleSaveReturnDate(container.id)}
                          >
                            Salvar
                          </Button>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      {demError ? (
                        <span className="app-bl-error">{demError}</span>
                      ) : demCalc ? (
                        demCalc.status === 'within_free_time' ? (
                          <span className="app-bl-tone--success">Dentro do free time</span>
                        ) : (
                          <span className="app-bl-cell__stack">
                            <span className="app-bl-tone--danger tabular-nums">{`${demCalc.total_days - demCalc.free_days} dias excedentes · ${formatUSD(demCalc.total_usd)}`}</span>
                            <span className="app-bl-facts__sub tabular-nums">{`P1: ${demCalc.days_p1} d × ${formatUSD(demCalc.rate_p1_usd)} · P2: ${demCalc.days_p2} d × ${formatUSD(demCalc.rate_p2_usd)}`}</span>
                          </span>
                        )
                      ) : (
                        <span className="app-bl-facts__missing" title="Sem descarga ou devolução informada">—</span>
                      )}
                    </td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td className="text-[var(--app-muted)]" colSpan={4}>Nenhum container vinculado a este B/L.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </section>
    </Card>
  )
}

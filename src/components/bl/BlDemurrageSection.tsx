import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { afterDatasContainerAlteradas } from '../../services/cacheEffects'
import { Save } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '../ui/Button'
import { RowActionButton } from '../ui/RowActionButton'
import { Block, Fact, FactList, LeadValue } from '../ui/Block'
import { StatusText } from '../ui/StatusText'
import { CopyValue } from '../ui/CopyValue'
import { NoValue } from '../ui/NoValue'
import { Field, Input } from '../ui/Input'
import { useConfirm, useConfirmWithReason } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import { useCustomerDemurrageAgreements } from '../../hooks/useCustomerDemurrageAgreements'
import { selectAgreementForDischargeDate } from '../../services/demurrage/customerDemurrageAgreements'
import { saveBlDemurrageConfig } from '../../services/blDemurrageConfig'
import { calculateDemurrage, demurrageFreeTimeDays, demurrageRateFor, ensureDemurrageRatesLoaded } from '../../services/demurrage/demurrageRates'
import { daysSince } from '../../services/demurrage/demurragePresentation'
import { saoPauloTodayIso } from '../../lib/dates'
import { updateContainerReturnDate } from '../../services/demurrage/demurrageContainers'
import { queryKeys } from '../../services/queryKeys'
import { formatDate, formatUSD } from '../../lib/utils'
import { userFacingErrorMessage } from '../../lib/errors'
import { InvoiceStatusBadge } from '../demurrage/DemurrageBadges'
import { BlManualRoe } from './BlManualRoe'
import { demurrageInvoiceHref } from '../../pages/demurrageListState'
import type { BLDetail } from '../../types/database'

// Seção consolidada de demurrage do B/L: config geral (free time + P1/P2) e
// tabela por container com devolução editável e demurrage calculado.
export type BlDemurrageInvoiceSummary = { id: number; doc_number: string | null; status: string | null; total_usd: number | null }

export function BlDemurrageSection({ bl, invoices }: { bl: BLDetail; invoices?: BlDemurrageInvoiceSummary[] }) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const confirmWithReason = useConfirmWithReason()

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
  const [editingConditions, setEditingConditions] = useState(false)

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
      setEditingConditions(false)
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

    // Remover a devolução gravada é caso isolado e pede motivo (ADR 0078, item 19).
    const removing = Boolean(container?.return_date) && !returnDate
    let reason: string | null = null
    if (removing) {
      reason = await confirmWithReason({
        title: 'Remover data de devolução',
        message: `Remover a data de devolução do container ${container?.container_number ?? containerId}?`,
        confirmLabel: 'Remover data',
        tone: 'danger',
        changes: [{ field: 'Data de devolução', before: beforeDate, after: afterDate }],
        consequence: 'O container volta a contar como não devolvido nos B/Ls que o dividem nesta Viagem; Invoice de Demurrage emitida é reconciliada.',
        reversibility: 'Informe a data de novo quando ela for confirmada.',
      })
      if (reason === null) return
    } else {
      const confirmed = await confirm({
        title: 'Salvar data de devolução',
        message: `Atualizar data de devolução do container ${container?.container_number ?? containerId}?`,
        confirmLabel: 'Salvar data',
        changes: [{ field: 'Data de devolução', before: beforeDate, after: afterDate }],
        consequence: 'O cálculo de Demurrage deste container considerará a devolução nesta data para apuração de dias excedentes e valores devidos.',
        reversibility: 'A data pode ser alterada ou desfeita novamente.',
      })
      if (!confirmed) return
    }

    setSavingReturnDate(containerId)
    try {
      await updateContainerReturnDate(containerId, returnDate || null, reason)
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
    } catch (error) {
      // A recusa do banco (devolução antes da descarga, motivo ausente) é a orientação.
      showToast(userFacingErrorMessage(error, 'Erro ao salvar a data de devolução.'), 'error')
    } finally {
      setSavingReturnDate(null)
    }
  }

  const containers = bl.bl_containers ?? []
  const today = saoPauloTodayIso()
  const hasOverride = bl.free_time_override != null || bl.demurrage_rate_override_p1_usd != null || bl.demurrage_rate_override_p2_usd != null
  // Acordo do Cliente que vale para a descarga mais antiga do B/L (o mesmo
  // critério do cálculo por container).
  const firstDischarge = containers.map((container) => container.discharge_date).filter(Boolean).sort()[0] ?? today
  const agreement = selectAgreementForDischargeDate(customerAgreements ?? [], firstDischarge)
  const conditionSource = hasOverride ? 'Condição deste B/L' : agreement ? 'Acordo do Cliente' : 'Tabela de Demurrage'
  // SOC não tem Demurrage; tipo sem tarifa vira "Sem tarifa" no bloco, não erro
  // na ficha inteira (o cálculo por container trata o mesmo caso na linha).
  const containerTypes = Array.from(new Set(containers.filter((container) => container.ownership !== 'SOC').map((container) => container.type ?? null)))
  const conditionFor = (type: string | null) => {
    try {
      return demurrageRateFor(type, bl.free_time_override, bl.demurrage_rate_override_p1_usd, bl.demurrage_rate_override_p2_usd, agreement)
    } catch {
      return null
    }
  }

  const lines = containers.map((container) => {
    const soc = container.ownership === 'SOC'
    const returnDateVal = returnDates[container.id] ?? container.return_date ?? ''
    let calc: ReturnType<typeof calculateDemurrage> | null = null
    let freeTimeDays: number | null = null
    let error = ratesError
    if (!soc && ratesReady) {
      const matchingAgreement = selectAgreementForDischargeDate(customerAgreements ?? [], container.discharge_date ?? today)
      try {
        freeTimeDays = demurrageFreeTimeDays(container.type, bl.free_time_override, matchingAgreement)
        if (container.discharge_date) {
          calc = calculateDemurrage(
            container.type,
            container.discharge_date,
            returnDateVal || today,
            bl.free_time_override,
            bl.demurrage_rate_override_p1_usd,
            bl.demurrage_rate_override_p2_usd,
            matchingAgreement,
          )
        }
      } catch (err) {
        error = err instanceof Error ? err.message : 'Falha ao calcular Demurrage.'
      }
    }
    const days = container.discharge_date ? daysSince(container.discharge_date, returnDateVal || today) : null
    return { container, soc, returnDateVal, returnDateChanged: returnDateVal !== (container.return_date ?? ''), calc, freeTimeDays, days, error }
  })
  const chargeable = lines.filter((line) => !line.soc && line.container.discharge_date)
  const overdue = chargeable.filter((line) => line.calc?.status === 'overdue')
  const notCalculated = chargeable.filter((line) => line.error || !line.calc)
  const overdueUsd = overdue.reduce((sum, line) => sum + (line.calc?.total_usd ?? 0), 0)
  const invoicesText = invoices?.length
    ? invoices.map((invoice) => invoice.doc_number ?? `#${invoice.id}`).join(', ')
    : 'nenhuma fatura de Demurrage'

  return (
    <>
      <Block
        title="Demurrage"
        flush
        aside={<Link className="app-btn app-btn--secondary app-btn--sm" to={`/demurrage?busca=${encodeURIComponent(bl.id)}`}>Abrir em Demurrage</Link>}
      >
        <div className="app-block__body">
          {overdue.length ? (
            <LeadValue tone="warning" detail={`${overdue.length} de ${chargeable.length} fora do free time${notCalculated.length ? ` · ${notCalculated.length} sem cálculo` : ''} · ${invoicesText}`}>{formatUSD(overdueUsd)} {overdue.every((line) => line.returnDateVal) ? 'a faturar' : 'em curso'}</LeadValue>
          ) : notCalculated.length ? (
            <LeadValue tone="warning" detail={invoicesText}>{`Demurrage não calculada para ${notCalculated.length} de ${chargeable.length} contêiner${chargeable.length > 1 ? 'es' : ''}`}</LeadValue>
          ) : (
            <LeadValue detail={invoicesText}>{chargeable.length ? `${chargeable.length} de ${chargeable.length} no free time` : 'Sem contêiner descarregado'}</LeadValue>
          )}
          {invoices?.length ? (
            <FactList columns={4}>
              {invoices.map((invoice) => (
                <Fact key={invoice.id} label="Fatura de Demurrage">
                  <Link className="app-link" to={demurrageInvoiceHref(invoice.id)}>{invoice.doc_number ?? `#${invoice.id}`}</Link>{' '}
                  <InvoiceStatusBadge status={invoice.status as never} />
                  {invoice.total_usd != null ? <> · <span className="tabular-nums">{formatUSD(invoice.total_usd)}</span></> : null}
                </Fact>
              ))}
            </FactList>
          ) : null}
        </div>
        <div className="app-table-scroll">
          <table className="app-table app-table--compact">
            <caption className="sr-only">Demurrage por contêiner</caption>
            <thead>
              <tr>
                <th scope="col">Contêiner</th>
                <th scope="col">Descarga</th>
                <th scope="col">Devolução</th>
                <th scope="col">Dias</th>
                <th scope="col">Free time</th>
                <th scope="col">Demurrage</th>
              </tr>
            </thead>
            <tbody>
              {lines.length ? lines.map((line) => {
                const { container, calc } = line
                const over = calc?.status === 'overdue'
                return (
                  <tr key={container.id}>
                    <td className="app-bl-code whitespace-nowrap"><CopyValue value={container.container_number} label="número do contêiner" /></td>
                    <td className="whitespace-nowrap tabular-nums">{container.discharge_date ? formatDate(container.discharge_date) : <NoValue label="Sem data de descarga" />}</td>
                    <td className="whitespace-nowrap">
                      {line.soc ? <StatusText tone="muted">Não se aplica</StatusText> : (
                        <div className="flex items-center justify-center gap-2">
                          <Input
                            type="date"
                            aria-label={`Devolução do container ${container.container_number}`}
                            className="max-w-[11rem]"
                            value={line.returnDateVal}
                            onChange={(e) => setReturnDates((prev) => ({ ...prev, [container.id]: e.target.value }))}
                          />
                          {line.returnDateChanged ? (
                            <RowActionButton
                              label={`Salvar devolução do container ${container.container_number}`}
                              icon={Save}
                              loading={savingReturnDate === container.id}
                              onClick={() => void handleSaveReturnDate(container.id)}
                            />
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap tabular-nums">{line.days == null ? <NoValue label="Sem descarga" /> : over ? <StatusText tone="warning">{line.days}</StatusText> : line.days}</td>
                    <td className="whitespace-nowrap tabular-nums" title={line.freeTimeDays != null ? conditionSource : undefined}>{line.freeTimeDays ?? <NoValue label={line.soc ? 'Não se aplica (SOC)' : 'Sem tarifa de Demurrage'} />}</td>
                    <td className="whitespace-nowrap tabular-nums">
                      {line.soc ? <StatusText tone="muted">Não se aplica (SOC)</StatusText>
                        : line.error ? <span className="text-[var(--app-danger-fg)]">{line.error}</span>
                        : over && calc ? (
                          <span title={`1º período: ${calc.days_p1} d × ${formatUSD(calc.rate_p1_usd)} · 2º período: ${calc.days_p2} d × ${formatUSD(calc.rate_p2_usd)}`}>
                            <StatusText tone="warning">{formatUSD(calc.total_usd)}</StatusText> <span className="text-[var(--app-muted)]">{line.returnDateVal ? 'a faturar' : 'em curso'}</span>
                          </span>
                        ) : <NoValue label="Sem cobrança" />}
                    </td>
                  </tr>
                )
              }) : (
                <tr>
                  <td className="text-[var(--app-muted)]" colSpan={6}>Nenhum container vinculado a este B/L.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Block>

      <Block
        title="Condições de Demurrage deste B/L"
        aside={editingConditions ? null : <Button variant="secondary" className="app-btn--sm" onClick={() => setEditingConditions(true)}>Definir condição do B/L</Button>}
      >
        <LeadValue detail={hasOverride ? 'substitui o acordo do Cliente e a tabela neste B/L' : agreement ? 'sem condição própria do B/L' : 'sem acordo do Cliente nem condição própria do B/L'}>{conditionSource}</LeadValue>
        {ratesReady ? (
          <FactList columns={3}>
            {containerTypes.map((type) => {
              const rate = conditionFor(type)
              return (
                <Fact key={type ?? 'sem-tipo'} label={`Free time e diárias${type ? ` (${type})` : ''}`}>
                  {!rate ? <NoValue label="Sem tarifa de Demurrage para este tipo" /> : <>{rate.freeUntil} dias · {formatUSD(rate.p1.usd)} por dia (dias {rate.p1.range[0]} a {rate.p1.range[1]}) · {formatUSD(rate.p2.usd)} por dia a partir do dia {rate.p2.range[0]}</>}
                </Fact>
              )
            })}
          </FactList>
        ) : null}
        {editingConditions ? (
          <div className="grid gap-3 md:grid-cols-[repeat(3,minmax(0,1fr))_auto] md:items-end">
            <Field label="Free time (dias)">
              <Input inputMode="numeric" value={freeTime} onChange={(e) => setFreeTime(e.target.value)} placeholder="Em branco: acordo ou tabela" />
            </Field>
            <Field label="Tarifa P1 (USD/dia)">
              <Input inputMode="decimal" value={p1} onChange={(e) => setP1(e.target.value)} placeholder="Em branco: acordo ou tabela" />
            </Field>
            <Field label="Tarifa P2 (USD/dia)">
              <Input inputMode="decimal" value={p2} onChange={(e) => setP2(e.target.value)} placeholder="Em branco: acordo ou tabela" />
            </Field>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditingConditions(false)}>Voltar</Button>
              <Button type="button" variant="secondary" onClick={() => void handleSaveDemurrageConfig()} loading={savingConfig} loadingLabel="Salvando…">
                <Save size={15} aria-hidden="true" />
                Salvar condições
              </Button>
            </div>
          </div>
        ) : null}
        <BlManualRoe blId={bl.id} roe={bl.demurrage_roe ?? null} manual={Boolean(bl.demurrage_roe_manual)} />
      </Block>
    </>
  )
}

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, Pencil, Plus } from 'lucide-react'
import { Card, EmptyState, PageHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { RowActionButton } from '../components/ui/RowActionButton'
import { Modal } from '../components/ui/Modal'
import { ImportFileBlock, ImportFilePicker, ImportFootnote, ImportGuide, ImportNotice, ImportSection, ImportSteps, ImportTemplateLinks } from '../components/shared/ImportParts'
import { ImportIssuesPanel } from '../components/shared/ImportIssuesPanel'
import { plural } from '../components/shared/importPresentation'
import { SummaryStrip } from '../components/ui/SummaryStrip'
import { NoValue } from '../components/ui/NoValue'
import { SkeletonTable } from '../components/ui/Skeleton'
import { Block, Fact, FactList } from '../components/ui/Block'
import { ScheduleLegend, ScheduleTable, ScheduleWidthPage } from '../components/portal/ShipScheduleWidget'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { useToast } from '../components/ui/Toast'
import { assertUploadSize } from '../lib/fileGuard'
import { useAuth } from '../hooks/useAuth'
import { userFacingErrorMessage } from '../lib/errors'
import { emptyScheduleForm, buildScheduleLanes, clearedPodLabels, scheduleFormFromVoyage, type ScheduleForm } from './chegadasSaidasForm'
import { PORTAL_SCHEDULE_LANES, formatScheduleDate, type PortalScheduleLane } from '../services/portalScheduleLanes'
import { assertNoRepeatedScheduleColumns, parseScheduleRows, scheduleSheetIssues } from '../services/portalScheduleBulkImport'
import { confirmScheduleEffectiveDate, fetchInternalScheduleVoyages, type PortalScheduleVoyage } from '../services/portalScheduleVoyages'
import { scheduleCellState } from '../components/portal/shipScheduleCells'
import { Field, Input } from '../components/ui/Input'
import { applyScheduleSheetPlan, createOrAttachVoyageFromSchedule, isScheduleSheetWrite, planScheduleSheet, type ScheduleSheetPlanRow } from '../services/voyageFromSchedule'
import { afterEscalaAlterada, afterViagemAlterada } from '../services/cacheEffects'
import { scheduleLaneTitle } from '../components/portal/shipScheduleCells'
import { readSheet } from '../services/importCore'
import { hasBlockingIssues, type ImportIssue } from '../services/importValidation'

const POL_LANES = PORTAL_SCHEDULE_LANES.filter((lane) => lane.kind === 'pol')
const POD_LANES = PORTAL_SCHEDULE_LANES.filter((lane) => lane.kind === 'pod')

function VesselForm({ formData, onChange, onSubmit, onCancel, isEditing, saving }: {
  formData: ScheduleForm
  onChange: (data: ScheduleForm) => void
  onSubmit: () => void
  onCancel: () => void
  isEditing: boolean
  saving: boolean
}) {
  function updateDate(label: string, value: string) {
    onChange({ ...formData, dates: { ...formData.dates, [label]: value } })
  }

  function toggleOmitted(label: string, omitted: boolean) {
    const nextDates = { ...formData.dates }
    if (omitted) {
      nextDates[label] = ''
    } else if (!nextDates[label]) {
      nextDates[label] = new Date().toISOString().slice(0, 10)
    }
    onChange({
      ...formData,
      dates: nextDates,
      omitted: { ...(formData.omitted ?? {}), [label]: omitted },
    })
  }

  function renderLane(lane: PortalScheduleLane) {
    const isOmitted = formData.omitted ? (formData.omitted[lane.label] ?? !formData.dates[lane.label]) : !formData.dates[lane.label]
    const value = formData.dates[lane.label] ?? ''
    const kindLabel = lane.kind === 'pol' ? 'ETD' : 'ETA'
    return (
      <div key={lane.label} className="app-schedule-form__lane">
        <label className="app-field__label" htmlFor={`lane-${lane.label}`}>{scheduleLaneTitle(lane)} · {kindLabel}</label>
        <input
          id={`lane-${lane.label}`}
          type="date"
          className="app-input app-input--full"
          value={value}
          disabled={isOmitted}
          onChange={(event) => updateDate(lane.label, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
            }
          }}
        />
        <label className="app-schedule-form__skip">
          <input
            type="checkbox"
            checked={isOmitted}
            onChange={(event) => toggleOmitted(lane.label, event.target.checked)}
          />
          Não escala
        </label>
      </div>
    )
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit() }} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="app-field">
          <label className="app-field__label" htmlFor="vessel_name">Nome do Navio<span className="app-field__required" aria-hidden="true"> *</span></label>
          <input id="vessel_name" className="app-input app-input--full" value={formData.vesselName} disabled={isEditing}
            onChange={(event) => onChange({ ...formData, vesselName: event.target.value })} placeholder="GREEN PECEM" required aria-required="true" />
        </div>
        <div className="app-field">
          <label className="app-field__label" htmlFor="voyage">Viagem (VOY)<span className="app-field__required" aria-hidden="true"> *</span></label>
          <input id="voyage" className="app-input app-input--full" value={formData.voyageNumber} disabled={isEditing}
            onChange={(event) => onChange({ ...formData, voyageNumber: event.target.value })} placeholder="6" required aria-required="true" />
        </div>
        <div className="app-field">
          <label className="app-field__label" htmlFor="imo_number">Número IMO</label>
          <input id="imo_number" className="app-input app-input--full" value={formData.vesselImo} disabled={isEditing}
            onChange={(event) => onChange({ ...formData, vesselImo: event.target.value })} placeholder="9976501"
            aria-describedby={isEditing ? 'vessel-identity-hint' : undefined} />
        </div>
        {isEditing ? (
          <p id="vessel-identity-hint" className="app-field__hint self-end">
            Navio, viagem e IMO se corrigem em Viagens. Aqui só as datas.
          </p>
        ) : null}
      </div>
      <fieldset className="app-schedule-form__group">
        <legend>Saída na origem (ETD)</legend>
        <div className="app-schedule-form__lanes">{POL_LANES.map(renderLane)}</div>
      </fieldset>
      <fieldset className="app-schedule-form__group">
        <legend>Chegada no Brasil (ETA)<span className="app-field__required" aria-hidden="true"> *</span></legend>
        <p className="app-field__hint">Ao menos um porto com data.</p>
        <div className="app-schedule-form__lanes">{POD_LANES.map(renderLane)}</div>
      </fieldset>
      <div className="app-modal__actions">
        <Button type="button" variant="secondary" onClick={onCancel}>Voltar</Button>
        <Button type="submit" loading={saving} loadingLabel="Salvando…">{isEditing ? 'Salvar alterações' : 'Adicionar e publicar'}</Button>
      </div>
    </form>
  )
}

type SchedulePlan = { rows: ScheduleSheetPlanRow[]; issues: ImportIssue[] }

/** O que a gravação faz com a linha, em texto (molde do lote 6a). */
function planSituation(row: ScheduleSheetPlanRow): { text: string; tone?: 'warning' | 'danger' | 'muted' } {
  if (row.error) return { text: 'Erro', tone: 'danger' }
  if (row.createsVoyage) return { text: 'Cria' }
  if (row.publishes) return { text: 'Publica no Portal', tone: 'warning' }
  if (row.changes.length) return { text: 'Atualiza', tone: 'warning' }
  return { text: 'Sem alteração', tone: 'muted' }
}

function planDates(row: ScheduleSheetPlanRow): string {
  return row.changes
    .filter((change) => change.field_name === 'eta' || change.field_name === 'etd')
    .map((change) => `${change.port} ${change.field_name.toUpperCase()}: ${change.old_value ? formatScheduleDate(change.old_value) : '—'} → ${change.new_value ? formatScheduleDate(change.new_value) : '—'}`)
    .join('; ')
}

/**
 * Programação por planilha no molde do lote 6a: Arquivo → Prévia → Resultado.
 * Qualquer linha com erro (data ilegível, Viagem que a prévia recusa) recusa a
 * planilha inteira; a gravação é uma transação só (migration 188).
 */
function ScheduleImportModal({ onClose, onUpdate }: { onClose: () => void; onUpdate: (voyageIds: number[]) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [reading, setReading] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [plan, setPlan] = useState<SchedulePlan | null>(null)
  const [applying, setApplying] = useState(false)
  const [writeError, setWriteError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<{ created: number; updated: number } | null>(null)
  const { showToast } = useToast()
  const { user } = useAuth()

  async function chooseFile(chosen: File) {
    setFile(chosen)
    setPlan(null)
    setReadError(null)
    setWriteError(null)
    setOutcome(null)
    setReading(true)
    try {
      assertUploadSize(chosen)
      const { headers, rows } = await readSheet(await chosen.arrayBuffer())
      assertNoRepeatedScheduleColumns(headers)
      const parsed = parseScheduleRows(rows)
      if (!parsed.length) throw new Error('Nenhuma viagem na planilha. Preencha VESSEL NAME e VOY em cada linha.')
      const planned = await planScheduleSheet(parsed, user?.id ?? null)
      const imoNotes: ImportIssue[] = planned.flatMap((row, index) => row.ignoredImo && !row.error ? [{
        row: parsed[index]?.rowNumber ?? index + 2,
        field: 'row',
        code: 'invalid_group' as const,
        severity: 'warning' as const,
        message: `${row.label}: IMO “${row.ignoredImo}” ignorado (não tem 7 dígitos); a viagem é procurada pelo nome do navio.`,
      }] : [])
      setPlan({ rows: planned, issues: [...scheduleSheetIssues(parsed, planned), ...imoNotes] })
    } catch (error) {
      setReadError(error instanceof Error ? error.message : 'Não foi possível ler a planilha.')
    } finally {
      setReading(false)
    }
  }

  async function apply() {
    if (!plan || hasBlockingIssues(plan.issues)) return
    setApplying(true)
    setWriteError(null)
    try {
      const result = await applyScheduleSheetPlan(plan.rows)
      setOutcome({ created: result.created, updated: result.updated })
      showToast(`${plural(result.created, 'viagem criada', 'viagens criadas')}, ${plural(result.updated, 'atualizada', 'atualizadas')}.`, 'success')
      onUpdate(result.voyage_ids ?? [])
    } catch (error) {
      // Tudo ou nada: a falha não deixa parte da planilha gravada.
      setWriteError(userFacingErrorMessage(error, 'falha ao gravar a programação'))
    } finally {
      setApplying(false)
    }
  }

  const issues = plan?.issues ?? []
  const hasErrors = hasBlockingIssues(issues)
  const writes = plan?.rows.filter(isScheduleSheetWrite).length ?? 0
  const creates = plan?.rows.filter((row) => !row.error && row.createsVoyage).length ?? 0
  const updates = plan?.rows.filter((row) => !row.error && !row.createsVoyage && (row.changes.length || row.publishes)).length ?? 0
  const unchanged = plan?.rows.filter((row) => !row.error && !isScheduleSheetWrite(row)).length ?? 0
  const errorCount = issues.filter((issue) => issue.severity === 'error').length

  let footnote = 'Nada é gravado antes de você conferir a prévia e confirmar.'
  let tone: 'default' | 'warning' | 'success' = 'default'
  if (outcome) { footnote = 'Programação gravada.'; tone = 'success' }
  else if (reading) footnote = 'Lendo o arquivo. Nada foi gravado.'
  else if (hasErrors) { footnote = 'Com erro na planilha, nada é importado. Corrija e escolha o arquivo de novo.'; tone = 'warning' }
  else if (plan && !writes) { footnote = 'Nada a gravar: a planilha não muda nenhuma viagem.'; tone = 'warning' }
  else if (plan) footnote = 'Prévia pronta. Nada foi gravado ainda.'
  const step = outcome ? 'resultado' : plan || readError ? 'previa' : 'arquivo'

  return (
    <Modal open onClose={onClose} title="Importar programação de navios">
      <div className="app-import">
        <ImportSteps current={step} />
        <ImportFileBlock templates={<ImportTemplateLinks baseName="programacao-navios-modelo" />}>
          <ImportGuide
            required={<><strong>VESSEL NAME</strong> e <strong>VOY</strong>.</>}
            optional={<>IMO e uma coluna por porto: ETD na origem (ex.: QINGDAO ETD), ETA no Brasil (ex.: SALVADOR ETA).</>}
            details={(
              <>
                <p>Uma linha por viagem, com as datas por porto em DD/MM/AAAA ou AAAA-MM-DD.</p>
                <p>Célula vazia ou "X" deixa o porto como está: a planilha nunca cancela escala. Data ilegível impede a importação da planilha inteira.</p>
              </>
            )}
          />
          <ImportFilePicker
            accept=".xlsx,.xls,.csv"
            label="Planilha de programação"
            files={file ? [file] : []}
            onFiles={([chosen]) => void chooseFile(chosen)}
            disabled={reading || applying || Boolean(outcome)}
          />
        </ImportFileBlock>

        {readError ? (
          <ImportNotice tone="danger" role="alert" title="Não foi possível ler a planilha">
            <p>{readError}</p>
            <p>Nada foi gravado; corrija o arquivo e escolha-o de novo.</p>
          </ImportNotice>
        ) : null}

        {plan && !outcome ? (
          <ImportSection
            title="Prévia"
            aside={(
              <SummaryStrip
                label="O que a planilha grava"
                items={[
                  { label: creates === 1 ? 'viagem nova' : 'viagens novas', value: creates },
                  { label: updates === 1 ? 'atualizada' : 'atualizadas', value: updates },
                  { label: 'sem alteração', value: unchanged },
                  { label: errorCount === 1 ? 'linha com erro' : 'linhas com erro', value: errorCount, tone: errorCount ? 'danger' : 'default' },
                ]}
              />
            )}
          >
            <div className="app-table-scroll app-import-table">
              <table className="app-table app-table--compact w-full">
                <caption className="sr-only">O que a planilha grava, por viagem</caption>
                <thead>
                  <tr>
                    <th scope="col">Viagem</th>
                    <th scope="col">Situação</th>
                    <th scope="col" className="app-table__text-head">Datas</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((row, index) => {
                    const situation = planSituation(row)
                    const dates = planDates(row)
                    return (
                      <tr key={`${row.label}-${index}`}>
                        <td className="whitespace-nowrap">{row.label}</td>
                        <td className={situation.tone ? `app-import-tone--${situation.tone}` : undefined}>{situation.text}</td>
                        <td className="app-table__text" title={dates || undefined}>{dates || <NoValue label="Nenhuma data muda" />}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </ImportSection>
        ) : null}

        {plan && !outcome ? <ImportIssuesPanel issues={issues} filename="programacao-erros.csv" /> : null}

        {writeError ? (
          <ImportNotice tone="danger" role="alert" title="A importação não foi concluída">
            <p>Nada foi gravado: {writeError}</p>
            <p>A prévia continua aqui; confirme de novo quando o problema for resolvido.</p>
          </ImportNotice>
        ) : null}

        {outcome ? (
          <ImportSection title="Resultado">
            <div role="status" aria-label="Resultado da planilha">
              <FactList columns={2}>
                <Fact label="Viagens criadas">{outcome.created.toLocaleString('pt-BR')}</Fact>
                <Fact label="Viagens atualizadas">{outcome.updated.toLocaleString('pt-BR')}</Fact>
              </FactList>
            </div>
          </ImportSection>
        ) : null}

        <div className="app-modal__actions">
          <ImportFootnote tone={tone}>{footnote}</ImportFootnote>
          {outcome ? (
            <Button onClick={onClose}>Concluir</Button>
          ) : (
            <>
              <Button variant="secondary" disabled={applying} onClick={onClose}>Voltar</Button>
              <Button disabled={!writes || hasErrors || reading} loading={applying} loadingLabel="Importando…" onClick={() => void apply()}>
                {writes ? `Importar ${plural(writes, 'viagem', 'viagens')}` : 'Importar viagens'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

function SpreadsheetUpload({ canWrite, onUpdate }: { canWrite: boolean; onUpdate: (voyageIds: number[]) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold">Atualizar várias viagens por planilha</h2>
      <p className="mt-1 text-sm text-[var(--app-muted)]">
        Uma linha por viagem, com as datas por porto. Célula vazia ou "X" deixa o porto como está: a planilha nunca cancela escala.
      </p>
      {canWrite ? (
        <div className="mt-4">
          <Button type="button" className="app-btn--sm" onClick={() => setOpen(true)}>Importar programação</Button>
        </div>
      ) : null}
      {open ? <ScheduleImportModal onClose={() => setOpen(false)} onUpdate={onUpdate} /> : null}
    </Card>
  )
}

/** Célula vencida a confirmar: navio, porto e a previsão que passou. */
type PendingConfirmation = { vessel: PortalScheduleVoyage; lane: PortalScheduleLane; forecast: string }

/**
 * Confirma a data efetiva de uma célula vencida (ADR 0097, migration 414): a
 * saída do POL só com a data, provisória até o Laden on Board do B/L (que a
 * substitui se for diferente); a chegada na escala com data e hora, como no
 * modal da Escala. O Portal mostra só a data efetiva, sem o mecanismo.
 */
function ConfirmEffectiveDateDialog({ pending, onClose, onSaved }: {
  pending: PendingConfirmation
  onClose: () => void
  onSaved: (voyageId: number) => void
}) {
  const isDeparture = pending.lane.kind === 'pol'
  const [date, setDate] = useState(pending.forecast.slice(0, 10))
  const [time, setTime] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const port = pending.vessel.portCodeByLabel?.[pending.lane.label] ?? pending.lane.label
  const what = isDeparture ? 'saída' : 'chegada'

  async function save() {
    if (!date || (!isDeparture && !time)) {
      setError(isDeparture ? 'Informe a data da saída.' : 'Informe a data e a hora da chegada.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await confirmScheduleEffectiveDate({ voyageId: pending.vessel.voyageId, port, kind: pending.lane.kind, value: isDeparture ? date : `${date}T${time}` })
      onSaved(pending.vessel.voyageId)
    } catch (err) {
      setError(userFacingErrorMessage(err, `Não foi possível confirmar a ${what}.`))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={saving ? () => {} : onClose} title={`Confirmar ${what} · ${pending.vessel.vesselName} / ${pending.vessel.voyage}`} size="sm">
      <div className="grid gap-4">
        <p className="text-sm">
          {scheduleLaneTitle(pending.lane)}: previsão de {formatScheduleDate(pending.forecast)}.{' '}
          {isDeparture
            ? 'A data confirmada passa a ser a saída efetiva; se o B/L trouxer outro Laden on Board, a data dele substitui a confirmada.'
            : 'A data confirmada passa a ser a chegada efetiva (ATA) da escala.'}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={isDeparture ? 'Data da saída' : 'Data da chegada'}>
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
          {isDeparture ? null : (
            <Field label="Hora da chegada">
              <Input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
            </Field>
          )}
        </div>
        {error ? <p className="text-sm text-[var(--app-danger-fg)]" role="alert">{error}</p> : null}
        <div className="app-modal__actions">
          <Button variant="secondary" disabled={saving} onClick={onClose}>Voltar</Button>
          <Button loading={saving} loadingLabel="Confirmando…" onClick={() => void save()}>Confirmar {what}</Button>
        </div>
      </div>
    </Modal>
  )
}

export function ChegadasSaidas() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formData, setFormData] = useState<ScheduleForm>(emptyScheduleForm)
  const [originalForm, setOriginalForm] = useState<ScheduleForm | null>(null)
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { user, profile, isAdmin } = useAuth()
  const canWrite = Boolean(profile || user)
  const [saving, setSaving] = useState(false)
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null)

  const { data: vessels = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['portal-schedule-voyages'],
    queryFn: () => fetchInternalScheduleVoyages(),
  })

  // Viagem criada, publicada ou com datas novas muda as opções de Viagem, a
  // agenda, a ficha e o Line-Up: o dono é afterViagemAlterada. Uma chamada
  // basta, pois ele invalida as famílias inteiras (inclusive a linha do tempo).
  const invalidateSchedules = (voyageIds: number[]) => {
    if (voyageIds.length) void afterViagemAlterada(queryClient, { voyageId: voyageIds[0] })
  }

  const openAdd = () => {
    setEditingId(null)
    setFormData({
      ...emptyScheduleForm,
      dates: { ...emptyScheduleForm.dates },
      omitted: { ...(emptyScheduleForm.omitted ?? {}) },
    })
    setDialogOpen(true)
  }

  const openEdit = (voyage: PortalScheduleVoyage) => {
    setEditingId(voyage.voyageId)
    const form = scheduleFormFromVoyage(voyage)
    setFormData(form)
    setOriginalForm(form)
    setDialogOpen(true)
  }

  const closeDialog = () => {
    setDialogOpen(false)
    setEditingId(null)
    setOriginalForm(null)
    setFormData({
      ...emptyScheduleForm,
      dates: { ...emptyScheduleForm.dates },
      omitted: { ...(emptyScheduleForm.omitted ?? {}) },
    })
  }

  const handleSubmit = async () => {
    const lanes = buildScheduleLanes(formData)
    const pods = lanes.filter((lane) => lane.kind === 'pod' && lane.date)
    if (!formData.vesselName.trim() || !formData.voyageNumber.trim()) {
      showToast('Informe navio e número da viagem.', 'error')
      return
    }
    if (pods.length === 0) {
      showToast('Informe ao menos um porto de descarga com data.', 'error')
      return
    }
    const cleared = editingId && originalForm ? clearedPodLabels(originalForm, formData) : []

    const changes = editingId && originalForm
      ? [
          { field: 'Navio', before: originalForm.vesselName, after: formData.vesselName },
          { field: 'IMO', before: originalForm.vesselImo, after: formData.vesselImo },
          { field: 'Número da viagem', before: originalForm.voyageNumber, after: formData.voyageNumber },
          ...PORTAL_SCHEDULE_LANES.map((lane) => ({
            field: `Data ${lane.label}`,
            before: originalForm.dates[lane.label] || 'Sem data',
            after: formData.dates[lane.label] || 'Sem data',
          })),
        ].filter((c) => c.before !== c.after)
      : []

    if (editingId && changes.length === 0) {
      showToast('Nenhuma alteração para salvar.', 'info')
      return
    }

    const consequence = cleared.length > 0
      ? `A programação atualizada será visível publicamente no Portal em Chegadas e Saídas. Escalas marcadas como “não escala” (${cleared.join(', ')}): a escala sai da Viagem e do Line-Up quando não tem B/L, ATA nem manifesto; com vínculo, só a data sai do Portal.`
      : 'A programação atualizada será visível publicamente no Portal em Chegadas e Saídas.'

    const saveConfirmed = await confirm({
      title: editingId ? 'Salvar programação da viagem' : 'Publicar programação da viagem',
      message: editingId
        ? `Salvar as alterações na programação do navio ${formData.vesselName} (VOY ${formData.voyageNumber})?`
        : `Publicar a viagem do navio ${formData.vesselName} (VOY ${formData.voyageNumber}) no Portal?`,
      confirmLabel: editingId ? 'Salvar alterações' : 'Publicar viagem',
      tone: cleared.length > 0 ? 'danger' : 'primary',
      changes: changes.length > 0 ? changes : undefined,
      affected: !editingId
        ? { summary: `${formData.vesselName} · VOY ${formData.voyageNumber} · ${pods.length} porto(s) com data prevista` }
        : undefined,
      consequence,
      reversibility: 'A viagem e suas datas podem ser editadas novamente na programação.',
    })
    if (!saveConfirmed) return

    setSaving(true)
    try {
      const saved = await createOrAttachVoyageFromSchedule({
        vesselName: formData.vesselName,
        vesselImo: formData.vesselImo,
        voyageNumber: formData.voyageNumber,
        lanes,
      }, user?.id ?? null, { mode: 'form', voyageId: editingId ?? undefined, canRemoveEscala: isAdmin })
      showToast(editingId ? 'Programação atualizada no Portal.' : 'Viagem cadastrada e publicada no Portal.', 'success')
      invalidateSchedules([saved.voyageId])
      closeDialog()
    } catch (error) {
      showToast(userFacingErrorMessage(error, editingId ? 'Falha ao salvar a programação.' : 'Falha ao cadastrar a viagem.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScheduleWidthPage>
      <PageHeader
        title="Chegadas e Saídas"
        description="Datas publicadas no Portal, no bloco Chegadas e saídas do Painel. Cada linha é uma Viagem; datas efetivas vêm de Viagens."
        action={canWrite ? (
          <Button type="button" onClick={openAdd}>
            <Plus size={16} /> Adicionar navio
          </Button>
        ) : null}
      />

      <Modal
        open={dialogOpen && canWrite}
        onClose={closeDialog}
        title={editingId ? `Editar programação · ${formData.vesselName} / ${formData.voyageNumber}` : 'Adicionar navio à programação'}
        size="md"
      >
        <VesselForm formData={formData} onChange={setFormData} onSubmit={handleSubmit} onCancel={closeDialog} isEditing={!!editingId} saving={saving} />
      </Modal>

      <Block
        title="Programação publicada no Portal"
        aside={vessels.length ? `${vessels.length} ${vessels.length === 1 ? 'navio' : 'navios'}` : undefined}
        flush
        className="app-schedule"
      >
        {isLoading ? (
          <SkeletonTable rows={4} cols={8} label="Carregando a programação" />
        ) : isError ? (
          <div className="app-schedule__state" role="alert">
            <p>Não foi possível carregar a programação publicada.</p>
            <Button variant="secondary" className="app-btn--sm" loading={isFetching} loadingLabel="Tentando novamente" onClick={() => void refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : vessels.length === 0 ? (
          <EmptyState
            title="Nenhum navio publicado no Portal"
            description="Adicione um navio ou envie a planilha para publicar a programação."
          />
        ) : (
          <ScheduleTable
            vessels={vessels}
            audience="internal"
            cellAction={canWrite ? (vessel, lane) => {
              const cell = scheduleCellState(vessel, lane)
              if (cell.state !== 'overdue' || !cell.value) return null
              const forecast = cell.value
              return (
                <RowActionButton
                  label={`Confirmar ${lane.kind === 'pol' ? 'saída' : 'chegada'} de ${vessel.vesselName} / ${vessel.voyage} em ${vessel.portCodeByLabel?.[lane.label] ?? lane.label}`}
                  icon={CircleCheck}
                  onClick={() => setPendingConfirmation({ vessel, lane, forecast })}
                />
              )
            } : undefined}
            caption="Programação de chegadas e saídas"
            actions={canWrite ? (vessel) => (
              <RowActionButton
                label={`Editar programação de ${vessel.vesselName} / ${vessel.voyage}`}
                icon={Pencil}
                onClick={() => openEdit(vessel)}
              />
            ) : undefined}
          />
        )}
        {vessels.length > 0 && !isError ? <ScheduleLegend audience="internal" /> : null}
        {pendingConfirmation ? (
          <ConfirmEffectiveDateDialog
            pending={pendingConfirmation}
            onClose={() => setPendingConfirmation(null)}
            onSaved={(voyageId) => {
              setPendingConfirmation(null)
              showToast('Data efetiva confirmada.', 'success')
              void afterEscalaAlterada(queryClient, { voyageId })
              invalidateSchedules([voyageId])
            }}
          />
        ) : null}
      </Block>

      <div className="mt-6">
        <SpreadsheetUpload canWrite={canWrite} onUpdate={invalidateSchedules} />
      </div>
    </ScheduleWidthPage>
  )
}

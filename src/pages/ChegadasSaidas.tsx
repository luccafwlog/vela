import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Pencil, Plus, Upload } from 'lucide-react'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { ImportFilePicker } from '../components/shared/ImportParts'
import { SkeletonTable } from '../components/ui/Skeleton'
import { ScheduleDate, ScheduleLegend, VesselLink } from '../components/portal/ShipScheduleWidget'
import { scheduleLaneTitle } from '../components/portal/shipScheduleCells'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { useToast } from '../components/ui/Toast'
import { assertUploadSize } from '../lib/fileGuard'
import { useAuth } from '../hooks/useAuth'
import { userFacingErrorMessage } from '../lib/errors'
import { emptyScheduleForm, buildScheduleLanes, clearedPodLabels, scheduleFormFromVoyage, type ScheduleForm } from './chegadasSaidasForm'
import { PORTAL_SCHEDULE_LANES, type PortalScheduleLane } from '../services/portalScheduleLanes'
import { parseScheduleRows, scheduleTemplateColumns } from '../services/portalScheduleBulkImport'
import { fetchPortalScheduleVoyages, type PortalScheduleVoyage } from '../services/portalScheduleVoyages'
import { createOrAttachVoyageFromSchedule } from '../services/voyageFromSchedule'
import { readSheet } from '../services/importCore'
import { inspectImportFile, type ImportFileInspection } from '../services/importText'

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
        <legend>Chegada no Brasil (ETA)<span className="app-field__required" aria-hidden="true"> *</span></legend>
        <p className="app-field__hint">Ao menos um porto com data.</p>
        <div className="app-schedule-form__lanes">{POD_LANES.map(renderLane)}</div>
      </fieldset>
      <fieldset className="app-schedule-form__group">
        <legend>Saída na origem (ETD)</legend>
        <div className="app-schedule-form__lanes">{POL_LANES.map(renderLane)}</div>
      </fieldset>
      <div className="app-modal__actions">
        <Button type="button" variant="secondary" onClick={onCancel}>Voltar</Button>
        <Button type="submit" loading={saving} loadingLabel="Salvando…">{isEditing ? 'Salvar alterações' : 'Adicionar e publicar'}</Button>
      </div>
    </form>
  )
}

function SpreadsheetUpload({ canWrite, onUpdate }: { canWrite: boolean; onUpdate: () => void }) {
  const [uploading, setUploading] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [result, setResult] = useState<{ inspection: ImportFileInspection; updated: string[]; errors: string[]; warnings: string[] } | null>(null)
  const [chosenFiles, setChosenFiles] = useState<File[]>([])
  const { showToast } = useToast()
  const { user } = useAuth()

  const downloadTemplate = async () => {
    const XLSX = await import('@e965/xlsx')
    const columns = scheduleTemplateColumns()
    const example = Object.fromEntries(columns.map((column) => [column, '']))
    example['VESSEL NAME'] = 'EXEMPLO NAVIO'
    example.VOY = '1'
    example.IMO = '9976501'
    example['QINGDAO ETD'] = '2026-01-04'
    example['SALVADOR ETA'] = '2026-01-22'

    const ws = XLSX.utils.json_to_sheet([example], { header: columns })
    ws['!cols'] = columns.map(() => ({ wch: 16 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Navios')
    XLSX.writeFile(wb, 'modelo_navios.xlsx')
    showToast('Planilha modelo baixada!', 'info')
  }

  const handleSubmitSheet = async () => {
    const file = chosenFiles[0]
    if (!file) return
    setUploading(true)
    setResult(null)
    setReadError(null)
    try {
      assertUploadSize(file)
      const buf = await file.arrayBuffer()
      const inspection = inspectImportFile(buf)
      const { rows } = await readSheet(buf)
      const parsed = parseScheduleRows(rows)
      const next = { inspection, updated: [] as string[], errors: [] as string[], warnings: [] as string[] }

      for (const row of parsed) {
        if (row.invalidCells.length > 0) {
          next.warnings.push(`${row.vesselName} / ${row.voyageNumber}: datas ilegíveis em ${row.invalidCells.join(', ')}`)
        }
        try {
          await createOrAttachVoyageFromSchedule(row, user?.id ?? null, { mode: 'bulk' })
          next.updated.push(`${row.vesselName} / ${row.voyageNumber}`)
        } catch (error) {
          next.errors.push(`${row.vesselName}: ${error instanceof Error ? error.message : 'falha inesperada'}`)
        }
      }

      setResult(next)
      if (next.updated.length > 0) {
        showToast(`${next.updated.length} viagem(ns) atualizada(s)!`, 'success')
        onUpdate()
      } else {
        showToast('Nenhuma viagem foi atualizada', 'error')
      }
    } catch (error) {
      // A falha de leitura fica no conteúdo; o toast não é a única explicação.
      const message = error instanceof Error ? error.message : 'Erro ao processar planilha'
      setReadError(`Não foi possível ler ${file.name}: ${message}. Nada foi gravado; corrija o arquivo e envie de novo.`)
      showToast(message, 'error')
    } finally {
      setUploading(false)
      setChosenFiles([])
    }
  }

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold">Atualizar várias viagens por planilha</h2>
      <p className="mt-1 text-sm text-[var(--app-muted)]">
        Uma linha por viagem, com as datas por porto (ISO ou DD/MM/AAAA). Célula vazia ou "X" deixa o porto como está: a planilha nunca cancela escala.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="button" variant="secondary" className="app-btn--sm" onClick={downloadTemplate}>
          <Download size={14} /> Baixar planilha modelo
        </Button>
      </div>
      {canWrite ? (
        // Área de arquivo comum das importações (etapa 04): escolher, conferir
        // o nome e só então enviar.
        <div className="mt-4 grid gap-3">
          <ImportFilePicker
            accept=".xlsx,.xls,.csv"
            label="Planilha de programação"
            files={chosenFiles}
            onFiles={(files) => { setChosenFiles(files); setReadError(null) }}
            disabled={uploading}
          />
          <div>
            <Button type="button" className="app-btn--sm" onClick={() => void handleSubmitSheet()} disabled={!chosenFiles.length} loading={uploading} loadingLabel="Processando…">
              <Upload size={14} /> Enviar planilha
            </Button>
          </div>
        </div>
      ) : null}
      {readError ? <div className="mt-4"><InlineError message={readError} /></div> : null}
      {result ? (
        <div className="mt-4 grid gap-3 border-t border-[var(--app-border)] pt-4 text-sm" role="status" aria-label="Resultado da planilha">
          <p className="m-0 font-medium">
            {result.updated.length} atualizada(s)
            {result.errors.length ? ` · ${result.errors.length} com erro` : ''}
            {result.warnings.length ? ` · ${result.warnings.length} com datas ilegíveis (ignoradas)` : ''}
          </p>
          {result.errors.length ? (
            <div>
              <div className="font-medium text-[var(--app-danger-fg)]">Não atualizadas</div>
              <ul className="mt-1 list-disc pl-5">
                {result.errors.map((message) => <li key={message}>{message}</li>)}
              </ul>
            </div>
          ) : null}
          {result.warnings.length ? (
            <div>
              <div className="font-medium text-[var(--app-warning-fg)]">Datas ignoradas</div>
              <ul className="mt-1 list-disc pl-5">
                {result.warnings.map((message) => <li key={message}>{message}</li>)}
              </ul>
            </div>
          ) : null}
          <details className="text-xs text-[var(--app-muted)]">
            <summary className="cursor-pointer">Diagnóstico do arquivo</summary>
            <div className="mt-2">
              Formato detectado: <strong>{result.inspection.format.toUpperCase()}</strong> · Encoding: <strong>{result.inspection.encoding ?? 'binário'}</strong> · BOM: <strong>{result.inspection.hadBom ? 'presente' : 'ausente'}</strong> · {result.inspection.byteLength.toLocaleString('pt-BR')} bytes
            </div>
            {result.inspection.preview ? <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap rounded border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-2 font-mono text-xs">{result.inspection.preview}</pre> : null}
          </details>
        </div>
      ) : null}
    </Card>
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

  const { data: vessels = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['portal-schedule-voyages'],
    queryFn: () => fetchPortalScheduleVoyages(),
  })

  const invalidateSchedules = () => {
    queryClient.invalidateQueries({ queryKey: ['portal-schedule-voyages'] })
    queryClient.invalidateQueries({ queryKey: ['voyages'] })
    queryClient.invalidateQueries({ queryKey: ['voyage-escala-schedules'] })
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
      await createOrAttachVoyageFromSchedule({
        vesselName: formData.vesselName,
        vesselImo: formData.vesselImo,
        voyageNumber: formData.voyageNumber,
        lanes,
      }, user?.id ?? null, { mode: 'form', voyageId: editingId ?? undefined, canRemoveEscala: isAdmin })
      showToast(editingId ? 'Programação atualizada no Portal.' : 'Viagem cadastrada e publicada no Portal.', 'success')
      invalidateSchedules()
      closeDialog()
    } catch (error) {
      showToast(userFacingErrorMessage(error, editingId ? 'Falha ao salvar a programação.' : 'Falha ao cadastrar a viagem.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Chegadas e Saídas"
        description="Programação de navios publicada no Portal. Cada linha é uma Viagem; datas efetivas vêm de Viagens."
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

      <section className="app-schedule" aria-label="Programação publicada">
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
          <div className="app-table-scroll">
            <table className="app-table app-table--dense">
              <caption className="sr-only">Programação de chegadas e saídas</caption>
              <thead>
                <tr>
                  <th scope="col" rowSpan={2} className="text-left">Navio</th>
                  <th scope="col" rowSpan={2} className="text-center">Viagem</th>
                  <th scope="colgroup" colSpan={POL_LANES.length} className="text-center app-schedule__group">Saída na origem (ETD)</th>
                  <th scope="colgroup" colSpan={POD_LANES.length} className="text-center app-schedule__group">Chegada no Brasil (ETA)</th>
                  {canWrite ? <th scope="col" rowSpan={2}><span className="sr-only">Ações</span></th> : null}
                </tr>
                <tr>
                  {PORTAL_SCHEDULE_LANES.map((lane) => (
                    <th scope="col" key={lane.label} className="text-center">{scheduleLaneTitle(lane)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vessels.map((vessel) => (
                  <tr key={vessel.voyageId}>
                    <th scope="row" className="text-left font-semibold"><VesselLink voyage={vessel} /></th>
                    <td className="text-center">{vessel.voyage}</td>
                    {PORTAL_SCHEDULE_LANES.map((lane) => (
                      <td key={lane.label} className="text-center"><ScheduleDate voyage={vessel} lane={lane} /></td>
                    ))}
                    {canWrite ? (
                      <td className="text-center">
                        <Button
                          type="button"
                          variant="ghost"
                          className="app-table__icon-button"
                          aria-label={`Editar programação de ${vessel.vesselName} / ${vessel.voyage}`}
                          title="Editar"
                          onClick={() => openEdit(vessel)}
                        >
                          <Pencil size={15} />
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {vessels.length > 0 && !isError ? <ScheduleLegend /> : null}
      </section>

      <div className="mt-6">
        <SpreadsheetUpload canWrite={canWrite} onUpdate={invalidateSchedules} />
      </div>
    </>
  )
}

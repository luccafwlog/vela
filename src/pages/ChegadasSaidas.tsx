import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileSpreadsheet, Pencil, Plus, Upload } from 'lucide-react'
import { Card, PageHeader } from '../components/ui/Card'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { useToast } from '../components/ui/Toast'
import { assertUploadSize } from '../lib/fileGuard'
import { useAuth } from '../hooks/useAuth'
import { userFacingErrorMessage } from '../lib/errors'
import { emptyScheduleForm, buildScheduleLanes, clearedPodLabels, scheduleFormFromVoyage, type ScheduleForm } from './chegadasSaidasForm'
import { PORTAL_SCHEDULE_LANES, formatScheduleDate } from '../services/portalScheduleLanes'
import { parseScheduleRows, scheduleTemplateColumns } from '../services/portalScheduleBulkImport'
import { fetchPortalScheduleVoyages, type PortalScheduleVoyage } from '../services/portalScheduleVoyages'
import { createOrAttachVoyageFromSchedule } from '../services/voyageFromSchedule'
import { readSheet } from '../services/importCore'
import { inspectImportFile, type ImportFileInspection } from '../services/importText'

function DateTd({ value, isActual = false, omitted = false }: { value: string; isActual?: boolean; omitted?: boolean }) {
  const isX = value === 'X'
  const isOmitted = omitted
  return (
    <td
      title={isOmitted ? 'Escala omitida pelo armador' : undefined}
      className={`px-3 py-2.5 text-center text-sm border-r border-[var(--app-border)] ${isOmitted || isX ? 'text-[var(--app-muted-soft)]' : isActual ? 'font-semibold' : ''}`}
      style={isActual ? { color: 'var(--app-blue)' } : undefined}
    >
      {isOmitted ? 'OMIT' : isX ? 'X' : formatScheduleDate(value)}
    </td>
  )
}

function VesselForm({ formData, onChange, onSubmit, onCancel, isEditing }: {
  formData: ScheduleForm
  onChange: (data: ScheduleForm) => void
  onSubmit: () => void
  onCancel: () => void
  isEditing: boolean
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

  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit() }} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="app-field">
          <label className="app-field__label" htmlFor="vessel_name">Nome do Navio</label>
          <input id="vessel_name" className="app-input app-input--full" value={formData.vesselName} disabled={isEditing}
            onChange={(event) => onChange({ ...formData, vesselName: event.target.value })} placeholder="GREEN PECEM" required />
        </div>
        <div className="app-field">
          <label className="app-field__label" htmlFor="voyage">Viagem (VOY)</label>
          <input id="voyage" className="app-input app-input--full" value={formData.voyageNumber} disabled={isEditing}
            onChange={(event) => onChange({ ...formData, voyageNumber: event.target.value })} placeholder="6" required />
        </div>
      </div>
      <div className="app-field">
        <label className="app-field__label" htmlFor="imo_number">Número IMO</label>
        <input id="imo_number" className="app-input app-input--full" value={formData.vesselImo} disabled={isEditing}
          onChange={(event) => onChange({ ...formData, vesselImo: event.target.value })} placeholder="9976501" />
        {isEditing ? (
          <div className="mt-1 text-xs text-[var(--app-muted)]">
            Navio, VOY e IMO se editam na tela Viagens. Aqui você ajusta apenas as datas da programação.
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PORTAL_SCHEDULE_LANES.map((lane) => {
          const isOmitted = formData.omitted ? (formData.omitted[lane.label] ?? !formData.dates[lane.label]) : !formData.dates[lane.label]
          const value = formData.dates[lane.label] ?? ''
          return (
            <div key={lane.label} className="app-field rounded-lg border border-[var(--app-border)] p-3">
              <label className="app-field__label" htmlFor={`lane-${lane.label}`}>{lane.label} {lane.kind === 'pol' ? 'ETD' : 'ETA'}</label>
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
              <label className="mt-2 flex items-center gap-2 text-xs text-[var(--app-muted)]">
                <input
                  type="checkbox"
                  checked={isOmitted}
                  onChange={(event) => toggleOmitted(lane.label, event.target.checked)}
                />
                Não escala
              </label>
            </div>
          )
        })}
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <button type="button" className="app-btn app-btn--secondary" onClick={onCancel}>Voltar</button>
        <button type="submit" className="app-btn app-btn--primary">{isEditing ? 'Salvar Alterações' : 'Adicionar'}</button>
      </div>
    </form>
  )
}

function SpreadsheetUpload({ canWrite, onUpdate }: { canWrite: boolean; onUpdate: () => void }) {
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<{ inspection: ImportFileInspection; updated: string[]; errors: string[]; warnings: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
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

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true)
    setResult(null)
    try {
      assertUploadSize(file)
      const buf = await file.arrayBuffer()
      const inspection = inspectImportFile(buf)
      const { rows } = await readSheet(buf, { dates: 'date' })
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
      showToast(error instanceof Error ? error.message : 'Erro ao processar planilha', 'error')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-3 mb-4">
        <FileSpreadsheet className="w-5 h-5 text-[var(--app-blue)]" />
        <h2 className="text-base font-semibold">Atualização em Lote via Planilha</h2>
      </div>
      <p className="text-sm text-[var(--app-muted)] mb-4">
        Baixe a planilha modelo, preencha as datas e faça o upload para atualizar múltiplas viagens.
      </p>
      <div className="flex flex-wrap gap-3 mb-4">
        <button type="button" className="app-btn app-btn--secondary app-btn--sm" onClick={downloadTemplate}>
          <Download size={14} /> Baixar Planilha Modelo
        </button>
        {canWrite ? (
          <>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="hidden" id="sheet-upload" />
            <button type="button" className="app-btn app-btn--primary app-btn--sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Upload size={14} /> {uploading ? 'Processando...' : 'Fazer Upload'}
            </button>
          </>
        ) : null}
      </div>
      {result && (
        <div className="space-y-2 mt-4 pt-4 border-t border-[var(--app-border)] text-sm">
          <div className="app-panel app-panel--padded text-xs" role="status" aria-label="Diagnóstico do arquivo">
            Formato detectado: <strong>{result.inspection.format.toUpperCase()}</strong> · Encoding: <strong>{result.inspection.encoding ?? 'binário'}</strong> · BOM: <strong>{result.inspection.hadBom ? 'presente' : 'ausente'}</strong> · {result.inspection.byteLength.toLocaleString('pt-BR')} bytes
            {result.inspection.preview ? <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap rounded border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-2 font-mono text-[11px]">{result.inspection.preview}</pre> : null}
          </div>
          {result.updated.length > 0 && <div className="text-[var(--app-green)] font-medium">{result.updated.length} atualizada(s)</div>}
          {result.warnings.length > 0 && <div className="text-[var(--app-gold)]">{result.warnings.length} com datas ilegíveis (ignoradas)</div>}
          {result.errors.length > 0 && <div className="text-[var(--app-red)]">{result.errors.length} erro(s)</div>}
        </div>
      )}
      <div className="mt-4 text-xs text-[var(--app-muted)] bg-[var(--app-surface-muted)] p-3 rounded-lg">
        <strong>Dica:</strong> use datas ISO ou DD/MM/AAAA. Célula vazia ou "X" significa "não escala".
      </div>
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
  const tableColumnCount = PORTAL_SCHEDULE_LANES.length + (canWrite ? 3 : 2)

  const { data: vessels = [], isLoading } = useQuery({
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
    if (cleared.length > 0) {
      const confirmed = await confirm({
        title: 'Marcar como “não escala”',
        message: `${cleared.join(', ')}: a escala sai da Viagem e do Line-Up quando não tem B/L, ATA nem manifesto. Com vínculo, só a data sai do Portal.`,
        confirmLabel: 'Confirmar',
        tone: 'danger',
      })
      if (!confirmed) return
    }
    try {
      await createOrAttachVoyageFromSchedule({
        vesselName: formData.vesselName,
        vesselImo: formData.vesselImo,
        voyageNumber: formData.voyageNumber,
        lanes,
      }, user?.id ?? null, { mode: 'form', voyageId: editingId ?? undefined, canRemoveEscala: isAdmin })
      showToast('Viagem cadastrada e publicada no Portal.', 'success')
      invalidateSchedules()
      closeDialog()
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Falha ao cadastrar a viagem.'), 'error')
    }
  }

  return (
    <>
      <PageHeader
        title="Chegadas e Saídas"
        description="Cadastre e publique viagens no quadro de Programação de Navios do Portal."
        action={canWrite ? (
          <button type="button" className="app-btn app-btn--primary app-btn--sm" onClick={openAdd}>
            <Plus size={14} /> Adicionar Navio
          </button>
        ) : null}
      />

      {dialogOpen && canWrite && (
        <div className="app-modal-backdrop" onClick={closeDialog}>
          <div className="app-modal" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 760 }}>
            <div className="app-modal__header">
              <h2 className="app-modal__title">{editingId ? 'Editar Viagem Publicada' : 'Adicionar Navio'}</h2>
              <button type="button" className="app-btn app-btn--ghost app-modal__close" onClick={closeDialog}>&times;</button>
            </div>
            <div className="app-modal__body">
              <VesselForm formData={formData} onChange={setFormData} onSubmit={handleSubmit} onCancel={closeDialog} isEditing={!!editingId} />
            </div>
          </div>
        </div>
      )}

      <div className="app-soft-panel" style={{ padding: 0 }}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[var(--app-navy)] text-white">
                <th scope="col" className="px-3 py-3 text-left text-xs font-bold uppercase tracking-wider border-r border-white/10">Navio</th>
                <th scope="col" className="px-3 py-3 text-center text-xs font-bold uppercase tracking-wider border-r border-white/10 w-14">VOY</th>
                {PORTAL_SCHEDULE_LANES.map((lane) => (
                  <th scope="col" key={lane.label} className="px-3 py-3 text-center text-xs font-bold uppercase tracking-wider border-r border-white/10">
                    {lane.label}
                  </th>
                ))}
                {canWrite ? <th scope="col" className="px-3 py-3 text-center text-xs font-bold uppercase tracking-wider">Ações</th> : null}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={tableColumnCount} className="text-center py-8 text-sm text-[var(--app-muted)]">Carregando...</td></tr>
              ) : vessels.length === 0 ? (
                <tr><td colSpan={tableColumnCount} className="text-center py-8 text-sm text-[var(--app-muted)]">Nenhum navio publicado no Portal.</td></tr>
              ) : vessels.map((vessel, index) => (
                <tr key={vessel.voyageId} className={`${index % 2 === 0 ? '' : 'bg-[var(--app-surface-muted)]'} hover:bg-[var(--app-blue-soft)] transition-colors border-b border-[var(--app-border)] last:border-b-0`}>
                  <td className="px-3 py-2.5 border-r border-[var(--app-border)] text-sm font-semibold text-[var(--app-blue)]">
                    {vessel.imoNumber ? (
                      <a href={`https://www.marinetraffic.com/en/ais/details/ships/imo:${vessel.imoNumber}`}
                        target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80">{vessel.vesselName}</a>
                    ) : vessel.vesselName}
                  </td>
                  <td className="px-3 py-2.5 text-center border-r border-[var(--app-border)] text-sm">{vessel.voyage}</td>
                  {PORTAL_SCHEDULE_LANES.map((lane) => (
                    <DateTd key={lane.label} value={vessel.datesByLabel[lane.label] ?? 'X'} omitted={Boolean(vessel.omittedByLabel?.[lane.label])} isActual={Boolean(vessel.actualDatesByLabel?.[lane.label])} />
                  ))}
                  {canWrite ? (
                    <td className="px-2 py-2 text-center">
                      <div className="flex justify-center gap-1">
                        <button type="button" className="app-btn app-btn--ghost app-btn--sm" style={{ minHeight: 32, minWidth: 32, padding: 0 }}
                          onClick={() => openEdit(vessel)} title="Editar"><Pencil size={14} /></button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-2 text-xs text-[var(--app-muted)]">
        <span className="text-[var(--app-blue)] font-semibold">Datas em azul</span> = data efetiva confirmada. Datas em preto = data prevista.
      </div>

      <div className="mt-6">
        <SpreadsheetUpload canWrite={canWrite} onUpdate={invalidateSchedules} />
      </div>
    </>
  )
}

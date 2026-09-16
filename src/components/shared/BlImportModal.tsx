import { useMemo, useState, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useCancellableFileRead } from '../../hooks/useCancellableFileRead'
import { parseBLFile } from '../../services/blParser'
import {
  confirmBlFreightImport,
  previewBlFreightImport,
  type BlCustomerChange,
  type BlFreightImportPreview,
  type BlFreightImportRow,
} from '../../services/blFreightImport'
import { applyLadenOnBoardAtd } from '../../services/ladenOnBoardAtd'
import { afterManifestoImportado } from '../../services/cacheEffects'
import { Badge, type BadgeTone } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { PreviewBox } from '../ui/PreviewBox'
import { useToast } from '../ui/Toast'
import { VoyageCombobox } from './VoyageCombobox'
import { ImportReadProgress } from './ImportReadProgress'

export function BlImportModal({
  open,
  onClose,
  voyageId = null,
  voyageLabel,
  onlyBlId = null,
}: {
  open: boolean
  onClose: () => void
  voyageId?: number | null
  voyageLabel?: string
  onlyBlId?: string | null
}) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const [files, setFiles] = useState<File[]>([])
  const { parsing, progress, readFiles, cancel: cancelReading } = useCancellableFileRead<Awaited<ReturnType<typeof parseBLFile>>>(parseBLFile)
  const [preview, setPreview] = useState<BlFreightImportPreview | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [overrideBilling, setOverrideBilling] = useState(false)
  const [confirmCustomerChange, setConfirmCustomerChange] = useState(false)
  const [selectedVoyageId, setSelectedVoyageId] = useState<number | null>(voyageId)

  const importableCount = useMemo(
    () => preview?.rows.filter((row) => Boolean(row.payload)).length ?? 0,
    [preview],
  )
  const billingOverrideCount = preview?.summary.billingOverrideCount ?? 0
  const customerChangeCount = preview?.summary.customerChangeCount ?? 0
  const customerChangeRows = useMemo(
    () => preview?.rows.filter((row) => row.customerChange) ?? [],
    [preview],
  )

  function resetAndClose() {
    setFiles([])
    setPreview(null)
    cancelReading()
    setSubmitting(false)
    setOverrideBilling(false)
    setConfirmCustomerChange(false)
    setSelectedVoyageId(voyageId ?? null)
    onClose()
  }

  function handleVoyageSelect(nextVoyageId: number | null) {
    cancelReading()
    setSelectedVoyageId(nextVoyageId)
    setPreview(null)
    setOverrideBilling(false)
    setConfirmCustomerChange(false)
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? [])
    setFiles(selectedFiles)
    setPreview(null)
    setOverrideBilling(false)
    setConfirmCustomerChange(false)
    if (!selectedFiles.length) return
    if (!selectedVoyageId) {
      showToast('Selecione a viagem antes de carregar o preview do B/L.', 'error')
      return
    }

    try {
      const documents = (await readFiles(selectedFiles, (error, file) => {
        const message = error instanceof Error ? error.message : 'Falha ao ler arquivo.'
        showToast(`${file.name}: ${message}`, 'error')
      })) ?? []

      if (!documents.length) return

      const nextPreview = await previewBlFreightImport({
        documents,
        voyageId: selectedVoyageId,
        onlyBlId,
      })
      setPreview(nextPreview)

      if (nextPreview.summary.blockedCount > 0 && nextPreview.rows.every((row) => !row.payload)) {
        showToast(`Importacao bloqueada: ${nextPreview.summary.blockedCount} B/L(s). Nada sera gravado.`, 'error')
        return
      }

      showToast(
        `Preview de B/L carregado: ${nextPreview.summary.total} B/L(s), ${nextPreview.summary.blockedCount} bloqueado(s).`,
        nextPreview.summary.blockedCount ? 'info' : 'success',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao preparar preview de B/L.'
      showToast(message, 'error')
    }
  }

  async function handleConfirm() {
    if (!preview || importableCount === 0) return
    if (!selectedVoyageId) {
      showToast('Selecione a viagem antes de confirmar a importação do B/L.', 'error')
      return
    }

    setSubmitting(true)
    try {
      const { refusedCustomerRelinks } = await confirmBlFreightImport(
        preview,
        user?.id ?? '',
        overrideBilling,
        files[0]?.name,
        confirmCustomerChange,
      )
      try {
        await applyLadenOnBoardAtd({ rows: preview.rows, changedBy: user?.id ?? null })
      } catch {
        showToast('B/Ls importados; ATD do POL não pôde ser atualizado — edite manualmente.', 'info')
      }
      await afterManifestoImportado(queryClient, { voyageId: selectedVoyageId })
      if (refusedCustomerRelinks.length) {
        // Importou, mas o B/L continua com o cliente antigo: dizer "concluida" aqui
        // esconderia justamente o que o operador pediu para acontecer.
        showToast(
          `Importacao concluida, mas a troca de cliente foi recusada em ${refusedCustomerRelinks.length} B/L(s): ${refusedCustomerRelinks
            .map((relink) => `${relink.blNumber} (${relink.blockers.join(' ')})`)
            .join(' | ')}`,
          'error',
        )
      } else {
        showToast(
          `Importacao de B/L concluida: ${importableCount} B/L(s), ${preview.summary.blockedCount} bloqueado(s).`,
          'success',
        )
      }
      resetAndClose()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao confirmar importacao de B/L.'
      showToast(message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={resetAndClose} title="Importar B/L">
      <div className="grid gap-5">
        {onlyBlId ? (
          <div className="app-panel app-panel--padded text-sm">
            B/L: <span className="font-semibold text-[var(--app-text-strong)]">{onlyBlId}</span>
          </div>
        ) : null}

        <VoyageCombobox
          key={`${open ? 'open' : 'closed'}-${voyageId ?? 'none'}-${voyageLabel ?? ''}`}
          required
          initialValue={voyageLabel}
          selectedVoyageId={selectedVoyageId}
          onSelect={handleVoyageSelect}
        />

        <Field label="Arquivo .xlsx / .xls">
          <Input accept=".xlsx,.xls" multiple type="file" onChange={handleFile} />
        </Field>

        {files.length ? (
          <div className="app-panel__meta">
            {files.length} arquivo(s) selecionado(s): {files.map((file) => file.name).join(', ')}
          </div>
        ) : null}
        {parsing ? <ImportReadProgress progress={progress} /> : null}

        {preview ? <BlImportPreview preview={preview} /> : null}

        {customerChangeRows.length ? (
          <div className="app-panel app-panel--padded grid gap-3 text-sm">
            <div className="font-semibold text-amber-200">
              Troca de consignatario em {customerChangeRows.length} B/L(s)
            </div>
            {customerChangeRows.map((row) => (
              <CustomerChangeCard key={row.blNumber} blNumber={row.blNumber} change={row.customerChange!} />
            ))}
            {customerChangeCount > 0 ? (
              <label className="flex items-start gap-2 text-amber-200">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={confirmCustomerChange}
                  onChange={(event) => setConfirmCustomerChange(event.target.checked)}
                />
                <span>
                  Confirmo a troca de cliente em {customerChangeCount} B/L(s): o B/L passa a pertencer ao novo
                  consignatario e a fatura aberta acompanha, com o mesmo valor. Sem marcar, os demais campos sao
                  aplicados e o vinculo de cliente fica como esta.
                </span>
              </label>
            ) : null}
          </div>
        ) : null}

        {billingOverrideCount > 0 ? (
          <label className="app-panel app-panel--padded flex items-start gap-2 text-sm text-amber-200">
            <input
              type="checkbox"
              className="mt-1"
              checked={overrideBilling}
              onChange={(event) => setOverrideBilling(event.target.checked)}
            />
            <span>
              Sobrescrever faturamento em {billingOverrideCount} B/L(s) com impacto (quantidade de containers,
              container compartilhado, IMO/OOG, peso de carga solta ou CNPJ faturado). Sem marcar, os demais campos
              sao aplicados e as mudancas com impacto em faturamento sao ignoradas.
            </span>
          </label>
        ) : null}

        <div className="app-modal__actions">
          <Button variant="secondary" disabled={submitting} onClick={parsing ? cancelReading : resetAndClose}>
            {parsing ? 'Cancelar leitura' : 'Cancelar'}
          </Button>
          <Button disabled={!selectedVoyageId || importableCount === 0} loading={submitting || parsing} onClick={() => void handleConfirm()}>
            <Upload size={16} />
            Confirmar importacao
          </Button>
        </div>
        {!selectedVoyageId ? (
          <div className="text-sm text-amber-700">Selecione uma viagem para habilitar a importacao.</div>
        ) : null}
      </div>
    </Modal>
  )
}

function BlImportPreview({ preview }: { preview: BlFreightImportPreview }) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-4">
        <PreviewBox label="Novos" value={preview.summary.newCount} />
        <PreviewBox label="Atualizados" value={preview.summary.updatedCount} />
        <PreviewBox label="Sem mudanca" value={preview.summary.unchangedCount} />
        <PreviewBox label="Bloqueados" value={preview.summary.blockedCount} />
      </div>

      {/* Plain app-table-scroll (horizontal only): the modal body is already the
          scroll container (.app-modal__body, overflow-y: auto) with a sticky
          actions bar pinned to its bottom. Giving the table its own bounded
          vertical scroll region (app-table-scroll--sticky) nests a second
          independent scrollbar inside that one, and its sticky header/footer
          fight the outer sticky actions bar, breaking scrolling and clipping
          rows behind the buttons. */}
      <div className="app-table-scroll rounded-xl border border-[var(--app-border)]">
        <table className="app-table app-table--compact min-w-[960px] text-left text-sm">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2">B/L</th>
              <th scope="col" className="px-3 py-2">Status</th>
              <th scope="col" className="px-3 py-2">Viagem</th>
              <th scope="col" className="px-3 py-2">POL / POD</th>
              <th scope="col" className="px-3 py-2">Laden on Board</th>
              <th scope="col" className="px-3 py-2">Diferencas</th>
              <th scope="col" className="px-3 py-2">Bloqueios / Faturamento</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => (
              <tr key={row.blNumber}>
                <td className="px-3 py-2 font-semibold text-[var(--app-text-strong)]">{row.blNumber}</td>
                <td className="px-3 py-2">
                  <StatusPill status={row.status} />
                </td>
                <td className="px-3 py-2">{row.voyageNumber ?? '-'}</td>
                <td className="px-3 py-2">{row.pol || row.pod ? `${row.pol ?? '-'} / ${row.pod ?? '-'}` : '-'}</td>
                <td className="px-3 py-2">{row.ladenOnBoard ?? '-'}</td>
                <td className="px-3 py-2">
                  <DiffList row={row} />
                </td>
                <td className="px-3 py-2">
                  {row.blockedReasons.length || row.billingImpacts.length ? (
                    <ul className="grid gap-1 text-xs">
                      {row.blockedReasons.map((reason) => (
                        <li key={reason} className="text-red-300">{reason}</li>
                      ))}
                      {row.billingImpacts.map((reason) => (
                        <li key={reason} className="text-amber-300">Faturamento: {reason}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-xs text-[var(--app-muted-soft)]">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * O aviso que o operador le antes de aceitar: de quem para quem o B/L vai, o que
 * a fatura faz, e o que impede a troca quando ela nao pode ser automatica.
 */
function CustomerChangeCard({ blNumber, change }: { blNumber: string; change: BlCustomerChange }) {
  return (
    <div className="rounded-lg border border-[var(--app-border)] px-3 py-2">
      <div className="font-semibold text-[var(--app-text-strong)]">{blNumber}</div>
      <ul className="mt-1 grid gap-1 text-xs">
        {change.messages.map((message) => (
          <li key={message} className="text-amber-200">{message}</li>
        ))}
        {change.blockedReasons.map((reason) => (
          <li key={reason} className="text-red-300">Impedimento: {reason}</li>
        ))}
      </ul>
      {change.blockedReasons.length ? (
        <div className="mt-1 text-xs text-red-300">
          O cliente deste B/L nao sera trocado; os demais campos seguem sendo aplicados.
        </div>
      ) : null}
    </div>
  )
}

function DiffList({ row }: { row: BlFreightImportRow }) {
  if (!row.diffs.length) {
    return <span className="text-xs text-[var(--app-muted-soft)]">-</span>
  }

  return (
    <div className="grid gap-1">
      {row.diffs.map((diff) => (
        <div key={`${row.blNumber}-${diff.field}`} className={diff.billingImpact ? 'text-amber-300' : undefined}>
          <span className="font-semibold">{diff.label}</span>:{' '}
          <span>{formatDiffValue(diff.from)}</span> {'->'} <span>{formatDiffValue(diff.to)}</span>
          {diff.billingImpact ? <span className="ml-1 text-xs">(faturamento)</span> : null}
        </div>
      ))}
    </div>
  )
}

function StatusPill({ status }: { status: BlFreightImportRow['status'] }) {
  const labels: Record<BlFreightImportRow['status'], string> = {
    new: 'Novo',
    updated: 'Atualizado',
    unchanged: 'Sem mudanca',
    blocked: 'Bloqueado',
  }
  // Badge (app-badge--*) instead of ad-hoc Tailwind colors: those hardcoded
  // light-text-on-light-tint classes were unreadable outside dark theme.
  const tone: BadgeTone = status === 'blocked'
    ? 'yellow'
    : status === 'new'
      ? 'green'
      : status === 'updated'
        ? 'blue'
        : 'slate'

  return <Badge tone={tone}>{labels[status]}</Badge>
}

function formatDiffValue(value: string | number | null) {
  if (value === null || value === '') return '-'
  return String(value)
}

import { useMemo, useState } from 'react'
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
import { afterManifestoImportado } from '../../services/cacheEffects'
import { Badge, type SemanticBadgeTone } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { SummaryStrip } from '../ui/SummaryStrip'
import { useToast } from '../ui/Toast'
import { VoyageCombobox } from './VoyageCombobox'
import { ImportReadProgress } from './ImportReadProgress'
import { ImportContext, ImportFilePicker, ImportFootnote, ImportNotice } from './ImportParts'
import { plural } from './importPresentation'

/** O que a confirmação gravou e o que ficou de fora, mostrado no próprio modal. */
type ConfirmOutcome = {
  imported: number
  blocked: number
  refusedRelinks: string[]
  calculationErrors: string[]
}

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
  const [readError, setReadError] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<ConfirmOutcome | null>(null)

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
    setReadError(null)
    setConfirmError(null)
    setOutcome(null)
    onClose()
  }

  function handleVoyageSelect(nextVoyageId: number | null) {
    cancelReading()
    setSelectedVoyageId(nextVoyageId)
    setPreview(null)
    setOverrideBilling(false)
    setConfirmCustomerChange(false)
  }

  async function handleFiles(selectedFiles: File[]) {
    setFiles(selectedFiles)
    setPreview(null)
    setOverrideBilling(false)
    setConfirmCustomerChange(false)
    setReadError(null)
    setConfirmError(null)
    setOutcome(null)
    if (!selectedFiles.length) return
    // O seletor fica desativado sem viagem; a guarda cobre o caminho por código.
    if (!selectedVoyageId) {
      setReadError('Escolha a viagem de destino antes do arquivo: a prévia compara o arquivo com ela.')
      return
    }

    const failures: string[] = []
    try {
      const documents = (await readFiles(selectedFiles, (error, file) => {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : 'Falha ao ler o arquivo.'}`)
      })) ?? []
      if (failures.length) setReadError(failures.join(' | '))

      if (!documents.length) return

      const nextPreview = await previewBlFreightImport({
        documents,
        voyageId: selectedVoyageId,
        onlyBlId,
      })
      setPreview(nextPreview)
    } catch (error) {
      setReadError(error instanceof Error ? error.message : 'Falha ao preparar a prévia do B/L.')
    }
  }

  async function handleConfirm() {
    if (!preview || importableCount === 0) return
    if (!selectedVoyageId) return

    setSubmitting(true)
    setConfirmError(null)
    try {
      const { refusedCustomerRelinks, calculationErrors } = await confirmBlFreightImport(
        preview,
        user?.id ?? '',
        overrideBilling,
        files[0]?.name,
        confirmCustomerChange,
      )
      await afterManifestoImportado(queryClient, { voyageId: selectedVoyageId })
      const refused = refusedCustomerRelinks.map((relink) => `${relink.blNumber} (${relink.blockers.join(' ')})`)
      const failedCalculations = calculationErrors.map((failure) => `${failure.blNumber} (${failure.message})`)
      if (refused.length || failedCalculations.length) {
        // Importou, mas algo pedido não aconteceu: o modal fica aberto com o
        // resultado parcial. Dizer "concluída" e fechar esconderia justamente o
        // que o operador precisa resolver.
        const warnings: string[] = []
        if (refused.length) warnings.push(`a troca de cliente foi recusada em ${refused.length} B/L(s): ${refused.join(' | ')}`)
        if (failedCalculations.length) warnings.push(`${failedCalculations.length} B/L(s) ficaram sem cálculo automático: ${failedCalculations.join(' | ')}`)
        showToast(`Importação gravada, mas ${warnings.join(' | ')}`, 'error')
        setOutcome({
          imported: importableCount,
          blocked: preview.summary.blockedCount,
          refusedRelinks: refused,
          calculationErrors: failedCalculations,
        })
        return
      }
      showToast(
        `Importação de B/L concluída: ${importableCount} B/L(s), ${preview.summary.blockedCount} bloqueado(s).`,
        'success',
      )
      resetAndClose()
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : 'Falha ao confirmar a importação de B/L.')
      // A importacao vai em lotes: os que ja entraram precisam aparecer na tela.
      void afterManifestoImportado(queryClient, { voyageId: selectedVoyageId })
    } finally {
      setSubmitting(false)
    }
  }

  const blockedAll = Boolean(preview && importableCount === 0)
  let footnote = 'Nada é gravado antes de você conferir a prévia e confirmar.'
  if (outcome) footnote = 'Importação gravada com pendências; veja acima.'
  else if (parsing) footnote = 'Lendo o arquivo. Nada foi gravado.'
  else if (blockedAll) footnote = 'Nenhum B/L pode ser importado; veja os bloqueios na tabela.'
  else if (preview) footnote = `${plural(importableCount, 'B/L será gravado', 'B/Ls serão gravados')}. Nada foi gravado ainda.`

  return (
    <Modal open={open} onClose={resetAndClose} title="Importar B/L de container">
      <div className="app-import">
        {onlyBlId ? (
          <ImportContext label="B/L">
            <span className="app-import-code">{onlyBlId}</span>
          </ImportContext>
        ) : null}

        <VoyageCombobox
          key={`${open ? 'open' : 'closed'}-${voyageId ?? 'none'}-${voyageLabel ?? ''}`}
          required
          initialValue={voyageLabel}
          selectedVoyageId={selectedVoyageId}
          onSelect={handleVoyageSelect}
        />

        <ImportFilePicker
          accept=".xlsx,.xls"
          multiple
          files={files}
          onFiles={(next) => void handleFiles(next)}
          disabled={!selectedVoyageId || submitting || Boolean(outcome)}
          disabledReason={!selectedVoyageId ? 'Escolha a viagem de destino: a prévia compara o navio e a viagem do arquivo com ela.' : undefined}
        />

        {parsing ? <ImportReadProgress progress={progress} /> : null}

        {readError ? (
          <ImportNotice tone="danger" role="alert" title="Não foi possível montar a prévia">
            <p>{readError}</p>
            <p>Confira o arquivo e escolha de novo. Nada foi gravado.</p>
          </ImportNotice>
        ) : null}

        {preview ? <BlImportPreview preview={preview} /> : null}

        {customerChangeRows.length && !outcome ? (
          <section className="app-import-section" aria-label="Troca de consignatário">
            <h3 className="app-import-section__title">
              Troca de consignatário em {plural(customerChangeRows.length, 'B/L', 'B/Ls')}
            </h3>
            {customerChangeRows.map((row) => (
              <CustomerChangeCard key={row.blNumber} blNumber={row.blNumber} change={row.customerChange!} />
            ))}
            {customerChangeCount > 0 ? (
              <label className="app-import-override">
                <input
                  type="checkbox"
                  checked={confirmCustomerChange}
                  onChange={(event) => setConfirmCustomerChange(event.target.checked)}
                />
                <span>
                  <span className="app-import-override__title">
                    Confirmo a troca de cliente em {plural(customerChangeCount, 'B/L', 'B/Ls')}
                  </span>
                  <span className="app-import-override__hint">
                    O B/L passa a pertencer ao novo consignatário e as taxas locais são reemitidas; com recebimento,
                    devolva ao Cliente original antes da nova cobrança. Sem marcar, os demais campos são aplicados e o
                    vínculo de cliente fica como está.
                  </span>
                </span>
              </label>
            ) : null}
          </section>
        ) : null}

        {confirmError ? (
          <ImportNotice tone="danger" role="alert" title="A importação não foi concluída">
            <p>{confirmError}</p>
            <p>Os lotes que já entraram aparecem na lista. Confira e confirme de novo para o restante.</p>
          </ImportNotice>
        ) : null}

        {outcome ? (
          <ImportNotice tone="warning" role="status" title={`${plural(outcome.imported, 'B/L gravado', 'B/Ls gravados')}, com pendências`}>
            {outcome.refusedRelinks.length ? (
              <>
                <p>A troca de cliente foi recusada; o B/L continua com o cliente anterior:</p>
                <ul className="app-import-notice__list">
                  {outcome.refusedRelinks.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </>
            ) : null}
            {outcome.calculationErrors.length ? (
              <>
                <p>Ficaram sem cálculo automático de taxas locais; recalcule na ficha do B/L:</p>
                <ul className="app-import-notice__list">
                  {outcome.calculationErrors.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </>
            ) : null}
          </ImportNotice>
        ) : null}

        <div className="app-modal__actions">
          {/* No rodape fixo: a decisao fica a vista de quem confirma a importacao. */}
          {billingOverrideCount > 0 && !outcome ? (
            <label className="app-import-override basis-full">
              <input
                type="checkbox"
                checked={overrideBilling}
                onChange={(event) => setOverrideBilling(event.target.checked)}
              />
              <span>
                <span className="app-import-override__title">
                  Sobrescrever faturamento em {plural(billingOverrideCount, 'B/L', 'B/Ls')} com impacto
                </span>
                <span className="app-import-override__hint">
                  Quantidade de containers, container compartilhado, IMO/OOG, peso de carga solta ou CNPJ faturado. Sem
                  marcar, os demais campos são aplicados e as mudanças com impacto em faturamento são ignoradas.
                </span>
              </span>
            </label>
          ) : null}
          <ImportFootnote tone={outcome ? 'warning' : blockedAll ? 'warning' : 'default'}>{footnote}</ImportFootnote>
          {outcome ? (
            <Button onClick={resetAndClose}>Concluir</Button>
          ) : (
            <>
              <Button variant="secondary" disabled={submitting} onClick={parsing ? cancelReading : resetAndClose}>
                {parsing ? 'Interromper leitura' : 'Voltar'}
              </Button>
              <Button
                disabled={!selectedVoyageId || importableCount === 0 || parsing}
                loading={submitting}
                loadingLabel="Importando…"
                onClick={() => void handleConfirm()}
              >
                <Upload size={16} aria-hidden="true" />
                {importableCount > 0 ? `Importar ${plural(importableCount, 'B/L', 'B/Ls')}` : 'Importar B/Ls'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

function BlImportPreview({ preview }: { preview: BlFreightImportPreview }) {
  const { newCount, updatedCount, unchangedCount, blockedCount } = preview.summary
  return (
    <section className="app-import-section" aria-label="Prévia da importação">
      <div className="app-import-section__head">
        <h3 className="app-import-section__title">Prévia</h3>
        <SummaryStrip
          label="O que a importação faz"
          items={[
            { label: newCount === 1 ? 'novo' : 'novos', value: newCount },
            { label: updatedCount === 1 ? 'atualizado' : 'atualizados', value: updatedCount },
            { label: 'sem mudança', value: unchangedCount },
            { label: blockedCount === 1 ? 'bloqueado' : 'bloqueados', value: blockedCount, tone: blockedCount ? 'danger' : 'default' },
          ]}
        />
      </div>

      {/* Plain app-table-scroll (horizontal only): the modal body is already the
          scroll container (.app-modal__body, overflow-y: auto) with a sticky
          actions bar pinned to its bottom. Giving the table its own bounded
          vertical scroll region (app-table-scroll--sticky) nests a second
          independent scrollbar inside that one, and its sticky header/footer
          fight the outer sticky actions bar, breaking scrolling and clipping
          rows behind the buttons. */}
      <div className="app-table-scroll rounded-[var(--app-radius)] border border-[var(--app-border)]">
        <table className="app-table app-table--compact min-w-[880px] text-left">
          <thead>
            <tr>
              <th scope="col">B/L</th>
              <th scope="col">Situação</th>
              <th scope="col">Viagem</th>
              <th scope="col">POL → POD</th>
              <th scope="col">Laden on Board</th>
              <th scope="col">Diferenças</th>
              <th scope="col">Bloqueios e faturamento</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => (
              <tr key={row.blNumber}>
                <td className="app-import-code font-semibold text-[var(--app-text-strong)]">{row.blNumber}</td>
                <td>
                  <StatusPill status={row.status} />
                </td>
                <td>{row.voyageNumber ?? '—'}</td>
                <td>{row.pol || row.pod ? `${row.pol ?? '—'} → ${row.pod ?? '—'}` : '—'}</td>
                <td className="tabular-nums">{row.ladenOnBoard ?? '—'}</td>
                <td>
                  <DiffList row={row} />
                </td>
                <td>
                  {row.blockedReasons.length || row.billingImpacts.length ? (
                    <ul className="grid gap-1">
                      {row.blockedReasons.map((reason) => (
                        <li key={reason} className="app-import-tone--danger">{reason}</li>
                      ))}
                      {row.billingImpacts.map((reason) => (
                        <li key={reason} className="app-import-tone--warning">Faturamento: {reason}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="app-import-tone--muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * O aviso que o operador le antes de aceitar: de quem para quem o B/L vai, o que
 * a fatura faz, e o que impede a troca quando ela nao pode ser automatica.
 */
function CustomerChangeCard({ blNumber, change }: { blNumber: string; change: BlCustomerChange }) {
  return (
    <ImportNotice tone={change.blockedReasons.length ? 'danger' : 'warning'} title={<span className="app-import-code">{blNumber}</span>}>
      <ul className="app-import-notice__list">
        {change.messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
        {change.blockedReasons.map((reason) => (
          <li key={reason}>Impedimento: {reason}</li>
        ))}
      </ul>
      {change.blockedReasons.length ? (
        <p>O cliente deste B/L não será trocado; os demais campos seguem sendo aplicados.</p>
      ) : null}
    </ImportNotice>
  )
}

function DiffList({ row }: { row: BlFreightImportRow }) {
  if (!row.diffs.length) {
    return <span className="app-import-tone--muted">—</span>
  }

  return (
    <ul className="grid gap-1">
      {row.diffs.map((diff) => (
        <li key={`${row.blNumber}-${diff.field}`} className={diff.billingImpact ? 'app-import-tone--warning' : undefined}>
          <span className="font-semibold">{diff.label}</span>:{' '}
          <span className="app-import-diff__old">{formatDiffValue(diff.from)}</span>{' → '}<span>{formatDiffValue(diff.to)}</span>
          {diff.billingImpact ? <span> (faturamento)</span> : null}
        </li>
      ))}
    </ul>
  )
}

function StatusPill({ status }: { status: BlFreightImportRow['status'] }) {
  const labels: Record<BlFreightImportRow['status'], string> = {
    new: 'Novo',
    updated: 'Atualizado',
    unchanged: 'Sem mudança',
    blocked: 'Bloqueado',
  }
  // Bloqueado é perigo (não entra), não atenção.
  const tone: SemanticBadgeTone = status === 'blocked'
    ? 'danger'
    : status === 'new'
      ? 'success'
      : status === 'updated'
        ? 'info'
        : 'neutral'

  return <Badge tone={tone}>{labels[status]}</Badge>
}

function formatDiffValue(value: string | number | null) {
  if (value === null || value === '') return '—'
  return String(value)
}

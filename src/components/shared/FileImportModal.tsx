import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import type { ImportFileInspection } from '../../services/importText'
import type { ImportIssue } from '../../services/importValidation'
import type { FileReadProgress } from '../../hooks/useCancellableFileRead'
import { ImportIssuesPanel } from './ImportIssuesPanel'
import { ImportReadProgress } from './ImportReadProgress'

function yieldToBrowser() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

export type FilePreviewEntry<T> = {
  file: File
  preview: T
  inspection?: ImportFileInspection
}

type Props<T, TResult = void> = {
  title: string
  subtitle?: ReactNode
  prerequisite?: ReactNode
  ready?: boolean
  accept: string
  multiple?: boolean
  parser: (file: File) => Promise<T>
  /**
   * Muda quando uma opção de leitura muda (ex.: o formato numérico declarado).
   * O modal relê os arquivos já escolhidos com o novo `parser`, para a prévia
   * e as divergências refletirem a opção — sem isso o operador trocaria a
   * opção e continuaria vendo o resultado da leitura anterior.
   */
  reparseKey?: string | number
  inspectFile?: (file: File) => Promise<ImportFileInspection>
  importer?: (preview: T, file: File, allowOverride?: boolean) => Promise<TResult>
  batchImporter?: (entries: FilePreviewEntry<T>[], allowOverride?: boolean) => Promise<void>
  canImport: (preview: T, allowOverride?: boolean) => boolean
  getIssues?: (preview: T) => readonly ImportIssue[]
  issuesFilename?: string
  renderPreview: (preview: T, file: File) => ReactNode
  renderBatchSummary?: (entries: FilePreviewEntry<T>[]) => ReactNode
  renderImportResult?: (result: TResult) => ReactNode
  helper?: ReactNode
  onClose: () => void
}

export function FileImportModal<T, TResult = void>({
  title,
  subtitle,
  prerequisite,
  ready = true,
  accept,
  multiple = false,
  parser,
  reparseKey,
  inspectFile,
  importer,
  batchImporter,
  canImport,
  renderPreview,
  renderBatchSummary,
  renderImportResult,
  getIssues,
  issuesFilename,
  helper,
  onClose,
}: Props<T, TResult>) {
  const { showToast } = useToast()
  const [entries, setEntries] = useState<FilePreviewEntry<T>[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [parsing, setParsing] = useState(false)
  const [parseProgress, setParseProgress] = useState<FileReadProgress>({ completed: 0, total: 0, currentFile: null })
  const [importing, setImporting] = useState(false)
  const [allowOverride, setAllowOverride] = useState(false)
  const [importResult, setImportResult] = useState<TResult | undefined>(undefined)
  const parseControllerRef = useRef<AbortController | null>(null)
  const importControllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => {
    parseControllerRef.current?.abort()
    importControllerRef.current?.abort()
  }, [])


  function closeModal() {
    setSelectedFiles([])
    parseControllerRef.current?.abort()
    importControllerRef.current?.abort()
    onClose()
  }

  // A escolha do arquivo só guarda os arquivos; quem lê é o efeito abaixo. É o
  // que permite reler os MESMOS arquivos quando `reparseKey` muda, sem duplicar
  // o caminho de leitura nem guardar a lista num ref.
  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    parseControllerRef.current?.abort()
    setEntries([])
    setActiveIndex(0)
    setAllowOverride(false)
    setImportResult(undefined)
    setSelectedFiles(Array.from(event.target.files ?? []))
  }

  async function parseFiles(files: File[]) {
    parseControllerRef.current?.abort()
    setEntries([])
    setActiveIndex(0)
    setAllowOverride(false)
    setImportResult(undefined)
    setParseProgress({ completed: 0, total: files.length, currentFile: files[0]?.name ?? null })
    if (!files.length) {
      parseControllerRef.current = null
      setParsing(false)
      return
    }
    const controller = new AbortController()
    parseControllerRef.current = controller
    setParsing(true)
    const parsedEntries: FilePreviewEntry<T>[] = []
    for (const [index, file] of files.entries()) {
      if (controller.signal.aborted) break
      try {
        const inspection = inspectFile ? await inspectFile(file) : undefined
        const preview = await parser(file)
        if (controller.signal.aborted) break
        parsedEntries.push({ file, preview, inspection })
        setParseProgress((progress) => ({
          ...progress,
          completed: progress.completed + 1,
          currentFile: files[progress.completed + 1]?.name ?? file.name,
        }))
      } catch (err) {
        if (controller.signal.aborted) break
        showToast(`${file.name}: ${err instanceof Error ? err.message : 'Falha ao ler arquivo.'}`, 'error')
        setParseProgress((progress) => ({
          ...progress,
          completed: progress.completed + 1,
          currentFile: files[progress.completed + 1]?.name ?? file.name,
        }))
      }
      if (!controller.signal.aborted && index < files.length - 1) await yieldToBrowser()
    }
    if (!controller.signal.aborted) setEntries(parsedEntries)
    if (parseControllerRef.current === controller) {
      setParsing(false)
      parseControllerRef.current = null
    }
  }

  // Lê os arquivos escolhidos, e relê quando a opção de leitura muda. Ler um
  // File é I/O externo assíncrono, e `parseFiles` zera prévia e progresso antes
  // de começar — daí o disable de `set-state-in-effect`, com o mesmo critério
  // usado em CustomerContactConfiguration e DepotCadastro.
  //
  // `parser` fica fora das deps de propósito: nem todo chamador o memoiza, e
  // uma identidade nova a cada render relançaria a leitura em laço.
  // `reparseKey` é o sinal explícito de "reler", no lugar dessa dependência.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (selectedFiles.length) void parseFiles(selectedFiles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFiles, reparseKey])
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleImport() {
    const importableEntries = entries.filter((entry) => canImport(entry.preview, allowOverride))
    if (!importableEntries.length) return
    const controller = new AbortController()
    importControllerRef.current = controller
    setImporting(true)
    let hasImportResult = false
    try {
      if (batchImporter) {
        await batchImporter(importableEntries, allowOverride)
      } else if (importer) {
        for (const entry of importableEntries) {
          if (controller.signal.aborted) return
          const result = await importer(entry.preview, entry.file, allowOverride)
          if (renderImportResult && result !== undefined) {
            hasImportResult = true
            setImportResult(result as TResult)
          }
        }
      }
      if (!controller.signal.aborted && (!renderImportResult || !hasImportResult)) closeModal()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao importar.', 'error')
    } finally {
      setImporting(false)
      if (importControllerRef.current === controller) importControllerRef.current = null
    }
  }

  function cancelParsing() {
    parseControllerRef.current?.abort()
    setParsing(false)
  }

  const activeEntry = entries[activeIndex] ?? null
  const activeIssues = activeEntry && getIssues ? getIssues(activeEntry.preview) : []

  return (
    <Modal open onClose={closeModal} title={title}>
      <div className="grid gap-4">
        {subtitle ? <div className="app-panel app-panel--padded text-sm">{subtitle}</div> : null}
        {helper}
        {prerequisite}
        <Field label={`Arquivo ${accept}`}>
          <Input accept={accept} disabled={!ready || importing} multiple={multiple} type="file" onChange={handleFile} />
        </Field>
        {parsing ? <ImportReadProgress progress={parseProgress} /> : null}
        {entries.length > 0 && renderBatchSummary ? renderBatchSummary(entries) : null}
        {activeEntry && entries.length > 1 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-3 py-2 text-sm">
            <span className="text-[var(--app-muted)]">
              Prévia {activeIndex + 1} de {entries.length}: <span className="font-semibold text-[var(--app-text-strong)]">{activeEntry.file.name}</span>
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={activeIndex <= 0} onClick={() => setActiveIndex((index) => index - 1)}>
                Anterior
              </Button>
              <Button variant="secondary" disabled={activeIndex >= entries.length - 1} onClick={() => setActiveIndex((index) => index + 1)}>
                Próxima
              </Button>
            </div>
          </div>
        ) : null}
        {activeEntry?.inspection ? <ImportInspection inspection={activeEntry.inspection} /> : null}
        {activeEntry ? renderPreview(activeEntry.preview, activeEntry.file) : null}
        {activeIssues.length ? <ImportIssuesPanel issues={activeIssues} filename={issuesFilename} /> : null}
        {importResult !== undefined && renderImportResult ? renderImportResult(importResult) : null}
        {entries.length > 0 && importResult === undefined && !entries.every((entry) => canImport(entry.preview, false)) && entries.some((entry) => canImport(entry.preview, true)) ? (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--app-gold)] bg-[var(--app-gold-soft)] p-3 text-xs text-[var(--app-gold-strong)]">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allowOverride}
                onChange={(e) => setAllowOverride(e.target.checked)}
                className="rounded border-[var(--app-border)]"
              />
              <span><b>Estou ciente das divergências/erros encontrados e desejo forçar a importação</b></span>
            </label>
          </div>
        ) : null}
        <div className="app-modal__actions">
          <Button variant="secondary" disabled={importing} onClick={parsing ? cancelParsing : closeModal}>{parsing ? 'Interromper leitura' : 'Voltar'}</Button>
          <Button
            disabled={importResult !== undefined ? false : !ready || !entries.some((entry) => canImport(entry.preview, allowOverride))}
            loading={importing}
            onClick={() => importResult !== undefined ? onClose() : void handleImport()}
          >
            {importResult !== undefined ? 'Concluir' : 'Confirmar'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function ImportInspection({ inspection }: { inspection: ImportFileInspection }) {
  const formatLabel: Record<ImportFileInspection['format'], string> = {
    xlsx: 'XLSX',
    xls: 'XLS',
    csv: 'CSV',
    edi: 'EDI',
  }
  const encodingLabel = inspection.encoding === null
    ? 'binário'
    : inspection.encoding === 'utf-8-sig'
      ? 'UTF-8 com BOM'
      : inspection.encoding === 'windows-1252'
        ? 'Windows-1252'
        : inspection.encoding.toUpperCase()

  return (
    <div className="app-panel app-panel--padded grid gap-2 text-xs" role="status" aria-label="Diagnóstico do arquivo">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span>Formato detectado: <strong>{formatLabel[inspection.format]}</strong></span>
        <span>Encoding: <strong>{encodingLabel}</strong></span>
        <span>BOM: <strong>{inspection.hadBom ? 'presente' : 'ausente'}</strong></span>
        <span>{inspection.byteLength.toLocaleString('pt-BR')} bytes</span>
      </div>
      {inspection.preview ? (
        <details>
          <summary className="cursor-pointer font-semibold">Prévia do conteúdo decodificado</summary>
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-2 font-mono text-[11px]">{inspection.preview}</pre>
        </details>
      ) : null}
    </div>
  )
}

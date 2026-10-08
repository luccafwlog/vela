import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import type { ImportFileInspection } from '../../services/importText'
import type { ImportIssue } from '../../services/importValidation'
import type { FileReadProgress } from '../../hooks/useCancellableFileRead'
import { ImportIssuesPanel } from './ImportIssuesPanel'
import { ImportReadProgress } from './ImportReadProgress'
import { ImportFilePicker, ImportFootnote, ImportNotice } from './ImportParts'
import { formatFileSize, plural } from './importPresentation'

function yieldToBrowser() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

export type FilePreviewEntry<T> = {
  file: File
  preview: T
  inspection?: ImportFileInspection
}

type ReadFailure = { name: string; message: string }

type Props<T, TResult = void> = {
  title: string
  subtitle?: ReactNode
  prerequisite?: ReactNode
  ready?: boolean
  /** Por que o arquivo ainda não pode ser escolhido quando `ready` é falso. */
  notReadyReason?: ReactNode
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
  /** Verbo e objeto do botão principal, ex.: "Importar manifesto". */
  confirmLabel?: string
  /** O que o aceite das divergências faz neste importador. */
  overrideHint?: ReactNode
  onClose: () => void
}

export function FileImportModal<T, TResult = void>({
  title,
  subtitle,
  prerequisite,
  ready = true,
  notReadyReason = 'Preencha os dados acima para escolher o arquivo.',
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
  confirmLabel = 'Importar',
  overrideHint = 'Só as linhas válidas são gravadas; as linhas com erro ficam de fora e continuam no relatório.',
  onClose,
}: Props<T, TResult>) {
  const [entries, setEntries] = useState<FilePreviewEntry<T>[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [parsing, setParsing] = useState(false)
  const [parseProgress, setParseProgress] = useState<FileReadProgress>({ completed: 0, total: 0, currentFile: null })
  const [readFailures, setReadFailures] = useState<ReadFailure[]>([])
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
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
  function handleFiles(files: File[]) {
    parseControllerRef.current?.abort()
    setEntries([])
    setActiveIndex(0)
    setAllowOverride(false)
    setImportResult(undefined)
    setImportError(null)
    setReadFailures([])
    setSelectedFiles(files)
  }

  async function parseFiles(files: File[]) {
    parseControllerRef.current?.abort()
    setEntries([])
    setActiveIndex(0)
    setAllowOverride(false)
    setImportResult(undefined)
    setImportError(null)
    setReadFailures([])
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
    const failures: ReadFailure[] = []
    for (const [index, file] of files.entries()) {
      if (controller.signal.aborted) break
      try {
        const inspection = inspectFile ? await inspectFile(file) : undefined
        const preview = await parser(file)
        if (controller.signal.aborted) break
        parsedEntries.push({ file, preview, inspection })
      } catch (err) {
        if (controller.signal.aborted) break
        failures.push({ name: file.name, message: err instanceof Error ? err.message : 'Falha ao ler o arquivo.' })
      }
      setParseProgress((progress) => ({
        ...progress,
        completed: progress.completed + 1,
        currentFile: files[progress.completed + 1]?.name ?? file.name,
      }))
      if (!controller.signal.aborted && index < files.length - 1) await yieldToBrowser()
    }
    if (!controller.signal.aborted) {
      setEntries(parsedEntries)
      setReadFailures(failures)
    }
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
    setImportError(null)
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
      // A falha fica na tela, junto da prévia que a causou; o arquivo
      // continua escolhido para o operador ajustar e tentar de novo.
      setImportError(err instanceof Error ? err.message : 'Falha ao importar.')
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
  const done = importResult !== undefined
  const importableCount = entries.filter((entry) => canImport(entry.preview, allowOverride)).length
  const strictCount = entries.filter((entry) => canImport(entry.preview, false)).length
  const offerOverride = entries.length > 0 && !done && strictCount < entries.length && entries.some((entry) => canImport(entry.preview, true))
  const primaryLabel = done
    ? 'Concluir'
    : multiple && importableCount > 1 ? `${confirmLabel} (${plural(importableCount, 'arquivo', 'arquivos')})` : confirmLabel

  let footnote: ReactNode
  if (done) footnote = <ImportFootnote tone="success">Importação gravada.</ImportFootnote>
  else if (parsing) footnote = <ImportFootnote>Lendo o arquivo. Nada foi gravado.</ImportFootnote>
  else if (!entries.length) footnote = <ImportFootnote>Nada é gravado antes de você conferir a prévia e confirmar.</ImportFootnote>
  else if (!importableCount) footnote = <ImportFootnote tone="warning">Nada pode ser importado ainda. Veja o que impede acima.</ImportFootnote>
  else if (multiple && entries.length > 1) footnote = <ImportFootnote>{plural(importableCount, 'arquivo será importado', 'arquivos serão importados')} de {entries.length}. Nada foi gravado ainda.</ImportFootnote>
  else footnote = <ImportFootnote>Prévia pronta. Nada foi gravado ainda.</ImportFootnote>

  return (
    <Modal open onClose={closeModal} title={title}>
      <div className="app-import">
        {subtitle ? <div className="app-import-context">{subtitle}</div> : null}
        {prerequisite}
        {helper}
        <ImportFilePicker
          accept={accept}
          multiple={multiple}
          files={selectedFiles}
          onFiles={handleFiles}
          disabled={!ready || importing}
          disabledReason={!ready ? notReadyReason : undefined}
        />
        {parsing ? <ImportReadProgress progress={parseProgress} /> : null}
        {readFailures.length ? (
          <ImportNotice
            tone="danger"
            role="alert"
            title={readFailures.length === 1 ? 'Não foi possível ler o arquivo' : `Não foi possível ler ${readFailures.length} arquivos`}
          >
            <ul className="app-import-notice__list">
              {readFailures.map((failure) => (
                <li key={failure.name}><strong>{failure.name}:</strong> {failure.message}</li>
              ))}
            </ul>
            <p>Confira o formato e o conteúdo e escolha o arquivo de novo.</p>
          </ImportNotice>
        ) : null}
        {entries.length > 0 && renderBatchSummary ? renderBatchSummary(entries) : null}
        {activeEntry && entries.length > 1 ? (
          <nav className="app-import-pager" aria-label="Prévia por arquivo">
            <span className="app-import-pager__label">
              Prévia {activeIndex + 1} de {entries.length}: <strong>{activeEntry.file.name}</strong>
            </span>
            <div className="app-import-pager__actions">
              <Button variant="secondary" aria-label="Arquivo anterior" disabled={activeIndex <= 0} onClick={() => setActiveIndex((index) => index - 1)}>
                <ChevronLeft size={16} aria-hidden="true" />
                Anterior
              </Button>
              <Button variant="secondary" aria-label="Próximo arquivo" disabled={activeIndex >= entries.length - 1} onClick={() => setActiveIndex((index) => index + 1)}>
                Próxima
                <ChevronRight size={16} aria-hidden="true" />
              </Button>
            </div>
          </nav>
        ) : null}
        {activeEntry?.inspection ? <ImportInspection inspection={activeEntry.inspection} /> : null}
        {activeEntry ? renderPreview(activeEntry.preview, activeEntry.file) : null}
        {activeIssues.length ? <ImportIssuesPanel issues={activeIssues} filename={issuesFilename} /> : null}
        {importError ? (
          <ImportNotice tone="danger" role="alert" title="A importação não foi concluída">
            <p>{importError}</p>
            <p>A prévia continua aqui; ajuste o que for preciso e confirme de novo.</p>
          </ImportNotice>
        ) : null}
        {done && renderImportResult ? renderImportResult(importResult) : null}
        {offerOverride ? (
          <label className="app-import-override">
            <input
              type="checkbox"
              checked={allowOverride}
              onChange={(e) => setAllowOverride(e.target.checked)}
            />
            <span>
              <span className="app-import-override__title">Estou ciente das divergências/erros encontrados e desejo forçar a importação</span>
              <span className="app-import-override__hint">{overrideHint}</span>
            </span>
          </label>
        ) : null}
        <div className="app-modal__actions">
          {footnote}
          {done ? null : (
            <Button variant="secondary" disabled={importing} onClick={parsing ? cancelParsing : closeModal}>
              {parsing ? 'Interromper leitura' : 'Voltar'}
            </Button>
          )}
          <Button
            disabled={done ? false : !ready || importableCount === 0}
            loading={importing}
            loadingLabel="Importando…"
            onClick={() => done ? onClose() : void handleImport()}
          >
            {primaryLabel}
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
    <div className="app-import-inspection" role="status" aria-label="Diagnóstico do arquivo">
      <p className="app-import-inspection__line">
        <span>Formato detectado: <strong>{formatLabel[inspection.format]}</strong></span>
        <span>Encoding: <strong>{encodingLabel}</strong></span>
        <span>BOM: <strong>{inspection.hadBom ? 'presente' : 'ausente'}</strong></span>
        <span>{formatFileSize(inspection.byteLength)}</span>
      </p>
      {inspection.preview ? (
        <details className="app-import-inspection__details">
          <summary>Ver o texto lido</summary>
          <pre>{inspection.preview}</pre>
        </details>
      ) : null}
    </div>
  )
}

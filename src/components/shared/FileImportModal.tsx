import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { hasBlockingIssues, type ImportIssue } from '../../services/importValidation'
import type { FileReadProgress } from '../../hooks/useCancellableFileRead'
import { ImportIssuesPanel } from './ImportIssuesPanel'
import { ImportReadProgress } from './ImportReadProgress'
import { ImportFileBlock, ImportFilePicker, ImportFootnote, ImportNotice, ImportSteps } from './ImportParts'
import { plural } from './importPresentation'
import { userFacingErrorMessage } from '../../lib/errors'

function yieldToBrowser() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

export type FilePreviewEntry<T> = {
  file: File
  preview: T
}

type ReadFailure = { name: string; message: string }

type Props<T, TResult = void> = {
  title: string
  subtitle?: ReactNode
  /**
   * Dados lidos antes do arquivo (viagem, formato). Como função, recebe
   * `locked`: verdadeiro durante a gravação e depois do resultado, para o
   * chamador travar os campos — trocar a viagem ali relia o arquivo e
   * reabria o "Importar" para gravar o mesmo arquivo noutro destino.
   */
  prerequisite?: ReactNode | ((state: { locked: boolean }) => ReactNode)
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
  importer?: (preview: T, file: File, allowOverride?: boolean) => Promise<TResult>
  batchImporter?: (entries: FilePreviewEntry<T>[], allowOverride?: boolean) => Promise<void>
  canImport: (preview: T, allowOverride?: boolean) => boolean
  /**
   * Sem erro, mas nada a gravar (ex.: só B/Ls cancelados, que são aviso):
   * devolve a frase do rodapé e o "Importar" fica desativado. Não é "Com erro
   * no arquivo": o painel de problemas só tem avisos.
   */
  nothingToImport?: (entries: FilePreviewEntry<T>[]) => ReactNode | null
  getIssues?: (preview: T) => readonly ImportIssue[]
  issuesFilename?: string
  renderPreview: (preview: T, file: File) => ReactNode
  renderBatchSummary?: (entries: FilePreviewEntry<T>[]) => ReactNode
  renderImportResult?: (result: TResult) => ReactNode
  helper?: ReactNode
  /** Modelos para baixar (`ImportTemplateLinks`), na faixa do bloco Arquivo. */
  templates?: ReactNode
  /**
   * Botão principal, "Importar N <o quê>" (lote 6a). Como função, recebe as
   * prévias lidas para contar o que será gravado.
   */
  confirmLabel?: string | ((entries: FilePreviewEntry<T>[]) => string)
  /**
   * O que o aceite dos avisos faz neste importador. Erro nunca é aceito: com
   * qualquer erro a importação inteira é recusada (regra de 2026-10-19).
   */
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
  importer,
  batchImporter,
  canImport,
  nothingToImport,
  renderPreview,
  renderBatchSummary,
  renderImportResult,
  getIssues,
  issuesFilename,
  helper,
  templates,
  confirmLabel = 'Importar',
  overrideHint = 'Os avisos não impedem a gravação; o arquivo inteiro é importado.',
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


  // Gravação em andamento: X, Escape e Voltar não fecham (como no CE
  // Mercante). Fechar no meio desmontava o modal com a gravação seguindo sem
  // tela, sem o resultado e sem o erro.
  function closeModal() {
    if (importing) return
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
        const preview = await parser(file)
        if (controller.signal.aborted) break
        parsedEntries.push({ file, preview })
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
  //
  // Com a gravação em andamento ou o resultado na tela, uma troca de
  // `reparseKey` não relê: o resultado gravado não é apagado e o "Importar"
  // não volta (escolher outro arquivo, em `handleFiles`, é que recomeça).
  useEffect(() => {
    if (importing || importResult !== undefined) return
    if (selectedFiles.length) void parseFiles(selectedFiles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFiles, reparseKey])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Regra de 2026-10-19 (ADR 0092): importação com qualquer erro é recusada
  // inteira. Um arquivo com erro, ilegível ou que o importador recusa bloqueia
  // todos os outros; o aceite vale só para avisos.
  function entryImportable(entry: FilePreviewEntry<T>) {
    if (getIssues && hasBlockingIssues(getIssues(entry.preview))) return false
    return canImport(entry.preview, allowOverride)
  }

  async function handleImport() {
    if (!allImportable) return
    const importableEntries = entries
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
      setImportError(err instanceof Error ? err.message : userFacingErrorMessage(err, 'Falha ao importar.'))
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
  const hasErrors = readFailures.length > 0
    || entries.some((entry) => (getIssues && hasBlockingIssues(getIssues(entry.preview))) || !canImport(entry.preview, true))
  const emptyNote = entries.length > 0 && !hasErrors && nothingToImport ? nothingToImport(entries) : null
  const allImportable = entries.length > 0 && !hasErrors && !emptyNote && entries.every(entryImportable)
  const offerOverride = entries.length > 0 && !done && !hasErrors && !emptyNote && !entries.every((entry) => canImport(entry.preview, false))
  const primaryLabel = done
    ? 'Concluir'
    : typeof confirmLabel === 'function'
      ? confirmLabel(entries)
      : multiple && entries.length > 1 ? `${confirmLabel} (${plural(entries.length, 'arquivo', 'arquivos')})` : confirmLabel

  let footnote: ReactNode
  if (done) footnote = <ImportFootnote tone="success">Importação gravada.</ImportFootnote>
  else if (parsing) footnote = <ImportFootnote>Lendo o arquivo. Nada foi gravado.</ImportFootnote>
  else if (!entries.length && !readFailures.length) footnote = <ImportFootnote>Nada é gravado antes de você conferir a prévia e confirmar.</ImportFootnote>
  else if (hasErrors) footnote = <ImportFootnote tone="warning">Com erro no arquivo, nada é importado. Corrija e escolha o arquivo de novo.</ImportFootnote>
  else if (emptyNote) footnote = <ImportFootnote tone="warning">{emptyNote}</ImportFootnote>
  else if (!allImportable) footnote = <ImportFootnote tone="warning">Confira os avisos e confirme o aceite para importar.</ImportFootnote>
  else if (multiple && entries.length > 1) footnote = <ImportFootnote>{plural(entries.length, 'arquivo será importado', 'arquivos serão importados')}. Nada foi gravado ainda.</ImportFootnote>
  else footnote = <ImportFootnote>Prévia pronta. Nada foi gravado ainda.</ImportFootnote>
  const step = done ? 'resultado' : entries.length || readFailures.length ? 'previa' : 'arquivo'

  return (
    <Modal open onClose={closeModal} title={title}>
      <div className="app-import">
        <ImportSteps current={step} />
        {subtitle ? <div className="app-import-context">{subtitle}</div> : null}
        {typeof prerequisite === 'function' ? prerequisite({ locked: importing || done }) : prerequisite}
        <ImportFileBlock templates={templates}>
          {helper}
          <ImportFilePicker
            accept={accept}
            multiple={multiple}
            files={selectedFiles}
            onFiles={handleFiles}
            disabled={!ready || importing}
            disabledReason={!ready ? notReadyReason : undefined}
          />
        </ImportFileBlock>
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
              <span className="app-import-override__title">Conferi os avisos e quero importar o arquivo</span>
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
            disabled={done ? false : !ready || !allImportable}
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

import { useEffect, useId, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react'
import { AlertTriangle, Check, CheckCircle2, Download, FileUp, Info, XCircle } from 'lucide-react'
import { Block, Fact, FactList } from '../ui/Block'
import { cn } from '../../lib/utils'
import { describeAccept, formatFileSize, uploadLimitLabel } from './importPresentation'
import { readSpreadsheetWarnings } from '../../services/importCore'

/**
 * Peças visuais comuns do percurso de importação: escolher arquivo → ler →
 * conferir → confirmar → ver resultado. Donas: etapa 04 da revisão visual;
 * o molde único (passos, blocos Arquivo/Prévia/Resultado, modelo como botão)
 * é do lote 6a da identidade (docs/identidade-visual.md, "Importação").
 */

export type ImportStep = 'arquivo' | 'previa' | 'resultado'

const IMPORT_STEPS: { key: ImportStep; label: string }[] = [
  { key: 'arquivo', label: 'Arquivo' },
  { key: 'previa', label: 'Prévia' },
  { key: 'resultado', label: 'Resultado' },
]

/** Linha de passos no topo do modal: onde se está no percurso. */
export function ImportSteps({ current }: { current: ImportStep }) {
  const currentIndex = IMPORT_STEPS.findIndex((step) => step.key === current)
  return (
    <ol className="app-import-steps" aria-label="Passos da importação">
      {IMPORT_STEPS.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'next'
        return (
          <li
            key={step.key}
            className={cn('app-import-steps__item', `app-import-steps__item--${state}`)}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            {state === 'done' ? <Check size={12} aria-hidden="true" /> : null}
            {step.label}
            {state === 'done' ? <span className="sr-only"> (concluído)</span> : null}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * Bloco "Arquivo" do molde: colunas e escolha do arquivo no corpo, modelos
 * para baixar na faixa do título.
 */
export function ImportFileBlock({ templates, children }: { templates?: ReactNode; children: ReactNode }) {
  return (
    <Block title="Arquivo" headingLevel={3} aside={templates}>
      <div className="app-import-file">{children}</div>
    </Block>
  )
}

type FilePickerProps = {
  accept: string
  multiple?: boolean
  /** Arquivos já escolhidos; o seletor os mostra no lugar do convite. */
  files: readonly File[]
  onFiles: (files: File[]) => void
  disabled?: boolean
  /** Por que ainda não dá para escolher (por exemplo, falta a viagem). */
  disabledReason?: ReactNode
  label?: string
  /**
   * O parser lê o arquivo pela posição das células, inclusive linhas e abas
   * ocultas (B/L COSCO): o aviso diz que elas são lidas, não que foram ignoradas.
   */
  positional?: boolean
}

/**
 * Área de arquivo com clique e arraste. O `<input type="file">` continua real
 * e focável (visualmente oculto): o teclado e os leitores de tela usam o
 * controle nativo, e o valor é limpo a cada escolha para que reenviar o mesmo
 * arquivo depois de corrigido leia de novo.
 */
export function ImportFilePicker({
  accept,
  multiple = false,
  files,
  onFiles,
  disabled = false,
  disabledReason,
  label = 'Arquivo',
  positional = false,
}: FilePickerProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const statusId = `${id}-status`
  const reasonId = `${id}-reason`
  const [dragging, setDragging] = useState(false)
  const formats = describeAccept(accept)
  const readsSpreadsheet = /\.(xlsx|xls|csv)\b/i.test(accept)
  // Chave estável: vários modais passam `[file]` novo a cada render. Os avisos
  // valem só para os arquivos para os quais foram lidos.
  const filesKey = files.map((file) => `${file.name}:${file.size}:${file.lastModified}`).join('|')
  const [readResult, setReadResult] = useState<{ key: string; warnings: string[] } | null>(null)
  const readWarnings = readResult && readResult.key === filesKey ? readResult.warnings : []
  const [filesToRead, setFilesToRead] = useState<{ key: string; files: readonly File[] }>({ key: '', files: [] })
  if (filesToRead.key !== filesKey) setFilesToRead({ key: filesKey, files })

  // Avisos de leitura comuns a toda planilha (ADR 0078, item 22): linhas e
  // abas ocultas ignoradas e CSV Windows-1252. Erros ficam com o parser.
  useEffect(() => {
    const { key, files: chosen } = filesToRead
    if (!readsSpreadsheet || !chosen.length) return
    let active = true
    void Promise.all(chosen.map(async (file) => {
      const warnings = await readSpreadsheetWarnings(file, { positional })
      return chosen.length > 1 ? warnings.map((warning) => `${file.name}: ${warning}`) : warnings
    })).then((lists) => {
      if (active) setReadResult({ key, warnings: lists.flat() })
    })
    return () => { active = false }
  }, [filesToRead, readsSpreadsheet, positional])

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (chosen.length) onFiles(chosen)
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    if (disabled) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)
    if (disabled) return
    const dropped = Array.from(event.dataTransfer.files ?? [])
    if (dropped.length) onFiles(multiple ? dropped : dropped.slice(0, 1))
  }

  const describedBy = [hintId, files.length ? statusId : null, disabled && disabledReason ? reasonId : null].filter(Boolean).join(' ')

  return (
    <div className="app-import-picker">
      <span className="app-field__label" aria-hidden="true">{label}</span>
      <label
        className={cn(
          'app-import-drop',
          dragging && 'app-import-drop--dragging',
          disabled && 'app-import-drop--disabled',
          files.length > 0 && 'app-import-drop--filled',
        )}
        onDragOver={handleDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <input
          type="file"
          className="sr-only"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          aria-label={`${label} (${formats})`}
          aria-describedby={describedBy || undefined}
          onChange={handleChange}
        />
        <FileUp size={20} aria-hidden="true" className="app-import-drop__icon" />
        {files.length ? (
          <span className="app-import-drop__body" id={statusId}>
            <span className="app-import-drop__file">
              {files.length === 1 ? files[0].name : `${files.length} arquivos escolhidos`}
            </span>
            <span className="app-import-drop__meta">
              <span>
                {files.length === 1
                  ? formatFileSize(files[0].size)
                  : files.slice(0, 3).map((file) => file.name).join(', ') + (files.length > 3 ? ` e mais ${files.length - 3}` : '')}
              </span>
              <span> · solte outro arquivo aqui para trocar</span>
            </span>
          </span>
        ) : (
          <span className="app-import-drop__body">
            <span className="app-import-drop__cta">Arraste {multiple ? 'os arquivos' : 'o arquivo'} para cá</span>
            <span className="app-import-drop__meta">ou escolha no computador</span>
          </span>
        )}
        <span className="app-import-drop__swap" aria-hidden="true">
          {files.length ? 'Trocar arquivo' : multiple ? 'Escolher arquivos' : 'Escolher arquivo'}
        </span>
      </label>
      <span id={hintId} className="app-field__hint">
        {formats} · {uploadLimitLabel()}{multiple ? ' · um ou vários de uma vez' : ''}
      </span>
      {disabled && disabledReason ? <span id={reasonId} className="app-import-picker__reason">{disabledReason}</span> : null}
      {readWarnings.length ? (
        <ImportNotice tone="warning" role="status" title="Avisos de leitura do arquivo">
          <ul className="app-import-notice__list">
            {readWarnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </ImportNotice>
      ) : null}
    </div>
  )
}

type NoticeTone = 'danger' | 'warning' | 'info' | 'success'

const NOTICE_ICONS = {
  danger: XCircle,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle2,
} as const

/** Aviso com estado em texto e ícone, não só na cor. */
export function ImportNotice({
  tone,
  title,
  children,
  role,
  className,
}: {
  tone: NoticeTone
  title?: ReactNode
  children?: ReactNode
  role?: 'alert' | 'status'
  className?: string
}) {
  const Icon = NOTICE_ICONS[tone]
  return (
    <div className={cn('app-import-notice', `app-import-notice--${tone}`, className)} role={role}>
      <Icon size={16} aria-hidden="true" className="app-import-notice__icon" />
      <div className="app-import-notice__content">
        {title ? <p className="app-import-notice__title">{title}</p> : null}
        {children ? <div className="app-import-notice__body">{children}</div> : null}
      </div>
    </div>
  )
}

/**
 * Modelo padrão para baixar, como botão (regra 9; lote 6a): toda importação
 * tem um. Vai na faixa do bloco Arquivo.
 */
export function ImportTemplateLinks({ baseName, extensions = ['xlsx', 'csv'] }: { baseName: string; extensions?: string[] }) {
  return (
    <span className="app-import-templates">
      {extensions.map((extension) => (
        <a
          key={extension}
          className="app-btn app-btn--ghost app-btn--sm"
          href={`/templates/${baseName}.${extension}`}
          download={`${baseName}.${extension}`}
          aria-label={`Baixar modelo .${extension}`}
        >
          <Download size={14} aria-hidden="true" />
          Modelo .{extension}
        </a>
      ))}
    </span>
  )
}

/**
 * Instrução indispensável primeiro (colunas obrigatórias); o resto fica em
 * "Como preencher", aberto só por quem precisa.
 */
export function ImportGuide({
  required,
  optional,
  details,
  templates,
  requiredLabel = 'Colunas obrigatórias',
}: {
  required: ReactNode
  optional?: ReactNode
  details?: ReactNode
  templates?: ReactNode
  requiredLabel?: string
}) {
  return (
    <div className="app-import-guide">
      <FactList columns={optional ? 2 : 1}>
        <Fact label={requiredLabel}>{required}</Fact>
        {optional ? <Fact label="Opcionais">{optional}</Fact> : null}
      </FactList>
      {details ? (
        <details className="app-import-guide__details">
          <summary>Como preencher</summary>
          <div className="app-import-guide__details-body">{details}</div>
        </details>
      ) : null}
      {templates}
    </div>
  )
}

/** Destino da importação (Viagem, B/L), lido antes do arquivo. */
export function ImportContext({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="app-import-context">
      <span className="app-import-context__label">{label}</span>
      <span className="app-import-context__value">{children}</span>
    </p>
  )
}

/** Frase de estado no rodapé, ao lado do botão que confirma. */
export function ImportFootnote({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'warning' | 'success' }) {
  return (
    <p className={cn('app-import-footnote', tone !== 'default' && `app-import-footnote--${tone}`)} aria-live="polite">
      {children}
    </p>
  )
}

/**
 * Seção da conferência (Prévia, Resultado) como bloco do molde: título na
 * faixa, resumo em `aside`.
 */
export function ImportSection({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <Block title={title} headingLevel={3} aside={aside}>
      <div className="app-import-section">{children}</div>
    </Block>
  )
}

/**
 * Reenvio do mesmo arquivo (ADR 0095, decisão 3): só avisa, nunca bloqueia.
 * O texto vem de `describePreviousImport`.
 */
export function PreviousImportNotice({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <ImportNotice tone="warning" role="status" title="Arquivo já importado">
      <p>{message}</p>
      <p>A importação continua permitida; confira se é mesmo para gravar de novo.</p>
    </ImportNotice>
  )
}

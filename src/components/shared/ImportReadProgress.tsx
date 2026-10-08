import { Loader2 } from 'lucide-react'
import type { FileReadProgress } from '../../hooks/useCancellableFileRead'

/**
 * Fase de leitura. O sistema só sabe quantos arquivos já terminou, não quanto
 * de cada arquivo leu: com vários arquivos a barra conta arquivos; com um só
 * ela é indeterminada, sem porcentagem inventada.
 */
export function ImportReadProgress({ progress }: { progress: FileReadProgress }) {
  if (!progress.total) return null
  const multiple = progress.total > 1
  const current = Math.min(progress.completed + 1, progress.total)

  return (
    <div className="app-import-reading" role="status" aria-live="polite">
      <Loader2 size={18} className="app-import-reading__spinner animate-spin" aria-hidden="true" />
      <div className="app-import-reading__body">
        <p className="app-import-reading__title">
          {multiple ? `Lendo arquivo ${current} de ${progress.total}` : 'Lendo arquivo'}
          {progress.currentFile ? <span className="app-import-reading__file">{progress.currentFile}</span> : null}
        </p>
        <p className="app-import-reading__meta">A prévia aparece aqui ao terminar. Nada é gravado nesta fase.</p>
        {multiple ? (
          <div
            role="progressbar"
            aria-label="Arquivos lidos"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.completed}
            aria-valuetext={`${progress.completed} de ${progress.total} arquivos lidos`}
            className="app-import-reading__bar"
          >
            <span style={{ width: `${(progress.completed / progress.total) * 100}%` }} />
          </div>
        ) : (
          <div role="progressbar" aria-label="Lendo arquivo" className="app-import-reading__bar app-import-reading__bar--indeterminate">
            <span />
          </div>
        )}
      </div>
    </div>
  )
}

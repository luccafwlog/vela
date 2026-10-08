import { Download } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '../ui/Button'
import { hasBlockingIssues, downloadIssuesCsv, sanitizeIssueMessage, type ImportIssue } from '../../services/importValidation'
import { countIssues, issueFieldLabel, plural } from './importPresentation'

/**
 * Erros e avisos por linha. Erro impede a importação (ou exige a decisão
 * explícita do operador); aviso só pede conferência. A severidade aparece em
 * texto em cada linha, não só na cor do painel.
 */
export function ImportIssuesPanel({
  issues,
  filename = 'import-issues.csv',
  title,
  hint,
}: {
  issues: readonly ImportIssue[]
  filename?: string
  /** Substitui o título quando a consequência é outra (ex.: linhas ignoradas). */
  title?: ReactNode
  hint?: ReactNode
}) {
  if (!issues.length) return null
  const blocking = hasBlockingIssues(issues)
  const { errors, warnings } = countIssues(issues)
  const heading = title ?? (blocking
    ? `${plural(errors, 'linha com erro impede', 'linhas com erro impedem')} a importação`
    : `${plural(warnings, 'aviso', 'avisos')} para conferir`)
  const guidance = hint ?? (blocking
    ? 'Corrija na planilha e escolha o arquivo de novo. O relatório lista linha, campo e motivo.'
    : 'Avisos não impedem a importação. Confira antes de confirmar.')

  return (
    <section
      role={blocking ? 'alert' : 'status'}
      aria-label="Problemas encontrados no arquivo"
      className={`app-import-issues app-import-issues--${blocking ? 'danger' : 'warning'}`}
    >
      <div className="app-import-issues__head">
        <div>
          <p className="app-import-issues__title">{heading}</p>
          <p className="app-import-issues__hint">{guidance}</p>
        </div>
        <Button variant="secondary" onClick={() => downloadIssuesCsv(filename, issues)}>
          <Download size={15} aria-hidden="true" />
          Baixar relatório completo
        </Button>
      </div>
      <p className="app-import-issues__count">
        {plural(errors, 'erro', 'erros')} · {plural(warnings, 'aviso', 'avisos')}
      </p>
      <ol aria-label="Relatório completo da importação" className="app-import-issues__list">
        {issues.map((issue, index) => {
          const field = issueFieldLabel(issue.field)
          return (
            <li key={`${issue.row}-${issue.field}-${issue.code}-${index}`} className="app-import-issues__item">
              <span className={`app-import-issues__tag app-import-issues__tag--${issue.severity}`}>
                {issue.severity === 'error' ? 'Erro' : 'Aviso'}
              </span>
              <span className="app-import-issues__where">Linha {issue.row}{field ? ` · ${field}` : ''}</span>
              <span className="app-import-issues__message">{sanitizeIssueMessage(issue.message)}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

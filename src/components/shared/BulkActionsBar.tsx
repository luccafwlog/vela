import type { ReactNode } from 'react'
import { Trash2, X } from 'lucide-react'
import { Button } from '../ui/Button'

type BulkActionsBarProps = {
  count: number
  onClear: () => void
  onDelete?: () => void
  deleting?: boolean
  /** Singular/plural do rotulo da entidade, ex: ['veiculo', 'veiculos']. */
  noun: [string, string]
  /** Acoes adicionais renderizadas antes do botao de exclusao. */
  extraActions?: ReactNode
}

/**
 * Barra de acoes em massa exibida quando ha linhas selecionadas. Apenas
 * apresentacao: a pagina decide o que fazer em `onDelete`/`onClear`.
 */
export function BulkActionsBar({ count, onClear, onDelete, deleting, noun, extraActions }: BulkActionsBarProps) {
  if (count === 0) return null

  const label = `${count} ${count === 1 ? noun[0] : noun[1]} selecionado${count === 1 ? '' : 's'}`

  // Fica fixa no topo da área rolável: a seleção continua visível enquanto o
  // usuário desce a lista marcando linhas.
  return (
    <div className="app-bulk-bar" role="region" aria-label="Ações em massa">
      <span className="app-bulk-bar__count" aria-live="polite">{label}</span>
      <div className="app-bulk-bar__actions">
        <Button variant="ghost" onClick={onClear} disabled={deleting}>
          <X size={15} />
          Limpar seleção
        </Button>
        {extraActions}
        {onDelete ? (
          <Button variant="danger" onClick={onDelete} loading={deleting}>
            <Trash2 size={15} />
            Excluir selecionados
          </Button>
        ) : null}
      </div>
    </div>
  )
}

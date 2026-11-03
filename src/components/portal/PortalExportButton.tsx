import { Download } from 'lucide-react'
import { Button } from '../ui/Button'

/**
 * "Exportar Excel" na faixa do bloco da lista do Portal, ao lado da contagem
 * (B/Ls e containers; Faturas desde 2026-11-02).
 */
export function PortalExportButton({ onClick, disabled = false, loading = false }: { onClick: () => void; disabled?: boolean; loading?: boolean }) {
  return (
    <Button variant="secondary" className="app-btn--sm" onClick={onClick} disabled={disabled} loading={loading}>
      <Download size={14} aria-hidden="true" />
      Exportar Excel
    </Button>
  )
}

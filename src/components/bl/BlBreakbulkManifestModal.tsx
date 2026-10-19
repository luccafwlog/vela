import { BreakbulkManifestImportModal } from '../shared/BreakbulkManifestImportModal'

/**
 * Importar manifesto BB, aberto pelo menu Importar de /bls. É o mesmo modal da
 * aba da Viagem (`BreakbulkManifestImportModal`, A1 do lote 6a); aqui a viagem
 * é escolhida no próprio modal.
 */
export function BreakbulkManifestUploadModal({
  open,
  onClose,
  defaultVoyageId,
}: {
  open: boolean
  onClose: () => void
  defaultVoyageId?: string
}) {
  if (!open) return null
  return <BreakbulkManifestImportModal defaultVoyageId={defaultVoyageId} onClose={onClose} />
}

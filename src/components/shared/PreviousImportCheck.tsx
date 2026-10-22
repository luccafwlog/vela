import { useImportFileReceipt } from '../../hooks/useImportFileReceipt'
import type { ImportFileKind } from '../../services/importFileReceipt'
import { PreviousImportNotice } from './ImportParts'

/**
 * Aviso de reenvio na prévia (ADR 0095, decisão 3): o mesmo arquivo já
 * gravado para esta Viagem e este tipo de importação. Só avisa.
 */
export function PreviousImportCheck({ kind, voyageId, files }: {
  kind: ImportFileKind
  voyageId: number | null | undefined
  files: readonly File[]
}) {
  const { previousImportMessage } = useImportFileReceipt(kind, voyageId, files)
  return <PreviousImportNotice message={previousImportMessage} />
}

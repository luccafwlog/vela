import { useEffect, useState } from 'react'
import {
  describePreviousImport,
  findPreviousImport,
  importFilesName,
  importFilesSha256,
  type ImportFileKind,
  type PreviousImport,
} from '../services/importFileReceipt'

/**
 * Nome e hash do arquivo escolhido e o aviso de reenvio (ADR 0095, decisão 3).
 * O hash sai do navegador antes da prévia; a consulta procura a gravação
 * anterior do mesmo arquivo para a mesma Viagem e o mesmo tipo de importação.
 * O aviso nunca bloqueia: falha ao calcular ou consultar só deixa sem aviso.
 * ponytail: estado local, não React Query; a consulta é refeita a cada escolha
 * de arquivo e não precisa de invalidação depois da gravação.
 */
export function useImportFileReceipt(kind: ImportFileKind, voyageId: number | null | undefined, files: readonly File[]) {
  // Identifica a escolha: o array muda de identidade a cada render.
  const fileKey = files.map((file) => `${file.name}:${file.size}:${file.lastModified}`).join('|')
  const [hashed, setHashed] = useState<{ key: string; hash: string | null }>({ key: '', hash: null })
  const fileHash = fileKey && hashed.key === fileKey ? hashed.hash : null

  useEffect(() => {
    if (!files.length) return undefined
    let alive = true
    importFilesSha256(files)
      .then((hash) => { if (alive) setHashed({ key: fileKey, hash }) })
      .catch(() => { if (alive) setHashed({ key: fileKey, hash: null }) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey])

  const lookupKey = voyageId && fileHash ? `${kind}|${voyageId}|${fileHash}` : ''
  const [found, setFound] = useState<{ key: string; previous: PreviousImport | null }>({ key: '', previous: null })
  const previousImport = lookupKey && found.key === lookupKey ? found.previous : null

  useEffect(() => {
    if (!lookupKey || !voyageId || !fileHash) return undefined
    let alive = true
    findPreviousImport(kind, voyageId, fileHash)
      .then((previous) => { if (alive) setFound({ key: lookupKey, previous }) })
      .catch(() => { if (alive) setFound({ key: lookupKey, previous: null }) })
    return () => { alive = false }
  }, [lookupKey, kind, voyageId, fileHash])

  return {
    fileHash,
    filename: importFilesName(files),
    previousImport,
    previousImportMessage: previousImport ? describePreviousImport(previousImport) : null,
  }
}

import { supabase } from './supabase'
import { formatDateTimeBR } from '../lib/utils'

/**
 * Hash do arquivo importado (ADR 0095, decisão 3; migration 405). Toda
 * importação por arquivo que grava lote leva nome e SHA-256 do arquivo ao
 * servidor; o reenvio do mesmo arquivo para a mesma Viagem e o mesmo tipo de
 * importação só avisa na prévia. Nenhum arquivo é guardado, só o hash.
 */
export type ImportFileKind = 'arquivo_bl' | 'manifesto_bb' | 'granito' | 'vazios_exportacao' | 'vazios_importacao'

export type PreviousImport = { uploadedAt: string | null; uploadedByName: string; filename: string | null }

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('O navegador não calcula a assinatura do arquivo.')
  return hex(await subtle.digest('SHA-256', bytes as BufferSource))
}

/**
 * SHA-256 do arquivo, em 64 hexadecimais minúsculos. Vários arquivos numa
 * importação só (arquivo de B/L): o hash do conjunto, sobre os hashes de cada
 * arquivo em ordem, para que a mesma escolha em outra ordem seja o mesmo envio.
 */
export async function importFilesSha256(files: readonly Blob[]): Promise<string | null> {
  if (!files.length) return null
  const each = await Promise.all(files.map(async (file) => sha256Hex(await file.arrayBuffer())))
  if (each.length === 1) return each[0]
  return sha256Hex(new TextEncoder().encode([...each].sort().join('\n')))
}

/** Nome gravado no lote: o arquivo, ou o primeiro e quantos mais vieram junto. */
export function importFilesName(files: readonly { name: string }[]): string | null {
  if (!files.length) return null
  return files.length === 1 ? files[0].name : `${files[0].name} e mais ${files.length - 1}`
}

export async function findPreviousImport(kind: ImportFileKind, voyageId: number, fileHash: string): Promise<PreviousImport | null> {
  const { data, error } = await supabase.rpc('import_file_previous_upload' as never, {
    p_kind: kind,
    p_voyage_id: voyageId,
    p_file_hash: fileHash,
  } as never)
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as { uploaded_at?: string | null; uploaded_by_name?: string | null; filename?: string | null } | null | undefined
  if (!row) return null
  return { uploadedAt: row.uploaded_at ?? null, uploadedByName: row.uploaded_by_name || 'usuário sem nome', filename: row.filename ?? null }
}

export function describePreviousImport(previous: PreviousImport): string {
  const when = previous.uploadedAt ? formatDateTimeBR(previous.uploadedAt) : 'data não registrada'
  return `Este arquivo já foi importado em ${when} por ${previous.uploadedByName}.`
}

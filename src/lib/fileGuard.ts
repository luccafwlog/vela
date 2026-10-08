// Limite padrão para uploads de planilhas (10 MB).
// Acima disso o parser do XLSX consome memória rápido demais e pode
// derrubar a aba do navegador — usado como salvaguarda contra DoS.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export function assertUploadSize(file: File, maxBytes: number = MAX_UPLOAD_BYTES) {
  if (file.size > maxBytes) {
    const limitMb = (maxBytes / 1_048_576).toFixed(0)
    throw new Error(
      `Arquivo muito grande (${(file.size / 1_048_576).toFixed(1)} MB). O limite é ${limitMb} MB.`,
    )
  }
}

export function assertUploadFile(
  file: File,
  allowedExtensions: readonly string[],
  maxBytes: number = MAX_UPLOAD_BYTES,
): void {
  assertUploadSize(file, maxBytes)

  const extension = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : ''
  const allowed = allowedExtensions.map((item) => item.replace(/^\./, '').toLowerCase())
  if (!extension || !allowed.includes(extension)) {
    const received = extension ? `.${extension}` : 'sem extensão'
    const expected = allowed.map((item) => `.${item}`).join(', ')
    throw new Error(`Formato de arquivo não suportado (${received}). Formatos aceitos: ${expected}.`)
  }
}

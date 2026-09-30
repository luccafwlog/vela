// Tipo declarado pelo navegador confere com o conteúdo (magic bytes) e com a
// extensão do nome. Usado por anexos de Dispute e de Comunicado.
//
// ponytail: só os 4 tipos permitidos; não inspeciona macros ou embeds em PDF.
// Upgrade: antivírus assíncrono se houver visualização inline.
const EXTENSIONS: Record<string, readonly string[]> = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'text/plain': ['txt'],
}

export function matchesMagicBytes(buffer: Uint8Array, mime: string): boolean {
  if (buffer.length < 4) return false
  if (mime === 'application/pdf') {
    return buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46 // %PDF
  }
  if (mime === 'image/png') {
    return buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47
  }
  if (mime === 'image/jpeg') {
    return buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF
  }
  if (mime === 'text/plain') {
    const slice = buffer.subarray(0, Math.min(buffer.length, 512))
    return !slice.includes(0x00)
  }
  return false
}

export function matchesExtension(fileName: string, mime: string): boolean {
  const extension = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  return Boolean(extension && EXTENSIONS[mime]?.includes(extension))
}

/** Primeiros bytes de um base64 sem decodificar o arquivo inteiro. */
export function base64Head(contentBase64: string, bytes = 512): Uint8Array {
  const chars = Math.ceil(bytes / 3) * 4
  const binary = atob(contentBase64.slice(0, chars))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

/**
 * Baixa um arquivo gerado no navegador. A URL do Blob só é revogada depois do
 * clique: revogar na mesma volta pode cancelar o download em alguns navegadores.
 */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

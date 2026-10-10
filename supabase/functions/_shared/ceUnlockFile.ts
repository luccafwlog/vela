export const CE_PDF_MAX_BYTES = 10 * 1024 * 1024;
export function validateCePdf(
  name: string,
  mime: string,
  bytes: Uint8Array,
): void {
  if (
    mime !== "application/pdf" ||
    !/\.pdf$/i.test(name) ||
    bytes.length < 5 ||
    bytes.length > CE_PDF_MAX_BYTES ||
    new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-"
  )
    throw new Error("Use PDF válido de até 10 MiB.");
}
export const CE_DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
/** Modelo do termo publicado pelo desk: o cliente baixa e preenche no editor de texto. */
export function validateCeModelDocx(
  name: string,
  mime: string,
  bytes: Uint8Array,
): void {
  // Navegador sem Office instalado pode não conhecer o tipo do .docx; o conteúdo decide.
  // ponytail: confere assinatura ZIP e a parte word/document.xml, não abre o pacote.
  const zip =
    bytes.length >= 4 &&
    bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (
    ![CE_DOCX_MIME, "", "application/octet-stream"].includes(mime) ||
    !/\.docx$/i.test(name) ||
    bytes.length > CE_PDF_MAX_BYTES ||
    !zip ||
    !new TextDecoder("latin1").decode(bytes).includes("word/document.xml")
  )
    throw new Error("Use DOCX válido de até 10 MiB.");
}
/** O modelo é DOCX; tudo o que o cliente anexa (termo, procuração, anuais) é PDF. */
export function validateCeUpload(
  source: unknown,
  name: string,
  mime: string,
  bytes: Uint8Array,
): string {
  if (source === "model") {
    validateCeModelDocx(name, mime, bytes);
    return CE_DOCX_MIME;
  }
  validateCePdf(name, mime, bytes);
  return "application/pdf";
}
export async function readCeMultipart(req: Request): Promise<FormData> {
  const max = CE_PDF_MAX_BYTES + 64 * 1024;
  if (Number(req.headers.get("content-length") ?? 0) > max || !req.body)
    throw new Error("Arquivo acima do limite.");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw new Error("Arquivo acima do limite.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new Response(bytes, {
    headers: { "content-type": req.headers.get("content-type") ?? "" },
  }).formData();
}

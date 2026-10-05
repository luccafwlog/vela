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

export const BODY_TOO_LARGE = "Arquivo acima do limite.";

/**
 * Lê o corpo multipart contando os bytes que chegam e para no limite, mesmo sem
 * Content-Length (corpo em streaming): `req.formData()` sozinho leria tudo.
 */
export async function readBoundedMultipart(req: Request, maxBytes: number): Promise<FormData> {
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes || !req.body) {
    throw new Error(BODY_TOO_LARGE);
  }
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error(BODY_TOO_LARGE);
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

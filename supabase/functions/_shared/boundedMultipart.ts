import { BODY_TOO_LARGE, readBoundedBytes } from "./boundedBody.ts";

export { BODY_TOO_LARGE };

/**
 * Lê o corpo multipart contando os bytes que chegam e para no limite, mesmo sem
 * Content-Length (corpo em streaming): `req.formData()` sozinho leria tudo.
 */
export async function readBoundedMultipart(req: Request, maxBytes: number): Promise<FormData> {
  if (!req.body) throw new Error(BODY_TOO_LARGE);
  const bytes = await readBoundedBytes(req, maxBytes);
  return new Response(bytes, {
    headers: { "content-type": req.headers.get("content-type") ?? "" },
  }).formData();
}

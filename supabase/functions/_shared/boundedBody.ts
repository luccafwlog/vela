// Leitura do corpo da requisição com teto de bytes (auditoria run-3, P6 e
// reforços seguintes). `req.text()`, `req.json()` e `req.formData()` leem o
// corpo inteiro antes de qualquer conferência; aqui a contagem acompanha o
// stream e para no limite, com ou sem Content-Length.

export const BODY_TOO_LARGE = "Corpo da requisição acima do limite.";

/** Teto das Edges que recebem só um JSON pequeno (ações, token, senha, motivo). */
export const SMALL_JSON_MAX_BYTES = 16 * 1024;

export function isBodyTooLarge(error: unknown): boolean {
  return error instanceof Error && error.message === BODY_TOO_LARGE;
}

/** Bytes do corpo; acima de `maxBytes` lança `BODY_TOO_LARGE` sem ler o resto. */
export async function readBoundedBytes(req: Request, maxBytes: number): Promise<Uint8Array> {
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) throw new Error(BODY_TOO_LARGE);
  if (!req.body) return new Uint8Array(0);
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
  return bytes;
}

/** Texto UTF-8 do corpo, com o mesmo teto de `readBoundedBytes`. */
export async function readBoundedText(req: Request, maxBytes: number): Promise<string> {
  return new TextDecoder().decode(await readBoundedBytes(req, maxBytes));
}

export type BoundedJsonBody = { tooLarge: true } | { tooLarge: false; value: unknown };

/**
 * JSON do corpo com teto. Corpo acima do limite volta `tooLarge` (a Edge
 * responde 413); JSON ausente ou inválido vira `{}`, o mesmo que o
 * `req.json().catch(() => ({}))` que esta leitura substitui, para que cada
 * Edge mantenha a resposta de dado inválido que já dava.
 */
export async function readBoundedJsonBody(req: Request, maxBytes: number): Promise<BoundedJsonBody> {
  let text: string;
  try {
    text = await readBoundedText(req, maxBytes);
  } catch (error) {
    if (isBodyTooLarge(error)) return { tooLarge: true };
    return { tooLarge: false, value: {} };
  }
  try {
    return { tooLarge: false, value: JSON.parse(text) };
  } catch {
    return { tooLarge: false, value: {} };
  }
}

export function validCleanupAuthorization(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const expected = new TextEncoder().encode(`Bearer ${secret}`);
  const received = new TextEncoder().encode(header);
  let difference = expected.length ^ received.length;
  for (let i = 0; i < expected.length; i++) difference |= expected[i] ^ (received[i] ?? 0);
  return difference === 0;
}

/**
 * Bearer de rotina com segredo próprio (auditoria run-3, decisão do dono de
 * 2026-10-22: um segredo por rotina). Enquanto o próprio não estiver
 * cadastrado na Edge, vale o segredo que a rotina dividia com outra; depois,
 * só o próprio. Os secrets das Edge Functions valem para o projeto inteiro, e
 * o compartilhado continua de outra rotina: aceitá-lo para sempre não
 * separaria nada.
 */
export function validDedicatedAuthorization(
  header: string | null,
  own: string | undefined,
  shared: string | undefined,
): boolean {
  return own ? validCleanupAuthorization(header, own) : validCleanupAuthorization(header, shared);
}

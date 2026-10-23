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
 * 2026-10-22: um segredo por rotina). Sem o próprio, vale o segredo que a
 * rotina dividia com outra. Com o próprio cadastrado, o compartilhado ainda
 * vale até `sharedRetired`: o cron escolhe o segredo pelo Vault e a Edge pelos
 * secrets, e aceitar os dois na troca evita rodada recusada entre os dois
 * cadastros. Os secrets das Edge Functions valem para o projeto inteiro e o
 * compartilhado continua de outra rotina, por isso a transição termina com a
 * aposentadoria explícita, não com a exclusão dele.
 */
export function validDedicatedAuthorization(
  header: string | null,
  own: string | undefined,
  shared: string | undefined,
  sharedRetired = false,
): boolean {
  if (own && validCleanupAuthorization(header, own)) return true;
  if (own && sharedRetired) return false;
  return validCleanupAuthorization(header, shared);
}

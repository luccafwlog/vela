export function validCleanupAuthorization(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const expected = new TextEncoder().encode(`Bearer ${secret}`);
  const received = new TextEncoder().encode(header);
  let difference = expected.length ^ received.length;
  for (let i = 0; i < expected.length; i++) difference |= expected[i] ^ (received[i] ?? 0);
  return difference === 0;
}

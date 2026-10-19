// Chave de idempotência da tentativa de Comunicado (plano dos e-mails, 5.1).
// A chave nova leva o hash do destinatário (recipientKey), não o e-mail em
// claro; ela também compõe a Idempotency-Key enviada ao provedor. Tentativas
// gravadas antes guardam a chave com o e-mail: se existir uma, ela continua
// sendo usada, para a nova chamada achar a mesma tentativa e não duplicar o
// envio.
import { recipientKey } from './email.ts'

export function legacyCommunicationAttemptKey(communicationId: number, attemptDiscriminator: number, recipient: string): string {
  return `comunicado:${communicationId}:${attemptDiscriminator}:${recipient.trim().toLowerCase()}`
}

export async function communicationAttemptKey(communicationId: number, attemptDiscriminator: number, recipient: string): Promise<string> {
  return `comunicado:${communicationId}:${attemptDiscriminator}:${await recipientKey(recipient)}`
}

export async function resolveCommunicationAttemptKey(
  input: { communicationId: number; attemptDiscriminator: number; recipient: string },
  attemptExists: (idempotencyKey: string) => Promise<boolean>,
): Promise<string> {
  const legacy = legacyCommunicationAttemptKey(input.communicationId, input.attemptDiscriminator, input.recipient)
  if (await attemptExists(legacy)) return legacy
  return communicationAttemptKey(input.communicationId, input.attemptDiscriminator, input.recipient)
}

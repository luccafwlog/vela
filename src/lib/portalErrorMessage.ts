import { classifyDbError } from './errors'

function errorMessage(error: unknown): string {
  return typeof error === 'object' && error ? String((error as { message?: unknown }).message ?? '') : ''
}

export function portalErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error && (error as { isUserSafe?: boolean }).isUserSafe && (error as Error).message) {
    return (error as Error).message
  }

  const classified = classifyDbError(error)
  if (classified.kind !== 'desconhecido') return classified.message

  const msg = errorMessage(error)
  const lower = msg.toLowerCase()
  if ((lower.includes('new password') && lower.includes('different')) || lower.includes('same password')) {
    return 'A nova senha deve ser diferente da senha atual.'
  }

  if (
    msg.includes('Quota de armazenamento') ||
    msg.includes('Limite diário') ||
    msg.includes('Apenas o autor da mensagem') ||
    msg.includes('Anexo inválido') ||
    msg.includes('Tipo de anexo não permitido') ||
    msg.includes('Conteúdo do arquivo não corresponde') ||
    msg.includes('Upload de anexo indisponível') ||
    msg.includes('Sua mensagem foi registrada, mas o anexo')
  ) {
    return msg
  }

  return fallback
}

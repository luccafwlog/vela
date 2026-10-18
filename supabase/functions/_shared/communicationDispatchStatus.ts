// Status final de um Comunicado depois de um envio (Comunicados e Régua de
// Cobrança). O banco recalcula pelas tentativas
// (`refresh_customer_communication_status`); aqui se decide o que fazer
// quando ele não consegue decidir. Plano dos e-mails, item 1B.

export type CommunicationDispatchStatus = 'pendente' | 'enviado' | 'simulado' | 'parcial' | 'falha'

export type ResolveDispatchStatusInput = {
  /** Retorno de `refresh_customer_communication_status`. */
  refreshed: unknown
  communicationsEnabled: boolean
  /** Destinatários com envio aceito nesta execução (real ou simulado, conforme a chave). */
  succeeded: number
  /** Destinatários cuja tentativa ficou registrada como falha. */
  failed: number
  /** Destinatários que falharam sem tentativa registrada (exceção antes ou durante o registro). */
  unrecordedFailures?: number
}

function asStatus(value: unknown): CommunicationDispatchStatus | null {
  return value === 'pendente' || value === 'enviado' || value === 'simulado' || value === 'parcial' || value === 'falha'
    ? value
    : null
}

export type ResolvedDispatchStatus = Exclude<CommunicationDispatchStatus, 'pendente'>

export function resolveDispatchStatus(input: ResolveDispatchStatusInput): ResolvedDispatchStatus {
  const refreshed = asStatus(input.refreshed)

  // Um destinatário que nem chegou a registrar tentativa é invisível para o
  // banco: sem isto, o Comunicado ficaria "enviado" com alguém sem e-mail, e
  // a produtora nunca tentaria de novo.
  if ((input.unrecordedFailures ?? 0) > 0) {
    return refreshed === 'enviado' || refreshed === 'simulado' || refreshed === 'parcial' ? 'parcial' : 'falha'
  }

  if (refreshed === 'enviado' || refreshed === 'parcial' || refreshed === 'falha') return refreshed
  // Com a chave ligada, "simulado" nunca é resposta válida: seria o marcador
  // antigo de um envio que não se concluiu.
  if (refreshed === 'simulado' && !input.communicationsEnabled) return 'simulado'

  // O banco não decidiu (sem tentativa, ou tentativa aceita sem id do provedor).
  if (input.succeeded > 0 && input.failed > 0) return 'parcial'
  if (input.succeeded > 0) return input.communicationsEnabled ? 'enviado' : 'simulado'
  return 'falha'
}

/** Status que precisa ser gravado porque o banco ficou para trás; null quando o banco já está certo. */
export function statusToPersist(refreshed: unknown, resolved: ResolvedDispatchStatus): 'parcial' | 'falha' | null {
  if (asStatus(refreshed) === resolved) return null
  return resolved === 'falha' || resolved === 'parcial' ? resolved : null
}

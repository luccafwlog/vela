import { formatCnpjCpf, formatDate } from './utils'
import type { AccountSituation, PortalDeliveryStatus, ProvisioningDecision, QueueRow, RecoveryEmailSource, RecoveryEmailStatus, EmailCandidate } from '../services/portalProvisioning'

const DECISION_LABELS: Record<ProvisioningDecision, string> = {
  aguardando_analise: 'Aguardando análise',
  aprovado_para_provisionar: 'Provisionamento autorizado',
}
const SITUATION_LABELS: Record<AccountSituation, string> = {
  sem_conta: 'Sem conta', convite_pendente: 'Ativação pendente', convite_expirado: 'Convite expirado',
  falha_no_envio: 'Falha no envio', ativo: 'Ativa', suspenso: 'Suspensa',
}
const SOURCE_LABELS: Record<RecoveryEmailSource, string> = {
  candidato: 'Candidato', informado_manualmente: 'Informado manualmente',
}
const PURPOSE_LABELS: Record<EmailCandidate['purpose'], string> = {
  geral: 'Geral', financeiro: 'Financeiro', operacional: 'Operacional', faturamento: 'Faturamento',
}
const DELIVERY_LABELS: Record<PortalDeliveryStatus, string> = {
  aceito: 'Aceito pelo provedor', nao_confirmado: 'Não confirmado', entregue: 'Entregue', bounce: 'Devolvido', complaint: 'Reclamação',
  falha_transitoria: 'Falha temporária', falha_permanente: 'Falha permanente',
}

const RECOVERY_EMAIL_STATUS_LABELS: Record<RecoveryEmailStatus, string> = {
  ok: 'Em ordem', bounce_permanente: 'Devolvido em definitivo', complaint: 'Marcado como spam',
}

export function provisioningDecisionLabel(value: string | null | undefined) { return value && value in DECISION_LABELS ? DECISION_LABELS[value as ProvisioningDecision] : 'Não informado' }
export function accountSituationLabel(value: string | null | undefined) { return value && value in SITUATION_LABELS ? SITUATION_LABELS[value as AccountSituation] : 'Não informado' }
export function recoveryEmailSourceLabel(value: string | null | undefined) { return value && value in SOURCE_LABELS ? SOURCE_LABELS[value as RecoveryEmailSource] : 'Não informado' }
export function contactPurposeLabel(value: string | null | undefined) { return value && value in PURPOSE_LABELS ? PURPOSE_LABELS[value as EmailCandidate['purpose']] : 'Não informado' }
export function deliveryStatusLabel(value: string | null | undefined) { return value && value in DELIVERY_LABELS ? DELIVERY_LABELS[value as PortalDeliveryStatus] : 'Não informado' }
export function recoveryEmailStatusLabel(value: string | null | undefined) { return value && value in RECOVERY_EMAIL_STATUS_LABELS ? RECOVERY_EMAIL_STATUS_LABELS[value as RecoveryEmailStatus] : 'Não informado' }

// A conta segue funcionando -- o cliente entra com a senha --, mas a
// recuperação de senha não chega mais. É um fato independente da situação da
// conta, e por isso tem coluna própria em vez de rebaixar `account_situation`.
export function hasBrokenRecoveryEmail(row: Pick<QueueRow, 'recoveryEmailStatus' | 'recoveryEmailSuppressed'>): boolean {
  return row.recoveryEmailSuppressed || (row.recoveryEmailStatus !== null && row.recoveryEmailStatus !== 'ok')
}

// Espelha o lado do Portal de `customer_billing_access_ready` (ADR 0054/0070):
// conta ativa com Email de Recuperação utilizável. O banco é a autoridade; esta
// leitura só decide o texto da Liberação de faturamento sem Portal.
export function isPortalReadyForBilling(row: Pick<QueueRow, 'account_situation' | 'recovery_email' | 'recoveryEmailStatus' | 'recoveryEmailSuppressed'>): boolean {
  return row.account_situation === 'ativo' && Boolean(row.recovery_email) && !hasBrokenRecoveryEmail(row)
}

/**
 * A decisão como linha de apoio da situação. Conta ativa com a decisão em
 * Aguardando análise só acontece quando o Administrativo reabre a análise à
 * mão (B/L novo não reabre a análise, migration 343): a tela diz
 * isso em vez de mostrar os dois status lado a lado sem explicação.
 */
export function provisioningDecisionDetail(row: Pick<QueueRow, 'account_situation' | 'provisioning_decision'>): string {
  if (row.account_situation === 'ativo' && row.provisioning_decision === 'aguardando_analise') {
    return 'Análise reaberta; a conta continua ativa até nova decisão'
  }
  return provisioningDecisionLabel(row.provisioning_decision)
}

export function hasPortalPendency(row: Pick<QueueRow, 'account_situation' | 'provisioning_decision'> | null | undefined): boolean {
  if (!row) return false
  return row.account_situation !== 'ativo'
}

/**
 * A ação da linha da fila do Provisionamento (lote 5a): diz o que falta, e o
 * botão abre a linha no bloco certo. Sem e-mail gravado, a escolha depende de
 * haver contato com e-mail ("Escolher e-mail") ou não ("Cadastrar e-mail").
 */
export function getPortalNextAction(row: QueueRow): string {
  if (row.account_situation === 'convite_pendente') return 'Acompanhar convite'
  if (row.account_situation === 'convite_expirado') return 'Reenviar convite'
  if (row.account_situation === 'falha_no_envio') return 'Revisar e-mail e reenviar'
  if (row.account_situation === 'ativo') return hasBrokenRecoveryEmail(row) ? 'Validar e-mail de recuperação' : 'Ver conta'
  if (row.account_situation === 'suspenso') return 'Reativar conta'
  if (row.recovery_email) return 'Enviar convite'
  return row.candidates.length ? 'Escolher e-mail' : 'Cadastrar e-mail'
}

/**
 * O que aconteceu num evento do Portal, em português (lote 5a, achado A6). O
 * motivo gravado pelo sistema ao reparar a fila é texto técnico; os demais
 * motivos são escritos por quem agiu. Sem motivo, a mudança de situação.
 */
export function portalEventDescription(event: { reason: string | null; previous_situation: string | null; new_situation: string | null }): string {
  const reason = event.reason?.trim()
  if (reason === 'Reparo automático da fila do Portal durante a leitura.') return 'Entrou na fila do Portal'
  if (reason) return reason
  if (event.new_situation && event.new_situation !== event.previous_situation) {
    return event.previous_situation
      ? `Conta: ${accountSituationLabel(event.previous_situation)} → ${accountSituationLabel(event.new_situation)}`
      : `Conta: ${accountSituationLabel(event.new_situation)}`
  }
  return 'Evento do Portal'
}

const ACTOR_LABELS: Record<string, string> = {
  sistema: 'Sistema', cliente: 'Cliente', documentacao: 'Documentação', administrativo: 'Administrativo',
}

export function portalEventActorLabel(actorType: string | null | undefined): string | null {
  return actorType ? ACTOR_LABELS[actorType] ?? null : null
}

export function formatPortalCandidate(candidate: EmailCandidate) {
  return `${candidate.email} · ${contactPurposeLabel(candidate.purpose)} · ${candidate.origin}`
}

export function portalProvisioningExportRow(row: QueueRow) {
  return {
    Cliente: row.customer_name,
    CNPJ: formatCnpjCpf(row.cnpj_cpf),
    Decisão: provisioningDecisionLabel(row.provisioning_decision),
    'Situação da conta': accountSituationLabel(row.account_situation),
    'Email de Recuperação': row.recovery_email ?? 'Não informado',
    'Origem do email': recoveryEmailSourceLabel(row.recovery_email_source),
    'Situação da entrega': deliveryStatusLabel(row.latestDeliveryStatus),
    'Vencimento do convite': row.pending_invite_expires_at ? formatDate(row.pending_invite_expires_at) : 'Não informado',
    'Alerta crítico': row.hasCriticalAlert ? 'Sim' : 'Não',
    'Última atividade': row.lastActivityAt ? formatDate(row.lastActivityAt) : 'Não informado',
    'Próxima ação': getPortalNextAction(row),
    'Email compartilhado': row.sharedEmailCount > 0 ? 'Sim' : 'Não',
    'Email de Recuperação bloqueado': row.recoveryEmailSuppressed ? 'Sim' : 'Não',
    'Saúde do Email de Recuperação': recoveryEmailStatusLabel(row.recoveryEmailStatus),
  }
}

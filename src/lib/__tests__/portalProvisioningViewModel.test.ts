import { describe, expect, it } from 'vitest'
import { accountSituationLabel, contactPurposeLabel, deliveryStatusLabel, getPortalNextAction, hasBrokenRecoveryEmail, provisioningDecisionLabel, recoveryEmailSourceLabel } from '../portalProvisioningViewModel'
import type { QueueRow } from '../../services/portalProvisioning'

const row = (partial: Partial<QueueRow> = {}): QueueRow => ({
  account_id: 1, customer_id: 1, customer_name: 'Cliente', cnpj_cpf: '12345678000195',
  provisioning_decision: 'aguardando_analise', account_situation: 'sem_conta', recovery_email: null,
  recovery_email_source: null, pending_invite_expires_at: null, hasCriticalAlert: false,
  hasOpenInvoice: false, hasActiveProcess: false, lastActivityAt: null, candidates: [],
  sharedEmailCount: 0, latestDeliveryStatus: null,
  recoveryEmailStatus: 'ok', recoveryEmailSuppressed: false, ...partial,
})

describe('portalProvisioningViewModel', () => {
  it('traduz todos os valores canônicos', () => {
    expect(provisioningDecisionLabel('aprovado_para_provisionar')).toBe('Provisionamento autorizado')
    expect(accountSituationLabel('convite_pendente')).toBe('Ativação pendente')
    expect(accountSituationLabel('ativo')).toBe('Ativa')
    expect(recoveryEmailSourceLabel('informado_manualmente')).toBe('Informado manualmente')
    expect(contactPurposeLabel('faturamento')).toBe('Faturamento')
    expect(deliveryStatusLabel('aceito')).toBe('Aceito pelo provedor')
    expect(deliveryStatusLabel('nao_confirmado')).toBe('Não confirmado')
    expect(deliveryStatusLabel('entregue')).toBe('Entregue')
    expect(accountSituationLabel('valor_inesperado')).toBe('Não informado')
  })
  it('deriva a próxima ação sem expor enum', () => {
    expect(getPortalNextAction(row({ account_situation: 'convite_expirado' }))).toBe('Reenviar convite')
    expect(getPortalNextAction(row({ provisioning_decision: 'aprovado_para_provisionar' }))).toBe('Revisar email')
  })
})

describe('sinal do Email de Recuperação', () => {
  it('trata bloqueio e falha permanente como email quebrado, e "ok" como saudável', () => {
    expect(hasBrokenRecoveryEmail(row({ recoveryEmailStatus: 'ok', recoveryEmailSuppressed: false }))).toBe(false)
    expect(hasBrokenRecoveryEmail(row({ recoveryEmailStatus: 'bounce_permanente' }))).toBe(true)
    expect(hasBrokenRecoveryEmail(row({ recoveryEmailStatus: 'complaint' }))).toBe(true)
    expect(hasBrokenRecoveryEmail(row({ recoveryEmailSuppressed: true }))).toBe(true)
  })

  // A conta continua ativa — o cliente entra com a senha. O que muda é o que o
  // operador precisa fazer, e isso aparece na fila sem rebaixar a situação.
  it('conta ativa com email quebrado pede validação em vez de "Conta ativa"', () => {
    expect(getPortalNextAction(row({ account_situation: 'ativo' }))).toBe('Conta ativa')
    expect(getPortalNextAction(row({ account_situation: 'ativo', recoveryEmailSuppressed: true }))).toBe('Validar Email de Recuperação')
  })
})

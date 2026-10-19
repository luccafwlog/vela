import { describe, expect, it } from 'vitest'
import { accountSituationLabel, contactPurposeLabel, deliveryStatusLabel, getPortalNextAction, hasBrokenRecoveryEmail, portalEventActorLabel, portalEventDescription, provisioningDecisionLabel, recoveryEmailSourceLabel } from '../portalProvisioningViewModel'
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
    expect(getPortalNextAction(row({ provisioning_decision: 'aprovado_para_provisionar' }))).toBe('Cadastrar e-mail')
    // A ação diz o que falta: com contato, escolher; com e-mail gravado, enviar.
    expect(getPortalNextAction(row({ candidates: [{ email: 'a@b.co', purpose: 'geral', origin: 'Contato do Cliente' }] }))).toBe('Escolher e-mail')
    expect(getPortalNextAction(row({ recovery_email: 'a@b.co' }))).toBe('Enviar convite')
    expect(getPortalNextAction(row({ account_situation: 'convite_pendente' }))).toBe('Acompanhar convite')
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
    expect(getPortalNextAction(row({ account_situation: 'ativo' }))).toBe('Ver conta')
    expect(getPortalNextAction(row({ account_situation: 'ativo', recoveryEmailSuppressed: true }))).toBe('Validar e-mail de recuperação')
  })
})

describe('Histórico do Portal (achado A6)', () => {
  it('troca o texto técnico do reparo da fila e descreve a mudança de situação sem motivo', () => {
    expect(portalEventDescription({ reason: 'Reparo automático da fila do Portal durante a leitura.', previous_situation: null, new_situation: 'sem_conta' })).toBe('Entrou na fila do Portal')
    expect(portalEventDescription({ reason: 'Cliente pediu outro e-mail', previous_situation: 'ativo', new_situation: 'ativo' })).toBe('Cliente pediu outro e-mail')
    expect(portalEventDescription({ reason: null, previous_situation: 'sem_conta', new_situation: 'convite_pendente' })).toBe('Conta: Sem conta → Ativação pendente')
    expect(portalEventActorLabel('sistema')).toBe('Sistema')
    expect(portalEventActorLabel(null)).toBeNull()
  })
})

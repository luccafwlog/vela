import { describe, expect, it, vi } from 'vitest'
import { comparePriority, effectiveSituation, listPortalProvisioningQueue, sendPortalInvite, type QueueRow } from '../portalProvisioning'

const rpc = vi.hoisted(() => vi.fn())
const invoke = vi.hoisted(() => vi.fn())
vi.mock('../supabase', () => ({ supabase: { rpc, functions: { invoke } } }))

function row(partial: Partial<QueueRow>): QueueRow {
  return {
    account_id: 1,
    customer_id: 1,
    customer_name: 'Cliente',
    cnpj_cpf: '12345678000195',
    provisioning_decision: 'aguardando_analise',
    account_situation: 'sem_conta',
    recovery_email: null,
    recovery_email_source: null,
    pending_invite_expires_at: null,
    hasCriticalAlert: false,
    hasOpenInvoice: false,
    hasActiveProcess: false,
    lastActivityAt: null,
    candidates: [],
    sharedEmailCount: 0,
    latestDeliveryStatus: null,
    recoveryEmailStatus: 'ok',
    recoveryEmailSuppressed: false,
    ...partial,
  }
}

describe('effectiveSituation', () => {
  it('rebaixa convite pendente vencido na leitura', () => {
    expect(effectiveSituation('convite_pendente', new Date(Date.now() - 60_000).toISOString())).toBe('convite_expirado')
  })
  it('mantém convite pendente dentro do prazo', () => {
    expect(effectiveSituation('convite_pendente', new Date(Date.now() + 60_000).toISOString())).toBe('convite_pendente')
  })
  it('não altera demais situações', () => {
    expect(effectiveSituation('ativo', null)).toBe('ativo')
    expect(effectiveSituation('sem_conta', null)).toBe('sem_conta')
  })
})

describe('comparePriority', () => {
  it('prioriza exceção crítica, fatura, processo e atividade nessa ordem', () => {
    expect(comparePriority(row({ hasCriticalAlert: true }), row({ hasOpenInvoice: true }))).toBeLessThan(0)
    expect(comparePriority(row({ hasOpenInvoice: true }), row({ hasActiveProcess: true }))).toBeLessThan(0)
    expect(comparePriority(row({ hasActiveProcess: true }), row({ lastActivityAt: '2026-07-01' }))).toBeLessThan(0)
  })

  it('prioriza uma conta autorizada com fatura aberta', () => {
    expect(comparePriority(row({ provisioning_decision: 'aprovado_para_provisionar', hasOpenInvoice: true }), row({}))).toBeLessThan(0)
  })
})

describe('listPortalProvisioningQueue', () => {
  it('consulta o read model RPC e mapeia a projeção resumida', async () => {
    rpc.mockResolvedValueOnce({ data: [{
      account_id: 1, customer_id: 7, customer_name: 'Cliente', cnpj_cpf: '12345678000195',
      provisioning_decision: 'aguardando_analise', account_situation: 'sem_conta',
      recovery_email: null, recovery_email_source: null, pending_invite_expires_at: null,
      recovery_email_status: 'ok', recovery_email_suppressed: false,
      latest_delivery_status: null, last_event_at: null,
      has_critical_alert: false, has_open_invoice: false, has_active_process: false,
      candidates: [], shared_email_count: 0,
    }], error: null })

    const result = await listPortalProvisioningQueue()

    expect(rpc).toHaveBeenCalledWith('portal_list_provisioning_console', {})
    expect(result[0]).toMatchObject({ recovery_email: null, candidates: [], sharedEmailCount: 0 })
  })

  it('rejeita linha JSON fora do contrato do console', async () => {
    rpc.mockResolvedValueOnce({ data: [{ account_id: 'invalid' }], error: null })

    await expect(listPortalProvisioningQueue()).rejects.toThrow(
      'Resposta inválida de portal_list_provisioning_console',
    )
  })
})

describe('sendPortalInvite', () => {
  it('reports success only when the Edge Function confirms a pending invite', async () => {
    invoke.mockResolvedValueOnce({ data: { situation: 'convite_pendente' }, error: null })

    await expect(sendPortalInvite(7, ' Cliente@Example.com ')).resolves.toBeUndefined()
    expect(invoke).toHaveBeenCalledWith('portal-invite-send', {
      body: { customer_id: 7, recovery_email: 'cliente@example.com', recovery_email_source: 'informado_manualmente' },
    })
  })

  it('surfaces a provider failure returned as HTTP 200 instead of reporting success', async () => {
    invoke.mockResolvedValueOnce({ data: { situation: 'falha_no_envio' }, error: null })

    await expect(sendPortalInvite(7, 'cliente@example.com')).rejects.toThrow('O envio do email falhou')
  })

  it('does not report success when the function response is missing', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: null })

    await expect(sendPortalInvite(7, 'cliente@example.com')).rejects.toThrow('Não foi possível confirmar o resultado')
  })
})

import { describe, expect, it, vi } from 'vitest'
import { processCeUnlockEmails, type NotifyDeps, type OutboxRow } from '../../../supabase/functions/_shared/ceUnlockNotifyEmail.ts'
import { ceUnlockNoticeTemplate } from '../../../supabase/functions/_shared/portalEmailTemplates.ts'

const row = (patch: Partial<OutboxRow> = {}): OutboxRow => ({
  id: 7, customer_id: 1, request_id: 'req', kind: 'changes_requested', subject: 'Assunto', body: 'Corpo', done_recipients: [], attempts: 0, ...patch,
})
function deps(patch: Partial<NotifyDeps> & { rows?: OutboxRow[] } = {}) {
  const finish = vi.fn(async () => {})
  const send = vi.fn(async () => true)
  const base: NotifyDeps = {
    communicationsEnabled: async () => true,
    pending: async () => patch.rows ?? [row()],
    contacts: async () => [{ id: 1, email: 'Ops@Cliente.com' }, { id: 2, email: 'ops@cliente.com' }, { id: 3, email: 'bloqueado@cliente.com' }, { id: 4, email: null }],
    allowed: async (_customer, contact) => contact !== 3,
    recipientKey: async (email) => `k:${email}`,
    send, finish,
  }
  return { deps: { ...base, ...patch }, finish, send }
}

describe('fila de e-mails do Desbloqueio de CE', () => {
  it('envia uma vez por endereço habilitado na caixa, com chave idempotente por destinatário', async () => {
    const { deps: d, send, finish } = deps()
    expect(await processCeUnlockEmails(d)).toEqual({ sent: 1, skipped: 0, retry: 0, failed: 0 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ row: expect.objectContaining({ id: 7 }), to: 'ops@cliente.com', idempotencyKey: 'ce-unlock:7:k:ops@cliente.com' })
    expect(finish).toHaveBeenCalledWith(7, 'sent', ['k:ops@cliente.com'])
  })
  it('com Comunicados desligados descarta sem enviar', async () => {
    const { deps: d, send, finish } = deps({ communicationsEnabled: async () => false })
    expect((await processCeUnlockEmails(d)).skipped).toBe(1)
    expect(send).not.toHaveBeenCalled()
    expect(finish).toHaveBeenCalledWith(7, 'skipped', [], expect.stringContaining('Comunicados desligados'))
  })
  it('sem contato habilitado na caixa não envia', async () => {
    const { deps: d, send, finish } = deps({ allowed: async () => false })
    expect((await processCeUnlockEmails(d)).skipped).toBe(1)
    expect(send).not.toHaveBeenCalled()
    expect(finish).toHaveBeenCalledWith(7, 'skipped', [], expect.stringContaining('documentacao_operacao'))
  })
  it('falha parcial volta à fila sem reenviar a quem já recebeu e desiste após cinco tentativas', async () => {
    const two = [{ id: 1, email: 'a@c.com' }, { id: 2, email: 'b@c.com' }]
    const first = deps({ contacts: async () => two, send: vi.fn(async ({ to }) => to === 'a@c.com') })
    expect((await processCeUnlockEmails(first.deps)).retry).toBe(1)
    expect(first.finish).toHaveBeenCalledWith(7, 'pending', ['k:a@c.com'], expect.any(String))
    const second = deps({ rows: [row({ done_recipients: ['k:a@c.com'], attempts: 1 })], contacts: async () => two, send: vi.fn(async () => true) })
    expect((await processCeUnlockEmails(second.deps)).sent).toBe(1)
    expect(second.deps.send).toHaveBeenCalledTimes(1)
    expect(second.deps.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'b@c.com' }))
    const last = deps({ rows: [row({ attempts: 4 })], contacts: async () => two, send: vi.fn(async () => false) })
    expect((await processCeUnlockEmails(last.deps)).failed).toBe(1)
    expect(last.finish).toHaveBeenCalledWith(7, 'failed', [], expect.any(String))
  })
})

describe('e-mail ao cliente', () => {
  it('leva o aviso e o link do Portal sem citar ZPT nem desbloqueio confirmado', () => {
    const mail = ceUnlockNoticeTemplate({
      title: 'Desbloqueio de CE: documentação validada',
      message: 'A documentação da solicitação CE-1 foi validada. Prazo para o desbloqueio: até 07/10 às 17:00. Consulte o Mercante para verificar o desbloqueio.',
      portalUrl: 'https://portal.exemplo.com.br', supportEmail: 'suporte@exemplo.com.br',
    })
    expect(mail.text).toContain('https://portal.exemplo.com.br/portal/desbloqueio-ce')
    expect(mail.html).toContain('Consulte o Mercante')
    expect(`${mail.subject}${mail.text}${mail.html}`).not.toMatch(/ZPT|desbloqueio confirmado/i)
  })
})

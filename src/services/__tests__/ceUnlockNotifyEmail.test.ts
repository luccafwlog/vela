import { describe, expect, it, vi } from 'vitest'
import {
  processCeUnlockEmails,
  runCeUnlockNotify,
  type CeUnlockNotifyHandlerDeps,
  type NotifyDeps,
  type OutboxRow,
  type SendOutcome,
} from '../../../supabase/functions/_shared/ceUnlockNotifyEmail.ts'
import { ceUnlockNoticeTemplate } from '../../../supabase/functions/_shared/portalEmailTemplates.ts'

const row = (patch: Partial<OutboxRow> = {}): OutboxRow => ({
  id: 7, customer_id: 1, request_id: 'req', kind: 'changes_requested', subject: 'Assunto', body: 'Corpo', done_recipients: [], attempts: 0, ...patch,
})
function deps(patch: Partial<NotifyDeps> & { rows?: OutboxRow[] } = {}) {
  const finish = vi.fn(async () => {})
  const send = vi.fn(async (): Promise<SendOutcome> => 'sent')
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
const empty = { sent: 0, partial: 0, simulated: 0, skipped: 0, retry: 0, failed: 0 }

describe('fila de e-mails do Desbloqueio de CE', () => {
  it('envia uma vez por endereço habilitado na caixa, com chave idempotente por destinatário', async () => {
    const { deps: d, send, finish } = deps()
    expect(await processCeUnlockEmails(d)).toEqual({ ...empty, sent: 1 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ row: expect.objectContaining({ id: 7 }), to: 'ops@cliente.com', idempotencyKey: 'ce-unlock:7:k:ops@cliente.com', simulate: false })
    expect(finish).toHaveBeenCalledWith(7, 'sent', ['k:ops@cliente.com'])
  })

  it('com a chave desligada resolve os destinatários, simula o envio e fecha como simulado (D11)', async () => {
    const { deps: d, send, finish } = deps({ communicationsEnabled: async () => false })
    expect(await processCeUnlockEmails(d)).toEqual({ ...empty, simulated: 1 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'ops@cliente.com', simulate: true }))
    expect(finish).toHaveBeenCalledWith(7, 'simulated', ['k:ops@cliente.com'], expect.stringContaining('simulado'))
  })

  it('sem contato habilitado na caixa não envia e fecha sem destinatário', async () => {
    const { deps: d, send, finish } = deps({ allowed: async () => false })
    expect((await processCeUnlockEmails(d)).skipped).toBe(1)
    expect(send).not.toHaveBeenCalled()
    expect(finish).toHaveBeenCalledWith(7, 'skipped', [], expect.stringContaining('documentacao_operacao'))
  })

  it('falha parcial volta à fila sem reenviar a quem já recebeu e desiste após cinco tentativas', async () => {
    const two = [{ id: 1, email: 'a@c.com' }, { id: 2, email: 'b@c.com' }]
    const first = deps({ contacts: async () => two, send: vi.fn(async ({ to }): Promise<SendOutcome> => (to === 'a@c.com' ? 'sent' : 'failed')) })
    expect((await processCeUnlockEmails(first.deps)).retry).toBe(1)
    expect(first.finish).toHaveBeenCalledWith(7, 'pending', ['k:a@c.com'], expect.any(String))
    const second = deps({ rows: [row({ done_recipients: ['k:a@c.com'], attempts: 1 })], contacts: async () => two })
    expect((await processCeUnlockEmails(second.deps)).sent).toBe(1)
    expect(second.send).toHaveBeenCalledTimes(1)
    expect(second.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'b@c.com' }))
    const last = deps({ rows: [row({ attempts: 4 })], contacts: async () => two, send: vi.fn(async (): Promise<SendOutcome> => 'failed') })
    expect((await processCeUnlockEmails(last.deps)).failed).toBe(1)
    expect(last.finish).toHaveBeenCalledWith(7, 'failed', [], expect.any(String))
  })

  it('destinatário suprimido no Portal não deixa a linha voltar: fecha parcial na primeira rodada', async () => {
    const two = [{ id: 1, email: 'a@c.com' }, { id: 2, email: 'bounce@c.com' }]
    const { deps: d, finish } = deps({ contacts: async () => two, send: vi.fn(async ({ to }): Promise<SendOutcome> => (to === 'a@c.com' ? 'sent' : 'suppressed')) })
    expect(await processCeUnlockEmails(d)).toEqual({ ...empty, partial: 1 })
    expect(finish).toHaveBeenCalledWith(7, 'partial', ['k:a@c.com'], expect.stringContaining('suprimido'))
  })

  it('todos os destinatários suprimidos fecham sem destinatário, sem nova tentativa', async () => {
    const { deps: d, finish } = deps({ send: vi.fn(async (): Promise<SendOutcome> => 'suppressed') })
    expect(await processCeUnlockEmails(d)).toEqual({ ...empty, skipped: 1 })
    expect(finish).toHaveBeenCalledWith(7, 'skipped', [], expect.stringContaining('suprimidos'))
  })

  it('exceção numa linha conta a tentativa e a fila segue para a próxima', async () => {
    const { deps: d, finish } = deps({
      rows: [row({ id: 1, customer_id: 10 }), row({ id: 2, customer_id: 20 })],
      contacts: async (customerId) => {
        if (customerId === 10) throw new Error('timeout no banco')
        return [{ id: 1, email: 'b@c.com' }]
      },
    })
    expect(await processCeUnlockEmails(d)).toEqual({ ...empty, sent: 1, retry: 1 })
    expect(finish).toHaveBeenCalledWith(1, 'pending', [], expect.stringContaining('timeout no banco'))
    expect(finish).toHaveBeenCalledWith(2, 'sent', ['k:b@c.com'])
  })

  it('exceção na quinta tentativa fecha a linha como falha (o alerta abre no banco)', async () => {
    const { deps: d, finish } = deps({ rows: [row({ attempts: 4 })], contacts: async () => { throw new Error('x') } })
    expect((await processCeUnlockEmails(d)).failed).toBe(1)
    expect(finish).toHaveBeenCalledWith(7, 'failed', [], expect.any(String))
  })
})

describe('handler do Desbloqueio de CE', () => {
  function handlerDeps(patch: Partial<CeUnlockNotifyHandlerDeps> = {}) {
    const base = deps()
    const pending = vi.fn(base.deps.pending)
    const full: CeUnlockNotifyHandlerDeps = {
      ...base.deps,
      pending,
      refreshOpen: async () => ({ data: 0, error: null }),
      providerConfigured: true,
      ...patch,
    }
    return { full, pending, finish: base.finish, send: base.send }
  }

  it('erro ao ler a chave responde 500 e não consome a fila', async () => {
    const { full, pending, finish } = handlerDeps({ communicationsEnabled: async () => { throw new Error('connection reset') } })
    expect((await runCeUnlockNotify(full)).status).toBe(500)
    expect(pending).not.toHaveBeenCalled()
    expect(finish).not.toHaveBeenCalled()
  })

  it('com a chave ligada e o provedor sem configuração responde 503 sem consumir a fila', async () => {
    const { full, pending } = handlerDeps({ providerConfigured: false })
    expect((await runCeUnlockNotify(full)).status).toBe(503)
    expect(pending).not.toHaveBeenCalled()
  })

  it('com a chave desligada simula mesmo sem o provedor configurado', async () => {
    const { full, finish } = handlerDeps({ providerConfigured: false, communicationsEnabled: async () => false })
    const result = await runCeUnlockNotify(full)
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ simulated: 1, failed: 0 })
    expect(finish).toHaveBeenCalledWith(7, 'simulated', expect.any(Array), expect.any(String))
  })

  it('devolve failed no corpo para o heartbeat ficar vermelho', async () => {
    const { full } = handlerDeps({ pending: async () => [row({ attempts: 4 })], send: vi.fn(async (): Promise<SendOutcome> => 'failed') })
    expect((await runCeUnlockNotify(full)).body).toMatchObject({ failed: 1 })
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

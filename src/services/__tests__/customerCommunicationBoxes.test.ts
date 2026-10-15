import { describe, expect, it } from 'vitest'
import {
  CUSTOMER_COMMUNICATION_BOXES,
  getBoxesForKind,
  resolveCustomerCommunicationRecipientsByBoxes as resolveByBoxes,
  buildRecipientSnapshot,
  type CustomerContactBoxLink,
} from '../customerCommunicationBoxes'
import { groupDemurrageDunningByCustomerCycle } from '../customerCommunications'
import type { CustomerContact } from '../../types/database'
import { communicationBoxKindsFromMigrations } from './communicationBoxKindsSql'

const boxKinds = communicationBoxKindsFromMigrations()
const resolveCustomerCommunicationRecipientsByBoxes = (input: Parameters<typeof resolveByBoxes>[0]) =>
  resolveByBoxes({ boxKinds, ...input })

describe('customerCommunicationBoxes — catálogo e resolvedor determinístico', () => {
  const baseContact = (id: number, email: string, isPrimary = false): CustomerContact => ({
    id,
    customer_id: 10,
    name: `Contato ${id}`,
    email,
    email_normalized: email.toLowerCase(),
    phone: null,
    purpose: null,
    is_primary: isPrimary,
    created_at: '2026-01-01T00:00:00Z',
    deactivated_at: null,
    updated_at: '2026-01-01T00:00:00Z',
    origin: 'interno',
  })

  it('possui as 3 caixas oficiais e mapeamento de modelos fechado', () => {
    expect(CUSTOMER_COMMUNICATION_BOXES.map((b) => b.code)).toEqual([
      'documentacao_operacao',
      'financeiro',
      'demurrage',
    ])
    // O mapa caixa → modelo vem do banco (B18): a semente da migration 116.
    expect(getBoxesForKind('ce_mercante_taxas', boxKinds)).toEqual(['documentacao_operacao', 'financeiro'])
    expect(getBoxesForKind('aviso_chegada_noa', boxKinds)).toEqual(['documentacao_operacao'])
    expect(getBoxesForKind('cobranca_demurrage', boxKinds)).toEqual(['financeiro', 'demurrage'])
  })

  it('sem as linhas do banco, nenhum modelo tem caixa e o envio fica bloqueado', () => {
    const res = resolveByBoxes({
      contacts: [baseContact(1, 'operacao@cliente.com', true)],
      boxLinks: [{ contact_id: 1, box_code: 'documentacao_operacao' }],
      kind: 'ce_mercante_taxas',
    })
    expect(res.eligible).toEqual([])
    expect(res.blocked).toBe(true)
  })

  it('CE mercante alcança contato de Documentação e contato de Financeiro, cada endereço uma vez', () => {
    const c1 = baseContact(1, 'operacao@cliente.com', true)
    const c2 = baseContact(2, 'financeiro@cliente.com', false)
    const boxLinks: CustomerContactBoxLink[] = [
      { contact_id: 1, box_code: 'documentacao_operacao' },
      { contact_id: 2, box_code: 'financeiro' },
    ]

    const res = resolveCustomerCommunicationRecipientsByBoxes({
      contacts: [c1, c2],
      boxLinks,
      kind: 'ce_mercante_taxas',
    })

    expect(res.blocked).toBe(false)
    expect(res.eligible).toHaveLength(2)
    expect(res.eligible.map((e) => e.email)).toEqual(['operacao@cliente.com', 'financeiro@cliente.com'])
    expect(res.eligible[0].matchedBoxCodes).toEqual(['documentacao_operacao'])
    expect(res.eligible[1].matchedBoxCodes).toEqual(['financeiro'])
  })

  it('cobrança de Demurrage alcança Financeiro e Demurrage sem duplicação', () => {
    const c1 = baseContact(1, 'cobranca@cliente.com', true)
    const boxLinks: CustomerContactBoxLink[] = [
      { contact_id: 1, box_code: 'financeiro' },
      { contact_id: 1, box_code: 'demurrage' },
    ]

    const res = resolveCustomerCommunicationRecipientsByBoxes({
      contacts: [c1],
      boxLinks,
      kind: 'cobranca_demurrage',
    })

    expect(res.blocked).toBe(false)
    expect(res.eligible).toHaveLength(1)
    expect(res.eligible[0].email).toBe('cobranca@cliente.com')
    expect(res.eligible[0].matchedBoxCodes).toContain('financeiro')
    expect(res.eligible[0].matchedBoxCodes).toContain('demurrage')
  })

  it('normalização de e-mail (CONTAS@CLIENTE.COM = contas@cliente.com) deduplica dentro do cliente', () => {
    const c1 = baseContact(1, 'contas@cliente.com', false)
    const c2 = baseContact(2, 'CONTAS@CLIENTE.COM', true)
    const boxLinks: CustomerContactBoxLink[] = [
      { contact_id: 1, box_code: 'financeiro' },
      { contact_id: 2, box_code: 'documentacao_operacao' },
    ]

    const res = resolveCustomerCommunicationRecipientsByBoxes({
      contacts: [c1, c2],
      boxLinks,
      kind: 'ce_mercante_taxas',
    })

    expect(res.eligible).toHaveLength(1)
    expect(res.eligible[0].email?.toLowerCase()).toBe('contas@cliente.com')
    expect(res.eligible[0].is_primary).toBe(true)
    expect(res.eligible[0].matchedBoxCodes).toContain('financeiro')
    expect(res.eligible[0].matchedBoxCodes).toContain('documentacao_operacao')
  })

  it('audiência todos ignora caixas mas exclui inativo, sem e-mail, complaint e bounce', () => {
    const c1 = baseContact(1, 'valido@cliente.com', true)
    const c2 = { ...baseContact(2, 'inativo@cliente.com'), deactivated_at: '2026-02-01T00:00:00Z' }
    const c3 = baseContact(3, '')
    const c4 = baseContact(4, 'complaint@cliente.com')
    const c5 = baseContact(5, 'bounce@cliente.com')

    const res = resolveCustomerCommunicationRecipientsByBoxes({
      contacts: [c1, c2, c3, c4, c5],
      audience: { mode: 'todos' },
      communicationSuppressions: [{ email: 'complaint@cliente.com', reason: 'complaint' }],
      portalSuppressions: [{ email: 'bounce@cliente.com', reason: 'bounce_permanente' }],
    })

    expect(res.eligible).toHaveLength(1)
    expect(res.eligible[0].email).toBe('valido@cliente.com')
    expect(res.excluded).toHaveLength(4)
    expect(res.excluded.find((e) => e.contact.id === 2)?.reason).toBe('contato_desativado')
    expect(res.excluded.find((e) => e.contact.id === 3)?.reason).toBe('email_ausente')
    expect(res.excluded.find((e) => e.contact.id === 4)?.reason).toBe('suprimido_complaint')
    expect(res.excluded.find((e) => e.contact.id === 5)?.reason).toBe('suprimido_bounce')
  })

  it('audiência de uma caixa exclui contato que está apenas em outra caixa', () => {
    const c1 = baseContact(1, 'doc@cliente.com', true)
    const c2 = baseContact(2, 'fin@cliente.com', false)
    const boxLinks: CustomerContactBoxLink[] = [
      { contact_id: 1, box_code: 'documentacao_operacao' },
      { contact_id: 2, box_code: 'financeiro' },
    ]

    const res = resolveCustomerCommunicationRecipientsByBoxes({
      contacts: [c1, c2],
      boxLinks,
      audience: { mode: 'caixa', boxCode: 'demurrage' },
    })

    expect(res.eligible).toHaveLength(0)
    expect(res.blocked).toBe(true)
  })

  it('gera snapshot determinístico de destinatários', () => {
    const c1 = baseContact(1, 'operacao@cliente.com', true)
    const snap1 = buildRecipientSnapshot({
      customerId: 10,
      kind: 'ce_mercante_taxas',
      audience: { mode: 'caixa', boxCode: 'documentacao_operacao' },
      recipients: [{ ...c1, boxCodes: ['documentacao_operacao'], matchedBoxCodes: ['documentacao_operacao'] }],
    })
    const snap2 = buildRecipientSnapshot({
      customerId: 10,
      kind: 'ce_mercante_taxas',
      audience: { mode: 'caixa', boxCode: 'documentacao_operacao' },
      recipients: [{ ...c1, boxCodes: ['documentacao_operacao'], matchedBoxCodes: ['documentacao_operacao'] }],
    })
    expect(snap1).toBe(snap2)
  })

  it('S06 — Demurrage: principal suprimido + alternativo só-operacional não envia', () => {
    const principal = baseContact(1, 'principal@cliente.com', true)
    const operacional = baseContact(2, 'operacional@cliente.com', false)
    const boxLinks: CustomerContactBoxLink[] = [
      { contact_id: 1, box_code: 'demurrage' },
      { contact_id: 1, box_code: 'financeiro' },
      { contact_id: 2, box_code: 'documentacao_operacao' },
    ]

    const res = resolveCustomerCommunicationRecipientsByBoxes({
      contacts: [principal, operacional],
      boxLinks,
      kind: 'cobranca_demurrage',
      communicationSuppressions: [],
      portalSuppressions: [{ email: 'principal@cliente.com', reason: 'bounce_permanente' }],
    })

    expect(res.eligible).toHaveLength(0)
    expect(res.blocked).toBe(true)
    expect(res.excluded.find((e) => e.contact.id === 1)?.reason).toBe('suprimido_bounce')
  })

  it('S06 — Demurrage: principal elegível permanece alcançável (fallback auditado no SQL)', () => {
    const principal = baseContact(1, 'principal@cliente.com', true)
    const operacional = baseContact(2, 'operacional@cliente.com', false)
    const boxLinks: CustomerContactBoxLink[] = [
      { contact_id: 1, box_code: 'demurrage' },
      { contact_id: 2, box_code: 'documentacao_operacao' },
    ]

    const res = resolveCustomerCommunicationRecipientsByBoxes({
      contacts: [principal, operacional],
      boxLinks,
      kind: 'cobranca_demurrage',
    })

    expect(res.blocked).toBe(false)
    expect(res.eligible).toHaveLength(1)
    expect(res.eligible[0].email).toBe('principal@cliente.com')
  })

  it('S06/D11 — 12 faturas do mesmo cliente/ciclo com 3 contatos geram 3 entregas', () => {
    const candidates = Array.from({ length: 12 }, (_, index) => ({
      invoice_id: 7000 + index,
      customer_id: 70,
      attempt_discriminator: 1,
    }))
    const groups = groupDemurrageDunningByCustomerCycle(candidates)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(12)

    const contacts = [
      baseContact(1, 'a@cliente.com', true),
      baseContact(2, 'b@cliente.com', false),
      baseContact(3, 'c@cliente.com', false),
    ]
    const boxLinks: CustomerContactBoxLink[] = [
      { contact_id: 1, box_code: 'demurrage' },
      { contact_id: 2, box_code: 'financeiro' },
      { contact_id: 3, box_code: 'demurrage' },
    ]
    const res = resolveCustomerCommunicationRecipientsByBoxes({
      contacts,
      boxLinks,
      kind: 'cobranca_demurrage',
    })
    expect(res.eligible).toHaveLength(3)

    // Uma mensagem por cliente/ciclo a cada destinatário: 1 grupo × 3
    // destinatários = 3 entregas com as 12 faturas (sem consolidar valores),
    // em vez de 12 × 3 = 36.
    expect(groups.length * res.eligible.length).toBe(3)
    const invoiceIds = groups.flatMap((group) => group.map((item) => item.invoice_id))
    expect(new Set(invoiceIds).size).toBe(12)
  })
})

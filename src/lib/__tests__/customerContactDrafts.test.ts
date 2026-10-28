import { describe, expect, it } from 'vitest'
import { boxesWithoutRecipient, currentSuppressionReason, firstBoxWithoutContact, isEligibleContact } from '../customerContactDrafts'
import type { PortalContactDraft } from '../../services/portalContactConfiguration'

const ALL_BOXES = ['documentacao_operacao', 'financeiro', 'demurrage']
const bounced: PortalContactDraft = {
  id: 1, name: 'Principal', email: 'compras@cliente.com', phone: null, isPrimary: true, active: true,
  boxCodes: ALL_BOXES, suppressionReason: 'bounce_permanente', sendable: false, suppressedEmail: 'compras@cliente.com',
}

// D14 de 2026-10-27: o Cliente com único contato em bounce salva os contatos, com
// aviso, e trocar o e-mail libera o contato.
describe('rascunho de contatos com e-mail devolvido', () => {
  it('caixa só com e-mail devolvido não bloqueia a gravação, mas fica sem destinatário', () => {
    expect(isEligibleContact(bounced)).toBe(false)
    expect(firstBoxWithoutContact([bounced])).toBeUndefined()
    expect(boxesWithoutRecipient([bounced]).map((box) => box.code)).toEqual(ALL_BOXES)
  })

  it('trocar o e-mail libera o contato; voltar ao e-mail devolvido bloqueia de novo', () => {
    const changed = { ...bounced, email: 'novo@cliente.com' }
    expect(isEligibleContact(changed)).toBe(true)
    expect(currentSuppressionReason(changed)).toBeNull()
    expect(boxesWithoutRecipient([changed])).toEqual([])
    const back = { ...bounced, email: ' Compras@Cliente.com ' }
    expect(isEligibleContact(back)).toBe(false)
    expect(currentSuppressionReason(back)).toBe('bounce_permanente')
  })

  it('caixa sem nenhum contato ativo com e-mail continua recusada', () => {
    expect(firstBoxWithoutContact([{ ...bounced, email: '' }])?.code).toBe('documentacao_operacao')
    expect(firstBoxWithoutContact([{ ...bounced, active: false }])?.code).toBe('documentacao_operacao')
  })
})

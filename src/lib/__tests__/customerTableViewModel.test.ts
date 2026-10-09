import { describe, expect, it } from 'vitest'
import {
  buildCustomerBillingUrl,
  getCustomerFilterChips,
  getPrimaryContactEmail,
  sortCustomerRows,
  summarizeContactsForDisplay,
} from '../customerTableViewModel'

describe('customerTableViewModel', () => {
  it('monta URL de faturas filtrada pelo cliente', () => {
    expect(buildCustomerBillingUrl({ id: 42, name: 'ACME EXPORTS & LOGISTICS' })).toBe(
      '/taxas-locais?tab=invoices&customer=42&customerName=ACME%20EXPORTS%20%26%20LOGISTICS',
    )
  })

  it('prioriza contato principal com e-mail', () => {
    expect(
      getPrimaryContactEmail([
        { id: 1, email: 'operacao@acme.com', is_primary: false, purpose: 'operacional' },
        { id: 2, email: 'financeiro@acme.com', is_primary: true, purpose: 'financeiro' },
      ]),
    ).toBe('financeiro@acme.com')
  })

  it('resume contatos com email principal, flag de principal e contagem de caixas', () => {
    expect(
      summarizeContactsForDisplay([
        { id: 1, email: 'ops@acme.com', is_primary: false, customer_contact_box_links: [{ box_code: 'documentacao_operacao' }] },
        { id: 2, email: 'fin@acme.com', is_primary: true, customer_contact_box_links: [{ box_code: 'financeiro' }, { box_code: 'demurrage' }] },
      ]),
    ).toEqual({
      count: 2,
      primaryEmail: 'fin@acme.com',
      isPrimary: true,
      boxCount: 2,
      empty: false,
    })
  })

  it('gera chips legiveis para filtros ativos', () => {
    expect(
      getCustomerFilterChips({
        search: 'ACME',
        contactEmail: 'fin@acme.com',
        emailStatus: 'with',
        blStatus: 'without',
        pendingStatus: 'with',
      }),
    ).toEqual([
      { key: 'search', label: 'Cliente: ACME' },
      { key: 'contactEmail', label: 'E-mail: fin@acme.com' },
      { key: 'emailStatus', label: 'Com e-mails' },
      { key: 'blStatus', label: 'Sem B/Ls' },
      { key: 'pendingStatus', label: 'Com saldo pendente' },
    ])
  })

  it('ordena clientes por saldo pendente decrescente', () => {
    const rows = [
      { id: 1, name: 'A', pending_balance: 10, bls: [] },
      { id: 2, name: 'B', pending_balance: 50, bls: [] },
    ]

    expect(sortCustomerRows(rows, 'pendingBalance', 'desc').map((row) => row.id)).toEqual([2, 1])
  })
})

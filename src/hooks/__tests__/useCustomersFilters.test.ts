import { describe, expect, it } from 'vitest'
import {
  filterCustomerRowsByClientSideFilters,
  summarizeCustomerRows,
  type CustomerFilters,
} from '../useCustomers'
import type { CustomerListItem } from '../../types/database'

const baseFilters: CustomerFilters = {
  search: '',
  contactEmail: '',
  emailStatus: '',
  blStatus: '',
  pendingStatus: '',
  chargeStatus: '',
  sortKey: 'name',
  sortDirection: 'asc',
  page: 0,
  pageSize: 50,
}

function customer(row: Partial<CustomerListItem>): CustomerListItem {
  return {
    id: 1,
    cnpj_cpf: '00000000000191',
    name: 'Cliente teste',
    trade_name: null,
    address: null,
    city: null,
    state: null,
    zip: null,
    notes: null,
    created_at: null,
    updated_at: null,
    deactivated_at: null,
    deactivated_by: null,
    deactivation_reason: null,
    pending_balance: 0,
    ...row,
  }
}

describe('customer client-side filters', () => {
  it('filtra clientes pelo e-mail de contato sem diferenciar maiusculas', () => {
    const rows = [
      customer({
        id: 1,
        customer_contacts: [{ id: 10, email: 'financeiro@acme.com.br', purpose: 'financeiro', is_primary: true }],
      }),
      customer({
        id: 2,
        customer_contacts: [{ id: 20, email: 'operacao@exemplo.com.br', purpose: 'operacional', is_primary: false }],
      }),
    ]

    expect(filterCustomerRowsByClientSideFilters(rows, { ...baseFilters, contactEmail: 'FINANCEIRO@ACME' })).toEqual([
      rows[0],
    ])
  })

  it('filtra pelo cartão Taxas a revisar: Cliente com B/L a revisar ou sem cálculo', () => {
    const rows = [
      customer({ id: 1, bls: [{ id: 'BL-1', charge_status: 'ready_for_billing' }, { id: 'BL-2', charge_status: 'review_required' }] }),
      customer({ id: 2, bls: [{ id: 'BL-3', charge_status: 'not_calculated' }] }),
      customer({ id: 3, bls: [{ id: 'BL-4', charge_status: 'ready_for_billing' }] }),
      customer({ id: 4, bls: [] }),
    ]

    expect(filterCustomerRowsByClientSideFilters(rows, { ...baseFilters, chargeStatus: 'with' }).map((row) => row.id)).toEqual([1, 2])
    expect(filterCustomerRowsByClientSideFilters(rows, { ...baseFilters, chargeStatus: 'without' }).map((row) => row.id)).toEqual([3, 4])
  })

  it('calcula os cards a partir dos clientes filtrados', () => {
    const rows = [
      customer({
        id: 1,
        pending_balance: 100,
        bls: [
          { id: 'BL-1', charge_status: 'review_required' },
          { id: 'BL-2', charge_status: 'ready_for_billing' },
        ],
      }),
      customer({
        id: 2,
        pending_balance: 50,
        bls: [{ id: 'BL-3', charge_status: 'not_calculated' }],
      }),
    ]

    expect(summarizeCustomerRows(rows)).toEqual({
      totalCustomers: 2,
      pendingBalance: 150,
      totalBls: 3,
      chargePending: 2,
      chargeReady: 1,
      customersWithoutEmail: 2,
    })
  })
})

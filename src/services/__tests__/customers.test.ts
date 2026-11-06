import { describe, expect, it } from 'vitest'
import { mapPendingBalancesByCustomer } from '../customers'

describe('mapPendingBalancesByCustomer', () => {
  it('usa o total canonico e separa faturado em aberto, a faturar e avulsa', () => {
    const result = mapPendingBalancesByCustomer([
      { customer_id: 10, local_balance_brl: 40, demurrage_balance_brl: 15, total_balance_brl: 75, invoiced_open_brl: 45, to_invoice_brl: 30, manual_balance_brl: 20 },
      { customer_id: 20, local_balance_brl: 75, demurrage_balance_brl: 0, total_balance_brl: 75 },
    ])

    expect(result.get(10)).toMatchObject({ totalBrl: 75, invoicedOpenBrl: 45, toInvoiceBrl: 30, manualBrl: 20 })
    expect(result.get(20)).toMatchObject({ totalBrl: 75, invoicedOpenBrl: 0, toInvoiceBrl: 0 })
  })
})

describe('isDuplicateCustomerCnpjError', () => {
  it('reconhece só a recusa da constraint de CNPJ único', async () => {
    const { isDuplicateCustomerCnpjError } = await import('../customers')
    expect(isDuplicateCustomerCnpjError({ code: '23505', message: 'duplicate key value violates unique constraint "customers_cnpj_cpf_key"' })).toBe(true)
    expect(isDuplicateCustomerCnpjError({ code: '23505', message: 'duplicate key', details: 'Key (cnpj_cpf)=(12345678000195) already exists.' })).toBe(true)
    expect(isDuplicateCustomerCnpjError({ code: '23505', message: 'duplicate key value violates unique constraint "customer_contacts_email_key"' })).toBe(false)
    expect(isDuplicateCustomerCnpjError({ code: '22023', message: 'customers_cnpj_cpf_key' })).toBe(false)
    expect(isDuplicateCustomerCnpjError(null)).toBe(false)
  })
})

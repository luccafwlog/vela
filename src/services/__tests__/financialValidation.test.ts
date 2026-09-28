import { describe, expect, it } from 'vitest'
import {
  demurrageDatesSchema,
  demurrageDiscountSchema,
  manualInvoiceChargeSchema,
  manualInvoiceCreationSchema,
  paymentFormSchema,
} from '../financialValidation'

describe('financialValidation', () => {
  it('converte numero com virgula para decimal', () => {
    const parsed = paymentFormSchema.parse({ amountBrl: '10,50', paymentMethod: 'pix', paidAt: '2026-06-13' })

    expect(parsed.amountBrl).toBe(10.5)
    expect(parsed.paidAt).toBe('2026-06-13')
  })

  it('rejeita campos financeiros obrigatorios vazios ou invalidos', () => {
    expect(paymentFormSchema.safeParse({ amountBrl: '', paymentMethod: 'pix', paidAt: '2026-06-13' }).success).toBe(false)
    expect(paymentFormSchema.safeParse({ amountBrl: '-1', paymentMethod: 'pix', paidAt: '2026-06-13' }).success).toBe(false)
    expect(paymentFormSchema.safeParse({ amountBrl: 'abc', paymentMethod: 'pix', paidAt: '2026-06-13' }).success).toBe(false)
    expect(paymentFormSchema.safeParse({ amountBrl: '10', paymentMethod: 'cartao', paidAt: '2026-06-13' }).success).toBe(false)
    expect(paymentFormSchema.safeParse({ amountBrl: '10', paymentMethod: 'pix', paidAt: '' }).success).toBe(false)
    expect(paymentFormSchema.safeParse({ amountBrl: '10', paymentMethod: 'pix', paidAt: '2026-13-01' }).success).toBe(false)
    expect(paymentFormSchema.safeParse({ amountBrl: '1e3', paymentMethod: 'pix', paidAt: '2026-06-13' }).success).toBe(false)
  })

  it('valida item manual de invoice', () => {
    expect(manualInvoiceChargeSchema.safeParse({ description: '', quantity: '1', unitValueBrl: '10' }).success).toBe(false)
    expect(manualInvoiceChargeSchema.safeParse({ description: 'Taxa', quantity: '-1', unitValueBrl: '10' }).success).toBe(false)
    expect(manualInvoiceChargeSchema.safeParse({ description: 'Taxa', quantity: '1', unitValueBrl: 'abc' }).success).toBe(false)

    expect(manualInvoiceChargeSchema.parse({ description: ' Taxa ', quantity: '2', unitValueBrl: '10,50' })).toEqual({
      description: 'Taxa',
      quantity: 2,
      unitValueBrl: 10.5,
    })
  })

  it('valida e normaliza os dados da criacao de fatura avulsa', () => {
    expect(manualInvoiceCreationSchema.safeParse({
      customerId: '',
      itemName: 'Taxa',
      quantity: '1',
      unitValueBrl: '10',
    }).success).toBe(false)
    expect(manualInvoiceCreationSchema.safeParse({
      customerId: 7,
      itemName: '  ',
      quantity: '1',
      unitValueBrl: '10',
    }).success).toBe(false)
    expect(manualInvoiceCreationSchema.safeParse({
      customerId: 7,
      itemName: 'Taxa',
      quantity: '0',
      unitValueBrl: '10',
    }).success).toBe(false)
    expect(manualInvoiceCreationSchema.safeParse({
      customerId: 7,
      itemName: 'Taxa',
      quantity: '1',
      unitValueBrl: 'abc',
    }).success).toBe(false)

    expect(manualInvoiceCreationSchema.parse({
      customerId: '7',
      itemName: ' Taxa especial ',
      description: ' Observacao da cobranca ',
      quantity: '2',
      unitValueBrl: '10,50',
      blId: ' BL-1 ',
      voyageId: '42',
    })).toEqual({
      customerId: 7,
      itemName: 'Taxa especial',
      description: 'Observacao da cobranca',
      quantity: 2,
      unitValueBrl: 10.5,
      blId: 'BL-1',
      voyageId: 42,
    })

    expect(manualInvoiceCreationSchema.parse({
      customerId: 7,
      itemName: 'Taxa sem contexto',
      quantity: 1,
      unitValueBrl: 10,
    })).toMatchObject({
      description: null,
      blId: null,
      voyageId: null,
    })
  })

  it('valida desconto de demurrage', () => {
    expect(demurrageDiscountSchema.safeParse({
      discount_type: 'comercial',
      discount_value: '101',
      discount_mode: 'percent',
      discount_justification: '',
      discount_approver: '',
    }).success).toBe(false)

    expect(demurrageDiscountSchema.parse({
      discount_type: 'acordo',
      discount_value: '10,5',
      discount_mode: 'fixed',
      discount_justification: ' Negociado ',
      discount_approver: ' Maria ',
    })).toEqual({
      discount_type: 'acordo',
      discount_value: 10.5,
      discount_mode: 'fixed',
      discount_justification: 'Negociado',
      discount_approver: 'Maria',
    })
  })

  it('rejeita devolucao anterior a descarga', () => {
    expect(demurrageDatesSchema.safeParse({ discharge: '', ret: null }).success).toBe(false)
    expect(demurrageDatesSchema.safeParse({ discharge: '2026-01-10', ret: '2026-01-09' }).success).toBe(false)

    expect(demurrageDatesSchema.parse({ discharge: '2026-01-10', ret: '' })).toEqual({
      discharge: '2026-01-10',
      ret: null,
    })
  })
})

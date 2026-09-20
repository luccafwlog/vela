// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { InvoicesTable } from '../InvoicesTable'
import type { InvoiceListRow } from '../../../services/billing'

afterEach(cleanup)

const baseInvoice: InvoiceListRow = {
  id: 1,
  invoice_number: 'FAT-001',
  customer_id: 10,
  bl_id: 'BL-INV-001',
  issued_at: '2026-03-01T10:00:00Z',
  total_brl: 1500,
  status: 'issued',
  invoice_type: 'individual',
  total_paid_brl: 0,
  balance_brl: 1500,
  created_at: '2026-03-01T10:00:00Z',
  customer: { id: 10, name: 'Cliente Teste', cnpj_cpf: '12345678000199' },
  invoice_bls: [
    {
      id: 101,
      bl_id: 'BL-INV-001',
      subtotal_brl: 1500,
      subtotal_usd: 0,
      bl: {
        pod: 'BRSSA',
        voyage: { voyage_number: '12', vessel: { name: 'Vessel A' } },
      },
    },
  ],
}

describe('InvoicesTable', () => {
  it('oferece ação no vazio e alinha a coluna financeira à direita', () => {
    render(
      <MemoryRouter>
        <InvoicesTable invoices={[]} isLoading={false} error={null} totalCount={0} filterDescription="" emptyState={{ title: 'Nenhuma fatura' }} emptyAction={<button>Limpar filtros</button>} page={1} totalPages={1} onPageChange={vi.fn()} onSelectInvoice={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: 'Limpar filtros' })).toBeTruthy()

    cleanup()
    render(
      <MemoryRouter>
        <InvoicesTable invoices={[baseInvoice]} isLoading={false} error={null} totalCount={1} filterDescription="" emptyState={{ title: 'Nenhuma fatura' }} page={1} totalPages={1} onPageChange={vi.fn()} onSelectInvoice={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('columnheader', { name: 'Financeiro' }).className).toContain('text-right')
  })

  it('aponta o número do BL para a ficha do B/L', () => {
    render(
      <MemoryRouter>
        <InvoicesTable
          invoices={[baseInvoice]}
          isLoading={false}
          error={null}
          totalCount={1}
          filterDescription=""
          emptyState={{ title: 'Nenhuma fatura' }}
          page={1}
          totalPages={1}
          onPageChange={vi.fn()}
          onSelectInvoice={vi.fn()}
        />
      </MemoryRouter>,
    )

    const link = screen.getByRole('link', { name: 'BL-INV-001' })
    expect(link.getAttribute('href')).toBe('/bls/BL-INV-001')
  })

  it('aponta múltiplos BLs para suas respectivas fichas de B/L', () => {
    const consolidatedInvoice: InvoiceListRow = {
      ...baseInvoice,
      id: 2,
      invoice_type: 'consolidated',
      invoice_bls: [
        { id: 101, bl_id: 'BL-A', subtotal_brl: 500, subtotal_usd: 0, bl: { pod: 'BRSSA', voyage: { voyage_number: '12', vessel: { name: 'Vessel A' } } } },
        { id: 102, bl_id: 'BL-B', subtotal_brl: 500, subtotal_usd: 0, bl: { pod: 'BRSSA', voyage: { voyage_number: '12', vessel: { name: 'Vessel A' } } } },
        { id: 103, bl_id: 'BL-C', subtotal_brl: 500, subtotal_usd: 0, bl: { pod: 'BRSSA', voyage: { voyage_number: '12', vessel: { name: 'Vessel A' } } } },
      ],
    }

    render(
      <MemoryRouter>
        <InvoicesTable
          invoices={[consolidatedInvoice]}
          isLoading={false}
          error={null}
          totalCount={1}
          filterDescription=""
          emptyState={{ title: 'Nenhuma fatura' }}
          page={1}
          totalPages={1}
          onPageChange={vi.fn()}
          onSelectInvoice={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'BL-A' }).getAttribute('href')).toBe('/bls/BL-A')
    expect(screen.getByRole('link', { name: 'BL-B' }).getAttribute('href')).toBe('/bls/BL-B')
    expect(screen.getByText('+1')).toBeTruthy()
  })
})

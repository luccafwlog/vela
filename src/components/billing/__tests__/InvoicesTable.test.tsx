// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  it('oferece ação no vazio e mostra as oito colunas da versão limpa', () => {
    render(
      <MemoryRouter>
        <InvoicesTable invoices={[]} isLoading={false} error={null} totalCount={0} emptyState={{ title: 'Nenhuma fatura' }} emptyAction={<button>Limpar filtros</button>} page={1} totalPages={1} onPageChange={vi.fn()} onSelectInvoice={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: 'Limpar filtros' })).toBeTruthy()

    cleanup()
    render(
      <MemoryRouter>
        <InvoicesTable invoices={[baseInvoice]} isLoading={false} error={null} totalCount={1} emptyState={{ title: 'Nenhuma fatura' }} page={1} totalPages={1} onPageChange={vi.fn()} onSelectInvoice={vi.fn()} />
      </MemoryRouter>,
    )
    // Tabela limpa: uma linha de título, oito colunas, Situação no fim.
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Fatura', 'B/L', 'Emissão', 'Cliente', 'Navio / Viagem', 'Total', 'Saldo', 'Situação'])
  })

  it('aponta o número do BL para a ficha do B/L', () => {
    render(
      <MemoryRouter>
        <InvoicesTable
          invoices={[baseInvoice]}
          isLoading={false}
          error={null}
          totalCount={1}

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

  it('consolidada mostra o primeiro B/L, "+n" e o ícone de pilha', () => {
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

          emptyState={{ title: 'Nenhuma fatura' }}
          page={1}
          totalPages={1}
          onPageChange={vi.fn()}
          onSelectInvoice={vi.fn()}
        />
      </MemoryRouter>,
    )

    // O primeiro B/L e "+n"; consolidada marcada pelo ícone, não por selo.
    expect(screen.getByRole('link', { name: 'BL-A' }).getAttribute('href')).toBe('/bls/BL-A')
    expect(screen.queryByRole('link', { name: 'BL-B' })).toBeNull()
    expect(screen.getByText('+2').getAttribute('title')).toBe('BL-A, BL-B, BL-C')
    expect(screen.getByRole('img', { name: 'Consolidada' })).toBeTruthy()
  })

  it('mostra fatura avulsa sem B/L e usa navio/viagem do contexto direto', () => {
    const manualInvoice: InvoiceListRow = {
      ...baseInvoice,
      id: 3,
      invoice_type: 'manual',
      bl_id: null,
      voyage_id: 42,
      voyage: { id: 42, voyage_number: '42N', vessel: { name: 'Navio Manual' } },
      invoice_bls: [],
      invoice_receivable_links: [],
    }

    render(
      <MemoryRouter>
        <InvoicesTable
          invoices={[manualInvoice]}
          isLoading={false}
          error={null}
          totalCount={1}

          emptyState={{ title: 'Nenhuma fatura' }}
          page={1}
          totalPages={1}
          onPageChange={vi.fn()}
          onSelectInvoice={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('Sem B/L')).toBeTruthy()
    expect(screen.queryByText('0 B/Ls')).toBeNull()
    expect(screen.getByText('Navio Manual / 42N')).toBeTruthy()
  })

  it('o número abre o detalhe; a parcial mostra o saldo em âmbar, sem CNPJ nem texto embaixo', () => {
    const onSelectInvoice = vi.fn()
    render(
      <MemoryRouter>
        <InvoicesTable invoices={[{ ...baseInvoice, status: 'partially_paid', total_paid_brl: 500, balance_brl: 1000 }]} isLoading={false} error={null} totalCount={1} emptyState={{ title: 'Nenhuma fatura' }} page={1} totalPages={1} onPageChange={vi.fn()} onSelectInvoice={onSelectInvoice} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Abrir fatura FAT-001' }))
    expect(onSelectInvoice).toHaveBeenCalledWith(1)
    // CNPJ sai da linha (fica no detalhe); nada escrito embaixo do valor.
    expect(screen.queryByText('12.345.678/0001-99')).toBeNull()
    expect(screen.getByText('Parcialmente paga')).toBeTruthy()
    const row = screen.getByRole('button', { name: 'Abrir fatura FAT-001' }).closest('tr')!
    expect(row.textContent).not.toContain('em aberto de')
    expect(row.querySelector('.app-status-text--warning')?.textContent).toMatch(/R\$\s1\.000,00/)
    expect(screen.queryByRole('button', { name: 'Detalhes' })).toBeNull()
  })

  it('erro de consulta avisa e oferece nova tentativa em vez de parecer lista vazia', () => {
    const onRetry = vi.fn()
    render(
      <MemoryRouter>
        <InvoicesTable invoices={[]} isLoading={false} error={new Error('falhou')} onRetry={onRetry} totalCount={0} emptyState={{ title: 'Nenhuma fatura' }} page={1} totalPages={1} onPageChange={vi.fn()} onSelectInvoice={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível carregar as faturas')
    expect(screen.queryByText('Nenhuma fatura')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('cancelada fica inteira em cinza e paga leva o ✓ antes da palavra', () => {
    render(
      <MemoryRouter>
        <InvoicesTable invoices={[{ ...baseInvoice, id: 7, invoice_number: 'FAT-007', status: 'cancelled' }, { ...baseInvoice, id: 8, invoice_number: 'FAT-008', status: 'paid', balance_brl: 0 }]} isLoading={false} error={null} totalCount={2} emptyState={{ title: 'Nenhuma fatura' }} page={1} totalPages={1} onPageChange={vi.fn()} onSelectInvoice={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: 'Abrir fatura FAT-007' }).closest('tr')!.className).toContain('app-table__row--muted')
    const paid = screen.getByRole('button', { name: 'Abrir fatura FAT-008' }).closest('tr')!
    expect(paid.querySelector('.app-status-text--paid svg')).toBeTruthy()
  })
})

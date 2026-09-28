import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialogProvider } from '../../ui/ConfirmDialog'
import { ConsolidatedInvoiceModal } from '../ConsolidatedInvoiceModal'

vi.mock('../../../hooks/useBilling', () => ({
  useBillingCustomers: () => ({ data: [] }),
}))

vi.mock('../../../hooks/useBillingLedger', () => ({
  useConsolidatableReceivables: () => ({ data: [], isLoading: false }),
  useCreateConsolidatedInvoice: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('../../../hooks/useBls', () => ({
  useVoyageOptions: () => ({ data: [] }),
}))

vi.mock('../../ui/Toast', async () => {
  const actual = await vi.importActual<typeof import('../../ui/Toast')>('../../ui/Toast')
  return {
    ...actual,
    useToast: () => ({ showToast: vi.fn() }),
  }
})

describe('ConsolidatedInvoiceModal', () => {
  it('renders the optional voyage filter', () => {
    const html = renderToStaticMarkup(
      React.createElement(ConfirmDialogProvider, null,
        React.createElement(ConsolidatedInvoiceModal, { open: true, onClose: vi.fn() }),
      ),
    )

    expect(html).toContain('Viagem')
    expect(html).toContain('Busque por navio ou viagem')
  })

  it('usa layout empilhado (filtros em grade no topo, tabela, rodape fixo)', () => {
    const html = renderToStaticMarkup(
      React.createElement(ConfirmDialogProvider, null,
        React.createElement(ConsolidatedInvoiceModal, { open: true, onClose: vi.fn() }),
      ),
    )
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

    expect(html).toContain('data-testid="consolidated-invoice-main"')
    expect(html).toContain('data-testid="consolidated-invoice-filters"')
    expect(html).toContain('data-testid="consolidated-invoice-table"')
    expect(html).toContain('data-testid="consolidated-invoice-footer"')
    // Filtros em barra horizontal (grade de 12 colunas) no topo.
    expect(html).toContain('invoice-create-modal__filters-grid')
    expect(css).toMatch(/\.invoice-create-modal\s*\{[^}]*display:\s*grid/)
    expect(css).toMatch(/\.invoice-create-modal\s*\{[^}]*grid-template-areas:\s*"filters"\s*"table"\s*"footer"/)
    expect(css).toContain('grid-template-columns: repeat(12, minmax(0, 1fr))')
    expect(css).toMatch(/\.invoice-create-modal__footer\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*0/)
  })
})

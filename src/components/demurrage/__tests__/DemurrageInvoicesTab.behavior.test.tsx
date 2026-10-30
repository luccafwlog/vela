// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { DemurrageInvoicesTab } from '../DemurrageInvoicesTab'

vi.mock('../../../services/supabase', () => ({ supabase: {} }))
vi.mock('../../../services/demurrageDunning', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/demurrageDunning')>()),
  fetchDemurrageDunningStatuses: vi.fn(async () => new Map()),
}))

vi.mock('../../../services/demurrage/demurrageInvoiceView', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/demurrage/demurrageInvoiceView')>()),
  fetchDemurrageInvoiceDetails: vi.fn(async () => new Map([
    [3, { paymentRoe: 5.6123, cancelReason: null, cancelledBy: null, cancelledAt: null, destinations: [] }],
    [4, { paymentRoe: null, cancelReason: 'Datas de container alteradas: cancelada para reemissão automática.', cancelledBy: 'Sistema', cancelledAt: '2026-08-12T12:00:00Z',
      destinations: [{ kind: 'reemitida', invoice_id: 5, doc_number: 'DEM-005', containers: ['MSCU1234567'] }] }],
  ])),
}))

afterEach(cleanup)

const invoice = {
  id: 1,
  doc_number: 'DEM-001',
  bl_id: 'BL-001',
  customer_id: 7,
  status: 'issued',
  billed_at: '2026-08-09T12:00:00Z',
  total_usd: 1000,
  current_total_brl: 4400,
  current_roe: 5.5,
  roe_source: 'bcb_live',
  discount_mode: 'percent',
  discount_value: 20,
  dispute_open: true,
  dispute_status: null,
  dunning_suspended_reason: 'Datas de container alteradas em Invoice com desconto ou disputa; reemitir à mão.',
  customer: { name: 'Cliente Alpha', cnpj_cpf: '11222333000181' },
} as never

function renderTab(props: Partial<Parameters<typeof DemurrageInvoicesTab>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onOpenDetail = vi.fn()
  const onSearchChange = vi.fn()
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <DemurrageInvoicesTab
          tab="emitidas"
          invoices={[invoice]}
          search=""
          loading={false}
          error={null}
          onRetry={vi.fn()}
          onSearchChange={onSearchChange}
          onOpenDetail={onOpenDetail}
          {...props}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  )
  return { onOpenDetail, onSearchChange }
}

it('o número da Invoice abre o detalhe e a linha mostra o USD a cobrar depois do desconto', async () => {
  const user = userEvent.setup()
  const { onOpenDetail } = renderTab()

  expect(screen.getByTestId('demurrage-invoice-context')).toBeTruthy()
  const financial = screen.getByTestId('demurrage-invoice-financial')
  expect(financial.textContent).toContain('800,00')
  // Tabela limpa: o desconto aparece ao passar o mouse, e o CNPJ fica no detalhe e na busca.
  expect(financial.getAttribute('title')).toContain('desconto')
  expect(screen.queryByText('11.222.333/0001-81')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Detalhes' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'DEM-001' }))
  expect(onOpenDetail).toHaveBeenCalledWith(1)
})

it('disputa aberta vira a situação "Em disputa", em texto', () => {
  renderTab()
  expect(within(screen.getByRole('table')).getByText('Em disputa')).toBeTruthy()
})

it('sem a coluna da Régua (Pagas), a Invoice fora da Régua diz isso ao lado da situação', () => {
  renderTab({ tab: 'pagas', invoices: [{ ...(invoice as object), status: 'paid', dispute_open: false, paid_at: '2026-08-20T12:00:00Z' } as never] })
  expect(screen.getByText('Fora da Régua')).toBeTruthy()
  expect(screen.getByText('20/08/2026')).toBeTruthy()
})

it('a busca ainda acha a Invoice pelo CNPJ do Cliente', () => {
  renderTab({ search: '11222333' })
  expect(screen.getByRole('button', { name: 'DEM-001' })).toBeTruthy()
})

it('separa busca sem resultado de lista vazia e oferece limpar', async () => {
  const user = userEvent.setup()
  const { onSearchChange } = renderTab({ search: 'XYZ' })
  expect(screen.getByText('Nenhuma Invoice nesta busca')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Limpar busca' }))
  expect(onSearchChange).toHaveBeenCalledWith('')
})

it('erro de consulta não vira lista vazia', () => {
  renderTab({ invoices: undefined, error: new Error('boom') })
  expect(screen.getByText('Não foi possível carregar as Invoices de Demurrage.')).toBeTruthy()
  expect(screen.queryByText('Nenhuma Invoice aguardando pagamento')).toBeNull()
})

const plain = {
  ...(invoice as object),
  id: 2,
  doc_number: 'DEM-002',
  customer_id: 8,
  discount_mode: null,
  discount_value: null,
  dispute_open: false,
  dunning_suspended_reason: null,
  total_usd: 500,
  current_total_brl: 2750,
  customer: { name: 'Cliente Beta', cnpj_cpf: '11222333000262' },
} as never

it('os filtros rápidos reduzem a lista e o resumo junto', async () => {
  const user = userEvent.setup()
  renderTab({ invoices: [invoice, plain] })
  expect(screen.getAllByTestId('demurrage-invoice-context')).toHaveLength(2)

  await user.click(screen.getByRole('switch', { name: 'Com desconto' }))
  expect(screen.getAllByTestId('demurrage-invoice-context')).toHaveLength(1)
  expect(screen.getByText('DEM-001')).toBeTruthy()
  const summary = screen.getByLabelText('Resumo das Invoices')
  expect(summary.textContent).toContain('800,00')
  expect(summary.textContent).not.toContain('1.300,00')

  await user.click(screen.getByRole('switch', { name: 'Com desconto' }))
  await user.click(screen.getByRole('switch', { name: 'Fora da Régua' }))
  expect(screen.getAllByTestId('demurrage-invoice-context')).toHaveLength(1)
  expect(screen.getByText('DEM-001')).toBeTruthy()
})

it('Faturas mostra o desconto com o motivo e há quantos dias está em aberto', () => {
  renderTab({ invoices: [{ ...(invoice as object), discount_justification: 'Acordo comercial' } as never] })
  expect(screen.getByRole('columnheader', { name: 'Desconto' })).toBeTruthy()
  expect(screen.getByTitle('Motivo: Acordo comercial').textContent).toContain('200,00')
  expect(screen.getByRole('columnheader', { name: 'Em aberto há' })).toBeTruthy()
  expect(screen.getByRole('columnheader', { name: 'USD a cobrar' })).toBeTruthy()
})

it('Pagas mostra o meio de pagamento, o ROE do pagamento e os dias até pagar', async () => {
  const paid = { ...(plain as object), id: 3, doc_number: 'DEM-003', status: 'paid', paid_at: '2026-08-19', payment_method: 'pix_itau' } as never
  renderTab({ tab: 'pagas', invoices: [paid] })
  expect(screen.getByRole('columnheader', { name: 'USD pago' })).toBeTruthy()
  expect(screen.queryByRole('columnheader', { name: 'USD a cobrar' })).toBeNull()
  expect(screen.getByText('Pix Itaú')).toBeTruthy()
  expect(screen.getByText('10 dias')).toBeTruthy()
  expect(await screen.findByText('5,6123')).toBeTruthy()
})

it('Canceladas mostra o motivo, quem cancelou e a Invoice que reemitiu, com link', async () => {
  const user = userEvent.setup()
  const cancelled = { ...(plain as object), id: 4, doc_number: 'DEM-004', status: 'cancelled' } as never
  const { onOpenDetail } = renderTab({ tab: 'canceladas', invoices: [cancelled] })
  expect(screen.getByRole('columnheader', { name: 'USD cancelado' })).toBeTruthy()
  expect(await screen.findByText('Datas de container alteradas: cancelada para reemissão automática.')).toBeTruthy()
  expect(screen.getByText('Sistema')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'MSCU1234567: reemitida na DEM-005' }))
  expect(onOpenDetail).toHaveBeenCalledWith(5)
})

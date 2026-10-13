// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
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
  expect(screen.getByTestId('demurrage-invoice-financial').textContent).toContain('800,00')
  expect(screen.getByText('11.222.333/0001-81')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Detalhes' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'DEM-001' }))
  expect(onOpenDetail).toHaveBeenCalledWith(1)
})

it('diz que a Invoice está fora da Régua e com disputa, sem depender só da cor', () => {
  renderTab()
  expect(screen.getByText('Fora da Régua: datas alteradas')).toBeTruthy()
  expect(screen.getByText('Disputa aberta')).toBeTruthy()
  expect(screen.getByText('Com desconto')).toBeTruthy()
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

// @vitest-environment jsdom
//
// A fila de reconciliação oferecia um par "Peso total / CBM total" só, ligado a
// `total_weight_kg`/`total_cbm`. Desde as migrations 061 e 064 essas duas
// colunas medem exclusivamente a carga CONTEINERIZADA, então um B/L de carga
// solta aparecia aqui com os dois campos vazios — e quem preenchesse criava uma
// segunda cubagem, que `blTotalCbm()` somava à que já existia em `bb_cbm`.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewDrawer } from '../ReviewDrawer'
import type { ReviewQueueItem } from '../../../hooks/useReview'

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, isAdmin: true }) }))
vi.mock('../../../hooks/useCustomers', () => ({ useCustomerLookup: () => ({ data: [] }) }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../../services/review', () => ({
  ConcurrentEditError: class extends Error {},
  saveBlReview: vi.fn(),
  saveGraniteBlReview: vi.fn(),
}))

function makeItem(overrides: Partial<ReviewQueueItem>): ReviewQueueItem {
  return {
    id: 'BL-CBM-1',
    source: 'bl',
    consignee: 'Timbro Trading',
    shipper: 'Sany',
    customer_id: null,
    customer: null,
    review_reasons: ['Pendente de revisão'],
    updated_at: '2026-09-18T12:00:00Z',
    ...overrides,
  } as unknown as ReviewQueueItem
}

function renderDrawer(item: ReviewQueueItem) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ReviewDrawer
        item={item}
        currentIndex={0}
        totalItems={1}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onReviewSaved={vi.fn()}
        onNavigate={vi.fn()}
        siblingIds={[]}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ReviewDrawer: peso e cubagem por modalidade', () => {
  it('B/L de carga solta edita as colunas de carga solta, e não as de contêiner', () => {
    renderDrawer(makeItem({ cargo_mode: 'carga_solta', bb_weight_ton: 259.312, bb_cbm: 1217.109 } as never))

    expect((screen.getByLabelText('Peso carga solta (ton)') as HTMLInputElement).value).toBe('259.312')
    expect((screen.getByLabelText('CBM carga solta (m³)') as HTMLInputElement).value).toBe('1217.109')
    expect(screen.queryByLabelText('CBM contêiner (m³)')).toBeNull()
    expect(screen.queryByLabelText('Peso contêiner (kg)')).toBeNull()
  })

  it('B/L de contêiner edita as colunas de contêiner', () => {
    renderDrawer(makeItem({ cargo_mode: 'container', total_weight_kg: 24000, total_cbm: 58.4 } as never))

    expect((screen.getByLabelText('Peso contêiner (kg)') as HTMLInputElement).value).toBe('24000')
    expect((screen.getByLabelText('CBM contêiner (m³)') as HTMLInputElement).value).toBe('58.4')
    expect(screen.queryByLabelText('CBM carga solta (m³)')).toBeNull()
  })

  it('B/L misto edita os dois pares, porque satisfaz os dois predicados', () => {
    renderDrawer(makeItem({ cargo_mode: 'misto', total_cbm: 58.4, bb_cbm: 120 } as never))

    expect((screen.getByLabelText('CBM contêiner (m³)') as HTMLInputElement).value).toBe('58.4')
    expect((screen.getByLabelText('CBM carga solta (m³)') as HTMLInputElement).value).toBe('120')
  })
})

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  createCustomer: vi.fn(),
  findCustomerIdByDocument: vi.fn(),
  linkBlCustomer: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../../hooks/useLocalCharges', () => ({ useOverrideCustomers: () => ({ data: [], isFetching: false }) }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../../services/customers', () => ({
  createCustomer: mocks.createCustomer,
  findCustomerIdByDocument: mocks.findCustomerIdByDocument,
}))
vi.mock('../../../services/review', () => ({ linkBlCustomer: mocks.linkBlCustomer }))

import { BlClienteSection } from '../BlClienteSection'

const bl = {
  id: 'BL-1',
  voyage_id: 1,
  customer_id: null,
  customer: null,
  manifest_customer_name: 'ACME LTDA',
  manifest_customer_cnpj_cpf: '11222333000181',
  manifest_customer_email: 'ops@acme.test',
} as never

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

function clickManifestLink() {
  render(<MemoryRouter><BlClienteSection bl={bl} /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Vincular' }))
}

describe('vínculo do cliente na ficha do B/L', () => {
  it('não cadastra o cliente do manifesto quando a confirmação é cancelada', async () => {
    mocks.findCustomerIdByDocument.mockResolvedValue(null)
    mocks.confirm.mockResolvedValue(false)
    clickManifestLink()
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
    expect(mocks.createCustomer).not.toHaveBeenCalled()
    expect(mocks.linkBlCustomer).not.toHaveBeenCalled()
  })

  it('usa o cadastro existente pelo CNPJ sem criar outro', async () => {
    mocks.findCustomerIdByDocument.mockResolvedValue(42)
    mocks.confirm.mockResolvedValue(true)
    mocks.linkBlCustomer.mockResolvedValue(undefined)
    clickManifestLink()
    await waitFor(() => expect(mocks.linkBlCustomer).toHaveBeenCalledWith(expect.objectContaining({ blId: 'BL-1', customerId: 42 })))
    expect(mocks.createCustomer).not.toHaveBeenCalled()
  })
})

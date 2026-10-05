// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ isAdmin: true, mayConfirm: true, confirm: vi.fn(), request: vi.fn(), settle: vi.fn(), toast: vi.fn(), summary: { received_brl: 550, refunds: [{ id: 1, amount_brl: 100, status: 'pending', purpose: 'correction', notes: 'Ajuste autorizado', bank_reference: null, beneficiary: null, settled_at: null }] } }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: mocks.isAdmin, can: () => mocks.mayConfirm }) }))
vi.mock('../../../hooks/useFinancialRefunds', () => ({ useFinancialRefunds: () => ({ data: mocks.summary }) }))
vi.mock('../../../services/financialRefunds', () => ({ cancelFinancialRefundAuthorization: vi.fn(), requestFinancialRefund: mocks.request, confirmDemurrageRefund: mocks.settle }))
vi.mock('../../../services/cacheEffects', () => ({ afterDatasContainerAlteradas: vi.fn() }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.toast }) }))
import { FinancialRefundsPanel } from '../FinancialRefundsPanel'
function mount() { return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><FinancialRefundsPanel source="demurrage" invoiceId={9} /></QueryClientProvider>) }
beforeEach(() => { vi.clearAllMocks(); mocks.isAdmin = true; mocks.mayConfirm = true; mocks.confirm.mockResolvedValue(true); mocks.request.mockResolvedValue(undefined); mocks.settle.mockResolvedValue(undefined) })
afterEach(cleanup)

it('consulta preserva valores sem oferecer ações à leitura sem autorização', () => {
  mocks.isAdmin = false; mocks.mayConfirm = false
  mount()
  expect(screen.getByText(/Disponível para autorizar/).textContent).toMatch(/450,00/)
  expect(screen.queryByRole('button')).toBeNull()
})
it('rejeita autorização acima do valor recebido ainda disponível', async () => {
  mount()
  fireEvent.change(screen.getByLabelText('Valor da restituição BRL'),{target:{value:'451'}})
  fireEvent.change(screen.getByLabelText('Justificativa da restituição'),{target:{value:'Erro na cobrança original'}})
  fireEvent.click(screen.getByRole('button',{name:'Autorizar restituição'}))
  await waitFor(() => expect(mocks.toast).toHaveBeenCalled())
  expect(mocks.confirm).not.toHaveBeenCalled()
  expect(mocks.request).not.toHaveBeenCalled()
})
it('confirma devolução somente depois de informar evidência e aceitar a conferência', async () => {
  mount()
  fireEvent.click(screen.getByRole('button',{name:'Registrar devolução'}))
  expect((screen.getByRole('button',{name:'Confirmar devolução realizada'}) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Referência do comprovante bancário'),{target:{value:'BANCO-REF-100'}})
  fireEvent.change(screen.getByLabelText('Favorecido (Cliente original / CNPJ)'),{target:{value:'Cliente original'}})
  fireEvent.change(screen.getByLabelText('Data da devolução'),{target:{value:'2026-10-01'}})
  mocks.confirm.mockResolvedValueOnce(false)
  fireEvent.click(screen.getByRole('button',{name:'Confirmar devolução realizada'}))
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
  expect(mocks.settle).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'Confirmar devolução realizada'}))
  await waitFor(() => expect(mocks.settle).toHaveBeenCalledWith({refundId:1,bankReference:'BANCO-REF-100',beneficiary:'Cliente original',paidAt:new Date('2026-10-01T00:00:00').toISOString()},expect.anything()))
})

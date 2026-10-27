import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRpc, mockInvite } = vi.hoisted(() => ({ mockRpc: vi.fn(), mockInvite: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: mockRpc } }))
vi.mock('../portalProvisioning', () => ({ sendPortalInvite: mockInvite }))

import { ConcurrentEditError } from '../review'
import { completeReviewCustomerGroup, sendReviewPortalInvite } from '../reviewCustomerGroup'

describe('reviewCustomerGroup service', () => {
  beforeEach(() => { mockRpc.mockReset(); mockInvite.mockReset(); mockInvite.mockResolvedValue(undefined) })

  it('envia o grupo e o e-mail normalizados para a RPC', async () => {
    mockRpc.mockResolvedValue({ data: { customer: { id: 8, cnpj_cpf: '11222333000181', name: 'Cliente Teste' }, bls: [] }, error: null })
    await completeReviewCustomerGroup({ blIds: ['BL1', 'BL2'], customerId: null, cnpjCpf: '11.222.333/0001-81', name: 'Cliente Teste', email: ' Financeiro@EXAMPLE.COM ', changedBy: 'actor-1' })
    expect(mockRpc).toHaveBeenCalledWith('complete_review_customer_group', { p_bl_ids: ['BL1', 'BL2'], p_customer_id: null, p_cnpj_cpf: '11222333000181', p_name: 'Cliente Teste', p_email: 'financeiro@example.com', p_changed_by: 'actor-1' })
  })

  // D10 de 2026-10-27: quem não edita contatos cadastra sem e-mail; e-mail digitado errado continua recusado.
  it('sem e-mail manda nulo para a RPC; e-mail inválido é recusado antes', async () => {
    mockRpc.mockResolvedValue({ data: { customer: { id: 8, cnpj_cpf: '11222333000181', name: 'Cliente Teste' }, bls: [] }, error: null })
    await completeReviewCustomerGroup({ blIds: ['BL1'], customerId: null, cnpjCpf: '11222333000181', name: 'Cliente Teste', email: '', changedBy: 'actor-1' })
    expect(mockRpc).toHaveBeenCalledWith('complete_review_customer_group', expect.objectContaining({ p_email: null }))
    await expect(completeReviewCustomerGroup({ blIds: ['BL1'], customerId: null, cnpjCpf: '11222333000181', name: 'Cliente', email: 'sem-arroba', changedBy: 'actor-1' })).rejects.toThrow('Informe um e-mail válido para o cliente.')
  })

  it('converte conflito do banco em ConcurrentEditError', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'grupo alterado' } })
    await expect(completeReviewCustomerGroup({ blIds: ['BL1'], customerId: null, cnpjCpf: '11222333000181', name: 'Cliente', email: 'a@b.com', changedBy: 'actor-1' })).rejects.toBeInstanceOf(ConcurrentEditError)
  })

  it('preserva a mensagem acionável para conflito documental PT409', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'O B/L BL1 contém CNPJs conflitantes nas evidências.' } })
    await expect(completeReviewCustomerGroup({ blIds: ['BL1'], customerId: null, cnpjCpf: '11222333000181', name: 'Cliente', email: 'a@b.com', changedBy: 'actor-1' })).rejects.toMatchObject({ message: 'O B/L BL1 contém CNPJs conflitantes nas evidências.' })
    await expect(completeReviewCustomerGroup({ blIds: ['BL1'], customerId: null, cnpjCpf: '11222333000181', name: 'Cliente', email: 'a@b.com', changedBy: 'actor-1' })).rejects.not.toBeInstanceOf(ConcurrentEditError)
  })

  it('envia o convite para o mesmo e-mail informado', async () => {
    await sendReviewPortalInvite(8, ' Portal@Example.com ')
    expect(mockInvite).toHaveBeenCalledWith(8, 'portal@example.com', 'informado_manualmente')
  })
})

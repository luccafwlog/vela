import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('../supabase', () => ({ supabase: { functions: { invoke } } }))

import { lookupCnpj } from '../cnpjLookup'

const data = { cnpj: '19131243000197', razao_social: 'OPEN KNOWLEDGE BRASIL', nome_fantasia: '', cep: '01311902', endereco: 'AVENIDA PAULISTA, 37', cidade: 'SAO PAULO', uf: 'SP', situacao: 'ATIVA' }

describe('lookupCnpj (ADR 0127)', () => {
  beforeEach(() => invoke.mockReset())

  it('chama a Edge Function cnpj-lookup e devolve os dados da Receita', async () => {
    invoke.mockResolvedValue({ data: { status: 'encontrado', data }, error: null })
    await expect(lookupCnpj('19131243000197')).resolves.toEqual({ status: 'encontrado', data })
    expect(invoke).toHaveBeenCalledWith('cnpj-lookup', { body: { cnpj: '19131243000197' } })
  })

  it('recusa, falha de rede ou resposta fora do contrato viram indisponivel, sem lançar', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: new Error('403') })
    invoke.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    invoke.mockResolvedValueOnce({ data: { status: 'encontrado', data: { cnpj: 'x' } }, error: null })
    for (let i = 0; i < 3; i += 1) await expect(lookupCnpj('19131243000197')).resolves.toEqual({ status: 'indisponivel' })
  })
})

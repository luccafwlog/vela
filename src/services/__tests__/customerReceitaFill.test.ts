import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyReceitaFill, listCustomersMissingReceitaData, planReceitaFill, RECEITA_FILL_JUSTIFICATION } from '../customerReceitaFill'

const { mockFrom, mockRpc } = vi.hoisted(() => ({ mockFrom: vi.fn(), mockRpc: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { from: mockFrom, rpc: mockRpc } }))

const receita = {
  cnpj: '35564896000116',
  razao_social: 'YAHO LOGISTICS DO BRASIL LIMITADA',
  nome_fantasia: 'YAHO LOGISTICS DO BRASIL',
  cep: '05314000',
  endereco: 'AVENIDA DR GASTAO VIDIGAL, 1305 - CONJ 42 - VILA LEOPOLDINA',
  cidade: 'SAO PAULO',
  uf: 'SP',
  situacao: 'ATIVA',
}
const empty = { trade_name: null, address: null, city: null, state: null, zip: null }

/** Encadeamento do PostgREST que termina na chamada final com `result`. */
function chain(result: unknown, terminal: 'range' | 'single') {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'is', 'order', 'eq']) builder[method] = vi.fn(() => builder)
  builder[terminal] = vi.fn(() => Promise.resolve(result))
  return builder
}

describe('Completar pela Receita', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
  })

  it('preenche só os campos vazios, no formato do Novo cliente', () => {
    expect(planReceitaFill(empty, receita)).toEqual({
      trade_name: 'YAHO LOGISTICS DO BRASIL',
      address: 'AVENIDA DR GASTAO VIDIGAL, 1305 - CONJ 42 - VILA LEOPOLDINA',
      city: 'SAO PAULO',
      state: 'SP',
      zip: '05314000',
    })
    // O que já está preenchido fica; razão social não entra.
    expect(planReceitaFill({ ...empty, address: 'RUA DO CLIENTE, 1', city: 'VITORIA' }, receita)).toEqual({
      trade_name: 'YAHO LOGISTICS DO BRASIL', state: 'SP', zip: '05314000',
    })
    // CEP e UF fora do formato ficam de fora, em vez de gravar lixo.
    expect(planReceitaFill(empty, { ...receita, cep: '0531', uf: 'Sao Paulo', nome_fantasia: '  ' })).toEqual({
      address: receita.endereco, city: 'SAO PAULO',
    })
  })

  it('lista só Clientes ativos com CNPJ válido a que falta algum campo', async () => {
    const builder = chain({
      data: [
        { id: 1, cnpj_cpf: '35564896000116', name: 'YAHO', ...empty },
        { id: 2, cnpj_cpf: '11222333000181', name: 'COMPLETO', trade_name: 'X', address: 'Y', city: 'Z', state: 'ES', zip: '29010000' },
        { id: 3, cnpj_cpf: '12345678909', name: 'PESSOA FISICA', ...empty },
      ],
      error: null,
    }, 'range')
    mockFrom.mockReturnValue(builder)
    await expect(listCustomersMissingReceitaData()).resolves.toEqual([expect.objectContaining({ id: 1 })])
    expect(builder.is).toHaveBeenCalledWith('deactivated_at', null)
  })

  it('relê o Cliente e não sobrescreve o que alguém preencheu depois da consulta', async () => {
    mockFrom.mockReturnValue(chain({ data: { ...empty, address: 'PREENCHIDO DEPOIS' }, error: null }, 'single'))
    mockRpc.mockResolvedValue({ data: true, error: null })
    const fields = await applyReceitaFill(1, planReceitaFill(empty, receita), 'user-1')
    expect(fields).toEqual(['trade_name', 'city', 'state', 'zip'])
    expect(mockRpc).toHaveBeenCalledWith('update_customer_with_audit', {
      p_customer_id: 1,
      p_updates: { trade_name: 'YAHO LOGISTICS DO BRASIL', city: 'SAO PAULO', state: 'SP', zip: '05314000' },
      p_changed_by: 'user-1',
      p_justification: RECEITA_FILL_JUSTIFICATION,
    })
  })

  it('não chama a gravação quando nada continua vazio', async () => {
    mockFrom.mockReturnValue(chain({ data: { trade_name: 'A', address: 'B', city: 'C', state: 'ES', zip: '29010000' }, error: null }, 'single'))
    await expect(applyReceitaFill(1, planReceitaFill(empty, receita), 'user-1')).resolves.toEqual([])
    expect(mockRpc).not.toHaveBeenCalled()
  })
})

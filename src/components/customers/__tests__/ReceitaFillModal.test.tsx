// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ list: vi.fn(), lookup: vi.fn(), apply: vi.fn() }))
vi.mock('../../../services/cnpjLookup', () => ({ lookupCnpj: mocks.lookup }))
vi.mock('../../../services/customerReceitaFill', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/customerReceitaFill')>()),
  listCustomersMissingReceitaData: mocks.list,
  applyReceitaFill: mocks.apply,
}))

import { ReceitaFillModal } from '../ReceitaFillModal'

const blank = { trade_name: null, address: null, city: null, state: null, zip: null }
const found = (overrides: Record<string, string> = {}) => ({
  status: 'encontrado',
  data: { cnpj: '', razao_social: '', nome_fantasia: 'YAHO', cep: '05314000', endereco: 'AV DR GASTAO VIDIGAL, 1305', cidade: 'SAO PAULO', uf: 'SP', situacao: 'ATIVA', ...overrides },
})

function renderModal() {
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ReceitaFillModal open onClose={onClose} changedBy="user-1" />
    </QueryClientProvider>,
  )
  return { onClose }
}

describe('ReceitaFillModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.list.mockResolvedValue([
      { id: 1, cnpj_cpf: '35564896000116', name: 'YAHO LOGISTICS', ...blank },
      { id: 2, cnpj_cpf: '11222333000181', name: 'ALFA', ...blank, address: 'RUA A, 10', city: 'VITORIA', state: 'ES', zip: '29010000' },
      { id: 3, cnpj_cpf: '99610001000115', name: 'SEM RECEITA', ...blank },
    ])
    mocks.lookup.mockImplementation((cnpj: string) => Promise.resolve(
      cnpj === '35564896000116' ? found() : cnpj === '11222333000181' ? found({ nome_fantasia: '' }) : { status: 'nao_encontrado' },
    ))
    mocks.apply.mockResolvedValue(['trade_name', 'address', 'city', 'state', 'zip'])
  })

  it('consulta, mostra a prévia e grava só os Clientes com o que completar', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(await screen.findByRole('button', { name: 'Consultar a Receita (3 Clientes)' }))
    const table = screen.getByRole('table')
    expect(await within(table).findByText(/Nome fantasia: YAHO · Endereço: AV DR GASTAO VIDIGAL, 1305 · Cidade: SAO PAULO · UF: SP · CEP: 05314-000/)).toBeTruthy()
    expect(within(table).getByText('A Receita não tem o que falta.')).toBeTruthy()
    expect(within(table).getByText('CNPJ não encontrado na Receita.')).toBeTruthy()
    expect(mocks.apply).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Gravar em 1 Cliente' }))
    expect(mocks.apply).toHaveBeenCalledTimes(1)
    expect(mocks.apply).toHaveBeenCalledWith(1, {
      trade_name: 'YAHO', address: 'AV DR GASTAO VIDIGAL, 1305', city: 'SAO PAULO', state: 'SP', zip: '05314000',
    }, 'user-1')
    expect(await screen.findByText('1 Cliente completado. Cada campo está no Histórico do Cliente.')).toBeTruthy()
  })

  it('mostra a falha de um Cliente sem esconder os gravados', async () => {
    mocks.lookup.mockResolvedValue(found())
    mocks.apply.mockResolvedValueOnce(['trade_name']).mockRejectedValueOnce({ code: '42501', message: 'Usuário sem permissão para editar o Cliente.' })
    const user = userEvent.setup()
    renderModal()

    await user.click(await screen.findByRole('button', { name: 'Consultar a Receita (3 Clientes)' }))
    await user.click(await screen.findByRole('button', { name: /^Gravar em/ }))
    expect(await screen.findByText(/Não gravado: Usuário sem permissão para editar o Cliente/)).toBeTruthy()
    expect(screen.getByText(/2 Clientes completados; 1 falhou\. Os demais já estão gravados\./)).toBeTruthy()
  })
})

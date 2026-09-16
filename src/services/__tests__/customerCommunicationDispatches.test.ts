import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    functions: {
      invoke: mocks.invoke,
    },
  },
}))

import { dispatchCustomerCommunication } from '../customerCommunicationDispatches'

const input = {
  customerId: 1,
  kind: 'institucional' as const,
  nature: 'avisos_gerais',
  recipient: 'qa-financeiro-20260915@example.test',
  subject: 'Comunicado sintético',
  html: '<p>Teste sintético</p>',
  text: 'Teste sintético',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('dispatchCustomerCommunication', () => {
  it('propaga o motivo devolvido no corpo de uma resposta não-2xx da Edge Function', async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: {
        name: 'FunctionsHttpError',
        message: 'Edge Function returned a non-2xx status code',
        context: {
          json: async () => ({ error: 'Contato desativado para esta caixa ou modelo.' }),
        },
      },
    })

    await expect(dispatchCustomerCommunication(input)).rejects.toThrow('Contato desativado para esta caixa ou modelo.')
  })
})

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

import { CustomerCommunicationDispatchError, dispatchCustomerCommunication } from '../customerCommunicationDispatches'

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

describe('dispatchCustomerCommunication — recusa do provedor (502)', () => {
  it('traduz o motivo da tentativa e marca a recusa definitiva, com o Comunicado', async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: {
        name: 'FunctionsHttpError',
        message: 'Edge Function returned a non-2xx status code',
        context: {
          json: async () => ({ communicationId: 41, status: 'falha', permanent: true, reason: 'HTTP 422 validation_error', message: 'Falha no envio do comunicado.' }),
        },
      },
    })

    const error = await dispatchCustomerCommunication(input).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(CustomerCommunicationDispatchError)
    expect(error).toMatchObject({
      message: 'O provedor recusou a mensagem (endereço ou conteúdo inválido).',
      permanent: true,
      communicationId: 41,
    })
  })

  it('falha transitória sem motivo registrado fica com a mensagem genérica e pode ser repetida', async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: { context: { json: async () => ({ communicationId: 41, status: 'falha', message: 'Falha no envio do comunicado.' }) } },
    })

    await expect(dispatchCustomerCommunication(input)).rejects.toMatchObject({ message: 'Falha no envio do comunicado.', permanent: false })
  })

  it('endereço suprimido também não adianta repetir', async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: { context: { json: async () => ({ error: 'Endereço suprimido para Comunicados.', suppressed: true }) } },
    })

    await expect(dispatchCustomerCommunication(input)).rejects.toMatchObject({ message: 'Endereço suprimido para Comunicados.', permanent: true })
  })
})

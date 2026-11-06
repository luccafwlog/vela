// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const lookupCnpj = vi.hoisted(() => vi.fn())
vi.mock('../../services/cnpjLookup', () => ({ lookupCnpj }))

import { useCnpjLookup } from '../useCnpjLookup'

const CNPJ = '11222333000181'
const found = {
  status: 'encontrado',
  data: { cnpj: CNPJ, razao_social: 'ACME LTDA', nome_fantasia: '', cep: '', endereco: '', cidade: '', uf: '', situacao: 'ATIVA' },
}

function harness() {
  // Mesmos padrões do cliente do app: sem refetch no foco.
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('consulta à Receita pelo CNPJ', () => {
  beforeEach(() => lookupCnpj.mockReset())

  it('dado encontrado vale para a sessão: reabrir a janela não consulta de novo', async () => {
    lookupCnpj.mockResolvedValue(found)
    const { wrapper } = harness()
    const first = renderHook(() => useCnpjLookup(CNPJ), { wrapper })
    await waitFor(() => expect(first.result.current.data).toEqual(found))
    first.unmount()

    const second = renderHook(() => useCnpjLookup(CNPJ), { wrapper })
    expect(second.result.current.data).toEqual(found)
    expect(lookupCnpj).toHaveBeenCalledTimes(1)
  })

  it('"indisponível" não fica guardado: reabrir a janela consulta de novo e mostra o dado', async () => {
    // Queda da BrasilAPI, limite de uso ou a Edge Function ainda não publicada.
    lookupCnpj.mockResolvedValueOnce({ status: 'indisponivel' }).mockResolvedValueOnce(found)
    const { wrapper } = harness()
    const first = renderHook(() => useCnpjLookup(CNPJ), { wrapper })
    await waitFor(() => expect(first.result.current.data).toEqual({ status: 'indisponivel' }))
    first.unmount()

    const second = renderHook(() => useCnpjLookup(CNPJ), { wrapper })
    await waitFor(() => expect(second.result.current.data).toEqual(found))
    expect(lookupCnpj).toHaveBeenCalledTimes(2)
  })

  it('sem CNPJ não consulta', () => {
    const { wrapper } = harness()
    renderHook(() => useCnpjLookup(null), { wrapper })
    expect(lookupCnpj).not.toHaveBeenCalled()
  })
})

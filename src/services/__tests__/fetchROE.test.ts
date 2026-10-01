// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { reportBestEffortFailure, rpc, from } = vi.hoisted(() => ({
  reportBestEffortFailure: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}))
vi.mock('../../lib/telemetry', () => ({ reportBestEffortFailure }))
vi.mock('../supabase', () => ({ supabase: { rpc, from } }))

import { fetchROE } from '../demurrage/demurrageKpis'

const ROE_CACHE_KEY = 'demurrage_roe_cache'

function okResponse(cotacaoVenda: string, dataHoraCotacao = '2026-07-16T13:04:05.000Z') {
  return {
    ok: true,
    json: () => Promise.resolve({ value: [{ cotacaoVenda, dataHoraCotacao }] }),
  } as unknown as Response
}

afterEach(() => {
  vi.restoreAllMocks()
  reportBestEffortFailure.mockClear()
  rpc.mockClear()
  from.mockClear()
  localStorage.clear()
})

describe('fetchROE', () => {
  beforeEach(() => {
    localStorage.clear()
    rpc.mockResolvedValue({ error: null })
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }))
  })

  it('não registra falha best-effort quando o BCB responde', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(okResponse('5.0000'))))

    const result = await fetchROE()

    expect(result.source).toBe('bcb_live')
    expect(result.offline).toBe(false)
    expect(result.ptax).toBe(5)
    expect(result.roe).toBe(5.325)
    expect(result.effectiveDate).toBe('2026-07-16')
    expect(rpc).toHaveBeenCalledWith('save_exchange_rate_reference_v2', {
      p_ptax: 5,
      p_roe: 5.325,
      p_effective_date: '2026-07-16',
      p_source: 'bcb_live',
      p_quote_date: '2026-07-16',
    })
    expect(reportBestEffortFailure).not.toHaveBeenCalled()
  })

  it('cai para a cotação do banco quando o BCB cai e não reporta erro (VELA-A)', async () => {
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({
            data: { ptax: 5.25, roe: 5.5913, effective_date: '2026-09-30', updated_at: '2026-09-30T17:00:00.000Z' },
            error: null,
          }),
        }),
      }),
    }))
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))))

    const result = await fetchROE()

    expect(result).toEqual({
      roe: 5.5913,
      ptax: 5.25,
      effectiveDate: '2026-09-30',
      offline: true,
      cachedAt: '2026-09-30T17:00:00.000Z',
      source: 'cached',
    })
    // Não reporta como erro no Sentry quando o fallback para o banco funciona
    expect(reportBestEffortFailure).not.toHaveBeenCalled()
    // Atualiza o cache do localStorage
    expect(localStorage.getItem(ROE_CACHE_KEY)).toContain('5.5913')
  })

  it('cai para o cache local quando banco e BCB não respondem e não reporta erro (VELA-A)', async () => {
    localStorage.setItem(ROE_CACHE_KEY, JSON.stringify({ roe: 5.32, ptax: 4.9953, effectiveDate: '2026-06-19', fetchedAt: '2026-06-20T00:00:00.000Z' }))
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))))

    const result = await fetchROE()

    expect(result).toEqual({ roe: 5.32, ptax: 4.9953, effectiveDate: '2026-06-19', offline: true, cachedAt: '2026-06-20T00:00:00.000Z', source: 'cached' })
    expect(reportBestEffortFailure).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('save_exchange_rate_reference_v2', {
      p_ptax: 4.9953,
      p_roe: 5.32,
      p_effective_date: '2026-06-19',
      p_source: 'cached',
      p_quote_date: '2026-06-19',
    })
  })

  it('ignora cache legado sem PTAX e data efetiva', async () => {
    localStorage.setItem(ROE_CACHE_KEY, JSON.stringify({ roe: 5.32, fetchedAt: '2026-06-20T00:00:00.000Z' }))
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))))

    await expect(fetchROE()).rejects.toThrow('BCB offline e sem cache de PTAX disponivel')
    expect(reportBestEffortFailure.mock.calls[0][2]).toEqual({ fellBackToCache: false })
  })

  it('registra a falha no Sentry somente quando não há nenhum fallback disponível', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 503 } as Response)))

    await expect(fetchROE()).rejects.toThrow('BCB offline e sem cache de PTAX disponivel')
    expect(reportBestEffortFailure).toHaveBeenCalledTimes(1)
    expect(reportBestEffortFailure.mock.calls[0][0]).toBe('fetchROE: BCB PTAX indisponivel e sem cache')
    expect(reportBestEffortFailure.mock.calls[0][2]).toEqual({ fellBackToCache: false })
  })
})

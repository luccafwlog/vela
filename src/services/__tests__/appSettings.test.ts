import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_SETTINGS, fetchAppSettings, setCommunicationsEnabled } from '../appSettings'

const { mockFrom, mockRpc } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
  },
}))

function settingsBuilder(result: { data: unknown; error: unknown }) {
  const value = {
    select: vi.fn(() => value),
    eq: vi.fn(() => value),
    single: vi.fn(async () => result),
    maybeSingle: vi.fn(async () => result),
  }
  return value
}

describe('app settings service', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
  })

  it('lê a linha singleton de app_settings', async () => {
    const row = {
      id: 1,
      communications_enabled: false,
      demurrage_dunning_interval_days: 7,
      created_at: '2026-09-01T00:00:00Z',
    }
    mockFrom.mockReturnValue(settingsBuilder({ data: row, error: null }))

    await expect(fetchAppSettings()).resolves.toEqual(row)
    expect(mockFrom).toHaveBeenCalledWith('app_settings')
  })

  it('retorna DEFAULT_APP_SETTINGS quando a linha não existe (evita 406 do PGRST116 / VELA-13)', async () => {
    mockFrom.mockReturnValue(settingsBuilder({ data: null, error: null }))

    const result = await fetchAppSettings()
    expect(result).toEqual(DEFAULT_APP_SETTINGS)
    expect(result.communications_enabled).toBe(false)
    expect(result.demurrage_dunning_interval_days).toBe(7)
  })

  it('propaga erro normalizado na leitura quando o banco falha', async () => {
    mockFrom.mockReturnValue(settingsBuilder({ data: null, error: { message: 'settings unavailable', code: '42501' } }))

    await expect(fetchAppSettings()).rejects.toThrow('settings unavailable')
  })

  it('altera a chave exclusivamente pela RPC auditada', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null })

    await expect(setCommunicationsEnabled(true)).resolves.toBe(true)
    expect(mockRpc).toHaveBeenCalledWith('set_communications_enabled', { p_enabled: true })
  })
})

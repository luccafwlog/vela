import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error — script operacional em JS puro, sem declarações geradas.
import { assertPreviewTarget, provisionPreviewAdmin } from '../../../scripts/provision-preview-admin.mjs'

const PRODUCTION_REF = 'fgmkhbzhaeebrsizwccx'

const input = {
  email: 'qa-admin@example.test',
  password: 'PreviewAdmin2026!',
  fullName: 'Preview Admin',
}

describe('provisionPreviewAdmin', () => {
  it('creates the Auth user and its active admin profile when the fixture is absent', async () => {
    const authAdmin = {
      listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
      createUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-preview-1', email: input.email } },
        error: null,
      }),
      updateUserById: vi.fn(),
    }
    const profiles = { upsert: vi.fn().mockResolvedValue({ error: null }) }

    const result = await provisionPreviewAdmin({ authAdmin, profiles, ...input })

    expect(result).toEqual({ id: 'user-preview-1', email: input.email })
    expect(authAdmin.createUser).toHaveBeenCalledWith({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.fullName, preview_fixture: true },
    })
    expect(profiles.upsert).toHaveBeenCalledWith(
      { id: 'user-preview-1', full_name: input.fullName, role: 'administrativo', active: true },
      { onConflict: 'id' },
    )
  })

  it('repairs an existing fixture instead of creating a duplicate', async () => {
    const authAdmin = {
      listUsers: vi.fn().mockResolvedValue({
        data: { users: [{ id: 'user-preview-1', email: input.email }] },
        error: null,
      }),
      createUser: vi.fn(),
      updateUserById: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-preview-1', email: input.email } },
        error: null,
      }),
    }
    const profiles = { upsert: vi.fn().mockResolvedValue({ error: null }) }

    await provisionPreviewAdmin({ authAdmin, profiles, ...input })

    expect(authAdmin.createUser).not.toHaveBeenCalled()
    expect(authAdmin.updateUserById).toHaveBeenCalledWith('user-preview-1', {
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.fullName, preview_fixture: true },
    })
  })

  it('preserves an existing fixture when Auth rejects reapplying its password policy', async () => {
    const authAdmin = {
      listUsers: vi.fn().mockResolvedValue({
        data: { users: [{ id: 'user-preview-1', email: input.email }] },
        error: null,
      }),
      createUser: vi.fn(),
      updateUserById: vi
        .fn()
        .mockResolvedValueOnce({
          data: null,
          error: {
            message: 'Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0***9.',
          },
        })
        .mockResolvedValueOnce({
          data: { user: { id: 'user-preview-1', email: input.email } },
          error: null,
        }),
    }
    const profiles = { upsert: vi.fn().mockResolvedValue({ error: null }) }

    const result = await provisionPreviewAdmin({ authAdmin, profiles, ...input })

    expect(result).toEqual({ id: 'user-preview-1', email: input.email })
    expect(authAdmin.updateUserById).toHaveBeenNthCalledWith(2, 'user-preview-1', {
      email_confirm: true,
      user_metadata: { full_name: input.fullName, preview_fixture: true },
    })
    expect(profiles.upsert).toHaveBeenCalledWith(
      { id: 'user-preview-1', full_name: input.fullName, role: 'administrativo', active: true },
      { onConflict: 'id' },
    )
  })
})

describe('assertPreviewTarget', () => {
  it('recusa a URL do projeto de produção', () => {
    // O fixture é um admin ativo com e-mail conhecido e senha fixa: provisioná-lo
    // em produção entrega uma conta administrativa de credencial previsível.
    expect(() => assertPreviewTarget(`https://${PRODUCTION_REF}.supabase.co`, PRODUCTION_REF))
      .toThrow(/produção/)
  })

  it('aceita a URL de uma Preview Branch', () => {
    const branchUrl = 'https://abcdefghijklmnopqrst.supabase.co'
    expect(assertPreviewTarget(branchUrl, PRODUCTION_REF)).toBe(branchUrl)
  })

  it('não confunde ref de produção com um ref de branch que o contenha como substring', () => {
    // A comparação é por rótulo de host, não por `includes`: um ref de branch
    // que apenas contivesse o de produção não é produção, e recusá-lo travaria
    // o provisionamento legítimo.
    const branchUrl = `https://x${PRODUCTION_REF}x.supabase.co`
    expect(assertPreviewTarget(branchUrl, PRODUCTION_REF)).toBe(branchUrl)
  })

  it('falha fechado quando o ref de produção não foi informado', () => {
    expect(() => assertPreviewTarget('https://qualquer.supabase.co', '')).toThrow(/SUPABASE_PROJECT_REF/)
  })

  it('rejeita URL malformada em vez de deixá-la passar', () => {
    expect(() => assertPreviewTarget('nao-e-url', PRODUCTION_REF)).toThrow(/inválida/)
  })
})

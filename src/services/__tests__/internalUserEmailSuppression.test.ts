import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { releasePreviousEmailSuppression } from '../../../supabase/functions/_shared/internalUserEmailSuppression.ts'

// Plano dos e-mails, 2.8 (D19): salvar o e-mail em Editar acesso libera a
// supressão do endereço anterior do usuário interno.
describe('liberação da supressão do e-mail anterior do usuário interno', () => {
  it('chama a RPC com o e-mail anterior normalizado e devolve quantas supressões saíram', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null })
    await expect(releasePreviousEmailSuppression({ rpc }, '  Antigo@Example.test ', 'novo@example.test')).resolves.toBe(1)
    expect(rpc).toHaveBeenCalledWith('release_internal_user_email_suppression', { p_email: 'antigo@example.test' })
  })

  it('não chama a RPC sem e-mail anterior ou sem e-mail salvo (troca só de senha)', async () => {
    const rpc = vi.fn()
    await expect(releasePreviousEmailSuppression({ rpc }, null, 'novo@example.test')).resolves.toBe(0)
    await expect(releasePreviousEmailSuppression({ rpc }, 'antigo@example.test', undefined)).resolves.toBe(0)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('erro ou exceção da RPC não derruba a troca já feita', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(releasePreviousEmailSuppression({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'x' } }) }, 'a@example.test', 'b@example.test')).resolves.toBe(0)
    await expect(releasePreviousEmailSuppression({ rpc: vi.fn().mockRejectedValue(new Error('rede')) }, 'a@example.test', 'b@example.test')).resolves.toBe(0)
    expect(error).toHaveBeenCalledTimes(2)
    error.mockRestore()
  })

  it('a Edge admin-users chama a liberação depois de salvar o e-mail', () => {
    const source = readFileSync(resolve('supabase/functions/admin-users/index.ts'), 'utf8')
    const update = source.indexOf('admin.auth.admin.updateUserById(userId, updates)')
    const release = source.indexOf('releasePreviousEmailSuppression(admin, previousEmail, email)')
    expect(update).toBeGreaterThan(0)
    expect(release).toBeGreaterThan(update)
  })
})

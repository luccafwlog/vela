// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => auth.value }))

import { ProtectedRoute } from '../ProtectedRoute'

function renderAt(path: string, guard: { adminOnly?: boolean; permission?: 'ce_unlock_read' }) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute {...guard} />}>
          <Route path="/restrita" element={<div>conteúdo restrito</div>} />
        </Route>
        <Route path="/painel" element={<div>painel</div>} />
        <Route path="/login" element={<div>login</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProtectedRoute (estados de acesso)', () => {
  const signOut = vi.fn()
  beforeEach(() => {
    signOut.mockReset()
    auth.value = {
      user: { id: 'u1' },
      profile: { id: 'u1', role: 'financeiro' },
      loading: false,
      isAdmin: false,
      can: () => false,
      profileStatus: 'ready',
      profileError: null,
      refreshProfile: vi.fn(),
      signOut,
    }
  })

  it('explica o acesso restrito em vez de devolver ao Painel sem aviso', () => {
    renderAt('/restrita', { permission: 'ce_unlock_read' })

    expect(screen.getByRole('heading', { name: 'Acesso restrito' })).toBeTruthy()
    expect(screen.getByText(/não está liberada para o departamento Financeiro/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Voltar para o Painel' }).getAttribute('href')).toBe('/painel')
    expect(screen.queryByText('conteúdo restrito')).toBeNull()
    expect(screen.queryByText('painel')).toBeNull()
  })

  it('diz que a Administração é do Administrativo', () => {
    renderAt('/restrita', { adminOnly: true })
    expect(screen.getByText(/exclusiva do departamento Administrativo/)).toBeTruthy()
  })

  it('libera a rota com a permissão', () => {
    auth.value = { ...auth.value, can: () => true }
    renderAt('/restrita', { permission: 'ce_unlock_read' })
    expect(screen.getByText('conteúdo restrito')).toBeTruthy()
  })

  it('perfil ausente oferece Sair em vez de prender a pessoa na tela', () => {
    auth.value = { ...auth.value, profile: null, profileStatus: 'missing' }
    renderAt('/restrita', {})

    expect(screen.getByRole('heading', { name: 'Acesso ainda não liberado' })).toBeTruthy()
    expect(screen.queryByText(/user_profiles/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }))
    expect(signOut).toHaveBeenCalledOnce()
  })
})

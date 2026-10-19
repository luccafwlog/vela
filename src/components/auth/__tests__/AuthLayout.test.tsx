// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { AuthLayout, AuthNotice } from '../AuthLayout'

afterEach(cleanup)

describe('AuthLayout (lote 6a da identidade)', () => {
  it('o Portal mostra a logo branca da Fwlog no painel e nunca a marca Vela', () => {
    render(<AuthLayout brand="portal" title="Portal do Cliente"><p>form</p></AuthLayout>)
    expect(screen.getByRole('heading', { level: 1, name: 'Portal do Cliente' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Fwlog' }).getAttribute('src')).toBe('/branding/fwlog-logo-white.png')
    expect(document.body.textContent).not.toContain('Vela')
  })

  it('o Vela mostra o veleiro e o nome no mesmo painel', () => {
    render(<AuthLayout brand="vela" title="Acesso interno"><p>form</p></AuthLayout>)
    expect(document.querySelector('.app-auth__logo--vela')?.getAttribute('src')).toBe('/branding/vela-mark-dark.svg')
    expect(screen.getByText('Vela')).toBeTruthy()
  })

  it('o aviso junta o motivo e a explicação num alerta só', () => {
    render(<AuthNotice title="Link de recuperação inválido ou expirado.">Peça um novo para continuar.</AuthNotice>)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('inválido ou expirado')
    expect(alert.textContent).toContain('Peça um novo')
  })

  it('fundo e painel da marca lisos, sem textura de pontos (regra 7)', () => {
    const css = readFileSync('src/index.css', 'utf8')
    const auth = css.slice(css.indexOf('.app-auth {'), css.indexOf('/* Campo de senha com'))
    expect(auth).not.toContain('dot-pattern')
    expect(auth).not.toContain('radial-gradient')
  })
})

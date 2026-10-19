// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Switch } from '../Switch'

afterEach(cleanup)

describe('Switch', () => {
  it('diz o estado em texto e no aria-checked, e pede a troca sem mudar sozinho', () => {
    const onChange = vi.fn()
    render(<Switch checked={false} onChange={onChange}>Envio real desligado</Switch>)

    const chave = screen.getByRole('switch', { name: 'Envio real desligado' })
    expect(chave.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(chave)
    expect(onChange).toHaveBeenCalledWith(true)
    // Controlada: quem usa decide (e confirma) antes de trocar o estado.
    expect(chave.getAttribute('aria-checked')).toBe('false')
  })

  it('desabilitada não pede troca', () => {
    const onChange = vi.fn()
    render(<Switch checked onChange={onChange} disabled>Envio real ligado</Switch>)
    fireEvent.click(screen.getByRole('switch', { name: 'Envio real ligado' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})

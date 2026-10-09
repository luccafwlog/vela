// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FichaTabBar, resolveFichaTab } from '../FichaTabs'

describe('FichaTabBar', () => {
  it('renderiza as abas no TabList, com a ativa ligada ao painel', () => {
    const onSelect = vi.fn()
    render(<FichaTabBar active="visao-geral" onSelect={onSelect} />)

    expect(screen.getByRole('tablist', { name: 'Seções da ficha do Cliente' })).toBeTruthy()
    expect(screen.getAllByRole('tab')).toHaveLength(6)

    const geralTab = screen.getByRole('tab', { name: 'Visão geral' })
    expect(geralTab.getAttribute('aria-selected')).toBe('true')
    expect(geralTab.getAttribute('aria-controls')).toBe('cliente-panel-visao-geral')

    fireEvent.click(screen.getByRole('tab', { name: 'Financeiro' }))
    expect(onSelect).toHaveBeenCalledWith('financeiro')
  })

  it('sem leitura do Desbloqueio de CE, a aba CE/VIP some e a URL cai na Visão geral', () => {
    render(<FichaTabBar active="visao-geral" onSelect={vi.fn()} canReadCeUnlock={false} />)
    expect(screen.queryByRole('tab', { name: 'Desbloqueio de CE e VIP' })).toBeNull()
    expect(resolveFichaTab('desbloqueio-ce', false)).toBe('visao-geral')
    expect(resolveFichaTab('desbloqueio-ce', true)).toBe('desbloqueio-ce')
    expect(resolveFichaTab('inexistente', true)).toBe('visao-geral')
  })
})

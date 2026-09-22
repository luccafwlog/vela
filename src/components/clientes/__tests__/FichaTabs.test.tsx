// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FichaTabBar } from '../FichaTabs'

describe('FichaTabBar', () => {
  it('renderiza todas as abas usando TabButton oficial do sistema', () => {
    const onSelect = vi.fn()
    render(<FichaTabBar active="visao-geral" onSelect={onSelect} />)

    const tabs = screen.getAllByRole('tab')
    expect(tabs.length).toBe(5)

    const geralTab = screen.getByRole('tab', { name: 'Visão Geral' })
    expect(geralTab.getAttribute('aria-selected')).toBe('true')
    expect(geralTab.className).toContain('app-tab--active')

    const financeiroTab = screen.getByRole('tab', { name: 'Financeiro' })
    expect(financeiroTab.getAttribute('aria-selected')).toBe('false')

    fireEvent.click(financeiroTab)
    expect(onSelect).toHaveBeenCalledWith('financeiro')
  })
})

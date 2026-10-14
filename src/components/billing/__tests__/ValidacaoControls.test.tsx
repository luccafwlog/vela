// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ValidacaoControls } from '../ValidacaoControls'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

afterEach(cleanup)
function renderControls(overrides: Partial<React.ComponentProps<typeof ValidacaoControls>> = {}) {
  const onUpdateFilter = vi.fn()
  render(<QueryClientProvider client={new QueryClient()}><ValidacaoControls filters={{ search: '', cargoMode: '', pod: '', voyageId: '', blockCode: '', includeResolved: false }} truncated={false} onUpdateFilter={onUpdateFilter} {...overrides} /></QueryClientProvider>)
  return onUpdateFilter
}

describe('ValidacaoControls', () => {
  it('Busca, Motivo e Navio / Viagem abertos; Modo de carga, POD e resolvidos em Mais filtros', () => {
    renderControls()
    expect(screen.getByLabelText('Buscar B/L ou Cliente')).toBeTruthy()
    expect(screen.getByLabelText('Motivo')).toBeTruthy()
    expect(screen.queryByLabelText('Modo de carga')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Mais filtros/ }))
    expect(screen.getByLabelText('Modo de carga')).toBeTruthy()
    expect(screen.getByLabelText('POD')).toBeTruthy()
  })
  it('avisa quando o teto de 1200 B/Ls foi atingido', () => { renderControls({ truncated: true }); expect(screen.getByText(/Limite de 1200/)).toBeTruthy() })
  it('trocar o motivo atualiza o filtro', () => {
    const onUpdateFilter = renderControls()
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'pronto' } })
    expect(onUpdateFilter).toHaveBeenCalledWith('blockCode', 'pronto')
  })
})

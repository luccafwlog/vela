// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { VoyageRailItem } from '../../../services/voyageSummaries'
import { VoyageRail } from '../VoyageRail'

afterEach(cleanup)

const item = {
  id: 7,
  estado: 'divergente',
  vesselName: 'GREEN SANTOS',
  voyageNumber: '14N',
  carrierName: 'COSCO',
  originPorts: ['BRSSZ'],
  destinationPorts: ['BRVIX'],
  proximaEscala: null,
  escalasBrasileiras: [{ port: 'BRVIX', eta: '2026-08-02' }],
  modules: { container: true, cargaSolta: false, veiculos: false, vazios: false, granito: false },
} as unknown as VoyageRailItem

it('US-212: selecionar uma viagem no rail dispara onSelect com o id', () => {
  const onSelect = vi.fn()
  render(<VoyageRail items={[item]} selectedId={null} onSelect={onSelect} />)

  fireEvent.click(screen.getByText('GREEN SANTOS / 14N').closest('button') as HTMLButtonElement)
  expect(onSelect).toHaveBeenCalledWith(7)
})

it('US-212: rail vazio mostra mensagem de ausencia', () => {
  render(<VoyageRail items={[]} selectedId={null} onSelect={vi.fn()} />)
  expect(screen.getByText('Nenhuma viagem para os filtros atuais.')).toBeTruthy()
})

it('reposiciona o rail na abertura mesmo quando a viagem ja vem selecionada pela rota', () => {
  const scrollTo = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo })

  render(<VoyageRail items={[item]} selectedId={7} onSelect={vi.fn()} />)

  expect(scrollTo).toHaveBeenCalledWith({ left: 0, behavior: 'auto' })
})

// Revisão de 2026-10-22: a faixa abria no fim. As escalas chegam depois e
// reordenam os cards; a faixa que só aparece depois de carregar (Veículos)
// também não voltava ao início.
it('volta ao início quando a ordem dos cards muda e quando a faixa aparece depois de carregar', () => {
  const scrollTo = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo })
  const other = { ...item, id: 8, vesselName: 'GREEN ITAJAI', voyageNumber: '11' } as VoyageRailItem

  const view = render(<VoyageRail items={[]} selectedId={null} onSelect={vi.fn()} />)
  expect(scrollTo).not.toHaveBeenCalled()

  view.rerender(<VoyageRail items={[item, other]} selectedId={null} onSelect={vi.fn()} />)
  expect(scrollTo).toHaveBeenCalledTimes(1)

  // Mesma ordem: a rolagem do operador fica onde está.
  view.rerender(<VoyageRail items={[item, other]} selectedId={8} onSelect={vi.fn()} />)
  expect(scrollTo).toHaveBeenCalledTimes(1)

  view.rerender(<VoyageRail items={[other, item]} selectedId={8} onSelect={vi.fn()} />)
  expect(scrollTo).toHaveBeenCalledTimes(2)
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: 'auto' })
})

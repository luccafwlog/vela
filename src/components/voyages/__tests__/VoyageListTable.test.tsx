// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { VoyageListTable } from '../VoyageListTable'
import type { VoyageRailItem } from '../../../services/voyageSummaries'

function item(id: number, estado: VoyageRailItem['estado']): VoyageRailItem {
  return {
    id, estado, vesselName: `NAVIO ${id}`, voyageNumber: `00${id}`, carrierName: 'COSCO', status: 'active',
    originPorts: [], destinationPorts: [], proximaEscala: null, escalasBrasileiras: [],
    modules: { container: true, cargaSolta: false, veiculos: false, vazios: false, granito: false },
  } as unknown as VoyageRailItem
}

// O estado de Conciliação da Viagem tem o mesmo nome e a mesma cor na tabela,
// na faixa e na ficha (regra 5 da identidade): Divergente em vermelho, não âmbar.
describe('VoyageListTable · Conciliação', () => {
  it('usa o rótulo e o tom compartilhados de cada estado', () => {
    render(
      <MemoryRouter>
        <VoyageListTable
          items={[item(1, 'divergente'), item(2, 'incompleto'), item(3, 'conciliado'), item(4, 'verificando')]}
          breakbulkTons={new Map()}
          vehicleCounts={{}}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Divergente').className).toContain('app-status-text--danger')
    expect(screen.getByText('Pendente').className).toContain('app-status-text--warning')
    expect(screen.getByText('Conciliada').className).not.toMatch(/--(warning|danger)/)
    expect(screen.getByText('Verificando').className).toContain('app-status-text--muted')
  })
})

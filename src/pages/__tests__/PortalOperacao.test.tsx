// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { PortalOperationBL } from '../../services/portalOperation'

const rows: PortalOperationBL[] = [
  {
    bl_id: 'BL001',
    ce_mercante: '123456789012345',
    pol: 'CNSHA',
    pod: 'BRVIX',
    voyage_id: 10,
    voyage_number: '001W',
    vessel_name: 'NAVIO TESTE',
    transshipment: {
        omission_id: 9,
        disposition: 'transshipment',
        omitted_pod: 'BRVIX',
        discharge_pod: 'BRSSZ',
        onward_vessel_name: 'COSCO STAR',
        onward_carrier: null,
        onward_voyage_number: 'T-1',
        onward_etd: '2026-07-20',
        onward_eta: '2026-07-22',
    },
    container_count: 2,
    containers_in_demurrage: 1,
    containers_returned: 1,
    containers: [
      {
        id: 1,
        container_number: 'ABCD1234567',
        type: '40GP',
        discharge_date: '2026-06-01',
        return_date: '2026-06-20',
        usage_days: 19,
        free_time_days: 21,
        demurrage_days: 0,
        status: 'devolvido',
      },
      {
        id: 2,
        container_number: 'EFGH1234567',
        type: '20RF',
        discharge_date: '2026-06-01',
        return_date: null,
        usage_days: 25,
        free_time_days: 10,
        demurrage_days: 15,
        status: 'em_demurrage',
      },
    ],
  },
  {
    bl_id: 'BL002',
    ce_mercante: null,
    pol: 'CNSHA',
    pod: 'BRSSZ',
    voyage_id: 11,
    voyage_number: '002W',
    vessel_name: 'NAVIO SEM CONTAINER',
    transshipment: {
      omission_id: 10,
      disposition: 'cod',
      omitted_pod: 'BRVIX',
      discharge_pod: 'BRSSA',
      onward_vessel_name: null,
      onward_carrier: null,
      onward_voyage_number: null,
      onward_etd: null,
      onward_eta: null,
    },
    container_count: 0,
    containers_in_demurrage: 0,
    containers_returned: 0,
    containers: [],
  },
  {
    bl_id: 'BL003',
    ce_mercante: '987654321098765',
    pol: 'CNSHA',
    pod: 'BRVIX',
    voyage_id: 12,
    voyage_number: '003W',
    vessel_name: 'NAVIO DEVOLVIDO',
    container_count: 2,
    containers_in_demurrage: 0,
    containers_returned: 2,
    containers: [
      {
        id: 3,
        container_number: 'IJKL1234567',
        type: '40GP',
        discharge_date: '2026-06-01',
        return_date: '2026-06-15',
        usage_days: 14,
        free_time_days: 21,
        demurrage_days: 0,
        status: 'devolvido',
      },
      {
        id: 4,
        container_number: 'MNOP1234567',
        type: '20GP',
        discharge_date: '2026-06-01',
        return_date: '2026-06-16',
        usage_days: 15,
        free_time_days: 21,
        demurrage_days: 0,
        status: 'devolvido',
      },
    ],
  },
  {
    bl_id: 'BL004',
    ce_mercante: '555666777888999',
    pol: 'CNSHA',
    pod: 'BRVIX',
    voyage_id: 13,
    voyage_number: '004W',
    vessel_name: 'NAVIO MISTO',
    cargo_mode: 'misto',
    bb_weight_ton: 12.5,
    bb_packages_qty: 4,
    container_count: 1,
    containers_in_demurrage: 0,
    containers_returned: 1,
    containers: [
      {
        id: 5,
        container_number: 'MIXU9999999',
        type: '40HC',
        discharge_date: '2026-06-01',
        return_date: '2026-06-12',
        usage_days: 11,
        free_time_days: 15,
        demurrage_days: 0,
        status: 'devolvido',
      },
    ],
  },
]

vi.mock('../../hooks/usePortalOperation', () => ({
  usePortalOperationBls: () => ({ data: rows, isLoading: false, error: null }),
}))
vi.mock('../../services/exports', () => ({
  exportPortalBlsWorkbook: vi.fn(),
  exportPortalContainersWorkbook: vi.fn(),
}))

import { PortalOperacao } from '../PortalOperacao'
import { exportPortalBlsWorkbook, exportPortalContainersWorkbook } from '../../services/exports'

afterEach(cleanup)

function renderOperacao(initialEntry = '/portal/operacao') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <PortalOperacao />
    </MemoryRouter>,
  )
}

describe('PortalOperacao (BLs e Containers)', () => {
  it('mostra as abas BLs e Containers e a coluna POL na aba BLs', () => {
    renderOperacao()
    expect(screen.getByRole('heading', { name: 'BLs e Containers' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'BLs' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Containers' })).toBeTruthy()

    const blsTable = screen.getByRole('table')
    expect(within(blsTable).getByRole('columnheader', { name: 'POL' })).toBeTruthy()
    // POL exibido na linha do B/L
    expect(within(blsTable).getAllByText('CNSHA').length).toBeGreaterThan(0)
  })

  it('marca como Cancelado o B/L cancelado depois de liberado (ADR 0071)', () => {
    rows[1].cancelled_at = '2026-09-25T10:00:00Z'
    try {
      renderOperacao()
      const blsTable = screen.getByRole('table')
      const cancelledRow = within(blsTable).getByText('BL002').closest('tr') as HTMLElement
      expect(within(cancelledRow).getByText('Cancelado')).toBeTruthy()
      const activeRow = within(blsTable).getByText('BL001').closest('tr') as HTMLElement
      expect(within(activeRow).queryByText('Cancelado')).toBeNull()
    } finally {
      rows[1].cancelled_at = null
    }
  })

  it('filtra B/Ls por navio na aba BLs', async () => {
    const user = userEvent.setup()
    renderOperacao()

    await user.click(screen.getByRole('button', { name: /Filtros/i }))
    await user.type(screen.getByLabelText('Navio'), 'NAVIO TESTE')

    expect(screen.getByText('BL001')).toBeTruthy()
    expect(screen.queryByText('BL003')).toBeNull()
  })

  it('exibe o card persistente de Informações de Transbordo na ficha do B/L', async () => {
    const user = userEvent.setup()
    renderOperacao()

    await user.click(screen.getByText('BL001'))

    expect(screen.getByRole('heading', { name: 'Informações de Transbordo' })).toBeTruthy()
    expect(screen.getByText('COSCO STAR')).toBeTruthy()
    expect(screen.getByText('20/07/2026')).toBeTruthy()
    expect(screen.getByText('22/07/2026')).toBeTruthy()
    expect(screen.queryByText('Motivo')).toBeNull()
  })

  it('exibe um card próprio para COD sem publicar dados de transbordo', async () => {
    const user = userEvent.setup()
    renderOperacao()

    await user.click(screen.getByText('BL002'))

    expect(screen.getByRole('heading', { name: 'Destino alterado para BRSSA (COD)' })).toBeTruthy()
    expect(screen.getByText('Sua carga não seguirá em transbordo.')).toBeTruthy()
    const codCard = screen.getByRole('heading', { name: 'Destino alterado para BRSSA (COD)' }).closest('section')
    expect(codCard).not.toBeNull()
    expect(within(codCard as HTMLElement).queryByText('Navio')).toBeNull()
    expect(within(codCard as HTMLElement).queryByText('Armador')).toBeNull()
    expect(within(codCard as HTMLElement).queryByText('Viagem')).toBeNull()
    expect(within(codCard as HTMLElement).queryByText('ETD')).toBeNull()
    expect(within(codCard as HTMLElement).queryByText('ETA')).toBeNull()
    expect(within(codCard as HTMLElement).queryByText('Motivo')).toBeNull()
  })

  it('deriva a aba Containers dos containers dos B/Ls', async () => {
    const user = userEvent.setup()
    renderOperacao()

    await user.click(screen.getByRole('tab', { name: 'Containers' }))
    // Containers de todos os B/Ls aparecem sem precisar abrir o B/L
    expect(screen.getByText('ABCD1234567')).toBeTruthy()
    expect(screen.getByText('EFGH1234567')).toBeTruthy()
    expect(screen.getByText('IJKL1234567')).toBeTruthy()
  })

  it('renderiza cards mobile nas abas BLs e Containers', async () => {
    const user = userEvent.setup()
    renderOperacao()

    expect(screen.getByTestId('portal-operacao-bl-mobile-cards').textContent).toContain('B/L BL001')

    await user.click(screen.getByRole('tab', { name: 'Containers' }))

    expect(screen.getByTestId('portal-operacao-container-mobile-cards').textContent).toContain('Container ABCD1234567')
  })

  it('abre a aba Containers filtrada por demurrage via query param', () => {
    renderOperacao('/portal/operacao?tab=containers&devolucao=em_demurrage')
    // Apenas EFGH (em demurrage, sem devolucao) deve aparecer
    expect(screen.getByText('EFGH1234567')).toBeTruthy()
    expect(screen.queryByText('ABCD1234567')).toBeNull()
    expect(screen.queryByText('IJKL1234567')).toBeNull()
  })

  it('US-172: exporta os B/Ls e os containers para Excel', async () => {
    const user = userEvent.setup()
    renderOperacao()

    // aba BLs: exporta B/Ls
    await user.click(screen.getByRole('button', { name: 'Exportar Excel' }))
    expect(exportPortalBlsWorkbook).toHaveBeenCalledTimes(1)
    expect((exportPortalBlsWorkbook as ReturnType<typeof vi.fn>).mock.calls[0][0]).toHaveLength(rows.length)

    // aba Containers: exporta containers
    await user.click(screen.getByRole('tab', { name: 'Containers' }))
    await user.click(screen.getByRole('button', { name: 'Exportar Excel' }))
    expect(exportPortalContainersWorkbook).toHaveBeenCalledTimes(1)
  })

  it('apresenta B/L misto como documento unico com contêineres e sumario de carga solta', async () => {
    const user = userEvent.setup()
    renderOperacao()

    // B/L misto exibe indicador composto de contêineres e carga solta
    expect(screen.getByText('1 CNTR + 12.5t')).toBeTruthy()

    // Ao expandir o B/L misto
    await user.click(screen.getByText('BL004'))

    // Exibe sumário de carga solta (breakbulk)
    expect(screen.getByTestId('portal-breakbulk-summary')).toBeTruthy()
    expect(screen.getByText('12.5 ton')).toBeTruthy()
    expect(screen.getByText('4 volume(s)')).toBeTruthy()

    // Exibe contêiner e status normalmente
    expect(screen.getByText('MIXU9999999')).toBeTruthy()
    expect(screen.getByText('40HC')).toBeTruthy()
  })
})

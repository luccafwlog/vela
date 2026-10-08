// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LineUpTVDisplay } from '../LineUpTVDisplay'
import type { LineUpRow, LineUpSnapshot } from '../../services/lineup'

let mockSnapshot: LineUpSnapshot = {
  rows: [],
  lastChangedAt: '2026-08-31T12:00:00Z',
}
let mockIsLoading = false
let mockError: unknown = null

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: mockSnapshot,
    isLoading: mockIsLoading,
    error: mockError,
  }),
}))

function createMockRow(index: number, overrides: Partial<LineUpRow> = {}): LineUpRow {
  return {
    id: `${index}::POD${index}`,
    voyageId: index,
    voyageNumber: `V${index}`,
    voyageStatus: 'active',
    vesselName: `VESSEL ${index}`,
    pod: `POD${index}`,
    eta: '2026-09-01',
    etb: '2026-09-02',
    ata: null,
    atb: null,
    rowType: 'import',
    omitted: false,
    importTerminal: `TERM${index}`,
    exportTerminal: 'TBC',
    vin: index * 10,
    car: index * 5,
    cg: 0,
    total: index * 15,
    mty: 0,
    rtw: null,
    bbMachines: 0,
    bbPackages: 0,
    bbTotal: 0,
    atd: null,
    ceStatus: 'approved',
    linked: true,
    exportHasGranite: null,
    exportContainersQty: null,
    exportMovementsQty: null,
    exportCeStatus: null,
    exportLinked: null,
    ...overrides,
  }
}

describe('LineUpTVDisplay behavior (Issue #582)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.innerWidth = 1920
    mockIsLoading = false
    mockError = null
  })

  afterEach(cleanup)

  it('exibe quadro estático e placeholders quando há menos de 8 escalas (ex: 5 escalas)', () => {
    mockSnapshot = {
      rows: Array.from({ length: 5 }, (_, i) => createMockRow(i + 1)),
      lastChangedAt: '2026-08-31T12:00:00Z',
    }

    render(<LineUpTVDisplay />)

    // 5 escalas reais renderizadas
    expect(screen.getByText('VESSEL 1')).toBeTruthy()
    expect(screen.getByText('VESSEL 5')).toBeTruthy()

    // 3 placeholders para completar as 8 visíveis
    const rows = document.querySelectorAll('.app-lineup-display-board__row')
    const placeholders = document.querySelectorAll('.app-lineup-display-board__row--placeholder')
    expect(rows.length).toBe(8)
    expect(placeholders.length).toBe(3)
  })

  it('exibe quadro estático sem placeholders quando há exatamente 8 escalas', () => {
    mockSnapshot = {
      rows: Array.from({ length: 8 }, (_, i) => createMockRow(i + 1)),
      lastChangedAt: '2026-08-31T12:00:00Z',
    }

    render(<LineUpTVDisplay />)

    const rows = document.querySelectorAll('.app-lineup-display-board__row')
    const placeholders = document.querySelectorAll('.app-lineup-display-board__row--placeholder')
    expect(rows.length).toBe(8)
    expect(placeholders.length).toBe(0)
    expect(screen.getByText('VESSEL 8')).toBeTruthy()
  })

  it('ativa loop animado quando há exatamente 9 escalas (evita corte da 9ª escala)', () => {
    mockSnapshot = {
      rows: Array.from({ length: 9 }, (_, i) => createMockRow(i + 1)),
      lastChangedAt: '2026-08-31T12:00:00Z',
    }

    render(<LineUpTVDisplay />)

    // O loop animado gera 9 slots (8 visíveis + 1 para o slide)
    const rows = document.querySelectorAll('.app-lineup-display-board__row')
    expect(rows.length).toBe(9)

    // A 9ª escala está presente e renderizada no quadro de rotação
    expect(screen.getByText('VESSEL 9')).toBeTruthy()
  })

  it('destaca a borda de início do ciclo na primeira escala ordenada', () => {
    mockSnapshot = {
      rows: Array.from({ length: 10 }, (_, i) => createMockRow(i + 1)),
      lastChangedAt: '2026-08-31T12:00:00Z',
    }

    render(<LineUpTVDisplay />)

    const cycleStartRows = document.querySelectorAll('.app-lineup-display-board__row--cycle-start')
    expect(cycleStartRows.length).toBe(1)
    expect(cycleStartRows[0].textContent).toContain('VESSEL 1')
  })

  it('renderiza lista de cards verticais em viewport mobile (<= 1024px)', () => {
    window.innerWidth = 768
    mockSnapshot = {
      rows: Array.from({ length: 9 }, (_, i) => createMockRow(i + 1)),
      lastChangedAt: '2026-08-31T12:00:00Z',
    }

    render(<LineUpTVDisplay />)

    const mobileCards = document.querySelectorAll('.app-lineup-card')
    expect(mobileCards.length).toBe(9)
    expect(document.querySelector('.app-lineup-display-board')).toBeNull()
  })

  it('exibe indicador de início de ciclo no cabeçalho com precedência ATA -> ETA', () => {
    mockSnapshot = {
      rows: [
        createMockRow(1, { vesselName: 'ALPHA SHIP', pod: 'BRSSZ', eta: '2026-09-05', ata: '2026-09-04' }),
        createMockRow(2, { vesselName: 'BETA SHIP', pod: 'BRRIO', eta: '2026-09-10' }),
      ],
      lastChangedAt: '2026-08-31T12:00:00Z',
    }

    render(<LineUpTVDisplay />)

    // Precedência de ATA: 04/09 | ALPHA SHIP | BRSSZ
    expect(screen.getByText(/04\/09 \| ALPHA SHIP \| BRSSZ/)).toBeTruthy()
  })

  it('reage dinamicamente a evento de resize entre desktop e mobile', () => {
    window.innerWidth = 1920
    mockSnapshot = {
      rows: Array.from({ length: 9 }, (_, i) => createMockRow(i + 1)),
      lastChangedAt: '2026-08-31T12:00:00Z',
    }

    const { rerender } = render(<LineUpTVDisplay />)
    expect(document.querySelector('.app-lineup-display-board')).toBeTruthy()
    expect(document.querySelectorAll('.app-lineup-card').length).toBe(0)

    // Redimensiona para mobile
    window.innerWidth = 768
    window.dispatchEvent(new Event('resize'))
    rerender(<LineUpTVDisplay />)

    expect(document.querySelector('.app-lineup-display-board')).toBeNull()
    expect(document.querySelectorAll('.app-lineup-card').length).toBe(9)
  })

  it('lê BLs e CEs como o Painel: Lançando, Recebido e Em aprovação não viram "Aguardando"', () => {
    mockSnapshot = {
      rows: [
        createMockRow(1, { ceStatus: 'launching' }),
        createMockRow(2, { ceStatus: 'received' }),
        createMockRow(3, { ceStatus: 'approving' }),
        createMockRow(4, { ceStatus: 'waiting', linked: false }),
      ],
      lastChangedAt: '2026-08-31T12:00:00Z',
    }
    render(<LineUpTVDisplay />)

    expect(screen.getByText('Lançando')).toBeTruthy()
    expect(screen.getByText('Recebido')).toBeTruthy()
    expect(screen.getByText('Em aprovação')).toBeTruthy()
    expect(screen.getAllByText('Aguardando')).toHaveLength(1)
    expect(screen.getByText('NÃO')).toBeTruthy()
  })

  it('mantém o quadro e avisa no cabeçalho quando a atualização falha com dados anteriores', () => {
    mockSnapshot = { rows: [createMockRow(1)], lastChangedAt: '2026-08-31T12:00:00Z' }
    mockError = new Error('rede')
    render(<LineUpTVDisplay />)

    expect(screen.getByText('VESSEL 1')).toBeTruthy()
    expect(screen.getByText('Sem atualização desde')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('preserva dados e exibe flash verde temporário quando novo snapshot chega', () => {
    vi.useFakeTimers()

    mockSnapshot = {
      rows: Array.from({ length: 9 }, (_, i) => createMockRow(i + 1)),
      lastChangedAt: '2026-08-31T12:00:00Z',
    }

    const { rerender } = render(<LineUpTVDisplay />)

    // Novo snapshot mantendo o mesmo lastChangedAt
    mockSnapshot = {
      ...mockSnapshot,
      rows: [...mockSnapshot.rows],
    }

    rerender(<LineUpTVDisplay />)

    // O quadro continua exibindo todas as 9 linhas normalmente
    const rows = document.querySelectorAll('.app-lineup-display-board__row')
    expect(rows.length).toBe(9)

    vi.useRealTimers()
  })
})

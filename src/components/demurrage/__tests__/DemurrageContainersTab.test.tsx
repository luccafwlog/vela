// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DemurrageContainersTab } from '../DemurrageContainersTab'
import type { BoardBox, BoardGroup, DemurrageDivision } from '../../../services/demurrage/demurrageBoard'

afterEach(cleanup)

function box(number: string, overrides: Partial<BoardBox> = {}): BoardBox {
  return {
    container_id: Number(number.replace(/\D/g, '')) || 1,
    bl_id: 'BL-1',
    container_number: number,
    type: '40HC',
    rate_group: '40GP',
    discharge_date: '2026-09-01',
    return_date: null,
    total_days: 40,
    free_days: 21,
    free_source: 'tabela',
    last_free_day: '2026-09-22',
    days_p1: 9,
    rate_p1_usd: 60,
    days_p2: 10,
    rate_p2_usd: 80,
    usd: 1340,
    state: 'running',
    covered_by: null,
    covered_doc: null,
    ...overrides,
  }
}

function group(anchor: string, division: DemurrageDivision, overrides: Partial<BoardGroup> = {}): BoardGroup {
  return {
    anchor_bl_id: anchor,
    bl_ids: [anchor],
    voyage_id: 3,
    voyage_label: 'NAVIO / 001E',
    customer_id: 7,
    customer_name: `Cliente ${anchor}`,
    customer_cnpj: '11222333000181',
    division,
    reason_code: null,
    reason: null,
    warning: null,
    no_rate_types: null,
    usd: 1340,
    boxes: [box(`MSCU${anchor.replace(/\D/g, '')}00001`, { bl_id: anchor })],
    ...overrides,
  }
}

// Dados de exemplo do protótipo (aceite do lote 2).
const GROUPS: BoardGroup[] = [
  group('QV-02', 'correndo', { warning: 'B/L QV-02 sem CE Mercante. Cadastre o CE antes de faturar.' }),
  group('QV-04', 'a_emitir', { boxes: [box('MSCU0400001', { bl_id: 'QV-04', state: 'returned_overstay', return_date: '2026-10-24', usd: 1100 })], usd: 1100 }),
  group('QV-09A', 'a_emitir', {
    bl_ids: ['QV-09A', 'QV-09B'],
    usd: 500,
    boxes: [
      box('MSCU0900001', { bl_id: 'QV-09A', state: 'covered', return_date: '2026-10-20', usd: null, covered_by: 17, covered_doc: 'DEM-2026-0017' }),
      box('MSCU0900002', { bl_id: 'QV-09B', state: 'returned_overstay', return_date: '2026-10-24', usd: 500 }),
    ],
  }),
  group('QV-07A', 'esperando', {
    bl_ids: ['QV-07A', 'QV-07B'],
    usd: 1100,
    boxes: [
      box('TGHU0700001', { bl_id: 'QV-07A', state: 'returned_overstay', return_date: '2026-10-24', usd: 1100 }),
      box('TGHU0700002', { bl_id: 'QV-07B', state: 'in_free_time', usd: null, last_free_day: '2026-11-05', total_days: 5 }),
    ],
  }),
  group('QV-04B', 'travado', { reason_code: 'sem_ce', reason: 'B/L QV-04B sem CE Mercante. Cadastre o CE antes de faturar.', boxes: [box('MSCU0410001', { bl_id: 'QV-04B', state: 'returned_overstay', return_date: '2026-10-24', usd: 1100 })], usd: 1100 }),
  group('QV-14', 'travado', { reason_code: 'sem_tarifa', reason: 'Tipo 45HC sem tarifa de Demurrage.', no_rate_types: '45HC', usd: 0, boxes: [box('MSCU1400001', { bl_id: 'QV-14', type: '45HC', state: 'no_rate', usd: null, free_days: null, free_source: null })] }),
]

function renderTab(division: DemurrageDivision, props: Partial<Parameters<typeof DemurrageContainersTab>[0]> = {}) {
  const handlers = {
    onGenerateInvoice: vi.fn(),
    onEditContainer: vi.fn(),
    onOpenInvoice: vi.fn(),
    onDivisionChange: vi.fn(),
    onSearchChange: vi.fn(),
  }
  render(
    <MemoryRouter>
      <DemurrageContainersTab
        groups={GROUPS}
        search=""
        division={division}
        loading={false}
        error={null}
        canIssue
        generatingBl={null}
        onRetry={vi.fn()}
        {...handlers}
        {...props}
      />
    </MemoryRouter>,
  )
  return handlers
}

describe('aba Containers por divisão (ADR 0112, D1 a D5)', () => {
  it('as divisões mostram quantos grupos têm, e a escolha vai para a URL', async () => {
    const handlers = renderTab('correndo')
    const divisions = screen.getByRole('radiogroup', { name: 'Divisão da cobrança' })
    expect(within(divisions).getByRole('radio', { name: 'Correndo (1)' })).toBeTruthy()
    expect(within(divisions).getByRole('radio', { name: 'A emitir (2)' })).toBeTruthy()
    expect(within(divisions).getByRole('radio', { name: 'Esperando (1)' })).toBeTruthy()
    expect(within(divisions).getByRole('radio', { name: 'Travado (2)' })).toBeTruthy()
    await userEvent.setup().click(within(divisions).getByRole('radio', { name: 'Travado (2)' }))
    expect(handlers.onDivisionChange).toHaveBeenCalledWith('travado')
  })

  it('Correndo mostra o US$ de hoje e o aviso do que vai travar a emissão, sem Gerar Invoice', () => {
    renderTab('correndo')
    const row = screen.getByRole('link', { name: 'QV-02' }).closest('tr')!
    expect(within(row).getByText('US$ 1.340,00')).toBeTruthy()
    expect(within(row).getByText(/sem CE Mercante/)).toBeTruthy()
    expect(within(row).queryByRole('button', { name: /Gerar Invoice/ })).toBeNull()
  })

  it('A emitir oferece Gerar Invoice, e a complementar quando o grupo já tem Invoice', async () => {
    const handlers = renderTab('a_emitir')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Gerar Invoice do B/L QV-04' }))
    expect(handlers.onGenerateInvoice).toHaveBeenCalledWith('QV-04')
    expect(screen.getByRole('button', { name: 'Gerar Invoice complementar do B/L QV-09A' })).toBeTruthy()
    expect(screen.getByText('+ 1 B/L do grupo')).toBeTruthy()
  })

  it('a caixa já cobrada diz em qual Invoice; o grupo conta fora, devolvidos e total', async () => {
    const handlers = renderTab('a_emitir')
    const row = screen.getByRole('link', { name: 'QV-09A' }).closest('tr')!
    expect(within(row).getByText('0 fora · 2 devolvidos · 2')).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Abrir os containers do B/L QV-09A' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'DEM-2026-0017' }))
    expect(handlers.onOpenInvoice).toHaveBeenCalledWith(17)
  })

  it('Esperando nomeia a caixa que falta e o último dia livre', () => {
    renderTab('esperando')
    expect(screen.getByText('Aguarda TGHU0700002 até 05/11')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Gerar Invoice/ })).toBeNull()
  })

  it('Travado mostra o motivo e o atalho que destrava, nunca Gerar Invoice', () => {
    renderTab('travado')
    const ce = screen.getByRole('link', { name: 'QV-04B' }).closest('tr')!
    expect(within(ce).getByText(/sem CE Mercante/)).toBeTruthy()
    expect(within(ce).getByRole('link', { name: 'Cadastrar CE' }).getAttribute('href')).toBe('/bls/QV-04B')
    const rate = screen.getByRole('link', { name: 'QV-14' }).closest('tr')!
    expect(within(rate).getByRole('link', { name: 'Cadastrar tipo' }).getAttribute('href')).toBe('/demurrage/taxas?tab=tipos&tipo=45HC')
    expect(screen.queryByRole('button', { name: /Gerar Invoice/ })).toBeNull()
  })

  it('a busca filtra as divisões e as contagens juntas', () => {
    renderTab('a_emitir', { search: 'DEM-2026-0017' })
    expect(screen.getByRole('radio', { name: 'A emitir (1)' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Correndo (0)' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'QV-04' })).toBeNull()
  })

  it('Editar datas abre o formulário com a caixa e o grupo', async () => {
    const handlers = renderTab('esperando')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Abrir os containers do B/L QV-07A' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Editar datas de TGHU0700002' }))
    expect(handlers.onEditContainer).toHaveBeenCalledWith(expect.objectContaining({ container_number: 'TGHU0700002' }), expect.objectContaining({ anchor_bl_id: 'QV-07A' }))
  })
})

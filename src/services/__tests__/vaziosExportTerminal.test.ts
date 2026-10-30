import { beforeEach, describe, expect, it, vi } from 'vitest'

// ADR 0113 (migration 541): o embarque de vazios opera no terminal da frente
// Vazios EXP da escala.
const db = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  filters: [] as Array<[string, string, unknown]>,
  rpc: vi.fn(),
}))
vi.mock('../supabase', () => ({
  supabase: {
    rpc: db.rpc,
    from: (table: string) => {
      const builder = {
        select: () => builder,
        order: () => builder,
        eq: (column: string, value: unknown) => {
          db.filters.push([table, `eq.${column}`, value])
          return builder
        },
        in: (column: string, values: unknown) => {
          db.filters.push([table, `in.${column}`, values])
          return builder
        },
        or: (filter: string) => {
          db.filters.push([table, 'or', filter])
          return builder
        },
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => resolve({ data: db.rows[table] ?? [], error: null }),
      }
      return builder
    },
  },
}))

import { createVaziosExportOperation, fetchVaziosExportTerminalChoice } from '../vaziosExportOperations'

beforeEach(() => {
  db.rows = {}
  db.filters = []
  db.rpc.mockReset()
})

describe('createVaziosExportOperation', () => {
  it('cria pelo banco com o terminal e diz se o embarque já existia', async () => {
    db.rpc.mockResolvedValue({ data: { id: 'op-1', created: false, terminal_id: 'ter-1' }, error: null })
    await expect(createVaziosExportOperation({ voyageId: 7, embarkPort: 'BRVIX', terminalId: 'ter-1' }))
      .resolves.toEqual({ id: 'op-1', created: false, terminalId: 'ter-1' })
    expect(db.rpc).toHaveBeenCalledWith('create_vazios_export_operation', { p_voyage_id: 7, p_port: 'BRVIX', p_terminal_id: 'ter-1' })
  })

  it('repassa a recusa do banco', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: 'Escolha o terminal onde o embarque de vazios de BRVIX opera.' } })
    await expect(createVaziosExportOperation({ voyageId: 7, embarkPort: 'BRVIX', terminalId: null }))
      .rejects.toMatchObject({ message: expect.stringMatching(/Escolha o terminal/) })
  })
})

describe('fetchVaziosExportTerminalChoice', () => {
  it('frente em TBC: oferece só os terminais portuários ativos do porto', async () => {
    db.rows.voyage_escala_operation_fronts = [{ terminal_id: null }]
    db.rows.ports = [{ id: 10 }]
    db.rows.depots = [
      { id: 'a', code: 'TVV', name: 'Terminal de Vila Velha', active: true, port_id: 10 },
      { id: 'b', code: 'OLD', name: null, active: false, port_id: 10 },
    ]
    await expect(fetchVaziosExportTerminalChoice(7, 'brvix')).resolves.toEqual({
      frontTerminal: null,
      options: [{ id: 'a', code: 'TVV', name: 'Terminal de Vila Velha' }],
    })
    expect(db.filters).toContainEqual(['voyage_escala_operation_fronts', 'in.port', expect.arrayContaining(['BRVIX'])])
    expect(db.filters).toContainEqual(['depots', 'or', 'port_id.in.(10)'])
  })

  it('frente com terminal: devolve o terminal dela, mesmo inativo', async () => {
    db.rows.voyage_escala_operation_fronts = [{ terminal_id: 'b' }]
    db.rows.ports = [{ id: 10 }]
    db.rows.depots = [
      { id: 'a', code: 'TVV', name: null, active: true, port_id: 10 },
      { id: 'b', code: 'OLD', name: 'Antigo', active: false, port_id: 10 },
    ]
    const choice = await fetchVaziosExportTerminalChoice(7, 'BRVIX')
    expect(choice.frontTerminal).toEqual({ id: 'b', code: 'OLD', name: 'Antigo' })
    expect(db.filters).toContainEqual(['depots', 'or', 'port_id.in.(10),id.eq.b'])
  })
})

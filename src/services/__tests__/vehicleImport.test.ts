import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { importVehicleRows, parseVehicleImportBuffer, type VehicleImportRow } from '../vehicleImport'
import { jsonToBuffer, sheetsToBuffer } from './testWorkbook'

const { mockFrom, mockRpc } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
  },
}))

describe('vehicleImport', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
    mockRpc.mockResolvedValue({ data: { status: 'exempt', exempt: true }, error: null })
  })

  it('S03: valida a fixture QA anonimizada do fluxo COSCO', async () => {
    const file = readFileSync(resolve(process.cwd(), 'test-fixtures/qa-veiculos.xlsx'))
    const parsed = await parseVehicleImportBuffer(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength))

    expect(parsed.rowErrors).toEqual([])
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows.map((row) => row.bl_id)).toEqual(['QABL001', 'QABL001'])
    expect(parsed.rows.map((row) => row.container_number)).toEqual(['TEMU1234567', 'TEMU1234567'])
  })

  it('parseia a planilha de veiculos com o novo campo modelo', async () => {
    const buffer = jsonToBuffer([
      {
        CHASSI: '9BWZZZ377VT004251',
        MARCA: 'BYD',
        MODELO: 'DOLPHIN',
        PESO: '1.650,50',
        CUBAGEM: '12,3',
        CONTAINER: 'CAXU1234567',
        TIPO_CONTAINER: '40FM',
        LACRE: 'SEL123',
        BL: 'BL001',
        'Local de desova': 'Terminal Rio',
      },
    ])

    const parsed = await parseVehicleImportBuffer(buffer)

    expect(parsed.rowErrors).toHaveLength(0)
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0]?.model).toBe('DOLPHIN')
    expect(parsed.rows[0]?.weight_kg).toBeCloseTo(1650.5)
    expect(parsed.rows[0]?.container_number).toBe('CAXU1234567')
    expect(parsed.rows[0]?.unpacking_location).toBe('Terminal Rio')
  })

	it('mapeia o modelo do armador (COSCO Daily Report) escolhendo a aba de veiculos', async () => {
    // 1a aba: resumo (pivot) sem colunas de veiculo. 2a aba: dados reais.
    const buffer = sheetsToBuffer([
      {
        name: 'Planilha1',
        rows: [{ Brand: 'BYD', 'QTY VIN': 2136 }],
      },
      {
        name: 'Sheet1',
        rows: [
          {
            'Item NO#': 1,
            Vessel: 'COSCO SHIPPING XING WANG',
            Voyage: 31,
            Brand: 'BYD',
            Model: 'SONG PLUS DM-i',
            'VIN NO.': 'LGXC74C44V0007087',
            'GW(kg)': 1970,
            Volume: 15.047,
            'BL NUMBER': 'CSC07870X00V00',
            'Cntr Type': '48FR',
            'Cntr No.': 'CAXU5746573',
            Seal: '035744',
          },
        ],
      },
    ])

    const parsed = await parseVehicleImportBuffer(buffer)

    expect(parsed.rowErrors).toHaveLength(0)
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0]).toMatchObject({
      chassis: 'LGXC74C44V0007087',
      brand: 'BYD',
      model: 'SONG PLUS DM-i',
      weight_kg: 1970,
      cbm: 15.047,
      container_number: 'CAXU5746573',
      container_type: '48FR',
      seal_number: '035744',
      bl_id: 'CSC07870X00V00',
		})
	})

		it('preserva números Excel nativos mesmo quando a formatação usa vírgula de milhar', async () => {
		const XLSX = await import('@e965/xlsx')
		const workbook = XLSX.utils.book_new()
		const sheet = XLSX.utils.aoa_to_sheet([
			['CHASSI', 'MARCA', 'MODELO', 'PESO', 'CUBAGEM', 'CONTAINER', 'TIPO_CONTAINER', 'LACRE', 'BL'],
			['9BWZZZ377VT004251', 'BYD', 'DOLPHIN', 1234, 12, 'CAXU1234567', '40FM', 'SEL123', 'BL001'],
		])
		sheet.D2.z = '#,##0'
		sheet.E2.z = '#,##0'
		XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1')
		const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

		const parsed = await parseVehicleImportBuffer(buffer)

		expect(parsed.rowErrors).toEqual([])
			expect(parsed.rows[0]).toMatchObject({ weight_kg: 1234, cbm: 12 })
		})

  it('mapeia a lista de VINs dos terminais chineses da COSCO (cabecalhos em chines)', async () => {
    const buffer = jsonToBuffer([
      {
        序号: 1,
        船名: 'GREEN ITAPOA',
        航次: '6',
        品牌: '比亚迪',
        型号: 'DOLPHIN',
        VIN: 'LC0CE4CC4V0018347',
        毛重: '1405 ',
        体积: '11.694 ',
        提单号: 'CSC45350600100',
        箱型: '40HC',
        箱号: 'BEAU6464201',
        封号: '156000',
      },
    ])

    const parsed = await parseVehicleImportBuffer(buffer)

    expect(parsed.rowErrors).toHaveLength(0)
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0]).toMatchObject({
      chassis: 'LC0CE4CC4V0018347',
      brand: 'BYD',
      model: 'DOLPHIN',
      weight_kg: 1405,
      cbm: 11.694,
      container_number: 'BEAU6464201',
      container_type: '40HC',
      seal_number: '156000',
      bl_id: 'CSC45350600100',
    })
  })

  it('canoniza container ISO em minusculas antes de persistir', async () => {
    const buffer = jsonToBuffer([
      {
        CHASSI: '9BWZZZ377VT004251',
        MARCA: 'BYD',
        MODELO: 'DOLPHIN',
        PESO: '1.650,50',
        CUBAGEM: '12,3',
        CONTAINER: 'caxu1234567',
        TIPO_CONTAINER: '40fm',
        LACRE: 'sel123',
        BL: 'BL001',
      },
    ])

    const parsed = await parseVehicleImportBuffer(buffer)

    expect(parsed.rowErrors).toEqual([])
    expect(parsed.rows[0]).toMatchObject({
      container_number: 'CAXU1234567',
      container_type: '40FM',
      seal_number: 'SEL123',
    })
  })

  it('nao aceita expoente em peso ou cubagem do contrato COSCO', async () => {
    const buffer = jsonToBuffer([
      {
        CHASSI: '9BWZZZ377VT004251',
        MARCA: 'BYD',
        MODELO: 'DOLPHIN',
        PESO: '1e3',
        CUBAGEM: '12,3',
        CONTAINER: 'CAXU1234567',
        TIPO_CONTAINER: '40FM',
        LACRE: 'SEL123',
        BL: 'BL001',
      },
      {
        CHASSI: '9BWZZZ377VT004252',
        MARCA: 'BYD',
        MODELO: 'DOLPHIN',
        PESO: '1.650,50',
        CUBAGEM: '1e2',
        CONTAINER: 'CAXU1234568',
        TIPO_CONTAINER: '40FM',
        LACRE: 'SEL124',
        BL: 'BL002',
      },
    ])

    const parsed = await parseVehicleImportBuffer(buffer)

    expect(parsed.rows).toHaveLength(0)
    expect(parsed.rowErrors).toHaveLength(2)
  })

  it('valida duplicidade de chassi e consistencia BL-container antes de inserir', async () => {
    const insertedRows: Array<Record<string, unknown>> = []

    mockFrom.mockImplementation((table: string) => {
      if (table === 'vehicles') {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({
                data: [],
                error: null,
              }),
            }),
          }),
        }
      }

      if (table === 'bls') {
        return {
          select: () => ({
            eq: () => ({
              in: async (_column: string, values: string[]) => ({
                data: values
                  .filter((value) => value === 'BL001' || value === 'BL002')
                  .map((value) => ({ id: value, voyage_id: 7 })),
                error: null,
              }),
              maybeSingle: async () => ({ data: { financial_status: 'pending' }, error: null }),
            }),
          }),
          update: () => ({
            in: async () => ({ error: null }),
          }),
        }
      }

      if (table === 'bl_containers') {
        return {
          select: () => ({
            in: () => ({
              eq: () => ({
                order: () => ({
                  range: async () => ({
                    data: [
                      {
                        id: 11,
                        bl_id: 'BL001',
                        container_number: 'CAXU1234567',
                        type: '40FM',
                        seal_number: 'SEL123',
                        bl: { voyage_id: 7 },
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }
      }

      if (table === 'invoice_bls') {
        return {
          select: () => ({
            in: async () => ({ data: [], error: null }),
          }),
        }
      }

      throw new Error(`Tabela nao mockada: ${table}`)
    })

    const rows: VehicleImportRow[] = [
      {
        rowNumber: 2,
        chassis: 'CHASSI-001',
        brand: 'BYD',
        model: 'DOLPHIN',
        weight_kg: 1600,
        cbm: 12,
        container_number: 'CAXU1234567',
        container_type: '40FM',
        seal_number: 'SEL123',
        bl_id: 'BL001',
      },
      {
        rowNumber: 3,
        chassis: 'CHASSI-001',
        brand: 'BYD',
        model: 'DOLPHIN',
        weight_kg: 1600,
        cbm: 12,
        container_number: 'CAXU1234567',
        container_type: '40FM',
        seal_number: 'SEL123',
        bl_id: 'BL001',
      },
      {
        rowNumber: 4,
        chassis: 'CHASSI-002',
        brand: 'BYD',
        model: 'SEAL',
        weight_kg: 1700,
        cbm: 11,
        container_number: 'CAXU1234567',
        container_type: '40FM',
        seal_number: 'SEL123',
        bl_id: 'BL002',
      },
      {
        rowNumber: 5,
        chassis: 'CHASSI-003',
        brand: 'BYD',
        model: 'SEAL',
        weight_kg: 1700,
        cbm: 11,
        container_number: 'MSCU0000000',
        container_type: '40FM',
        seal_number: 'SEL000',
        bl_id: 'BL404',
      },
    ]

    mockRpc.mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name === 'import_vehicle_rows_transactional') {
        insertedRows.push(...(args.p_rows as Array<Record<string, unknown>>))
      }
      return Promise.resolve({ data: { status: 'exempt', exempt: true }, error: null })
    })

    const result = await importVehicleRows({ voyageId: 7, rows })

    expect(result.processed).toBe(4)
    expect(result.successCount).toBe(1)
    expect(result.errorCount).toBe(3)
    expect(result.errors.map((error) => error.message)).toEqual([
      'Chassi duplicado no arquivo para a viagem selecionada.',
      'BL nao pertence ao container informado.',
      'BL nao encontrado na viagem selecionada.',
    ])
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0]?.bl_id).toBe('BL001')
    expect(insertedRows[0]?.container_id).toBe(11)
    // O RPC de origem persiste o follow-up; nenhum cálculo/cancelamento fica
    // dependente da janela HTTP do browser.
    expect(mockRpc).toHaveBeenCalledWith('import_vehicle_rows_transactional', expect.anything())
    expect(mockRpc).not.toHaveBeenCalledWith('calculate_bl_local_charges', expect.anything())
    expect(mockRpc).not.toHaveBeenCalledWith('cancel_invoice', expect.anything())
  })

  it('persiste o follow-up quando o BL ja estava faturado', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'vehicles') {
        return {
          select: () => ({ eq: () => ({ in: async () => ({ data: [], error: null }) }) }),
          insert: async () => ({ error: null }),
        }
      }
      if (table === 'bls') {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({ data: [{ id: 'BL001', voyage_id: 7 }], error: null }),
              // Consulta pontual pre-recalculo (etapa 2): reflete o estado apos o
              // cancelamento da fatura ja ter sido aplicado por cancel_invoice.
              maybeSingle: async () => ({ data: { financial_status: 'pending' }, error: null }),
            }),
          }),
          update: () => ({ in: async () => ({ error: null }) }),
        }
      }
      if (table === 'bl_containers') {
        return {
          select: () => ({
            in: () => ({
              eq: () => ({
                order: () => ({
                  range: async () => ({
                    data: [{ id: 11, bl_id: 'BL001', container_number: 'CAXU1234567', type: '40FM', seal_number: 'SEL123', bl: { voyage_id: 7 } }],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'invoice_bls') {
        return { select: () => ({ in: async () => ({ data: [{ bl_id: 'BL001', invoice_id: 900 }], error: null }) }) }
      }
      if (table === 'invoices') {
        return { select: () => ({ in: async () => ({ data: [{ id: 900, status: 'issued' }], error: null }) }) }
      }
      throw new Error(`Tabela nao mockada: ${table}`)
    })

    const result = await importVehicleRows({
      voyageId: 7,
      rows: [
        {
          rowNumber: 2,
          chassis: 'CHASSI-V1',
          brand: 'BYD',
          model: 'DOLPHIN',
          weight_kg: 1500,
          cbm: 12,
          container_number: 'CAXU1234567',
          container_type: '40FM',
          seal_number: 'SEL123',
          bl_id: 'BL001',
        },
      ],
    })

    expect(result.successCount).toBe(1)
    expect(result.errorCount).toBe(0)
    expect(mockRpc).toHaveBeenCalledWith('import_vehicle_rows_transactional', expect.anything())
    expect(mockRpc).not.toHaveBeenCalledWith('cancel_invoice', expect.anything())
    expect(mockRpc).not.toHaveBeenCalledWith('calculate_bl_local_charges', expect.anything())
  })

  it('rejeita linha quando mais de um container atende ao mesmo tipo e lacre', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'vehicles') {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({
                data: [],
                error: null,
              }),
            }),
          }),
          insert: async () => ({ error: null }),
        }
      }

      if (table === 'bls') {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({
                data: [{ id: 'BL001', voyage_id: 7 }],
                error: null,
              }),
              maybeSingle: async () => ({ data: { financial_status: 'pending' }, error: null }),
            }),
          }),
          update: () => ({
            in: async () => ({ error: null }),
          }),
        }
      }

      if (table === 'bl_containers') {
        return {
          select: () => ({
            in: () => ({
              eq: () => ({
                order: () => ({
                  range: async () => ({
                    data: [
                      {
                        id: 11,
                        bl_id: 'BL001',
                        container_number: 'CAXU1234567',
                        type: '40FM',
                        seal_number: 'SEL123',
                        bl: { voyage_id: 7 },
                      },
                      {
                        id: 12,
                        bl_id: 'BL001',
                        container_number: 'CAXU1234567',
                        type: '40FM',
                        seal_number: 'SEL123',
                        bl: { voyage_id: 7 },
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }
      }

      throw new Error(`Tabela nao mockada: ${table}`)
    })

    const result = await importVehicleRows({
      voyageId: 7,
      rows: [
        {
          rowNumber: 2,
          chassis: 'CHASSI-AMB',
          brand: 'BYD',
          model: 'SEAL',
          weight_kg: 1700,
          cbm: 11,
          container_number: 'CAXU1234567',
          container_type: '40FM',
          seal_number: 'SEL123',
          bl_id: 'BL001',
        },
      ],
    })

    expect(result.successCount).toBe(0)
    expect(result.errorCount).toBe(1)
    expect(result.errors[0]?.message).toContain('Mais de um container desta BL')
  })
})

describe('vehicleImport — P1-9: validação de chassi e teto de absurdo', () => {
  it('recusa chassi mais curto que os 17 caracteres do VIN (ISO 3779)', async () => {
    const buffer = jsonToBuffer([
      {
        CHASSI: 'CURTO123',
        MARCA: 'BYD',
        MODELO: 'DOLPHIN',
        PESO: '1650',
        CUBAGEM: '12',
        CONTAINER: 'CAXU1234567',
        TIPO_CONTAINER: '40FM',
        LACRE: 'SEL123',
        BL: 'BL001',
      },
    ])
    const parsed = await parseVehicleImportBuffer(buffer)
    expect(parsed.rows).toHaveLength(0)
    expect(parsed.rowErrors[0]?.message).toContain('formato VIN esperado')
  })

  it('recusa chassi com letras proibidas pelo VIN (I, O, Q)', async () => {
    const buffer = jsonToBuffer([
      {
        CHASSI: 'LGXC74O44V0007087', // 'O' na posição 8, proibida no VIN
        MARCA: 'BYD',
        MODELO: 'DOLPHIN',
        PESO: '1650',
        CUBAGEM: '12',
        CONTAINER: 'CAXU1234567',
        TIPO_CONTAINER: '40FM',
        LACRE: 'SEL123',
        BL: 'BL001',
      },
    ])
    const parsed = await parseVehicleImportBuffer(buffer)
    expect(parsed.rows).toHaveLength(0)
    expect(parsed.rowErrors[0]?.message).toContain('formato VIN esperado')
  })

  it('recusa peso fora da faixa plausível para um veículo (teto de absurdo)', async () => {
    const buffer = jsonToBuffer([
      {
        CHASSI: '9BWZZZ377VT004251',
        MARCA: 'BYD',
        MODELO: 'DOLPHIN',
        PESO: '1650000', // 1.650 toneladas — nao e um veiculo
        CUBAGEM: '12',
        CONTAINER: 'CAXU1234567',
        TIPO_CONTAINER: '40FM',
        LACRE: 'SEL123',
        BL: 'BL001',
      },
    ])
    const parsed = await parseVehicleImportBuffer(buffer)
    expect(parsed.rows).toHaveLength(0)
    expect(parsed.rowErrors[0]?.message).toContain('fora da faixa plausível')
  })

  it('não recai sobre uma segunda leitura quando o número contradiz o formato declarado/inferido', async () => {
    // Cabecalho sem marcador de carrier -> formato inferido pt-BR. '1.650,50'
    // em pt-BR e 1650,5 (valido). Ja '12.34' nao e pt-BR valido (separador de
    // milhar sem tres digitos) nem deveria ser relido como outra convencao.
    const buffer = jsonToBuffer([
      {
        CHASSI: '9BWZZZ377VT004251',
        MARCA: 'BYD',
        MODELO: 'DOLPHIN',
        PESO: '1.650,50',
        CUBAGEM: '12.34',
        CONTAINER: 'CAXU1234567',
        TIPO_CONTAINER: '40FM',
        LACRE: 'SEL123',
        BL: 'BL001',
      },
    ])
    const parsed = await parseVehicleImportBuffer(buffer)
    expect(parsed.rows).toHaveLength(0)
    expect(parsed.rowErrors[0]?.message).toContain('obrigatorios')
  })
})


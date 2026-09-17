import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importBreakbulkManifest, parseBreakbulkManifestBuffer, type ParsedBreakbulkManifest } from '../breakbulkImport'
import { aoaToBuffer, jsonToBuffer } from './testWorkbook'

// breakbulkImport importa customerReconciliation que importa supabase — mock necessário para
// testes de parser que não usam o banco.
const { mockFrom, mockRpc } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
}))

describe('breakbulkImport', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
  })

  it('bloqueia erros de linha antes de tocar no banco sem override explícito', async () => {
    await expect(importBreakbulkManifest({
      filename: 'bb.xlsx',
      voyageId: 10,
      manifest: {
        layout: 'summary',
        bls: [],
        rowErrors: [{ row: 2, message: 'Porto inválido.', raw: {} }],
      },
      uploadedBy: 'user-1',
    })).rejects.toThrow('Linha 2')

    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('parseia o layout BB resumido', async () => {
    const buffer = jsonToBuffer([
      {
        BL: 'CCSV22001',
        CE: '122605051526081',
        MAQUINAS: 8,
        PACKAGES: 24,
        'PACKAGES TOTAL': 32,
        'WEIGHT (TON)': '259,312',
        'CBM (M3)': '1217,109',
        SHIPPER: 'SANY INTERNATIONAL',
        CONSIGNEE: 'TIMBRO TRADING S.A.',
        NOTIFY: 'SANY IMPORTACAO',
      },
    ])

    const manifest = await parseBreakbulkManifestBuffer(buffer)

    expect(manifest.layout).toBe('summary')
    expect(manifest.rowErrors).toHaveLength(0)
    expect(manifest.bls).toHaveLength(1)
    expect(manifest.bls[0]?.bb_machine_qty).toBe(8)
    expect(manifest.bls[0]?.bb_packages_total).toBe(32)
    expect(manifest.bls[0]?.bb_weight_ton).toBeCloseTo(259.312)
    expect(manifest.bls[0]?.total_weight_kg).toBeCloseTo(259312)
  })

  it('envia lote, BLs, itens e erros para a RPC transacional', async () => {
    const upsertBls = vi.fn(() => Promise.resolve({ error: null }))
    mockRpc.mockImplementation((name: string) =>
      Promise.resolve(name === 'import_breakbulk_manifest_transactional'
        ? { data: { batch_id: 77 }, error: null }
        : { data: { status: 'calculated' }, error: null }),
    )
    mockFrom.mockImplementation((table: string) => {
      if (table === 'voyages') {
        return { select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: { id: 10 }, error: null })) })) })) }
      }
      if (table === 'customers') {
        return {
          select: vi.fn(() => ({
            order: vi.fn(() => ({
              range: vi.fn(() =>
                Promise.resolve({
                  data: [{ id: 123, name: 'TIMBRO TRADING S.A.', cnpj_cpf: '12.116.971/0010-71' }],
                  error: null,
                }),
              ),
            })),
          })),
        }
      }
      if (table === 'import_batches') {
        return {
          insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: { id: 77 }, error: null })) })) })),
          update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })),
        }
      }
      if (table === 'bls') {
        return {
          select: vi.fn(() => ({ in: vi.fn(() => Promise.resolve({ data: [], error: null })) })),
          upsert: upsertBls,
        }
      }
      if (table === 'bl_breakbulk_items') {
        return {
          delete: vi.fn(() => ({ in: vi.fn(() => Promise.resolve({ error: null })) })),
        }
      }
      throw new Error(`Tabela nao mockada: ${table}`)
    })

    const manifest: ParsedBreakbulkManifest = {
      layout: 'summary',
      rowErrors: [],
      bls: [
        {
          rowNumber: 2,
          bl_id: 'BB001',
          ce_mercante: null,
          shipper: 'SANY INTERNATIONAL',
          consignee: 'TIMBRO TRADING S.A.',
          notify_party: 'SAME AS CONSIGNEE',
          cnpj_cpf: '12.116.971/0010-71',
          pol: 'CNTAC',
          pod: 'BRVIX',
          bb_machine_qty: 2,
          bb_packages_qty: 2,
          bb_packages_total: 2,
          bb_weight_ton: 10,
          total_weight_kg: 10000,
          total_cbm: 30,
          items: [],
        },
      ],
    }

    await importBreakbulkManifest({
      filename: 'bb.xlsx',
      voyageId: 10,
      manifest,
      uploadedBy: '00000000-0000-0000-0000-000000000001',
    })

    expect(upsertBls).not.toHaveBeenCalled()
    expect(mockRpc).toHaveBeenCalledWith('import_breakbulk_manifest_transactional', expect.objectContaining({
      p_filename: 'bb.xlsx',
      p_voyage_id: 10,
      p_uploaded_by: '00000000-0000-0000-0000-000000000001',
      p_bls: [expect.objectContaining({
        id: 'BB001',
        customer_id: 123,
        manifest_customer_cnpj_cpf: '12.116.971/0010-71',
        customer_reconciliation_status: 'matched_document',
        billing_hold_reason: null,
      })],
      p_items: [],
      p_errors: [],
    }))
  })

  it('agrega linhas do layout BB legado por BL', async () => {
    const buffer = jsonToBuffer([
      {
        BL: 'BBL001',
        CONSIGNATARIO: 'IMPORTADOR ALFA',
        CNPJ: '12.345.678/0001-95',
        POL: 'CNTAC',
        POD: 'BRSSA',
        DESCRICAO: 'MOTOR',
        VOLUMES: 2,
        PESO_KG: 1000,
        CBM: '10,5',
      },
      {
        BL: 'BBL001',
        CONSIGNATARIO: 'IMPORTADOR ALFA',
        CNPJ: '12.345.678/0001-95',
        POL: 'CNTAC',
        POD: 'BRSSA',
        DESCRICAO: 'CHASSI',
        VOLUMES: 3,
        PESO_KG: 500,
        CBM: '4,5',
      },
    ])

    const manifest = await parseBreakbulkManifestBuffer(buffer)
    const bl = manifest.bls[0]

    expect(manifest.layout).toBe('legacy')
    expect(manifest.rowErrors).toHaveLength(0)
    expect(manifest.bls).toHaveLength(1)
    expect(bl?.bb_packages_total).toBe(5)
    expect(bl?.total_weight_kg).toBe(1500)
    expect(bl?.total_cbm).toBeCloseTo(15)
    expect(bl?.items).toHaveLength(2)
  })

  it('parseia layout carrier com cabecalho B/L NO.', async () => {
    const buffer = jsonToBuffer([
      { A: 'CARGO MANIFEST' },
      { A: 'B/L NO.', B: 'POD', C: 'DECRIPTION', D: 'Pkg', E: 'G.W(KGS)', F: 'CBM', G: 'SHIPPER', H: 'CONSIGNEE', I: 'NOTIFY' },
      {
        A: 'JQV37ZJGPAR001',
        B: 'VITORIA,BRAZIL',
        C: '5 PACKAGES\n5 UNITS OF XCMG BULLDOZER',
        D: 5,
        E: 99700,
        F: 393.35,
        G: 'XCMG CONSTRUCTION MACHINERY GROUP HK LIMITED',
        H: 'TIMBRO TRADING S.A\nCNPJ: 12.116.971/0010-71',
        I: 'SAME AS CONSIGNEE',
      },
    ])

    const manifest = await parseBreakbulkManifestBuffer(buffer)
    const bl = manifest.bls[0]

    expect(manifest.layout).toBe('carrier')
    expect(manifest.rowErrors).toHaveLength(0)
    expect(bl?.bl_id).toBe('JQV37ZJGPAR001')
    expect(bl?.pod).toBe('BRVIX')
    expect(bl?.bb_machine_qty).toBe(5)
    expect(bl?.bb_packages_qty).toBe(5)
    expect(bl?.total_weight_kg).toBe(99700)
    expect(bl?.total_cbm).toBeCloseTo(393.35)
    expect(bl?.cnpj_cpf).toBe('12116971001071')
  })

  it('parseia carrier TAICANG com partes em linhas SH/CN/NP', async () => {
    const buffer = aoaToBuffer([
      ['EXPORT CARGO MANIFEST'],
      ['LOADING PORT:', 'TAICANG, CHINA', '', 'DISCH PORT:', 'VITORIA, BRAZIL'],
      ['B/L NO.', 'SHIPPER/CONSIGNEE/NOTIFY PARTY', '', '', 'MARKS', 'DESCRIPTION OF GOODS', '', '', 'NUMBER OF PIECES', '', 'GROSS WEIGHT'],
      [
        'GRI011TCVIT101',
        'SH:',
        'SANY SOUTH EAST ASIA PTE LTD\nHUP HIN BUILDING',
        '',
        'SANY DO BRASIL',
        '16 PACKAGES\n8 UNITS SANY HYDRAULIC EXCAVATOR SY215H',
        '',
        '',
        16,
        'PACKAGES',
        175440,
        'KGS',
      ],
      ['', 'CN:', 'COMEXPORT TRADING COMERCIO EXTERIOR LTDA - CNPJ: 01.135.153/0006-13', '', '', '', '', '', '', '', 794.761, 'CBMS'],
      ['', 'NP:', 'SANY IMPORTACAO E EXPORTACAO DA AMERICA DO SUL LTDA - CNPJ: 09.066.194/0002-83'],
    ])

    const manifest = await parseBreakbulkManifestBuffer(buffer)
    const bl = manifest.bls[0]

    expect(manifest.layout).toBe('carrier')
    expect(manifest.rowErrors).toHaveLength(0)
    expect(bl?.bl_id).toBe('GRI011TCVIT101')
    expect(bl?.shipper).toContain('SANY SOUTH EAST ASIA')
    expect(bl?.consignee).toContain('COMEXPORT TRADING')
    expect(bl?.notify_party).toContain('SANY IMPORTACAO')
    expect(bl?.cnpj_cpf).toBe('01135153000613')
    expect(bl?.pol).toBe('CNTAC')
    expect(bl?.pod).toBe('BRVIX')
    expect(bl?.bb_machine_qty).toBe(8)
    expect(bl?.total_weight_kg).toBe(175440)
    expect(bl?.total_cbm).toBeCloseTo(794.761)
  })

  it('parseia carrier SYSTEM MANIFEST com partes em celula combinada', async () => {
    const buffer = aoaToBuffer([
      ['MANIFEST'],
      ['PORT OF LOADING:ZHANGJIAGANG, CN', 'PORT OF DISCHARGE:VITORIA, BR'],
      ['Shippers (SH); Consignee (CO); Notify Address (NF)', 'B/L Nr.', 'Marks and Numbers', 'Quantity', 'Description', 'Gross Weight', 'Measurement'],
      [
        'Shipper (SH)\nSANY SOUTH EAST ASIA PTE LTD\nConsignee (CO)\nTIMBRO TRADING S.A\nCNPJ: 12.116.971/0010-71\nNotify Address (NF)\nSANY IMPORTACAO E EXPORTACAO DA AMERICA DO SUL LTDA',
        'GSAL08ZJGVIT02C',
        'SANY DO BRASIL',
        '30PKGS',
        '30 packages\n10 UNIT SANY HYDRAULIC EXCAVATOR SY135C',
        '136873KGS',
        '614.313CBM',
      ],
    ])

    const manifest = await parseBreakbulkManifestBuffer(buffer)
    const bl = manifest.bls[0]

    expect(manifest.layout).toBe('carrier')
    expect(manifest.rowErrors).toHaveLength(0)
    expect(bl?.bl_id).toBe('GSAL08ZJGVIT02C')
    expect(bl?.shipper).toBe('SANY SOUTH EAST ASIA PTE LTD')
    expect(bl?.consignee).toBe('TIMBRO TRADING S.A')
    expect(bl?.cnpj_cpf).toBe('12116971001071')
    expect(bl?.bb_machine_qty).toBe(10)
    expect(bl?.bb_packages_qty).toBe(30)
    expect(bl?.total_weight_kg).toBe(136873)
    expect(bl?.total_cbm).toBeCloseTo(614.313)
  })

  it('parseia carrier ZJG com BL numerico e colunas deslocadas', async () => {
    const buffer = aoaToBuffer([
      ['CARGO MANIFEST'],
      ['M.V. COSCO SHIPPING WISDOM', '', 'FROM: ZHANGJIAGANG'],
      ['B/L NO.', 'POD', 'DECRIPTION', '', '', '', 'Pkg', 'G.W(KGS)', 'CBM', 'SHIPPER', '', 'CONSIGNEE', '', 'NOTIFY'],
      [
        '4514V20ZJGRIO01',
        'RIO DE JANEIRO ,BRAZIL',
        'STUDLESS ANCHOR CHAIN CABLE',
        '',
        '',
        '',
        '75BE',
        '3156820.0',
        '1063.89',
        'BESTLINK TRANSPORT LOGISTIC CO.,LTD.',
        '',
        'ALICAM SERVICOS ADUARNEIROS',
        '',
        'SAME AS CONSIGNEE',
      ],
    ])

    const manifest = await parseBreakbulkManifestBuffer(buffer)
    const bl = manifest.bls[0]

    expect(manifest.layout).toBe('carrier')
    expect(manifest.rowErrors).toHaveLength(0)
    expect(bl?.bl_id).toBe('4514V20ZJGRIO01')
    expect(bl?.consignee).toBe('ALICAM SERVICOS ADUARNEIROS')
    expect(bl?.bb_machine_qty).toBeNull()
    expect(bl?.bb_packages_qty).toBe(75)
    expect(bl?.total_weight_kg).toBe(3156820)
    expect(bl?.total_cbm).toBeCloseTo(1063.89)
  })

  it('quantifica maquinas por nomenclatura de equipamento na descricao', async () => {
    const buffer = aoaToBuffer([
      ['CARGO MANIFEST'],
      ['M.V. EQUIPMENT TEST', '', 'FROM: ZHANGJIAGANG'],
      ['B/L NO.', 'POD', 'DECRIPTION', 'Pkg', 'G.W(KGS)', 'CBM', 'SHIPPER', 'CONSIGNEE', 'NOTIFY'],
      [
        'ZJGBUSCRANE01',
        'VITORIA,BRAZIL',
        '3 UNITS ELECTRIC BUS\n1 UNIT XCMG MOBILE CRANE',
        4,
        100000,
        300,
        'SHIPPER TEST LTDA',
        'CONSIGNEE TEST LTDA\nCNPJ: 12.345.678/0001-95',
        'SAME AS CONSIGNEE',
      ],
    ])

    const manifest = await parseBreakbulkManifestBuffer(buffer)

    expect(manifest.rowErrors).toHaveLength(0)
    expect(manifest.bls[0]?.bb_machine_qty).toBe(4)
  })

  it('usa identificadores tecnicos para quantificar maquinas em descricoes variaveis', async () => {
    const buffer = aoaToBuffer([
      ['CARGO MANIFEST'],
      ['M.V. EQUIPMENT TEST', '', 'FROM: ZHANGJIAGANG'],
      ['B/L NO.', 'POD', 'DECRIPTION', 'Pkg', 'G.W(KGS)', 'CBM', 'SHIPPER', 'CONSIGNEE', 'NOTIFY'],
      [
        'ZJGCRUSHER01',
        'VITORIA,BRAZIL',
        '1 UNIT MOBILE JAW CRUSHER\nCHASSIS NUMBER/VIN NUMBER/ENGINE NUMBER:\nXUGCRUSHER001/ENG001',
        1,
        52000,
        120,
        'SHIPPER TEST LTDA',
        'CONSIGNEE TEST LTDA\nCNPJ: 12.345.678/0001-95',
        'SAME AS CONSIGNEE',
      ],
      [
        'ZJGTRUCK01',
        'VITORIA,BRAZIL',
        '3 UNITS OFF-ROAD TRUCK\nFRAME NO./ENGINE NO.:\nTRUCK001/ENG001',
        3,
        150000,
        450,
        'SHIPPER TEST LTDA',
        'CONSIGNEE TEST LTDA\nCNPJ: 12.345.678/0001-95',
        'SAME AS CONSIGNEE',
      ],
      [
        'ZJGUNITONLY01',
        'VITORIA,BRAZIL',
        '2 UNITS\nCHASSIS NUMBER/VIN NUMBER/ENGINE NUMBER:\nUNIT001/ENG001\nUNIT002/ENG002',
        2,
        80000,
        250,
        'SHIPPER TEST LTDA',
        'CONSIGNEE TEST LTDA\nCNPJ: 12.345.678/0001-95',
        'SAME AS CONSIGNEE',
      ],
    ])

    const manifest = await parseBreakbulkManifestBuffer(buffer)

    expect(manifest.rowErrors).toHaveLength(0)
    expect(manifest.bls.find((bl) => bl.bl_id === 'ZJGCRUSHER01')?.bb_machine_qty).toBe(1)
    expect(manifest.bls.find((bl) => bl.bl_id === 'ZJGTRUCK01')?.bb_machine_qty).toBe(3)
    expect(manifest.bls.find((bl) => bl.bl_id === 'ZJGUNITONLY01')?.bb_machine_qty).toBe(2)
  })

  it('usa NCM de maquinas para contar identificadores de modelo', async () => {
    const buffer = aoaToBuffer([
      ['MANIFEST'],
      ['PORT OF LOADING:ZHANGJIAGANG, CN', 'PORT OF DISCHARGE:VITORIA, BR'],
      ['Shippers (SH); Consignee (CO); Notify Address (NF)', 'B/L Nr.', 'Marks and Numbers', 'Quantity', 'Description', 'Gross Weight', 'Measurement'],
      [
        'Shipper (SH)\nGOODRICH INTERNATIONAL FREIGHT FORWARDER\nConsignee (CO)\nAIR SEA -UNIVERSAL LOGISTICS SERVICES LTDA\nCNPJ 19.235.691/0001-30\nNotify Address (NF)\nSAME AS CONSIGNEE',
        'GSAL08ZJGVIT01',
        'N/M',
        '9PKGS',
        'TELESCOPIC BOOMS SX-135XC\nSX135D-346\nSX135D-342\nSX135D-347\nSX135D-345\nSX135D-344\nSX135D-343\nSX135D-348\nTELESCOPIC BOOMS SX-125XC\nSX125D-3021\nSX125D-3020\nNCM 8427',
        '191091KGS',
        '891.11CBM',
      ],
    ])

    const manifest = await parseBreakbulkManifestBuffer(buffer)

    expect(manifest.rowErrors).toHaveLength(0)
    expect(manifest.bls[0]?.bb_machine_qty).toBe(9)
  })

  // A autoridade sobre o CE Mercante e a importacao de CE Mercante. Nenhum
  // layout de manifesto BB alem do resumo traz CE, e o B/L avulso nunca traz —
  // omitir o campo permite que a RPC preserve atomicamente o valor no target.
  it('omite o CE Mercante quando o arquivo importado nao traz CE', async () => {
    mockRpc.mockImplementation((name: string) =>
      Promise.resolve(name === 'import_breakbulk_manifest_transactional'
        ? { data: { batch_id: 91 }, error: null }
        : { data: { status: 'calculated' }, error: null }),
    )
    mockFrom.mockImplementation((table: string) => {
      if (table === 'voyages') {
        return { select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: { id: 10 }, error: null })) })) })) }
      }
      if (table === 'customers') {
        return { select: vi.fn(() => ({ order: vi.fn(() => ({ range: vi.fn(() => Promise.resolve({ data: [], error: null })) })) })) }
      }
      if (table === 'bls') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => Promise.resolve({
              data: [{ id: 'BB009', cargo_mode: 'carga_solta' }],
              error: null,
            })),
          })),
        }
      }
      throw new Error(`Tabela nao mockada: ${table}`)
    })

    const manifest: ParsedBreakbulkManifest = {
      layout: 'bl_document',
      rowErrors: [],
      bls: [
        {
          rowNumber: 1,
          bl_id: 'BB009',
          ce_mercante: null,
          shipper: 'SHIPPER LTDA',
          consignee: 'IMPORTADOR LTDA',
          notify_party: null,
          cnpj_cpf: null,
          pol: 'CNTAC',
          pod: 'BRVIX',
          bb_machine_qty: null,
          bb_packages_qty: 4,
          bb_packages_total: 4,
          bb_weight_ton: 1,
          total_weight_kg: 1000,
          total_cbm: 12.5,
          items: [],
        },
      ],
    }

    await importBreakbulkManifest({
      filename: 'BB009.pdf',
      voyageId: 10,
      manifest,
      uploadedBy: '00000000-0000-0000-0000-000000000001',
    })

    const payload = mockRpc.mock.calls.find(([name]) => name === 'import_breakbulk_manifest_transactional')?.[1]
    expect(payload.p_bls[0]).toMatchObject({ id: 'BB009' })
    expect(payload.p_bls[0]).not.toHaveProperty('ce_mercante')
  })

  it('permite importar carga solta para BL existente como container tornando-o misto sem erro', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'voyages') {
        return { select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: { id: 10 }, error: null })) })) })) }
      }
      if (table === 'customers') {
        return {
          select: vi.fn(() => ({
            order: vi.fn(() => ({
              range: vi.fn(() => Promise.resolve({ data: [], error: null })),
            })),
          })),
        }
      }
      if (table === 'bls') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => Promise.resolve({ data: [{ id: 'CNTR_BL_01', cargo_mode: 'container' }], error: null })),
          })),
        }
      }
      return { select: vi.fn(() => ({ in: vi.fn(() => Promise.resolve({ data: [], error: null })) })) }
    })

    mockRpc.mockImplementation(() => Promise.resolve({ data: { batch_id: 88 }, error: null }))

    const manifest: ParsedBreakbulkManifest = {
      layout: 'summary',
      carrier: 'GENERIC',
      rowErrors: [],
      bls: [
        {
          rowNumber: 1,
          bl_id: 'CNTR_BL_01',
          ce_mercante: null,
          shipper: 'SHIPPER',
          consignee: 'CONSIGNEE',
          notify_party: null,
          cnpj_cpf: null,
          pol: 'CNSHG',
          pod: 'BRSSZ',
          bb_machine_qty: null,
          bb_packages_qty: 2,
          bb_packages_total: 2,
          bb_weight_ton: 10,
          total_weight_kg: 10000,
          total_cbm: 20,
          items: [],
        },
      ],
    }

    await importBreakbulkManifest({
      filename: 'mixed.xlsx',
      voyageId: 10,
      manifest,
      uploadedBy: '00000000-0000-0000-0000-000000000001',
    })

    const payload = mockRpc.mock.calls.find(([name]) => name === 'import_breakbulk_manifest_transactional')?.[1]
    expect(payload.p_bls[0]).toMatchObject({ id: 'CNTR_BL_01', cargo_mode: 'misto' })
  })
})

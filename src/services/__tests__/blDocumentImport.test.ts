import { beforeEach, describe, expect, it, vi } from 'vitest'
import { describeVoyageMismatch, importBlDocument, importBlDocuments } from '../blDocumentImport'
import type { ParsedBlDocument } from '../blDocumentParser'

// blDocumentImport chega no supabase pelo breakbulkImport; estes testes cobrem
// a decisão que acontece antes da escrita.
const { mockFrom, mockImportBreakbulkManifest } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockImportBreakbulkManifest: vi.fn(),
}))

vi.mock('../breakbulkImport', () => ({
  importBreakbulkManifest: mockImportBreakbulkManifest,
}))

vi.mock('../supabase', () => ({
  supabase: { from: mockFrom, rpc: vi.fn() },
}))

function blDocument(overrides: Partial<ParsedBlDocument> = {}): ParsedBlDocument {
  return {
    format: 'pdf',
    layout: 'labeled',
    bl_id: 'DX75ZJGVIT02',
    shipper: 'SHIPPER LTDA',
    consignee: 'IMPORTADOR LTDA',
    notify_party: null,
    cnpj_cpf: '13532646000161',
    vessel_name: 'DA XIN',
    voyage_number: '75',
    pol: 'CNZJG',
    pod: 'BRVIX',
    pol_raw: 'ZHANGJIAGANG,CN',
    pod_raw: 'VITORIA,BR',
    originals: 3,
    packages_qty: 5,
    package_unit: 'CASES',
    machine_qty: null,
    cargo_description: 'STAINLESS STEEL SEAMLESS PIPE',
    ncm_codes: ['7304'],
    marks: 'N/M',
    gross_weight_kg: 11652,
    total_cbm: 5.39,
    freight_terms: 'PREPAID',
    place_and_date_of_issue: null,
    remarks: null,
    errors: [],
    warnings: [],
    ...overrides,
  }
}

describe('describeVoyageMismatch', () => {
  it('não acusa divergência quando navio e viagem batem', () => {
    expect(
      describeVoyageMismatch(blDocument(), { voyage_number: '75', vessel: { name: 'DA XIN' } }),
    ).toBeNull()
  })

  it('aceita o alias de prefixo do nome do navio', () => {
    const document = blDocument({ vessel_name: 'CS XING WANG', voyage_number: '33' })

    expect(
      describeVoyageMismatch(document, { voyage_number: '33', vessel: { name: 'COSCO SHIPPING XING WANG' } }),
    ).toBeNull()
  })

  // O armador escreve a mesma viagem como "33", "033" ou "V.33".
  it('ignora zeros à esquerda e pontuação no número da viagem', () => {
    expect(
      describeVoyageMismatch(blDocument({ voyage_number: '75' }), {
        voyage_number: '075',
        vessel: { name: 'DA XIN' },
      }),
    ).toBeNull()
  })

  it('acusa navio diferente', () => {
    const reason = describeVoyageMismatch(blDocument(), {
      voyage_number: '75',
      vessel: { name: 'COSCO SHIPPING XING WANG' },
    })

    expect(reason).toContain('DA XIN / 75')
    expect(reason).toContain('COSCO SHIPPING XING WANG / 75')
  })

  it('acusa viagem diferente do mesmo navio', () => {
    expect(
      describeVoyageMismatch(blDocument(), { voyage_number: '76', vessel: { name: 'DA XIN' } }),
    ).toContain('mas você apontou')
  })

  it('sem viagem escolhida ou sem navio no documento não há o que comparar', () => {
    expect(describeVoyageMismatch(blDocument(), null)).toBeNull()
    expect(
      describeVoyageMismatch(blDocument({ vessel_name: null }), { voyage_number: '75', vessel: { name: 'OUTRO' } }),
    ).toBeNull()
  })

  it('bloqueia viagem diferente mesmo quando o navio não foi extraído', () => {
    expect(
      describeVoyageMismatch(blDocument({ vessel_name: null, voyage_number: '75' }), {
        voyage_number: '76',
        vessel: { name: 'DA XIN' },
      }),
    ).toContain('mas você apontou')
  })
})

describe('importBlDocument', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockImportBreakbulkManifest.mockReset()
  })

  it('recusa documento sem número de B/L antes de tocar no banco', async () => {
    const document = blDocument({ bl_id: '', errors: ['Número do B/L não encontrado no documento.'] })

    await expect(
      importBlDocument({ filename: 'bl.pdf', voyageId: 10, document, uploadedBy: 'user-1' }),
    ).rejects.toThrow('bl.pdf: Número do B/L não encontrado no documento.')
  })

  it('revalida a viagem no serviço antes de persistir', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() =>
            Promise.resolve({ data: { voyage_number: '76', vessel: { name: 'DA XIN' } }, error: null }),
          ),
        })),
      })),
    })

    await expect(
      importBlDocument({
        filename: 'bl.pdf',
        voyageId: 10,
        document: blDocument({ voyage_number: '75' }),
        uploadedBy: 'user-1',
      }),
    ).rejects.toThrow('mas você apontou')
    expect(mockImportBreakbulkManifest).not.toHaveBeenCalled()
  })

  it('envia vários documentos em um único lote BB', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() =>
            Promise.resolve({ data: { voyage_number: '75', vessel: { name: 'DA XIN' } }, error: null }),
          ),
        })),
      })),
    })
    mockImportBreakbulkManifest.mockResolvedValue(77)

    await importBlDocuments({
      filename: 'bls.zip',
      voyageId: 10,
      documents: [blDocument(), blDocument({ bl_id: 'DX75ZJGVIT03' })],
      uploadedBy: 'user-1',
    })

    expect(mockImportBreakbulkManifest).toHaveBeenCalledTimes(1)
    expect(mockImportBreakbulkManifest.mock.calls[0]?.[0].manifest.bls).toHaveLength(2)
  })

  it('avisos pedem o aceite; o aceite não chega à gravação como permissão para erro', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() =>
            Promise.resolve({ data: { voyage_number: '75', vessel: { name: 'DA XIN' } }, error: null }),
          ),
        })),
      })),
    })

    const document = blDocument({ warnings: ['Peso extraído com baixa confiança.'] })
    await expect(importBlDocuments({
      filename: 'bls.zip',
      voyageId: 10,
      documents: [document],
      uploadedBy: 'user-1',
    })).rejects.toThrow('bls.zip')
    expect(mockImportBreakbulkManifest).not.toHaveBeenCalled()

    mockImportBreakbulkManifest.mockResolvedValue(77)
    await importBlDocuments({
      filename: 'bls.zip',
      voyageId: 10,
      documents: [document],
      uploadedBy: 'user-1',
      acceptWarnings: true,
    })

    expect(mockImportBreakbulkManifest).toHaveBeenCalledTimes(1)
    expect(mockImportBreakbulkManifest.mock.calls[0]?.[0]).not.toHaveProperty('allowRowErrors')
  })

  // Regra de 2026-10-19 (ADR 0092): um arquivo com erro recusa o lote inteiro.
  it('um arquivo com erro recusa todos os do lote, sem gravar nenhum', async () => {
    await expect(importBlDocuments({
      filename: 'bls.zip',
      voyageId: 10,
      documents: [blDocument(), blDocument({ bl_id: 'DX75ZJGVIT03', errors: ['Número do B/L não encontrado.'] })],
      uploadedBy: 'user-1',
      acceptWarnings: true,
    })).rejects.toThrow('Número do B/L não encontrado.')
    expect(mockImportBreakbulkManifest).not.toHaveBeenCalled()
  })
})

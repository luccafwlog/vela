import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  blDocumentToManifest,
  normalizeBlDocumentFields,
  parseBlDocumentBuffer,
} from '../blDocumentParser'
import { collectFieldsFromBlocks, type BlDocumentFields } from '../blDocumentFields'

const fixturesPath = new URL('./fixtures/', import.meta.url)

async function readFixtureBuffer(filename: string) {
  const file = await readFile(new URL(filename, fixturesPath))
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer
}

// Os dois modelos são B/Ls reais recebidos da agência, reduzidos apenas no
// peso do arquivo (fonte embutida, imagem do formulário e o desenho base64 do
// fallback do Word). O texto e a estrutura são os do documento original.
describe('parseBlDocumentFile — B/L do armador', () => {
  it('lê o modelo em PDF pelos rótulos numerados do formulário', async () => {
    const document = await parseBlDocumentBuffer(await readFixtureBuffer('bl-cosco-especializado.pdf'), 'pdf')

    expect(document.layout).toBe('labeled')
    expect(document.errors).toEqual([])
    expect(document.warnings).toEqual([])
    expect(document.bl_id).toBe('DX75ZJGVIT02')
    expect(document.shipper).toBe('PARISI GRAND SMOOTH LOGISTICS LTD SHANGHAI BRANCH.')
    expect(document.consignee).toBe('DOM LOGISTICS ASSESSORIA EM COMERCIO EXTERIOR LTDA')
    expect(document.notify_party).toBe('DOM LOGISTICS ASSESSORIA EM COMERCIO EXTERIOR LTDA')
    expect(document.cnpj_cpf).toBe('13532646000161')
    expect(document.vessel_name).toBe('DA XIN')
    expect(document.voyage_number).toBe('75')
    expect(document.pol).toBe('CNZJG')
    expect(document.pod).toBe('BRVIX')
    expect(document.originals).toBe(3)
    expect(document.packages_qty).toBe(5)
    expect(document.package_unit).toBe('CASES')
    expect(document.gross_weight_kg).toBe(11652)
    expect(document.total_cbm).toBe(5.39)
    expect(document.marks).toBe('N/M')
    expect(document.freight_terms).toBe('PREPAID')
    expect(document.ncm_codes).toEqual(['7304'])
    expect(document.cargo_description).toContain('STAINLESS STEEL SEAMLESS PIPE')
    expect(document.place_and_date_of_issue).toBe('VITORIA,BRAZIL 2026-06-18')
  })

  // O texto pré-impresso do formulário divide o mesmo quadro com a carga; nada
  // dele pode virar descrição de mercadoria.
  it('não confunde texto do formulário com dado do embarque no PDF', async () => {
    const document = await parseBlDocumentBuffer(await readFixtureBuffer('bl-cosco-especializado.pdf'), 'pdf')

    expect(document.cargo_description).not.toContain('Container No.')
    expect(document.cargo_description).not.toContain('of which')
    expect(document.cargo_description).not.toContain('TOTAL FIVE CASES ONLY')
    // "0 CASES" é o campo de carga no convés, logo abaixo do quadro — contá-lo
    // como volume trocaria 5 caixas por zero.
    expect(document.packages_qty).toBe(5)
  })

  it('a ressalva do navio fica fora da descrição e traz o anexo do PDF', async () => {
    const document = await parseBlDocumentBuffer(await readFixtureBuffer('bl-cosco-especializado.pdf'), 'pdf')

    expect(document.remarks).toContain('SEE ATTACHMENT.')
    expect(document.remarks).toContain('All cargo was stacked at open yard')
    expect(document.cargo_description).not.toContain('Ship')
  })

  it('lê o modelo em .docx, que não tem rótulo legível', async () => {
    const document = await parseBlDocumentBuffer(await readFixtureBuffer('bl-cosco-formulario.docx'), 'docx')

    expect(document.layout).toBe('form')
    expect(document.errors).toEqual([])
    expect(document.warnings).toEqual([])
    expect(document.bl_id).toBe('CSXW33TCVT01')
    expect(document.shipper).toBe('SANY SOUTH EAST ASIA PTE LTD')
    expect(document.consignee).toBe('TIMBRO TRADING S.A')
    expect(document.notify_party).toBe('SANY IMPORTACAO E EXPORTACAO DA AMERICA DO SUL LTDA')
    expect(document.cnpj_cpf).toBe('12116971001071')
    expect(document.vessel_name).toBe('COSCO SHIPPING XING WANG')
    expect(document.voyage_number).toBe('33')
    expect(document.pol).toBe('CNTAC')
    expect(document.pod).toBe('BRVIX')
    expect(document.originals).toBe(3)
    expect(document.packages_qty).toBe(6)
    expect(document.package_unit).toBe('PACKAGES')
    expect(document.marks).toBe('SANY DO BRASIL')
    expect(document.machine_qty).toBe(1)
    expect(document.ncm_codes).toEqual(['8479'])
    expect(document.place_and_date_of_issue).toBe('VITORIA,BRAZIL 8TH JULY 2026')
  })

  // Peso e medida dividem a mesma caixa de texto no modelo em Word; ler a linha
  // inteira para os dois campos gravaria 16975 CBM.
  it('separa peso e cubagem escritos na mesma linha do .docx', async () => {
    const document = await parseBlDocumentBuffer(await readFixtureBuffer('bl-cosco-formulario.docx'), 'docx')

    expect(document.gross_weight_kg).toBe(16975)
    expect(document.total_cbm).toBe(55.244)
  })

  it('rejeita arquivo que não é do formato declarado', async () => {
    const notADocx = new TextEncoder().encode('isto nao e um docx').buffer
    await expect(parseBlDocumentBuffer(notADocx, 'docx')).rejects.toThrow(/zip/i)
  })
})

describe('normalizeBlDocumentFields', () => {
  const baseFields: BlDocumentFields = {
    blNumber: 'ABC123456789',
    codeName: null,
    shipper: 'SHIPPER LTDA',
    consignee: 'IMPORTADOR LTDA - CNPJ: 12.116.971/0010-71\nRUA A, 1',
    notifyParty: 'NOTIFY LTDA',
    vessel: 'NAVIO TESTE V.12',
    pol: 'TAICANG,CHINA',
    pod: 'VITORIA,BRAZIL',
    originals: 'THREE',
    marks: 'N/M',
    description: '4 CASES\nMAQUINA DE TESTE',
    grossWeight: '1000 KGS',
    measurement: '12.5 CBM',
    placeAndDateOfIssue: null,
    sayTotal: 'SAY TOTAL FOUR CASES ONLY',
    freight: 'FREIGHT COLLECT',
    remarks: null,
  }

  it('separa nome e documento do consignatário', () => {
    const document = normalizeBlDocumentFields(baseFields, 'pdf', 'labeled')

    expect(document.consignee).toBe('IMPORTADOR LTDA')
    expect(document.cnpj_cpf).toBe('12116971001071')
    expect(document.warnings).toEqual([])
  })

  it('lê o total por extenso e o número de vias', () => {
    const document = normalizeBlDocumentFields(baseFields, 'pdf', 'labeled')

    expect(document.packages_qty).toBe(4)
    expect(document.originals).toBe(3)
    expect(document.freight_terms).toBe('COLLECT')
  })

  // O B/L traz a mesma quantidade duas vezes; divergir entre elas é sinal de
  // documento alterado à mão, e o operador precisa ver antes de importar.
  it('avisa quando os volumes divergem do total por extenso', () => {
    const document = normalizeBlDocumentFields(
      { ...baseFields, sayTotal: 'SAY TOTAL SIX CASES ONLY' },
      'pdf',
      'labeled',
    )

    expect(document.packages_qty).toBe(4)
    expect(document.warnings).toContainEqual(expect.stringContaining('divergem do total por extenso'))
  })

  it('sem número de B/L o documento não pode ser importado', () => {
    const document = normalizeBlDocumentFields({ ...baseFields, blNumber: null }, 'pdf', 'labeled')

    expect(document.bl_id).toBe('')
    expect(document.errors).toEqual(['Número do B/L não encontrado no documento.'])
  })

  it('avisa quando falta CNPJ, peso ou cubagem', () => {
    const document = normalizeBlDocumentFields(
      { ...baseFields, consignee: 'IMPORTADOR LTDA', grossWeight: null, measurement: null },
      'docx',
      'form',
    )

    expect(document.cnpj_cpf).toBeNull()
    expect(document.warnings).toHaveLength(3)
    expect(document.warnings.join(' ')).toContain('CNPJ do consignatário')
    expect(document.warnings.join(' ')).toContain('Peso bruto')
    expect(document.warnings.join(' ')).toContain('Cubagem')
  })

  // "11.652 KGS" é onze mil e seiscentos e cinquenta e dois quilos, mas
  // "55.244 CBM" é cinquenta e cinco vírgula duzentos e quarenta e quatro.
  it('trata ponto como milhar no peso e como decimal na cubagem', () => {
    const document = normalizeBlDocumentFields(
      { ...baseFields, grossWeight: '11.652 KGS', measurement: '55.244 CBM' },
      'pdf',
      'labeled',
    )

    expect(document.gross_weight_kg).toBe(11652)
    expect(document.total_cbm).toBe(55.244)
    expect(document.warnings).toContainEqual(expect.stringContaining('separador de milhar'))
  })

  it('converte peso declarado em toneladas', () => {
    const document = normalizeBlDocumentFields({ ...baseFields, grossWeight: '25.5 TONS' }, 'pdf', 'labeled')

    expect(document.gross_weight_kg).toBe(25500)
  })

  it('avisa quando o porto não é reconhecido', () => {
    const document = normalizeBlDocumentFields({ ...baseFields, pod: 'PORTO INEXISTENTE' }, 'pdf', 'labeled')

    expect(document.warnings).toContainEqual(expect.stringContaining('POD'))
  })
})

describe('blDocumentToManifest', () => {
  it('entrega o B/L no modelo do manifesto BB, com os avisos no lote', () => {
    const document = normalizeBlDocumentFields(
      {
        blNumber: 'ABC123456789',
        codeName: null,
        shipper: 'SHIPPER LTDA',
        consignee: 'IMPORTADOR LTDA',
        notifyParty: 'NOTIFY LTDA',
        vessel: 'NAVIO TESTE V.12',
        pol: 'TAICANG,CHINA',
        pod: 'VITORIA,BRAZIL',
        originals: '3',
        marks: 'N/M',
        description: '4 CASES\nMAQUINA DE TESTE',
        grossWeight: '1000 KGS',
        measurement: '12.5 CBM',
        placeAndDateOfIssue: null,
        sayTotal: null,
        freight: null,
        remarks: null,
      },
      'pdf',
      'labeled',
    )

    const manifest = blDocumentToManifest(document)

    expect(manifest.layout).toBe('bl_document')
    expect(manifest.bls).toHaveLength(1)
    expect(manifest.bls[0]?.bl_id).toBe('ABC123456789')
    expect(manifest.bls[0]?.ce_mercante).toBeNull()
    expect(manifest.bls[0]?.bb_weight_ton).toBe(1)
    expect(manifest.bls[0]?.bb_weight_ton).toBe(1)
    expect(manifest.bls[0]?.total_cbm).toBe(12.5)
    expect(manifest.bls[0]?.bb_packages_qty).toBe(4)
    expect(manifest.bls[0]?.items).toEqual([
      {
        item_description: 'MAQUINA DE TESTE',
        package_qty: 4,
        package_unit: 'CASES',
        gross_weight_kg: 1000,
        cbm: 12.5,
        marks: 'N/M',
      },
    ])
    expect(manifest.rowErrors.map((error) => error.message)).toEqual([
      expect.stringContaining('Aviso: CNPJ do consignatário'),
    ])
  })

  it('mantém o consignatário genérico quando o documento não identifica um', () => {
    const document = normalizeBlDocumentFields(
      {
        blNumber: 'ABC123456789',
        codeName: null,
        shipper: null,
        consignee: null,
        notifyParty: null,
        vessel: null,
        pol: null,
        pod: null,
        originals: null,
        marks: null,
        description: null,
        grossWeight: null,
        measurement: null,
        placeAndDateOfIssue: null,
        sayTotal: null,
        freight: null,
        remarks: null,
      },
      'docx',
      'form',
    )

    expect(blDocumentToManifest(document).bls[0]?.consignee).toBe('CONSIGNATARIO NAO IDENTIFICADO')
  })
})

describe('collectFieldsFromBlocks', () => {
  it('preserva as reservas do navio no formulário sem rótulos', () => {
    const block = (order: number, lines: string[]) => ({
      order,
      page: 1,
      x: null,
      y: null,
      lines,
      text: lines.join('\n'),
    })

    const fields = collectFieldsFromBlocks([
      block(0, ['SHIPPER LOGISTICS LTD']),
      block(1, ['CONSIGNEE TRADING S.A', 'CNPJ: 12.116.971/0010-71']),
      block(2, ['NOTIFY IMPORTACAO LTDA']),
      block(3, ['5 CASES', 'STEEL PIPES']),
      block(4, ["SHIP'S REMARKS:", 'CARGO STORED IN OPEN YARD']),
    ])

    expect(fields.remarks).toBe('CARGO STORED IN OPEN YARD')
  })
})

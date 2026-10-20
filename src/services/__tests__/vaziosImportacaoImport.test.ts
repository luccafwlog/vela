import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { importVaziosImportacaoManifest, listVaziosImportacaoContainers, parseVaziosImportacaoBuffer, resolveVaziosManifestNumbers, resolveVaziosManifestRoutes, vaziosImportacaoHiddenConfirmOptions, vazioManifestoNumero } from '../vaziosImportacaoImport'
import { aoaToBuffer, jsonToBuffer } from './testWorkbook'

const { rpcMock, fromMock } = vi.hoisted(() => ({ rpcMock: vi.fn(), fromMock: vi.fn() }))
vi.mock('../supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  },
}))

const ROTA = { pol: 'CNTAC', pod: 'BRVIX' }
const container = (n: string, rota: { pol?: string; pod?: string } = ROTA) =>
  ({ rowNumber: 2, container_number: n, container_type: '40HC', tare_kg: 3800, ...rota })

describe('parseVaziosImportacaoBuffer', () => {
  it('mapeia cabecalhos com acentos/variacoes e normaliza tara e rotas (Origem / Destino)', async () => {
    const buffer = jsonToBuffer([
      { 'Contêiner': 'MSCU1234567', 'Tipo': '40HC', 'Tara (kg)': '3.800', 'Origem': 'CNTAC', 'Destino': 'BRVIX' },
      { 'Contêiner': 'TGHU7654321', 'Tipo': '', 'Tara (kg)': '', 'Origem': 'CNSHA', 'Destino': 'BRSSZ' },
    ])

    const manifest = await parseVaziosImportacaoBuffer(buffer)

    expect(manifest.rowErrors).toEqual([])
    expect(manifest.containers).toEqual([
      { rowNumber: 2, container_number: 'MSCU1234567', container_type: '40HC', tare_kg: 3800, pol: 'CNTAC', pod: 'BRVIX' },
      // Ausência não é tara zero: preservamos a diferença entre empty e value 0.
      { rowNumber: 3, container_number: 'TGHU7654321', container_type: null, tare_kg: null, pol: 'CNSHA', pod: 'BRSSZ' },
    ])
  })

  it('não transforma texto inválido ou expoente em tara zero', async () => {
    const buffer = jsonToBuffer([
      { Container: 'MSCU1234567', 'Tare (kg)': '1e3' },
      { Container: 'TGHU7654321', 'Tare (kg)': '12abc' },
    ])

    const manifest = await parseVaziosImportacaoBuffer(buffer)

    expect(manifest.containers.map((container) => container.tare_kg)).toEqual([null, null])
    expect(manifest.rowErrors).toHaveLength(2)
  })

  it('mapeia cabecalhos em ingles (POL / POD)', async () => {
    const buffer = jsonToBuffer([
      { 'Container': 'MSCU1234567', 'Type': '40HC', 'Tare (kg)': '3800', 'POL': 'CNTAC', 'POD': 'BRVIX' },
    ])

    const manifest = await parseVaziosImportacaoBuffer(buffer)

    expect(manifest.rowErrors).toEqual([])
    expect(manifest.containers).toEqual([
      { rowNumber: 2, container_number: 'MSCU1234567', container_type: '40HC', tare_kg: 3800, pol: 'CNTAC', pod: 'BRVIX' },
    ])
  })

  it('canoniza caixa do ISO e dos portos e bloqueia porto nao reconhecido', async () => {
    const buffer = jsonToBuffer([
      { Container: 'mscu1234567', Tipo: '40hc', Tara: '3800', Origem: 'Vitoria', Destino: 'porto inexistente' },
    ])

    const manifest = await parseVaziosImportacaoBuffer(buffer)

    expect(manifest.containers[0]).toMatchObject({
      container_number: 'MSCU1234567',
      container_type: '40HC',
      pol: 'BRVIX',
      pod: null,
    })
    expect(manifest.rowErrors).toEqual([
      expect.objectContaining({ row: 2, message: expect.stringContaining('POD') }),
    ])
  })

  it('ignora linhas sem container ou com formato ISO invalido e sinaliza ambas', async () => {
    const buffer = jsonToBuffer([
      { 'Container': '', 'Tipo': '20DV' },
      { 'Container': 'ABC123', 'Tipo': '20DV' },
    ])

    const manifest = await parseVaziosImportacaoBuffer(buffer)

    expect(manifest.containers).toEqual([])
    expect(manifest.rowErrors).toEqual([
      { row: 2, message: 'Container ausente — linha ignorada.', raw: expect.anything() },
      { row: 3, message: 'Container ABC123: formato ISO esperado (XXXX0000000).', raw: expect.anything() },
    ])
  })

  it('rejeita planilha vazia com a mensagem original', async () => {
    await expect(parseVaziosImportacaoBuffer(jsonToBuffer([]))).rejects.toThrow('Planilha vazia.')
  })

  it('S03: rejeita arquivo sem o marcador estrutural Container', async () => {
    await expect(parseVaziosImportacaoBuffer(jsonToBuffer([{ Tipo: '40HC', Tara: 3800 }]))).rejects.toThrow(/Container/)
  })

	it('S03: localiza o cabeçalho de Vazios IMP após o preâmbulo e preserva a linha de origem', async () => {
    const manifest = await parseVaziosImportacaoBuffer(aoaToBuffer([
      ['VAZIOS IMP — COSCO'],
      ['Atualizado em 09/09/2026'],
      ['Container', 'Tipo', 'Tara'],
      ['MSCU1234567', '40HC', 3800],
    ]))

    expect(manifest.rowErrors).toEqual([])
		expect(manifest.containers[0]).toMatchObject({ rowNumber: 4, container_number: 'MSCU1234567' })
	})

	it('S03: não renumera dados depois de uma linha vazia física', async () => {
		const manifest = await parseVaziosImportacaoBuffer(aoaToBuffer([
			['VAZIOS IMP — COSCO'],
			[''],
			['Container', 'Tipo', 'Tara'],
			['MSCU1234567', '40HC', 3800],
			[''],
			['TGHU7654321', '40HC', 3900],
		]))

		expect(manifest.rowErrors).toEqual([])
		expect(manifest.containers.map((container) => container.rowNumber)).toEqual([4, 6])
	})

  it('S03: valida a fixture QA anonimizada em CSV do fluxo de Vazios IMP', async () => {
    const file = readFileSync(resolve(process.cwd(), 'test-fixtures/qa-vazios-importacao.csv'))
    const manifest = await parseVaziosImportacaoBuffer(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength))

    expect(manifest.rowErrors).toEqual([])
    expect(manifest.containers).toHaveLength(2)
    expect(manifest.containers.map((container) => container.container_number)).toEqual(['TEMU1234567', 'TGHU7654325'])
  })

	it('S03: o importador não chama a RPC quando o preview traz divergências', async () => {
    rpcMock.mockReset()

    await expect(importVaziosImportacaoManifest({
      manifest: {
        containers: [{ rowNumber: 2, container_number: 'MSCU1234567', container_type: '40HC', tare_kg: 3800 }],
        rowErrors: [{ row: 2, message: 'Container inválido.', raw: { Container: 'MSCU1234567' } }],
      },
      uploadedBy: 'user-1',
      voyageId: 7,
      manifestNumbers: { CNTAC__BRVIX: '1226501801342' },
    })).rejects.toThrow('Linha 2')

		expect(rpcMock).not.toHaveBeenCalled()
	})

	// Regra de 2026-10-19 (ADR 0091): não há aceite que grave só as linhas válidas.
	it('linha com erro recusa o arquivo inteiro mesmo com aceite antigo', async () => {
		rpcMock.mockReset()

		await expect(importVaziosImportacaoManifest({
			manifest: {
				containers: [container('MSCU1234567')],
				rowErrors: [{ row: 2, message: 'Container inválido.', raw: { Container: 'MSCU1234567' } }],
			},
			uploadedBy: 'user-1',
			voyageId: 7,
			manifestNumbers: { CNTAC__BRVIX: '1226501801342' },
			...({ allowRowErrors: true } as object),
		})).rejects.toThrow(/^Nada foi gravado: uma linha tem erro\./)

		expect(rpcMock).not.toHaveBeenCalled()
	})
})

describe('Nº do manifesto Mercante dos vazios (um por rota POL → POD)', () => {
  const base = { uploadedBy: 'user-1', voyageId: 7 }
  const OUTRA = { pol: 'CNSHA', pod: 'BRVIX' }
  const doisPortos = { containers: [container('MSCU1234567'), container('TGHU7654325', OUTRA)], rowErrors: [] }

  beforeEach(() => {
    rpcMock.mockReset()
    fromMock.mockReset()
  })

  it('recusa número vazio ou só espaços sem gravar nada', async () => {
    for (const numero of ['', '   ']) {
      await expect(importVaziosImportacaoManifest({
        ...base, manifestNumbers: { CNTAC__BRVIX: numero }, manifest: { containers: [container('MSCU1234567')], rowErrors: [] },
      })).rejects.toThrow('Informe o Nº do manifesto Mercante de CNTAC → BRVIX')
    }
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('com duas rotas exige um número para cada uma', async () => {
    await expect(importVaziosImportacaoManifest({
      ...base, manifestNumbers: { CNTAC__BRVIX: '111' }, manifest: doisPortos,
    })).rejects.toThrow('CNSHA → BRVIX')
    await expect(importVaziosImportacaoManifest({
      ...base, manifestNumbers: { CNTAC__BRVIX: '111', CNSHA__BRVIX: ' 111 ' }, manifest: doisPortos,
    })).rejects.toThrow('mais de uma rota')
    await expect(importVaziosImportacaoManifest({
      ...base, manifestNumbers: { CNTAC__BRVIX: '1' }, manifest: { containers: [container('MSCU1234567', {})], rowErrors: [] },
    })).rejects.toThrow('POL e POD são obrigatórios')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('grava os números de cada porto e os containers numa única RPC', async () => {
    rpcMock.mockResolvedValue({ data: { manifest_id: 'manifest-1', mercante_manifest_ids: ['m1', 'm2'] }, error: null })

    await expect(importVaziosImportacaoManifest({
      ...base, manifestNumbers: { CNTAC__BRVIX: ' 111 ', CNSHA__BRVIX: '222' }, manifest: doisPortos,
    })).resolves.toEqual({ manifestId: 'manifest-1', mercanteManifestIds: ['m1', 'm2'] })
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('import_vazios_importacao_transactional', expect.objectContaining({
      p_manifestos: [
        { pol: 'CNSHA', pod: 'BRVIX', numero: '222' },
        { pol: 'CNTAC', pod: 'BRVIX', numero: '111' },
      ],
    }))
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('número já cadastrado é recusado pela RPC e chega ao usuário', async () => {
    const duplicate = { code: '23505', message: 'O número de manifesto Mercante "1" já foi cadastrado no sistema.' }
    rpcMock.mockResolvedValue({ data: null, error: duplicate })

    await expect(importVaziosImportacaoManifest({
      ...base, manifestNumbers: { CNTAC__BRVIX: '1' }, manifest: { containers: [container('MSCU1234567')], rowErrors: [] },
    })).rejects.toBe(duplicate)
  })
})

describe('resolveVaziosManifestRoutes', () => {
  it('lista cada porto de origem da planilha uma vez', () => {
    expect(resolveVaziosManifestRoutes({
      containers: [container('A'), container('B'), container('C', { pol: 'CNSHA', pod: 'BRVIX' })],
    }).routes).toEqual([{ pol: 'CNSHA', pod: 'BRVIX' }, ROTA])
  })

  it('explica o bloqueio quando falta POL/POD ou não há containers', () => {
    expect(resolveVaziosManifestRoutes({ containers: [container('A', { pol: 'CNTAC' })] }).error).toMatch(/POL e POD/)
    expect(resolveVaziosManifestRoutes({ containers: [] }).error).toMatch(/Nenhum container/)
  })

  it('V3: o mesmo POL com dois POD pede dois números (um por rota)', () => {
    expect(resolveVaziosManifestRoutes({
      containers: [container('A'), container('B', { pol: 'CNTAC', pod: 'BRSSZ' })],
    }).routes).toEqual([{ pol: 'CNTAC', pod: 'BRSSZ' }, ROTA])
  })

  it('aceita os números quando cada porto tem o seu', () => {
    expect(resolveVaziosManifestNumbers({ containers: [container('A')] }, { CNTAC__BRVIX: '9' }).manifestos).toEqual([{ ...ROTA, numero: '9' }])
  })
})

// Revisão da PR 929: a gravação substitui os containers de cada rota do
// arquivo; linha oculta da mesma rota sairia do manifesto sem pergunta.
describe('Vazios de Importação — linhas e abas ocultas', () => {
  async function bookWithHidden() {
    const XLSX = await import('@e965/xlsx')
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Container', 'POL', 'POD'],
      ['MSCU1234567', 'CNTAC', 'BRVIX'],
      ['TGHU7654325', 'CNTAC', 'BRVIX'],
    ])
    sheet['!rows'] = [{}, {}, { hidden: true }]
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Plan1')
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Container'], ['TEMU1234567']]), 'Depot B')
    book.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }] }
    return XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  }

  it('o parser devolve as ocultas e os avisos de leitura', async () => {
    const manifest = await parseVaziosImportacaoBuffer(await bookWithHidden())
    expect(manifest.containers.map((c) => c.container_number)).toEqual(['MSCU1234567'])
    expect(manifest.hidden).toEqual({ rows: 1, sheets: ['Depot B'] })
    expect(manifest.warnings).toEqual([
      'Aba oculta "Depot B" ignorada.',
      '1 linha oculta ignorada: o filtro da planilha indica importar só o visível.',
    ])
  })

  it('a confirmação diz que as unidades ocultas sairão do manifesto', async () => {
    const { hidden } = await parseVaziosImportacaoBuffer(await bookWithHidden())
    const options = vaziosImportacaoHiddenConfirmOptions(hidden)
    expect(options).toMatchObject({ tone: 'danger', confirmLabel: 'Importar sem as ocultas' })
    expect(options?.message).toBe(
      '1 linha oculta foi ignorada e as unidades dela sairão do manifesto. '
      + 'A aba oculta "Depot B" foi ignorada; se ela tiver unidades, elas sairão do manifesto. Continuar?',
    )
  })

  it('sem nada oculto, não pergunta', async () => {
    const { hidden } = await parseVaziosImportacaoBuffer(jsonToBuffer([{ Container: 'MSCU1234567', POL: 'CNTAC', POD: 'BRVIX' }]))
    expect(hidden).toEqual({ rows: 0, sheets: [] })
    expect(vaziosImportacaoHiddenConfirmOptions(hidden)).toBeNull()
    expect(vaziosImportacaoHiddenConfirmOptions({ rows: 3, sheets: [] })?.message).toMatch(/^3 linhas ocultas foram ignoradas e as unidades delas sairão do manifesto/)
  })
})

describe('vazioManifestoNumero (coluna Manifesto Mercante)', () => {
  const manifestos = [
    { voyage_id: 7, pol: 'CNSHA', pod: 'BRVIX', numero: '2626501234568' },
    { voyage_id: 7, pol: 'CNSHA', pod: 'BRSSZ', numero: '2626501234567' },
    { voyage_id: 8, pol: 'CNSHA', pod: 'BRVIX', numero: '2626509999999' },
  ]
  const row = (pol: string | null, pod: string | null, voyageId: number | null = 7) => ({ pol, pod, manifest: { voyage_id: voyageId } })

  it('casa pela Viagem, POL e POD do container', () => {
    expect(vazioManifestoNumero(row('CNSHA', 'BRVIX'), manifestos)).toBe('2626501234568')
    expect(vazioManifestoNumero(row('CNSHA', 'BRSSZ'), manifestos)).toBe('2626501234567')
    expect(vazioManifestoNumero(row('CNSHA', 'BRVIX', 8), manifestos)).toBe('2626509999999')
  })

  it('compara o porto pela forma canônica (BRVIT é BRVIX, caixa baixa)', () => {
    expect(vazioManifestoNumero(row('cnsha', 'BRVIT'), manifestos)).toBe('2626501234568')
  })

  it('sem manifesto da rota, sem POL/POD ou sem Viagem não tem número', () => {
    expect(vazioManifestoNumero(row('CNNGB', 'BRVIX'), manifestos)).toBeNull()
    expect(vazioManifestoNumero(row(null, 'BRVIX'), manifestos)).toBeNull()
    expect(vazioManifestoNumero(row('CNSHA', 'BRVIX', null), manifestos)).toBeNull()
  })

  it('usa a régua do banco (normalize_port_code): porto fora da lista do import ainda casa', () => {
    const outro = [{ voyage_id: 7, pol: 'ARBUE', pod: 'BRVIX', numero: '2626500000001' }]
    expect(vazioManifestoNumero(row('ARBUE', 'BRVIX'), outro)).toBe('2626500000001')
  })
})

describe('listVaziosImportacaoContainers (filtros da lista)', () => {
  beforeEach(() => fromMock.mockReset())

  it('POL/POD filtram por todas as grafias gravadas do porto, não pela coluna exata', async () => {
    const inCalls: unknown[][] = []
    const builder: Record<string, unknown> = {}
    Object.assign(builder, {
      select: () => builder, range: () => builder, order: () => builder, eq: () => builder, or: () => builder,
      in: (...args: unknown[]) => { inCalls.push(args); return builder },
      then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null, count: 0 }),
    })
    fromMock.mockReturnValue(builder)

    await listVaziosImportacaoContainers({ pol: 'CNNGB', pod: 'BRVIX' })

    expect(inCalls).toContainEqual(['pol', expect.arrayContaining(['CNNGB', 'CNZOS', 'NINGBO'])])
    expect(inCalls).toContainEqual(['pod', expect.arrayContaining(['BRVIX', 'BRVIT', 'VITORIA'])])
  })

  it('falha ao ler os manifestos da Viagem é erro da tela, não "Nenhum container"', async () => {
    fromMock.mockImplementation((table: string) => table === 'vazios_importacao_manifests'
      ? { select: () => ({ eq: () => Promise.resolve({ data: null, error: new Error('manifestos fora do ar') }) }) }
      : { select: () => { throw new Error('não deveria consultar os containers') } })

    await expect(listVaziosImportacaoContainers({ voyageId: '7' })).rejects.toThrow('manifestos fora do ar')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { importVaziosImportacaoManifest, parseVaziosImportacaoBuffer, resolveVaziosManifestRoute } from '../vaziosImportacaoImport'
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
      manifestNumber: '1226501801342',
    })).rejects.toThrow('Linha 2')

		expect(rpcMock).not.toHaveBeenCalled()
	})

	it('só permite importar divergências quando o override de erros de linha é explícito', async () => {
		rpcMock.mockResolvedValue({ data: { manifest_id: 'manifest-1', mercante_manifest_id: 'mercante-1' }, error: null })

		await importVaziosImportacaoManifest({
			manifest: {
				containers: [container('MSCU1234567')],
				rowErrors: [{ row: 2, message: 'Container inválido.', raw: { Container: 'MSCU1234567' } }],
			},
			uploadedBy: 'user-1',
			voyageId: 7,
			manifestNumber: '1226501801342',
			allowRowErrors: true,
		})

		expect(rpcMock).toHaveBeenCalledWith('import_vazios_importacao_transactional', expect.anything())
	})
})

describe('Nº do manifesto Mercante dos vazios (obrigatório, por rota)', () => {
  const base = { uploadedBy: 'user-1', voyageId: 7 }

  beforeEach(() => {
    rpcMock.mockReset()
    fromMock.mockReset()
  })

  it('recusa número vazio ou só espaços sem gravar nada', async () => {
    for (const manifestNumber of ['', '   ']) {
      await expect(importVaziosImportacaoManifest({
        ...base, manifestNumber, manifest: { containers: [container('MSCU1234567')], rowErrors: [] },
      })).rejects.toThrow('Número do manifesto Mercante é obrigatório')
    }
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('recusa planilha sem POL/POD ou com mais de uma rota, sem gravar nada', async () => {
    await expect(importVaziosImportacaoManifest({
      ...base, manifestNumber: '1', manifest: { containers: [container('MSCU1234567', {})], rowErrors: [] },
    })).rejects.toThrow('POL e POD são obrigatórios')
    await expect(importVaziosImportacaoManifest({
      ...base,
      manifestNumber: '1',
      manifest: { containers: [container('MSCU1234567'), container('TGHU7654325', { pol: 'CNSHA', pod: 'BRVIX' })], rowErrors: [] },
    })).rejects.toThrow('2 rotas')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('grava número e containers numa única RPC, sem escrita separada em manifestos_mercante', async () => {
    rpcMock.mockResolvedValue({ data: { manifest_id: 'manifest-1', mercante_manifest_id: 'mercante-1' }, error: null })

    await expect(importVaziosImportacaoManifest({
      ...base, manifestNumber: ' 1226501801342 ', manifest: { containers: [container('MSCU1234567')], rowErrors: [] },
    })).resolves.toEqual({ manifestId: 'manifest-1', mercanteManifestId: 'mercante-1' })
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('import_vazios_importacao_transactional', expect.objectContaining({
      p_manifest_numero: '1226501801342',
    }))
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('número repetido recusado pela RPC chega ao usuário e nada fica para desfazer', async () => {
    const duplicate = { code: '23505', message: 'O número de manifesto Mercante "1" já foi cadastrado no sistema.' }
    rpcMock.mockResolvedValue({ data: null, error: duplicate })

    await expect(importVaziosImportacaoManifest({
      ...base, manifestNumber: '1', manifest: { containers: [container('MSCU1234567')], rowErrors: [] },
    })).rejects.toBe(duplicate)
    expect(fromMock).not.toHaveBeenCalled()
  })
})

describe('resolveVaziosManifestRoute', () => {
  it('devolve a rota única da planilha', () => {
    expect(resolveVaziosManifestRoute({ containers: [container('A'), container('B')] }).route).toEqual(ROTA)
  })

  it('explica o bloqueio quando falta POL/POD, há várias rotas ou não há containers', () => {
    expect(resolveVaziosManifestRoute({ containers: [container('A', { pol: 'CNTAC' })] }).error).toMatch(/POL e POD/)
    expect(resolveVaziosManifestRoute({
      containers: [container('A'), container('B', { pol: 'CNSHA', pod: 'BRVIX' })],
    }).error).toMatch(/2 rotas.*CNTAC → BRVIX.*CNSHA → BRVIX/)
    expect(resolveVaziosManifestRoute({ containers: [] }).error).toMatch(/Nenhum container/)
  })
})

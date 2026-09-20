import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { importVaziosManifest, parseVaziosManifestBuffer } from '../vaziosImport'

const rpcMock = vi.fn()
vi.mock('../supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpcMock(...args) } }))
const makeBuffer = async (rows: Record<string, unknown>[]) => {
  const XLSX = await import('@e965/xlsx')
  const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

describe('parser de vazios — novo contrato', () => {
  beforeEach(() => rpcMock.mockReset())
  it('lê as sete colunas do modelo manual', async () => {
    const parsed = await parseVaziosManifestBuffer(await makeBuffer([{ Container: 'ABCD1234567', Depot: 'VBR', Condition: 'material', 'Hand-in': '01/07/2026', 'Hand-out': '05/07/2026', 'Load date': '06/07/2026', Type: '40HC' }]))
    expect(parsed.bookings[0]).toMatchObject({ local_code: 'VBR', condition: 'material', container_type: '40HC', hand_in_date: '2026-07-01', hand_out_date: '2026-07-05', movement_date: '2026-07-06' })
  })
  it('aceita cabeçalhos Excel com acentos preservados', async () => {
    const parsed = await parseVaziosManifestBuffer(await makeBuffer([{ CONTAINER: 'ABCD1234568', TIPO: '40HC', LOCAL: 'VBR', ['CONDI\u00C7\u00C3O']: 'vazio', ENTRADA: '01/07/2026', ['SA\u00CDDA']: '05/07/2026', EMBARQUE: '06/07/2026' }]))
    expect(parsed.rowErrors).toEqual([])
    expect(parsed.bookings[0]).toMatchObject({ local_code: 'VBR', condition: 'vazio', hand_in_date: '2026-07-01', hand_out_date: '2026-07-05', movement_date: '2026-07-06' })
  })
  // P2-20: um container nao pode embarcar antes de sair do depot que o
  // liberou — sem checagem, um erro de digitacao no embarque nao era
  // confrontado com o gate in/out ja existente.
  it('recusa embarque anterior à saída do depot', async () => {
    const parsed = await parseVaziosManifestBuffer(await makeBuffer([
      { Container: 'ABCD1234567', Depot: 'VBR', Condition: 'vazio', 'Hand-in': '01/07/2026', 'Hand-out': '05/07/2026', 'Load date': '03/07/2026' },
    ]))
    expect(parsed.rowErrors).toHaveLength(1)
    expect(parsed.rowErrors[0].message).toContain('embarque anterior à saída do depot')
  })

  it('canoniza a caixa do container e do tipo antes do contrato da RPC', async () => {
    const parsed = await parseVaziosManifestBuffer(await makeBuffer([{ Container: 'abcd1234568', Type: '40hc', Depot: 'VBR', Condition: 'vazio' }]))
    expect(parsed.rowErrors).toEqual([])
    expect(parsed.bookings[0]).toMatchObject({ container_number: 'ABCD1234568', container_type: '40HC' })
  })
  it('normaliza datas Excel no formato MM/DD/YYYY sem enviar mes invalido ao banco', async () => {
    const parsed = await parseVaziosManifestBuffer(await makeBuffer([{ CONTAINER: 'ABCD1234570', TIPO: '40HC', LOCAL: 'VBR', Condition: 'vazio', 'Hand-in': '02/25/2026', 'Hand-out': '02/26/2026', 'Load date': '02/27/2026' }]))
    expect(parsed.rowErrors).toEqual([])
    expect(parsed.bookings[0]).toMatchObject({ hand_in_date: '2026-02-25', hand_out_date: '2026-02-26', movement_date: '2026-02-27' })
  })
  it('processa o modelo xlsx publicado pela tela', async () => {
    const buffer = readFileSync(resolve(process.cwd(), 'public/templates/unidades-embarcadas-modelo.xlsx'))
    const parsed = await parseVaziosManifestBuffer(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
    expect(parsed.rowErrors).toEqual([])
    expect(parsed.bookings[0]).toMatchObject({ container_number: 'ABCD1234567', local_code: 'VBR', condition: 'vazio' })
  })
  it('recusa datas impossíveis antes da persistência', async () => {
    const parsed = await parseVaziosManifestBuffer(await makeBuffer([{ Container: 'ABCD1234571', Depot: 'VBR', Condition: 'vazio', 'Hand-in': '31/02/2026' }]))
    expect(parsed.bookings[0].hand_in_date).toBeNull()
    expect(parsed.rowErrors.map((error) => error.message).join(' ')).toContain('data de entrada')
  })
  it('mantem a mesma convencao de data para todas as linhas da coluna, mesmo com uma linha ambigua', async () => {
    // '07/01/2026' sozinho seria ambiguo (ambos <=12); a segunda linha
    // desambigua a coluna inteira como MM/DD (mes 25 so existe como dia).
    const parsed = await parseVaziosManifestBuffer(await makeBuffer([
      { Container: 'ABCD1234572', Depot: 'VBR', Condition: 'vazio', 'Hand-in': '07/01/2026' },
      { Container: 'ABCD1234573', Depot: 'VBR', Condition: 'vazio', 'Hand-in': '07/25/2026' },
    ]))
    expect(parsed.rowErrors).toEqual([])
    expect(parsed.bookings[0].hand_in_date).toBe('2026-07-01')
    expect(parsed.bookings[1].hand_in_date).toBe('2026-07-25')
  })
  it('usa a convencao desambiguada por ENTRADA/EMBARQUE mesmo quando a coluna SAIDA nunca desambigua sozinha', async () => {
    // Bug real: todas as linhas de 'Hand-out' tem dia e mes <=12 (nunca
    // desambigua sozinha), mas a planilha inteira esta em MM/DD (evidencia em
    // 'Hand-in'). Sem combinar as tres colunas, 'Hand-out' cairia no
    // fallback DD/MM e inflaria a saida em ate 30 dias.
    const parsed = await parseVaziosManifestBuffer(await makeBuffer([
      { Container: 'ABCD1234580', Depot: 'VBR', Condition: 'vazio', 'Hand-in': '2/25/2026', 'Hand-out': '7/8/2026', 'Load date': '7/10/2026' },
      { Container: 'ABCD1234581', Depot: 'VBR', Condition: 'vazio', 'Hand-in': '2/18/2026', 'Hand-out': '7/10/2026', 'Load date': '7/10/2026' },
    ]))
    expect(parsed.rowErrors).toEqual([])
    expect(parsed.bookings[0]).toMatchObject({ hand_in_date: '2026-02-25', hand_out_date: '2026-07-08', movement_date: '2026-07-10' })
    expect(parsed.bookings[1]).toMatchObject({ hand_in_date: '2026-02-18', hand_out_date: '2026-07-10', movement_date: '2026-07-10' })
  })
  it('nao le um numero pequeno digitado por engano como serial Excel', async () => {
    const parsed = await parseVaziosManifestBuffer(await makeBuffer([{ Container: 'ABCD1234574', Depot: 'VBR', Condition: 'vazio', 'Hand-in': '2026' }]))
    expect(parsed.bookings[0].hand_in_date).toBeNull()
    expect(parsed.rowErrors.map((error) => error.message).join(' ')).toContain('data de entrada')
  })
  it('persiste somente as sete colunas na RPC', async () => {
    rpcMock.mockResolvedValue({ data: { manifest_id: 'm1' }, error: null })
    await importVaziosManifest({ filename: 'x.xlsx', voyageId: 7, port: 'BRSSA', uploadedBy: 'user-1', manifest: { bookings: [{ rowNumber: 2, container_number: 'ABCD1234569', container_type: '20DV', local_code: 'VBR', condition: 'vazio', hand_in_date: '2026-07-01', hand_out_date: '2026-07-02', movement_date: '2026-07-03' }], rowErrors: [] } })
    expect(rpcMock).toHaveBeenCalledWith('import_vazios_bookings_transactional', expect.objectContaining({ p_bookings: [expect.objectContaining({ local_code: 'VBR', condition: 'vazio' })] }))
  })
  it('dedupe container repetido na planilha, mantendo a ultima ocorrencia', async () => {
    const parsed = await parseVaziosManifestBuffer(await makeBuffer([
      { Container: 'ABCD1234567', Depot: 'VBR', Condition: 'vazio' },
      { Container: 'ABCD1234567', Depot: 'VIX', Condition: 'material' },
    ]))
    expect(parsed.bookings).toHaveLength(2)
    expect(parsed.rowErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 3, message: expect.stringContaining('duplicado') }),
    ]))
  })
  it('recusa linha sem condição ou local', async () => {
    const parsed = await parseVaziosManifestBuffer(await makeBuffer([{ Container: 'ABCD1234567', Local: '', Condition: '' }]))
    expect(parsed.bookings).toHaveLength(1)
    expect(parsed.rowErrors.map((error) => error.message).join(' ')).toContain('condição')
    expect(parsed.rowErrors.map((error) => error.message).join(' ')).toContain('local')
  })

  it('S03: rejeita arquivo sem os marcadores estruturais Local e Condition', async () => {
    await expect(parseVaziosManifestBuffer(await makeBuffer([{ Container: 'ABCD1234567' }]))).rejects.toThrow(/Local.*Condition|Condition.*Local/)
  })

	it('S03: localiza cabeçalho de Vazios após o preâmbulo e preserva a linha de origem', async () => {
    const parsed = await parseVaziosManifestBuffer(await (async () => {
      const XLSX = await import('@e965/xlsx')
      const workbook = XLSX.utils.book_new()
      const sheet = XLSX.utils.aoa_to_sheet([
        ['UNIDADES EMBARCADAS'],
        ['Modelo operacional'],
        ['Container', 'Tipo', 'Local', 'Condition'],
        ['ABCD1234582', '40HC', 'VBR', 'vazio'],
      ])
      XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1')
      return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    })())

    expect(parsed.rowErrors).toEqual([])
		expect(parsed.bookings[0]).toMatchObject({ rowNumber: 4, container_number: 'ABCD1234582' })
	})

	it('S03: não renumera uma linha após um vazio físico', async () => {
		const parsed = await parseVaziosManifestBuffer(await (async () => {
			const XLSX = await import('@e965/xlsx')
			const workbook = XLSX.utils.book_new()
			const sheet = XLSX.utils.aoa_to_sheet([
				['UNIDADES EMBARCADAS'],
				[''],
				['Container', 'Tipo', 'Local', 'Condition'],
				['ABCD1234583', '40HC', 'VBR', 'vazio'],
				[''],
				['ABCD1234584', '40HC', 'VBR', 'vazio'],
			])
			XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1')
			return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
		})())

		expect(parsed.rowErrors).toEqual([])
		expect(parsed.bookings.map((booking) => booking.rowNumber)).toEqual([4, 6])
	})
})

describe('parser de vazios — divergência apontada por linha contra o Cadastro de Terminais', () => {
  const DEPOTS = [
    { code: 'VBR', tipo: 'depot', active: true },
    { code: 'TVV', tipo: 'terminal_portuario', active: true },
    { code: 'INATIVO', tipo: 'depot', active: false },
  ]

  it('aponta local que não existe no cadastro, com o código digitado', async () => {
    const parsed = await parseVaziosManifestBuffer(await makeBuffer([
      { Container: 'ABCD1234567', Depot: 'CAPIXABA TERMINAIS', Condition: 'vazio', 'Hand-in': '01/07/2026', 'Hand-out': '05/07/2026' },
    ]), DEPOTS)
    expect(parsed.rowErrors.map((error) => error.message).join(' ')).toContain('"CAPIXABA TERMINAIS"')
    expect(parsed.rowErrors.map((error) => error.message).join(' ')).toContain('não encontrado')
  })

  it('aponta local inativo no cadastro', async () => {
    const parsed = await parseVaziosManifestBuffer(await makeBuffer([
      { Container: 'ABCD1234567', Depot: 'INATIVO', Condition: 'vazio', 'Hand-in': '01/07/2026', 'Hand-out': '05/07/2026' },
    ]), DEPOTS)
    expect(parsed.rowErrors.map((error) => error.message).join(' ')).toContain('inativo')
  })

  it('aponta depot sem entrada/saída', async () => {
    const parsed = await parseVaziosManifestBuffer(await makeBuffer([
      { Container: 'ABCD1234567', Depot: 'VBR', Condition: 'vazio' },
    ]), DEPOTS)
    expect(parsed.rowErrors.map((error) => error.message).join(' ')).toContain('exige entrada e saída')
  })

  it('aponta saída anterior à entrada num depot', async () => {
    const parsed = await parseVaziosManifestBuffer(await makeBuffer([
      { Container: 'ABCD1234567', Depot: 'VBR', Condition: 'vazio', 'Hand-in': '10/07/2026', 'Hand-out': '05/07/2026' },
    ]), DEPOTS)
    expect(parsed.rowErrors.map((error) => error.message).join(' ')).toContain('saída anterior à entrada')
  })

  it('aponta terminal portuário com entrada/saída indevidas', async () => {
    const parsed = await parseVaziosManifestBuffer(await makeBuffer([
      { Container: 'ABCD1234567', Depot: 'TVV', Condition: 'vazio', 'Hand-in': '01/07/2026', 'Hand-out': '05/07/2026' },
    ]), DEPOTS)
    expect(parsed.rowErrors.map((error) => error.message).join(' ')).toContain('não aceita entrada ou saída')
  })

  it('aceita depot e terminal quando a linha respeita a regra de cada tipo', async () => {
    const parsed = await parseVaziosManifestBuffer(await makeBuffer([
      { Container: 'ABCD1234567', Depot: 'VBR', Condition: 'vazio', 'Hand-in': '01/07/2026', 'Hand-out': '05/07/2026' },
      { Container: 'ABCD1234568', Depot: 'TVV', Condition: 'vazio' },
    ]), DEPOTS)
    expect(parsed.rowErrors).toEqual([])
  })

  it('não valida contra o cadastro quando nenhuma lista de depots é passada (compatibilidade)', async () => {
    const parsed = await parseVaziosManifestBuffer(await makeBuffer([
      { Container: 'ABCD1234567', Depot: 'QUALQUER COISA', Condition: 'vazio', 'Hand-in': '01/07/2026', 'Hand-out': '05/07/2026' },
    ]))
    expect(parsed.rowErrors).toEqual([])
  })

  it('resume divergências além do limite mostrado, em vez de listar tudo', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      Container: `ABCD123${String(4500 + i).padStart(4, '0')}`,
      Depot: 'DESCONHECIDO', Condition: 'vazio',
    }))
    const parsed = await parseVaziosManifestBuffer(await makeBuffer(rows), DEPOTS)
    expect(parsed.rowErrors).toHaveLength(25)
    await expect(importVaziosManifest({
      filename: 'x.xlsx', voyageId: 7, port: 'BRSSA', uploadedBy: 'user-1', manifest: parsed,
    })).rejects.toThrow(/e mais 5 linhas com divergências\./)
  })
})

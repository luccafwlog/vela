import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { describeGraniteImport, graniteImportScope, importGraniteManifest, type ParsedGraniteManifest } from '../graniteImport'

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

const manifest: ParsedGraniteManifest = {
  vesselVoyage: 'COSCO TEST / 001',
  rowErrors: [],
  fileBlNumbers: ['BL-1'],
  bls: [{
    rowNumber: 2,
    sequence: 1,
    booking_number: 'BOOK-1',
    bl_number: 'BL-1',
    shipper_ref: null,
    vessel_voyage: 'COSCO TEST / 001',
    loading_port: 'CNSHA',
    discharge_port: 'BRSSZ',
    shipper_name: 'Cliente',
    shipper_cnpj: '12345678000195',
    consignee_name: null,
    charter: null,
    shipper_m3: 10,
    shipper_weight_kg: 1000,
    blocks_qty: 2,
    received_blocks_qty: 2,
    final_m3: 10,
    real_weight_kg: 950,
    stockyard: null,
    remarks: null,
    partial_restriction: false,
    cosco_transport: null,
    fragile_blocks: null,
    cssc_selection: null,
    cargo_readiness_date: '2026-06-22',
    phase: 'READY',
  }],
}

describe('atomic Granite manifest import', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
  })

	it('persists the manifest header and B/L rows through one RPC', async () => {
    mockRpc.mockResolvedValue({
      data: { manifest_id: 'manifest-1', inserted_bls: 1 },
      error: null,
    })
    mockFrom.mockReturnValue({ select: () => ({ eq: async () => ({ data: [], error: null }) }) })

    const result = await importGraniteManifest({
      filename: 'granite.xlsx',
      voyageId: 12,
      manifest,
      uploadedBy: 'user-1',
    })

    // Única leitura: os B/Ls já gravados na Viagem, para a reimportação.
    expect(mockFrom).toHaveBeenCalledWith('granite_bls')
    expect(mockRpc).toHaveBeenCalledWith(
      'import_granite_manifest_transactional',
      expect.objectContaining({
        p_voyage_id: 12,
        p_vessel_voyage: 'COSCO TEST / 001',
        p_total_bls: 1,
        p_total_weight_kg: 950,
        p_uploaded_by: 'user-1',
        p_bls: [expect.objectContaining({
          bl_number: 'BL-1',
          charge_status: 'not_calculated',
        })],
      }),
    )
    // O Granito não tem Cliente (lote 5b, migration 325): nada de vínculo nem sugestão no payload.
    const payload = mockRpc.mock.calls[0][1] as { p_bls: Array<Record<string, unknown>> }
    expect(payload.p_bls[0]).not.toHaveProperty('client_id')
    expect(payload.p_bls[0]).not.toHaveProperty('suggested_client_id')
		expect(result).toEqual({ manifestId: 'manifest-1', inserted: 1, updated: 0, removed: [], keptMissing: [], keptInvoiced: [], separateManifest: false })
	})

	it('reimportação: ausentes do arquivo só saem com confirmação', async () => {
    mockRpc.mockResolvedValue({ data: { manifest_id: 'manifest-1', inserted_bls: 0, updated_bls: 1, removed_bl_numbers: ['BL-OLD'] }, error: null })
    mockFrom.mockReturnValue({ select: () => ({ eq: async () => ({ data: [{ bl_number: 'BL-1', manifest_id: 'm1' }, { bl_number: 'BL-OLD', manifest_id: 'm1' }], error: null }) }) })
    const confirmRemoval = vi.fn().mockResolvedValue(true)
    const result = await importGraniteManifest({ filename: 'g.xlsx', voyageId: 12, manifest, uploadedBy: 'user-1', confirmRemoval })
    expect(confirmRemoval).toHaveBeenCalledWith(['BL-OLD'])
    expect(mockRpc).toHaveBeenCalledWith('import_granite_manifest_transactional', expect.objectContaining({ p_remove_missing: ['BL-OLD'] }))
    expect(result).toMatchObject({ updated: 1, removed: ['BL-OLD'] })

    confirmRemoval.mockResolvedValue(false)
    await importGraniteManifest({ filename: 'g.xlsx', voyageId: 12, manifest, uploadedBy: 'user-1', confirmRemoval })
    expect(mockRpc).toHaveBeenLastCalledWith('import_granite_manifest_transactional', expect.objectContaining({ p_remove_missing: [] }))
	})

	// ADR 0079, decisão 7 (migration 206): arquivo sem B/L em comum é manifesto novo.
	it('arquivo sem B/L em comum com a Viagem é manifesto novo e não pergunta pelos ausentes', async () => {
    mockRpc.mockResolvedValue({ data: { manifest_id: 'manifest-2', inserted_bls: 1, new_manifest: true }, error: null })
    mockFrom.mockReturnValue({ select: () => ({ eq: async () => ({ data: [{ bl_number: 'BL-A', manifest_id: 'm1' }, { bl_number: 'BL-B', manifest_id: 'm1' }], error: null }) }) })
    const confirmRemoval = vi.fn().mockResolvedValue(true)
    const result = await importGraniteManifest({ filename: 'g.xlsx', voyageId: 12, manifest, uploadedBy: 'user-1', confirmRemoval })
    expect(confirmRemoval).not.toHaveBeenCalled()
    expect(mockRpc).toHaveBeenCalledWith('import_granite_manifest_transactional', expect.objectContaining({ p_remove_missing: [] }))
    expect(result.separateManifest).toBe(true)
    expect(describeGraniteImport(result)).toMatch(/^manifesto novo na Viagem/)
	})

	it('com B/L em comum, ausente é só do manifesto que o arquivo toca', () => {
    const existing = [
      { bl_number: 'BL-1', manifest_id: 'm1' }, { bl_number: 'BL-2', manifest_id: 'm1' },
      { bl_number: 'BL-X', manifest_id: 'm2' },
    ]
    expect(graniteImportScope(existing, ['bl-1 '], ['BL-1'])).toEqual({ newManifest: false, missing: ['BL-2'] })
    expect(graniteImportScope(existing, ['BL-9'], ['BL-9'])).toEqual({ newManifest: true, missing: [] })
    // Linha com erro não decide o manifesto (não vai à RPC), mas também não é ausente.
    expect(graniteImportScope(existing, ['BL-9'], ['BL-9', 'BL-1'])).toEqual({ newManifest: true, missing: [] })
	})

	// Achado V4 da revisão da PR 929: B/L presente no arquivo, mas em linha com
	// erro (peso zero, duplicada), não é ausente.
	it('reimportação com override: B/L em linha com erro não é oferecido para sair', async () => {
    mockRpc.mockResolvedValue({ data: { manifest_id: 'manifest-1' }, error: null })
    mockFrom.mockReturnValue({ select: () => ({ eq: async () => ({ data: [{ bl_number: 'BL-1', manifest_id: 'm1' }, { bl_number: 'BL-ZERO', manifest_id: 'm1' }, { bl_number: 'BL-OLD', manifest_id: 'm1' }], error: null }) }) })
    const confirmRemoval = vi.fn().mockResolvedValue(true)
    await importGraniteManifest({
      filename: 'g.xlsx', voyageId: 12, uploadedBy: 'user-1', allowRowErrors: true, confirmRemoval,
      manifest: { ...manifest, fileBlNumbers: ['BL-1', 'BL-ZERO'], rowErrors: [{ row: 3, message: 'BL BL-ZERO: Real Weight ausente ou zero.', raw: {} }] },
    })
    expect(confirmRemoval).toHaveBeenCalledWith(['BL-OLD'])
    expect(mockRpc).toHaveBeenCalledWith('import_granite_manifest_transactional', expect.objectContaining({ p_remove_missing: ['BL-OLD'] }))
	})

	// Achado V3: o B/L com Invoice fica e o aviso diz quais não saíram; a recusa
	// da RPC chega com a mensagem de negócio, não "Falha ao importar.".
	it('ausente com Invoice volta no resultado e no aviso; erro da RPC chega com a mensagem de negócio', async () => {
    mockFrom.mockReturnValue({ select: () => ({ eq: async () => ({ data: [{ bl_number: 'BL-1', manifest_id: 'm1' }, { bl_number: 'BL-INV', manifest_id: 'm1' }], error: null }) }) })
    mockRpc.mockResolvedValue({
      data: { manifest_id: 'manifest-1', removed_bl_numbers: [], kept_missing_bl_numbers: ['BL-INV'], kept_missing_invoiced_bl_numbers: ['BL-INV'] },
      error: null,
    })
    const result = await importGraniteManifest({ filename: 'g.xlsx', voyageId: 12, manifest, uploadedBy: 'user-1', confirmRemoval: async () => true })
    expect(result).toMatchObject({ keptMissing: ['BL-INV'], keptInvoiced: ['BL-INV'] })
    expect(describeGraniteImport(result)).toContain('1 com Invoice mantido(s): BL-INV')

    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'A planilha não tem B/L de Granito válido para gravar.', details: null, hint: null } })
    await expect(importGraniteManifest({ filename: 'g.xlsx', voyageId: 12, manifest, uploadedBy: 'user-1' }))
      .rejects.toThrow('A planilha não tem B/L de Granito válido para gravar.')
	})

	it('bloqueia erros de linha no service sem o override explícito', async () => {
		await expect(importGraniteManifest({
			filename: 'granite.xlsx',
			voyageId: 12,
			manifest: {
				...manifest,
				rowErrors: [{ row: 2, message: 'Porto inválido.', raw: {} }],
			},
			uploadedBy: 'user-1',
		})).rejects.toThrow('Linha 2')

		expect(mockRpc).not.toHaveBeenCalled()
	})

	it('a UI passa o override de erros de linha e não há mais pendência de Cliente', () => {
		const source = fs.readFileSync(path.resolve(process.cwd(), 'src/components/shared/VoyageImportActions.tsx'), 'utf8')

		expect(source).toContain('allowRowErrors: Boolean(override)')
		expect(source).not.toContain('allowPending: Boolean(override)')
	})

  it('has one SQL function that inserts the header and B/L rows transactionally', () => {
    // Contrato histórico: o `.find` deve achar a migration original, não o
    // snapshot consolidado (002), que não preserva as propriedades por arquivo.
    const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations_archive')
    const migration = fs.readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
      .find((sql) => sql.includes('import_granite_manifest_transactional'))

    expect(migration).toBeDefined()
    expect(migration).toMatch(/INSERT\s+INTO\s+public\.granite_manifests/i)
    expect(migration).toMatch(/INSERT\s+INTO\s+public\.granite_bls/i)
    expect(migration).toMatch(/SECURITY\s+INVOKER/i)
    expect(migration).toMatch(/REVOKE\s+ALL[\s\S]*FROM\s+PUBLIC,\s*anon/i)
    expect(migration).toMatch(/GRANT\s+EXECUTE[\s\S]*TO\s+authenticated/i)
  })
})

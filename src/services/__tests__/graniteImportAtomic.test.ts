import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importGraniteManifest, type ParsedGraniteManifest } from '../graniteImport'

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
    clientId: 7,
        reconciliationStatus: 'matched',
        suggestedClientId: null,
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
          client_id: 7,
          charge_status: 'not_calculated',
        })],
      }),
    )
		expect(result).toEqual({ manifestId: 'manifest-1', pendingCount: 0, inserted: 1, updated: 0, removed: [], keptMissing: [] })
	})

	it('reimportação: ausentes do arquivo só saem com confirmação', async () => {
    mockRpc.mockResolvedValue({ data: { manifest_id: 'manifest-1', inserted_bls: 0, updated_bls: 1, removed_bl_numbers: ['BL-OLD'] }, error: null })
    mockFrom.mockReturnValue({ select: () => ({ eq: async () => ({ data: [{ bl_number: 'BL-1' }, { bl_number: 'BL-OLD' }], error: null }) }) })
    const confirmRemoval = vi.fn().mockResolvedValue(true)
    const result = await importGraniteManifest({ filename: 'g.xlsx', voyageId: 12, manifest, uploadedBy: 'user-1', confirmRemoval })
    expect(confirmRemoval).toHaveBeenCalledWith(['BL-OLD'])
    expect(mockRpc).toHaveBeenCalledWith('import_granite_manifest_transactional', expect.objectContaining({ p_remove_missing: ['BL-OLD'] }))
    expect(result).toMatchObject({ updated: 1, removed: ['BL-OLD'] })

    confirmRemoval.mockResolvedValue(false)
    await importGraniteManifest({ filename: 'g.xlsx', voyageId: 12, manifest, uploadedBy: 'user-1', confirmRemoval })
    expect(mockRpc).toHaveBeenLastCalledWith('import_granite_manifest_transactional', expect.objectContaining({ p_remove_missing: [] }))
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

	it('a UI passa o override de erros de linha sem alterar o allowPending de reconciliação', () => {
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

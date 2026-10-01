import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importVaziosManifest } from '../vaziosImport'
import {
  importVaziosFromBaplie,
  importVaziosImportacaoManifest,
  replaceVaziosFromBaplie,
} from '../vaziosImportacaoImport'

const { fromMock, rpcMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
}))

vi.mock('../supabase', () => ({ supabase: { from: fromMock, rpc: rpcMock } }))

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
})

describe('imports de vazios transacionais', () => {
  it('importa bookings em uma unica RPC', async () => {
    rpcMock.mockResolvedValue({ data: { manifest_id: 'booking-manifest' }, error: null })

    await expect(importVaziosManifest({
      filename: 'bookings.xlsx',
      voyageId: 7,
      port: 'BRSSZ',
      uploadedBy: 'user-1',
      manifest: {
        bookings: [{
          rowNumber: 2,
          booking_number: 'BK-1',
          container_number: 'ABCD1234567',
          container_type: '40HC',
          movement_date: '2026-06-23',
          origin_terminal: 'SHA',
          destination: 'SSZ',
          notes: null,
          embark_port: null,
          depot: null,
          material: false,
          hand_in_date: null,
          hand_out_date: null,
          condition: 'empty',
          os_number: null,
          overtime_pct: 0,
        }],
        rowErrors: [],
      },
    })).resolves.toEqual({ manifestId: 'booking-manifest' })

    expect(rpcMock).toHaveBeenCalledWith('import_vazios_bookings_transactional', expect.objectContaining({
      p_voyage_id: 7,
      p_bookings: expect.any(Array),
    }))
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('importa planilha de vazios e o manifesto Mercante da rota em uma unica RPC', async () => {
    rpcMock.mockResolvedValue({ data: { manifest_id: 'empty-manifest', mercante_manifest_id: 'mercante-1' }, error: null })

    await expect(importVaziosImportacaoManifest({
      voyageId: 8,
      uploadedBy: 'user-2',
      manifestNumber: ' 1226501801342 ',
      manifest: {
        containers: [{
          rowNumber: 2,
          container_number: 'EFGH1234567',
          container_type: '20DV',
          tare_kg: 2200,
          pol: 'CNTAC',
          pod: 'BRVIX',
        }],
        rowErrors: [],
      },
    })).resolves.toEqual({ manifestId: 'empty-manifest', mercanteManifestId: 'mercante-1' })

    expect(rpcMock).toHaveBeenCalledWith('import_vazios_importacao_transactional', expect.objectContaining({
      p_voyage_id: 8,
      p_containers: expect.any(Array),
    }))
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('substitui o manifesto Baplie em uma unica RPC', async () => {
    rpcMock.mockResolvedValue({ data: { manifest_id: 'baplie-manifest', total: 2 }, error: null })

    await expect(replaceVaziosFromBaplie({
      voyageId: 9,
      uploadedBy: 'user-3',
    })).resolves.toEqual({ manifestId: 'baplie-manifest', total: 2 })

    expect(rpcMock).toHaveBeenCalledWith('replace_vazios_from_baplie_transactional', expect.objectContaining({
      p_voyage_id: 9,
      p_uploaded_by: 'user-3',
    }))
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('usa a mesma RPC sem substituir quando o manifesto ainda nao existe', async () => {
    rpcMock.mockResolvedValue({ data: { manifest_id: 'baplie-manifest', total: 1 }, error: null })

    await importVaziosFromBaplie({ voyageId: 10, uploadedBy: 'user-4' })

    expect(rpcMock).toHaveBeenCalledWith('replace_vazios_from_baplie_transactional', expect.objectContaining({
      p_replace_existing: false,
    }))
  })
})

it('define RPCs transacionais protegidas para os tres fluxos', () => {
  const sql = fs.readFileSync(
    path.resolve('supabase/migrations/146_import_vazios_transactional.sql'),
    'utf8',
  )

  for (const name of [
    'import_vazios_bookings_transactional',
    'import_vazios_importacao_transactional',
    'replace_vazios_from_baplie_transactional',
  ]) {
    expect(sql).toContain(`FUNCTION public.${name}`)
  }
  expect(sql).toMatch(/DELETE FROM public\.vazios_importacao_manifests/i)
  expect(sql).toMatch(/INSERT INTO public\.vazios_bookings/i)
  expect(sql).toMatch(/INSERT INTO public\.vazios_importacao_containers/i)
  expect(sql).toMatch(/SECURITY DEFINER/i)
  expect(sql).toMatch(/FROM PUBLIC, anon/i)
  expect(sql).toMatch(/TO authenticated/i)
})

it('grava o manifesto Mercante de vazio na mesma RPC dos containers (migration 117)', () => {
  const sql = fs.readFileSync(
    path.resolve('supabase/migrations/117_vazios_importacao_com_manifesto_mercante.sql'),
    'utf8',
  )
  const body = sql.slice(sql.indexOf('CREATE FUNCTION public.import_vazios_importacao_transactional'))

  expect(body).toMatch(/p_manifest_numero text/)
  expect(body).toMatch(/INSERT INTO public\.manifestos_mercante[\s\S]*'vazio'[\s\S]*INSERT INTO public\.vazios_importacao_containers/)
  expect(body).toMatch(/v_rotas > 1/)
  expect(body).toMatch(/ERRCODE = '23505'/)
  expect(body).toMatch(/p_uploaded_by IS DISTINCT FROM auth\.uid\(\)/)
  expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.import_vazios_importacao_transactional\(bigint, text, uuid, jsonb, text\) TO authenticated/)
})

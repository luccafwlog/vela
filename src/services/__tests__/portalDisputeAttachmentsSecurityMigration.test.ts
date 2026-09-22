import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationSql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/074_portal_dispute_attachments_security.sql'),
  'utf8',
)

describe('Migration 074: segurança de anexos de Dispute (PAF-02 e PAF-03)', () => {
  it('remove permissão de INSERT amplo do Portal em storage.objects', () => {
    expect(migrationSql).toContain('DROP POLICY IF EXISTS demurrage_dispute_objects_insert ON storage.objects')
    expect(migrationSql).toContain('CREATE POLICY demurrage_dispute_objects_insert ON storage.objects FOR INSERT TO authenticated')
    expect(migrationSql).toContain("bucket_id = 'demurrage-disputes' AND public.is_active_user()")
    expect(migrationSql).not.toContain("name LIKE (public.current_portal_customer_id()::text || '/%')")
  })

  it('valida autoria da mensagem para chamadores do Portal', () => {
    expect(migrationSql).toContain("v_message.author_type <> 'cliente'")
    expect(migrationSql).toContain('v_message.author_id IS DISTINCT FROM auth.uid()')
    expect(migrationSql).toContain('Apenas o autor da mensagem pode anexar arquivos.')
  })

  it('impõe serialização por advisory lock, quota de 100 MB em disputas abertas e limite diário de 20 anexos', () => {
    expect(migrationSql).toContain("pg_advisory_xact_lock(hashtext('customer_dispute_quota_' || v_customer_id::text))")
    expect(migrationSql).toContain("d.state = 'aberta'")
    expect(migrationSql).toContain('104857600')
    expect(migrationSql).toContain('Quota de armazenamento de anexos de 100 MB excedida.')
    expect(migrationSql).toContain("interval '1 day'")
    expect(migrationSql).toContain('Limite diário de 20 anexos excedido.')
  })

  it('verifica a existência e integridade do objeto físico em storage.objects', () => {
    expect(migrationSql).toContain("to_regclass('storage.objects') IS NOT NULL")
    expect(migrationSql).toContain("bucket_id = 'demurrage-disputes'")
    expect(migrationSql).toContain('Objeto de anexo não encontrado no storage.')
    expect(migrationSql).toContain('Tamanho do arquivo divergente do objeto armazenado.')
  })

  it('revoga execução pública e anônima e concede apenas a authenticated e service_role', () => {
    expect(migrationSql).toContain('REVOKE ALL ON FUNCTION public.add_demurrage_dispute_attachment(bigint, text, text, text, bigint) FROM PUBLIC, anon;')
    expect(migrationSql).toContain('GRANT EXECUTE ON FUNCTION public.add_demurrage_dispute_attachment(bigint, text, text, text, bigint) TO authenticated, service_role;')
  })

  it('fornece função administrativa para limpeza de objetos órfãos por idade (M3)', () => {
    expect(migrationSql).toContain('CREATE OR REPLACE FUNCTION public.cleanup_orphaned_dispute_attachments')
    expect(migrationSql).toContain('DELETE FROM storage.objects o')
    expect(migrationSql).toContain("bucket_id = 'demurrage-disputes'")
    expect(migrationSql).toContain('NOT EXISTS (')
    expect(migrationSql).toContain('GRANT EXECUTE ON FUNCTION public.cleanup_orphaned_dispute_attachments(interval) TO authenticated, service_role;')
  })
})

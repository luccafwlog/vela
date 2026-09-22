import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationSql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/075_portal_dispute_attachments_review_fixes.sql'),
  'utf8',
)

function functionBody(name: string) {
  const start = migrationSql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`)
  expect(start).toBeGreaterThanOrEqual(0)
  return migrationSql.slice(start, migrationSql.indexOf('$$;', start))
}

describe('Migration 075: residuais da revisão final da PR #718', () => {
  it.each(['add_demurrage_dispute_attachment', 'portal_check_dispute_attachment_eligibility'])(
    '%s recusa anexo do Portal em Dispute que não está aberta',
    (name) => {
      const body = functionBody(name)
      expect(body).toContain("IF v_dispute.state <> 'aberta' THEN")
      expect(body).toContain('Anexos só podem ser enviados em disputas abertas.')
      // A checagem vive no ramo do Portal: Equipamentos continua anexando.
      expect(body.indexOf("v_dispute.state <> 'aberta'")).toBeGreaterThan(body.indexOf('current_portal_customer_id()'))
    },
  )

  it('permite ao usuário interno remover só o próprio objeto ainda sem metadado', () => {
    expect(migrationSql).toContain('CREATE POLICY demurrage_dispute_objects_delete ON storage.objects FOR DELETE TO authenticated')
    expect(migrationSql).toContain('AND public.is_active_user()')
    expect(migrationSql).toContain('AND owner = auth.uid()')
    expect(migrationSql).toContain('WHERE a.storage_path = objects.name')
  })

  it('troca o DELETE por SQL em storage.objects por listagem somente leitura restrita a service_role', () => {
    expect(migrationSql).toContain('DROP FUNCTION IF EXISTS public.cleanup_orphaned_dispute_attachments(interval);')
    expect(functionBody('list_orphaned_dispute_attachments')).not.toMatch(/DELETE\s+FROM/i)
    expect(migrationSql).toContain('REVOKE ALL ON FUNCTION public.list_orphaned_dispute_attachments(interval) FROM PUBLIC, anon, authenticated;')
    expect(migrationSql).toContain('GRANT EXECUTE ON FUNCTION public.list_orphaned_dispute_attachments(interval) TO service_role;')
  })
})

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('confirmação de entrega do convite do Portal', () => {
  const migration = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/103_portal_provisioning_delivery_confirmation.sql'),
    'utf8',
  )

  it('não declara aceito sem id do provedor e preserva o acesso da RPC', () => {
    expect(migration).toContain("ea.status = 'aceito' AND ea.provider_message_id IS NULL THEN 'nao_confirmado'")
    expect(migration).toContain('SELECT status, provider_message_id')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.portal_list_provisioning_console(BIGINT) FROM PUBLIC, anon;')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.portal_list_provisioning_console(BIGINT) TO authenticated;')
  })
})

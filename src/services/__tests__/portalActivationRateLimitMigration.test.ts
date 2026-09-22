import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/076_portal_activation_rate_limit.sql', 'utf8')

describe('rate limit persistido da ativação do Portal', () => {
  it('mantém a ativação em um balde próprio, sem consumir login ou recovery', () => {
    expect(sql).toContain("'activation'::text" )
    expect(sql).toContain("source = 'activation'")
    expect(sql).toContain('portal_activation_check_rate_limit')
    expect(sql).toContain('portal_activation_register_failure')
    expect(sql).not.toContain("source = 'login'")
    expect(sql).not.toContain("source = 'recovery'")
  })

  it('usa o mesmo normalizador e os parâmetros 10/5 minutos', () => {
    expect(sql).toContain("public.normalize_cnpj(coalesce(p_login,''))")
    expect(sql).toContain("attempted_at > now() - interval '5 minutes'")
    expect(sql).toContain('coalesce(v_count, 0) >= 10')
  })

  it('fecha EXECUTE para clientes e concede somente ao service_role', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.portal_activation_check_rate_limit(text) FROM PUBLIC, anon, authenticated;')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.portal_activation_register_failure(text) FROM PUBLIC, anon, authenticated;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.portal_activation_check_rate_limit(text) TO service_role;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.portal_activation_register_failure(text) TO service_role;')
  })
})

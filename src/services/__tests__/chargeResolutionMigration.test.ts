import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('056 resolucao taxas duas tabelas migration (ADR 0069)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/056_resolucao_taxas_duas_tabelas.sql'),
    'utf8',
  )

  it('cria a funcao compartilhada resolve_bl_local_charge_table_ids', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.resolve_bl_local_charge_table_ids(')
    expect(sql).toContain('RETURNS TABLE(table_id bigint, cargo_mode text)')
    expect(sql).toContain("v_bl.cargo_mode = 'misto'")
  })

  it('suprime taxa documental da tabela de carga solta em BL misto por application_basis = bl', () => {
    expect(sql).toContain("application_basis = 'bl'")
  })

  it('atualiza mark_bl_ready_for_billing para nao quebrar em BL misto', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.mark_bl_ready_for_billing(')
    expect(sql).toContain('public.resolve_bl_local_charge_table_ids(')
  })

  it('atualiza calculate_bl_local_charges e resolve_bl_local_charge_items para consumir a funcao unica', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.calculate_bl_local_charges(')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.resolve_bl_local_charge_items(')
  })

  it('mantem os resolvers de leitura fechados para o cliente autenticado', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.resolve_bl_local_charge_table_ids\(text, date\) FROM PUBLIC, anon, authenticated/i)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.resolve_bl_local_charge_items\(text, text\) FROM PUBLIC, anon, authenticated/i)
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.resolve_bl_local_charge_(?:table_ids|items)\([^;]+\) TO authenticated/i)
  })
})

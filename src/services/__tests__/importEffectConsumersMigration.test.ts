import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/031_import_effect_consumers.sql'), 'utf8')

describe('consumidores duráveis dos efeitos de import', () => {
  // Histórico: o cálculo do Granito nasceu na 031, deixou de rodar na 325 e
  // saiu do banco, com as tarifas, na 329.
  it('a 031 reprocessava Granito no servidor e falhava fechado sem tarifa vigente', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.calculate_granite_bl_charges(')
    expect(migration).toContain("RAISE EXCEPTION 'Nenhuma tarifa ativa de Granito")
    expect(migration).toMatch(/Nenhuma tarifa ativa de Granito[\s\S]*?DELETE FROM public\.granite_bl_charges/i)
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public._run_import_effect_granite_billing(')
    expect(migration).toContain("WHEN 'granite_billing' THEN")
  })

  it('move os efeitos de veículo e breakbulk para a transação de origem', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public._run_import_effect_vehicle_followup(')
    expect(migration).toContain("WHEN 'vehicle_followup' THEN")
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.import_vehicle_rows_transactional[\s\S]*?INSERT INTO public\.import_pending_effects/i)
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.import_breakbulk_manifest_transactional[\s\S]*?INSERT INTO public\.import_pending_effects/i)
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.import_granite_manifest_transactional[\s\S]*?INSERT INTO public\.import_pending_effects/i)
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.import_breakbulk_manifest_transactional[\s\S]*?LANGUAGE plpgsql SECURITY DEFINER/i)
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.import_granite_manifest_transactional[\s\S]*?LANGUAGE plpgsql SECURITY DEFINER/i)
    expect(migration).toMatch(/import_breakbulk_manifest_transactional[\s\S]*?p_uploaded_by IS DISTINCT FROM auth\.uid\(\)/i)
    expect(migration).toMatch(/import_granite_manifest_transactional[\s\S]*?p_uploaded_by IS DISTINCT FROM auth\.uid\(\)/i)
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.import_bl_freight_with_metadata(')
    expect(migration).toContain("'physical_flags'")
    expect(migration).toContain('v_physical_effect_id')
    expect(migration).toContain('v_physical_effect_id,')
  })

  it('mantém cancelamento sistêmico restrito ao consumidor autenticado pelo worker', () => {
    expect(migration).toContain("current_setting('import_effects.consumer', true) IS DISTINCT FROM 'vehicle_followup'")
    expect(migration).toContain("set_config('import_effects.consumer', 'vehicle_followup', true)")
    expect(migration).toContain('REVOKE ALL ON FUNCTION public._run_import_effect_vehicle_followup')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.process_import_effect(bigint, text) TO service_role')
  })
})

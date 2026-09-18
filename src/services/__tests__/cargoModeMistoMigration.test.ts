import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('054 cargo_mode misto e trigger derivador migration', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/054_bl_cargo_mode_misto_trigger.sql'),
    'utf8',
  )

  it('amplia a constraint de cargo_mode em bls para aceitar misto', () => {
    expect(sql).toContain('ALTER TABLE public.bls DROP CONSTRAINT IF EXISTS bls_cargo_mode_check')
    expect(sql).toContain("CHECK (cargo_mode IN ('container', 'carga_solta', 'misto'))")
  })

  it('atualiza validate_bl_breakbulk_item_parent para nao proibir pai misto', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.validate_bl_breakbulk_item_parent()')
    expect(sql).toContain('validate_bl_breakbulk_item_parent')
    expect(sql).toMatch(/IN\s*\('container',\s*'carga_solta',\s*'misto'\)/)
  })

  it('cria a funcao recalculate_bl_cargo_mode que deriva a modalidade pelo conteudo observado', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.recalculate_bl_cargo_mode(')
    expect(sql).toContain("v_new_mode := 'misto'")
    expect(sql).toContain("v_new_mode := 'carga_solta'")
    expect(sql).toContain("v_new_mode := 'container'")
    expect(sql).toContain('DELETE FROM public.charge_calculations')
    expect(sql).toContain("WHERE bl_id = p_bl_id AND source = 'auto'")
  })

  it('instala triggers em bl_containers, bl_breakbulk_items e bls', () => {
    expect(sql).toContain('CREATE TRIGGER trg_bl_containers_cargo_mode')
    expect(sql).toContain('CREATE TRIGGER trg_bl_breakbulk_cargo_mode')
    expect(sql).toContain('AFTER INSERT OR UPDATE OR DELETE ON public.bl_containers')
    expect(sql).toContain('AFTER INSERT OR UPDATE OR DELETE ON public.bl_breakbulk_items')
  })
})

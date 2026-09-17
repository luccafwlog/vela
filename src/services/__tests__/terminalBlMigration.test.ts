import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('055 terminal do BL com heranca e excecao individual migration', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/055_terminal_bl_heranca_excecao.sql'),
    'utf8',
  )

  it('adiciona pod_port_id e terminal_id em bls com FK composta para depots(id, port_id)', () => {
    expect(sql).toContain('ALTER TABLE public.bls')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS pod_port_id bigint REFERENCES public.ports(id)')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS terminal_id uuid')
    expect(sql).toContain('FOREIGN KEY (terminal_id, pod_port_id) REFERENCES public.depots(id, port_id)')
  })

  it('cria a funcao resolve_bl_terminal_id que aplica precedencia da excecao sobre heranca', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.resolve_bl_terminal_id(')
    expect(sql).toContain('v_bl.terminal_id')
    expect(sql).toContain('carga_cheia')
    expect(sql).toContain('carga_solta')
  })

  it('trata misto explicitamente em bl_operation_front_modalidade', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.bl_operation_front_modalidade(')
    expect(sql).toContain("WHEN 'misto' THEN 'misto'")
  })

  it('registra pendencias review:mixed_bl_terminal_conflict e review:bl_terminal_sem_frente', () => {
    expect(sql).toContain('mixed_bl_terminal_conflict')
    expect(sql).toContain('bl_terminal_sem_frente')
  })
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('053 manifestos mercante dominio migration', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/053_manifestos_mercante_dominio.sql'),
    'utf8',
  )

  it('cria a tabela manifestos_mercante com campos de rota, numero unico e natureza', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.manifestos_mercante')
    expect(sql).toContain('voyage_id bigint NOT NULL REFERENCES public.voyages(id)')
    expect(sql).toContain('pol text NOT NULL')
    expect(sql).toContain('pod text NOT NULL')
    expect(sql).toContain('numero text NOT NULL')
    expect(sql).toContain("CHECK (natureza IN ('carga', 'vazio'))")
    expect(sql).toContain('CONSTRAINT manifestos_mercante_numero_uniq UNIQUE (numero)')
  })

  it('adiciona manifesto_mercante_id em bls como foreign key para manifestos_mercante', () => {
    expect(sql).toContain('ALTER TABLE public.bls')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS manifesto_mercante_id uuid REFERENCES public.manifestos_mercante(id) ON DELETE SET NULL')
    expect(sql).toContain('idx_bls_manifesto_mercante')
    expect(sql).toContain('ON public.bls(manifesto_mercante_id)')
  })

  it('adiciona pol e pod em vazios_bookings para permitir rota no manifesto de vazios de exportacao', () => {
    expect(sql).toContain('ALTER TABLE public.vazios_bookings')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS pol text')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS pod text')
  })
})

describe('057 cod manifesto pendency migration', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/057_cod_manifesto_pendency.sql'),
    'utf8',
  )

  it('atualiza set_bl_cod limpando manifesto_mercante_id em bls ao marcar COD', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.set_bl_cod')
    expect(sql).toContain('manifesto_mercante_id = NULL')
    expect(sql).toContain('pod = v_discharge')
    expect(sql).not.toContain('ce_mercante = NULL')
  })
})


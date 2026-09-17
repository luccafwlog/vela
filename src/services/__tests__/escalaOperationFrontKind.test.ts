import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { operationFrontKindForCargoMode, operationFrontKindsForCargoMode } from '../escalaTerminalAllocation'

// A regra que liga a carga de um cliente ao terminal onde ela foi descarregada
// vive nos dois lados: em TypeScript (conferência manual do NOB) e em SQL
// (produtora automática). Divergir aqui é exatamente o defeito que a migration
// 045 corrigiu no roteamento por caixa — um lado enviando para um público que o
// outro não enviaria. Esta tabela é a fonte comum.
const CASOS: Array<[string | null | undefined, string]> = [
  ['container', 'carga_cheia'],
  ['CONTAINER', 'carga_cheia'],
  ['carga_solta', 'carga_solta'],
  ['  carga_solta  ', 'carga_solta'],
  ['veiculo', 'veiculo'],
  ['veiculos', 'veiculo'],
  ['', 'carga_cheia'],
  [null, 'carga_cheia'],
  [undefined, 'carga_cheia'],
  ['modalidade_que_ainda_nao_existe', 'carga_cheia'],
]

describe('Frente de Operação derivada do cargo_mode', () => {
  it('classifica cada cargo_mode na sua frente de importação', () => {
    for (const [cargoMode, esperado] of CASOS) {
      expect(operationFrontKindForCargoMode(cargoMode)).toBe(esperado)
    }
  })

  it('mantém as duas frentes para um B/L misto', () => {
    expect(operationFrontKindsForCargoMode('misto')).toEqual(['carga_cheia', 'carga_solta'])
  })

  it('o espelho SQL cobre os mesmos casos com o mesmo resultado', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/045_comunicados_caixas_e_nob_automatico.sql'),
      'utf8',
    )
    const corpo = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.bl_operation_front_modalidade'),
      sql.indexOf('REVOKE ALL ON FUNCTION public.bl_operation_front_modalidade'),
    )

    // O SQL normaliza antes de comparar, como o TypeScript.
    expect(corpo).toMatch(/lower\(btrim\(COALESCE\(p_cargo_mode, ''\)\)\)/)

    // Cada caso não-default precisa de um WHEN explícito; o resto cai no ELSE.
    const explicitos = new Map(CASOS
      .map(([cargoMode, esperado]) => [String(cargoMode ?? '').trim().toLowerCase(), esperado] as const)
      .filter(([cargoMode, esperado]) => cargoMode !== '' && esperado !== 'carga_cheia'))
    for (const [cargoMode, esperado] of explicitos) {
      expect(corpo).toContain(`WHEN '${cargoMode}' THEN '${esperado}'`)
    }
    expect(corpo).toContain("ELSE 'carga_cheia'")

    // Nenhum WHEN a mais: um ramo sem par em CASOS é divergência silenciosa.
    const whens = [...corpo.matchAll(/WHEN '([^']+)' THEN '([^']+)'/g)].map((m) => m[1])
    expect(new Set(whens)).toEqual(new Set(explicitos.keys()))
  })
})

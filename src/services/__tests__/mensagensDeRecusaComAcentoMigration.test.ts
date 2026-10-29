import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/509_mensagens_de_recusa_com_acento.sql'),
  'utf8',
)
const body = sql.replace(/^--.*$/gm, '')
const raises = [...body.matchAll(/RAISE\s+EXCEPTION\s+'((?:[^']|'')*)'/gi)].map((match) => match[1])

describe('migration 509 — recusas com acento', () => {
  it('troca as recusas citadas no Manual do Operador', () => {
    expect(raises).toContain('Usuário sem permissão ativa.')
    expect(raises).toContain('Usuário sem permissão para importar o frete do B/L.')
    expect(raises.some((text) => text.includes('não pode ser removido: há fatura emitida'))).toBe(true)
  })

  it('não deixa as versões sem acento em nenhum RAISE redefinido', () => {
    const old = /Usuario sem permissao|Credenciais invalidas (?:ou sem permissao|para (?!o portal do cliente|importar manifesto Granito))|ha fatura emitida|Cambio \(ROE\) nao|Omissao % (?:nao|ja)/
    expect(raises.filter((text) => old.test(text))).toEqual([])
  })

  it('preserva o texto que outra função compara por SQLERRM e o login do Portal', () => {
    // import_granite_manifest_transactional_core_405 compara esse texto por SQLERRM.
    expect(body).not.toContain('sem permissão para importar manifesto Granito')
    expect(body).not.toMatch(/FUNCTION public\.portal_resolve_login/)
  })

  it('só redefine funções: não reescreve nem apaga linhas', () => {
    const outside = body.replace(/\$function\$[\s\S]*?\$function\$/g, '')
    expect(outside).not.toMatch(/\b(?:UPDATE|DELETE|TRUNCATE|DROP|ALTER|INSERT)\b/i)
    expect(outside.match(/CREATE OR REPLACE FUNCTION/g)?.length).toBeGreaterThan(100)
  })
})

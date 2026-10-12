import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// A substituição total da lista (migration 243, arquivada) saiu na 187: o
// Embarque de Vazios atualiza por container e preserva as unidades incluídas à
// mão (ADR 0078, item 25), comportamento provado em
// `vaziosReimportacao.local-pg.test.ts`. Fica aqui só a recusa de container
// repetido no lote, que a suíte de banco não exercita.
const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/187_vazios_reimportacao_preserva.sql'), 'utf8')

describe('RPC do Embarque de Vazios (migration 187)', () => {
  it('rejeita container repetido no mesmo lote antes de gravar', () => {
    expect(sql).toContain('Container duplicado na planilha')
    expect(sql).not.toContain('deduped AS')
  })
})

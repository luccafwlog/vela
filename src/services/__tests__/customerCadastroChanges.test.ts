import { describe, expect, it, vi } from 'vitest'

vi.mock('../supabase', () => ({ supabase: {} }))

const { buildCadastroChanges, diffContactSnapshots } = await import('../customerCadastroChanges')

describe('Alterações do cadastro do Cliente', () => {
  it('lê as caixas e os campos do contato em português, uma linha por mudança', () => {
    const before = [{ id: 1, name: 'Mariana Souza', email: 'a@x.com', phone: null, is_primary: true, active: true, box_codes: [] }]
    const after = [
      { id: 1, name: 'Mariana Souza', email: 'b@x.com', phone: null, is_primary: true, active: true, box_codes: ['financeiro', 'documentacao_operacao'] },
      { id: 2, name: 'Pedro', email: 'p@x.com', phone: null, is_primary: false, active: true, box_codes: [] },
    ]
    expect(diffContactSnapshots(before, after)).toEqual([
      { what: 'E-mail do contato Mariana Souza', from: 'a@x.com', to: 'b@x.com' },
      { what: 'Caixas do contato Mariana Souza', from: null, to: 'Documentação e Operação, Financeiro' },
      { what: 'Contato criado', from: null, to: 'Pedro · p@x.com' },
    ])
  })

  it('autor por nome, "Sistema" quando o sistema grava, nada quando o registro não guarda; mais recente primeiro', () => {
    const rows = buildCadastroChanges(
      [{ id: 1, field_name: 'trade_name', old_value: null, new_value: 'Atlântico Imports', changed_at: '2026-10-13T14:00:00Z', justification: 'Cadastro inicial', changed_by: 'u1' }],
      [{ id: 9, source: 'sistema', actor_id: null, before_snapshot: [{ id: 1, name: 'Mariana', box_codes: [] }], after_snapshot: [{ id: 1, name: 'Mariana', box_codes: ['demurrage'] }], change_summary: { justification: 'Caixa sem destinatário' }, created_at: '2026-10-13T14:02:00Z' }],
      new Map([['u1', 'Ana Ribeiro']]),
    )
    expect(rows.map((row) => [row.what, row.to, row.by, row.justification])).toEqual([
      ['Caixas do contato Mariana', 'Demurrage', 'Feito pelo sistema', 'Caixa sem destinatário'],
      ['Nome fantasia', 'Atlântico Imports', 'Ana Ribeiro', 'Cadastro inicial'],
    ])
  })

  it('mudança feita pelo Cliente no Portal é do Cliente, mesmo com o usuário de login gravado', () => {
    const rows = buildCadastroChanges(
      [],
      [{ id: 10, source: 'portal', actor_id: 'auth-portal-1', before_snapshot: [{ id: 1, name: 'Mariana', phone: null }], after_snapshot: [{ id: 1, name: 'Mariana', phone: '(13) 3232-1010' }], change_summary: null, created_at: '2026-10-13T15:00:00Z' }],
      new Map(),
    )
    expect(rows.map((row) => row.by)).toEqual(['Cliente pelo Portal'])
  })

  it('mudança da Base de Clientes aparece com "Origem: Base de Clientes", quem e quando (403, F-24)', () => {
    const rows = buildCadastroChanges(
      [
        { id: 1, field_name: 'name', old_value: 'ALFA LTDA', new_value: 'ALFA COMERCIO LTDA', changed_at: '2026-10-22T10:00:00Z', justification: 'Importação de Base de Clientes', changed_by: 'u1' },
        { id: 2, field_name: 'contact_added', old_value: null, new_value: 'op@alfa.test', changed_at: '2026-10-22T10:00:00Z', justification: 'Importação de Base de Clientes', changed_by: 'u1' },
      ],
      [],
      new Map([['u1', 'Ana Ribeiro']]),
    )
    expect(rows.map(({ what, from, to, by, justification }) => ({ what, from, to, by, justification }))).toEqual([
      { what: 'Razão social', from: 'ALFA LTDA', to: 'ALFA COMERCIO LTDA', by: 'Ana Ribeiro', justification: 'Origem: Base de Clientes' },
      { what: 'E-mail incluído', from: null, to: 'op@alfa.test', by: 'Ana Ribeiro', justification: 'Origem: Base de Clientes' },
    ])
  })
})

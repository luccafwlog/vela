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
      ['Caixas do contato Mariana', 'Demurrage', 'Sistema', 'Caixa sem destinatário'],
      ['Nome fantasia', 'Atlântico Imports', 'Ana Ribeiro', 'Cadastro inicial'],
    ])
  })
})

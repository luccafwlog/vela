import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 603: o Histórico de ações lê uma linha por ação (a transação de
// quem fez), sem a linha do gatilho que repete o campo gravado pela função, com
// busca e as linhas de uma ação pela chave. Migration 604: o gravador genérico
// deixa de gravar as colunas técnicas (data de atualização e afins).
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADMIN_ID = '60360300-0000-4000-8000-000000000001'
const OPERATOR_ID = '60360300-0000-4000-8000-000000000002'
const CUSTOMER_ID = 99603011
const EDITED_CUSTOMER_ID = 99603012
const DAY = '2031-07-23'
const IMPORT_AT = `${DAY} 14:55:11.626336-03`

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function asUser(userId: string, sql: string): { output: string; error: string } {
  const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-F', '|', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '${userId}';
     SET LOCAL request.jwt.claim.role = 'authenticated'; ${sql}; COMMIT;`], { encoding: 'utf8' })
  return { output: (result.stdout ?? '').trim(), error: (result.stderr ?? '').trim() }
}

function actions(extra = ''): string[] {
  const result = asUser(ADMIN_ID, `SELECT action, line_count, entity_count, groups::text, total_count
    FROM public.admin_action_history_actions(p_date_from => '${DAY}', p_date_to => '${DAY}'${extra})`)
  expect(result.error).toBe('')
  return result.output ? result.output.split('\n') : []
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE changed_at::date BETWEEN '${DAY}'::date - 1 AND '${DAY}'::date + 1;
    DELETE FROM public.audit_logs WHERE entity_type = 'customers' AND entity_id = '${EDITED_CUSTOMER_ID}';
    DELETE FROM public.customers WHERE id IN (${CUSTOMER_ID}, ${EDITED_CUSTOMER_ID});
    DELETE FROM public.user_profiles WHERE id IN ('${ADMIN_ID}', '${OPERATOR_ID}');
    DELETE FROM auth.users WHERE id IN ('${ADMIN_ID}', '${OPERATOR_ID}');
    SET session_replication_role = origin;
  `)
}

function migration603Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_proc WHERE proname = 'admin_action_history_actions';`) === '1'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration603Applied, 'migration603Applied (Histórico por ação)')

describeLocal('603 — Histórico de ações com uma linha por ação', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES
        ('${ADMIN_ID}', 'admin-603@example.test'),
        ('${OPERATOR_ID}', 'operacoes-603@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${ADMIN_ID}', 'Ana Administrativo 603', 'administrativo', true),
        ('${OPERATOR_ID}', 'Otávio Operações 603', 'operacoes', true);
      SET session_replication_role = replica;
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER_ID}, 'CLIENTE BUSCA 603 LTDA', '${syntheticCnpj(603011)}');
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification) VALUES
        -- Uma importação: dois B/Ls criados, um deles com o Status de revisão
        -- gravado pela função (bl) e repetido pelo gatilho (bls), e dois containers.
        ('bls', '9960301', 'criado', NULL, '{"id": 9960301, "bl_number": "GSPT603A"}', '${OPERATOR_ID}', '${IMPORT_AT}', 'Importação de B/L · Viagem NAVIO 603'),
        ('bls', '9960302', 'criado', NULL, '{"id": 9960302, "bl_number": "GSPT603B"}', '${OPERATOR_ID}', '${IMPORT_AT}', 'Importação de B/L · Viagem NAVIO 603'),
        ('bls', '9960301', 'review_status', 'reviewed', 'pending_review', '${OPERATOR_ID}', '${IMPORT_AT}', 'Importação de B/L · Viagem NAVIO 603'),
        ('bl', '9960301', 'review_status', 'reviewed', 'pending_review', '${OPERATOR_ID}', '${IMPORT_AT}', 'Gate canonico aplicado apos importacao'),
        ('bl_containers', '9960311', 'criado', NULL, '{"id": 9960311, "container_number": "MSKU6030001"}', '${OPERATOR_ID}', '${IMPORT_AT}', 'Importação de B/L · Viagem NAVIO 603'),
        ('bl_containers', '9960311', 'ownership', NULL, 'COC', '${OPERATOR_ID}', '${IMPORT_AT}', 'Importação de B/L · Viagem NAVIO 603'),
        ('bl_containers', '9960312', 'criado', NULL, '{"id": 9960312, "container_number": "MSKU6030002"}', '${OPERATOR_ID}', '${IMPORT_AT}', 'Importação de B/L · Viagem NAVIO 603'),
        -- Outra ação, no mesmo minuto, de outra pessoa: um campo do Cliente.
        ('customers', '${CUSTOMER_ID}', 'city', 'Santos', 'Vitória', '${ADMIN_ID}', '${DAY} 14:55:40-03', 'Endereço novo informado pelo Cliente');
      SET session_replication_role = origin;
    `)
  })
  afterAll(cleanup)

  it('fora do Administrativo, recusa', () => {
    const result = asUser(OPERATOR_ID, `SELECT count(*) FROM public.admin_action_history_actions()`)
    expect(result.error).toMatch(/Somente o Administrativo consulta o Histórico de ações/)
  })

  it('junta as linhas da mesma transação numa ação e conta registros, sem a linha repetida do gatilho', () => {
    const rows = actions()
    expect(rows).toHaveLength(2)
    const [customer, importAction] = rows.map((row) => row.split('|'))
    expect(customer.slice(0, 3)).toEqual(['alterou', '1', '1'])
    // 7 linhas gravadas, 6 lidas: o Status de revisão do gatilho (bls) sai.
    expect(importAction.slice(0, 3)).toEqual(['criou', '6', '4'])
    const groups = JSON.parse(importAction[3]) as Array<{ entity_type: string; kind: string; entities: number }>
    expect(groups.map((group) => [group.entity_type, group.kind, group.entities])).toEqual([
      ['bl_containers', 'criou', 2],
      ['bls', 'criou', 2],
    ])
    expect(importAction[4]).toBe('2')
  })

  it('a busca acha a ação pelo Cliente e pelo texto gravado, e o filtro de assunto pela linha', () => {
    expect(actions(`, p_search => 'busca 603'`)).toHaveLength(1)
    expect(actions(`, p_search => 'MSKU6030002'`)[0]).toMatch(/^criou\|6\|4\|/)
    expect(actions(`, p_search => 'nada-603-nada'`)).toHaveLength(0)
    expect(actions(`, p_entity_types => ARRAY['customers']`)).toHaveLength(1)
  })

  it('as linhas de uma ação pela chave: todas, já sem a repetida, e a motivo da função fica', () => {
    const key = asUser(ADMIN_ID, `SELECT action_key FROM public.admin_action_history_actions(p_date_from => '${DAY}', p_date_to => '${DAY}', p_search => 'MSKU6030002')`)
    expect(key.error).toBe('')
    const lines = asUser(ADMIN_ID, `SELECT entity_type || ':' || field_name || ':' || coalesce(justification, '-')
      FROM public.admin_action_history(p_action_key => '${key.output}', p_limit => 1000)`)
    expect(lines.error).toBe('')
    const out = lines.output.split('\n')
    expect(out).toHaveLength(6)
    expect(out).toContain('bl:review_status:Gate canonico aplicado apos importacao')
    expect(out.some((line) => line.startsWith('bls:review_status'))).toBe(false)
  })

  it('604: a edição grava o campo que mudou e não a data de atualização', () => {
    psql(`INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${EDITED_CUSTOMER_ID}, 'CLIENTE 604 LTDA', '${syntheticCnpj(604012)}')`)
    psql(`UPDATE public.customers SET name = 'CLIENTE 604 NOVO LTDA', updated_at = now() + interval '1 minute' WHERE id = ${EDITED_CUSTOMER_ID}`)
    const fields = psql(`SELECT string_agg(field_name, ',' ORDER BY field_name) FROM public.audit_logs
      WHERE entity_type = 'customers' AND entity_id = '${EDITED_CUSTOMER_ID}'`)
    expect(fields.split(',')).toContain('name')
    expect(fields.split(',')).not.toContain('updated_at')
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { execPsql, spawnPsql } from './localPsql'

// Migration 587 (decisão do dono de 2026-11-04): Pix não conciliado, Consulta
// de Pix do Itaú parada e Restituição pendente passam para o setor Financeiro.
// O produtor que ainda informa o Administrativo grava no Financeiro, e os itens
// já abertos mudam de setor com o setor anterior no histórico do item. Cada
// cenário roda numa transação desfeita no fim.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const FIN = '58700000-0000-4000-8000-000000000001'
const ADM = '58700000-0000-4000-8000-000000000002'

const migration = readFileSync('supabase/migrations/587_alertas_de_dinheiro_no_setor_financeiro.sql', 'utf8')
const moveStep = migration.slice(migration.indexOf('-- 4 --- Itens ativos'), migration.lastIndexOf('COMMIT;'))

const FIXTURES = `
  INSERT INTO auth.users (id, email) VALUES ('${FIN}', 'r587-fin@example.test'), ('${ADM}', 'r587-adm@example.test');
  INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
    ('${FIN}', 'R587 Financeiro', 'financeiro', true), ('${ADM}', 'R587 Administrativo', 'administrativo', true);
`

const asService = `SELECT set_config('request.jwt.claim.role', 'service_role', true) IS NOT NULL;
  SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) IS NOT NULL;`

function scenario(sql: string): string[] {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `BEGIN; ${FIXTURES} ${sql} ROLLBACK;`],
    { encoding: 'utf8' })
  expect(run.stderr).not.toMatch(/ERROR/)
  return run.stdout.split('\n').filter((line) => line.startsWith('>'))
}

/** Uma linha por item: `>tipo|entidade|setor|status`. */
const items = (entity: string) => `SELECT '>' || i.item_type || '|' || a.entity_id || '|' || i.department || '|' || i.status
  FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id WHERE a.entity_id LIKE '${entity}%' ORDER BY a.entity_id, i.id;`

describeLocal('587 — alertas de dinheiro no setor Financeiro', () => {
  // 620 (ADR 0133): a Consulta Itaú parada é técnica e passou à conta Dev do Administrativo.
  it('o catálogo põe Pix e Restituição no Financeiro; a Fatura desatualizada e a Consulta Itaú no Administrativo', () => {
    expect(execPsql(['-X', '-At', '-q', '-d', databaseUrl, '-c', `SELECT string_agg(type || ':' || responsible_department, ',' ORDER BY type)
      FROM public.alert_type_catalog WHERE type IN ('pix_unreconciled', 'restituicao_pendente', 'itau_pix_consulta_parada', 'fatura_desatualizada')`],
    { encoding: 'utf8' }).trim())
      .toBe('fatura_desatualizada:administrativo,itau_pix_consulta_parada:administrativo,pix_unreconciled:financeiro,restituicao_pendente:financeiro')
  })

  it('o produtor que informa o Administrativo grava no Financeiro, e o sino vai só ao Financeiro', () => {
    const lines = scenario(`${asService}
      SELECT public.upsert_alert_item('restituicao_pendente', 'invoice', 'R587-INV', 'Restituição de teste 587', 'teste_587',
        'administrativo', '{}'::jsonb, '/taxas-locais') IS NOT NULL;
      ${items('R587-INV')}
      SELECT '>sino|' || coalesce(string_agg(n.recipient_department, ',' ORDER BY n.recipient_department), '')
        FROM public.internal_notifications n JOIN public.alerts a ON a.id = n.alert_id
        WHERE a.entity_id = 'R587-INV' AND n.recipient_id IN ('${FIN}', '${ADM}');`)
    expect(lines).toEqual(['>restituicao_pendente|R587-INV|financeiro|active', '>sino|financeiro'])
  })

  it('o item ainda aberto no Administrativo passa para o Financeiro com o setor anterior no histórico; o resolvido não muda', () => {
    const seed = (entity: string, type: string, status: string) => `
      WITH a AS (INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
        VALUES ('aggregate', 'pix_transaction', '${entity}', 'Pix 587', 'open') RETURNING id)
      INSERT INTO public.alert_items (alert_id, item_type, source, severity, department, message, status, resolved_at)
      SELECT a.id, '${type}', 'teste_587', 'critical', 'administrativo', 'Pix 587', '${status}',
        CASE WHEN '${status}' = 'resolved' THEN now() END FROM a;`
    const lines = scenario(`SET LOCAL session_replication_role = replica;
      ${seed('R587-ABERTO', 'pix_unreconciled', 'active')}
      ${seed('R587-RESOLVIDO', 'pix_unreconciled', 'resolved')}
      ${seed('R587-FATURA', 'fatura_desatualizada', 'active')}
      SET LOCAL session_replication_role = origin;
      ${moveStep}
      ${items('R587-')}
      SELECT '>evento|' || e.event_type || '|' || (e.metadata->>'department_from') || '>' || (e.metadata->>'department_to')
        FROM public.alert_item_events e JOIN public.alert_items i ON i.id = e.alert_item_id JOIN public.alerts a ON a.id = i.alert_id
        WHERE a.entity_id LIKE 'R587-%' AND e.metadata->>'migration' = '587';`)
    expect(lines).toEqual([
      '>pix_unreconciled|R587-ABERTO|financeiro|active',
      '>fatura_desatualizada|R587-FATURA|administrativo|active',
      '>pix_unreconciled|R587-RESOLVIDO|administrativo|resolved',
      '>evento|updated|administrativo>financeiro',
    ])
  })
})

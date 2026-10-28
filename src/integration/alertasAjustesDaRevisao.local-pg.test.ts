// Migration 485 (revisão da PR #1070; decisões do dono de 2026-10-27): os
// quatro críticos da Documentação avisam também o Administrativo; a
// justificativa cala o alerta de origem externa por 24 h; na rotina HTTP, um
// tipo de falha novo reabre na hora. Cada cenário roda numa transação desfeita.
//
// Namespace exclusivo: usuários ...000000485NNN, Cliente 485001, registros 'A485-*'.
import { spawnPsql } from './localPsql'
import { describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADM = '00000000-0000-0000-0000-000000485001'
const DOC = '00000000-0000-0000-0000-000000485003'
const FIN = '00000000-0000-0000-0000-000000485002'

const FIXTURES = `
  INSERT INTO auth.users (id, email) VALUES
    ('${ADM}', 'a485-adm@example.test'), ('${DOC}', 'a485-doc@example.test'), ('${FIN}', 'a485-fin@example.test');
  INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
    ('${ADM}', 'A485 Ana', 'administrativo', true), ('${DOC}', 'A485 Paula', 'documentacao', true),
    ('${FIN}', 'A485 Rafael', 'financeiro', true);
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (485001, 'A485 Atlântica', '48500148500148');
  SET LOCAL session_replication_role = origin;
`
const asService = `SELECT set_config('request.jwt.claim.role', 'service_role', true) IS NOT NULL;`
const asAdm = `SELECT set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', '${ADM}', true);`

function httpFailure(status: number) {
  return `SELECT public.upsert_alert_item('rotina_http_falhou', 'cron_http', 'A485-HTTP', 'Falha HTTP ${status}', 'teste_485',
    'administrativo', '{"failures": 1, "queued": 0, "examples": [{"status_code": ${status}, "timed_out": false}]}'::jsonb, '/alertas') IS NOT NULL;`
}

const httpStatus = `SELECT '>' || i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
  WHERE a.entity_id = 'A485-HTTP' ORDER BY i.id DESC LIMIT 1;`

/** Roda o cenário numa transação desfeita; devolve as linhas que começam com '>'. */
function scenario(sql: string): { lines: string[]; stderr: string } {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `BEGIN; ${FIXTURES} ${sql} ROLLBACK;`],
    { encoding: 'utf8' })
  return { lines: run.stdout.split('\n').filter((line) => line.startsWith('>')), stderr: run.stderr }
}

describeLocal('Alertas: ajustes da revisão (migration 485)', () => {
  it('P3: "Cliente sem contato principal" avisa a Documentação e o Administrativo, não o Financeiro', () => {
    const { lines, stderr } = scenario(`
      ${asService}
      SELECT public.upsert_alert_item('cliente_sem_contato_principal', 'customer', '485001', 'Teste 485', 'teste_485',
        'documentacao', '{}'::jsonb, '/clientes') IS NOT NULL;
      SELECT '>' || string_agg(up.role, ',' ORDER BY up.role)
        FROM public.internal_notifications n JOIN public.alerts a ON a.id = n.alert_id
        JOIN public.user_profiles up ON up.id = n.recipient_id
        WHERE a.entity_type = 'customer' AND a.entity_id = '485001' AND n.recipient_id IN ('${ADM}', '${DOC}', '${FIN}');
    `)
    expect(stderr).toBe('')
    expect(lines).toEqual(['>administrativo,documentacao'])
  })

  it('M6: justificada a falha HTTP 500, a mesma falha não reabre, mas um HTTP 401 novo reabre na hora', () => {
    const { lines, stderr } = scenario(`
      ${asService} ${httpFailure(500)}
      ${asAdm}
      SELECT public.resolve_alert_item_with_justification(i.id, 'Itaú fora do ar, suporte avisado') IS NOT NULL
        FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id WHERE a.entity_id = 'A485-HTTP';
      ${asService} ${httpFailure(500)} ${httpStatus}
      ${httpFailure(401)} ${httpStatus}
    `)
    expect(stderr).toBe('')
    expect(lines).toEqual(['>resolved', '>active'])
  })

  it('P4: a justificativa cala por 24 h; depois disso, com a causa ainda lá, o alerta volta', () => {
    const { lines, stderr } = scenario(`
      ${asService} ${httpFailure(500)}
      ${asAdm}
      SELECT public.resolve_alert_item_with_justification(i.id, 'Itaú fora do ar, suporte avisado') IS NOT NULL
        FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id WHERE a.entity_id = 'A485-HTTP';
      UPDATE public.alert_item_events e SET created_at = now() - interval '25 hours'
        FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
        WHERE e.alert_item_id = i.id AND a.entity_id = 'A485-HTTP';
      ${asService} ${httpFailure(500)} ${httpStatus}
    `)
    expect(stderr).toBe('')
    expect(lines).toEqual(['>active'])
  })
})

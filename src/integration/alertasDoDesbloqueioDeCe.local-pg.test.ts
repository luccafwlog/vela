// Migration 608 (ADR 0131, D1): alertas do Desbloqueio de CE.
// - Solicitação do Cliente sem análise 2 horas úteis (08h–17h, dia útil)
//   depois do envio: Crítico, para Documentação e Administrativo.
// - Prazo do desbloqueio correndo: Normal 2 horas depois do início, Crítico 2
//   horas antes do vencimento; fecha quando a conciliação da ZPT traz o B/L
//   desbloqueado no CE atual (migration 612), não com a exportação.
// Cada cenário roda numa transação desfeita no fim.
//
// Namespace exclusivo: Cliente/Viagem 998608, B/L 'A608-*', usuários ...000000608001/2.
import { execPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

const db = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const local = process.env.LOCAL_PG_INTEGRATION === '1' ? describe : describe.skip
const customer = 998608
const client = '00000000-0000-0000-0000-000000608009'
const doc = '00000000-0000-0000-0000-000000608001'
const adm = '00000000-0000-0000-0000-000000608002'
const request = '00000000-0000-0000-0000-000000608100'
const termo = '00000000-0000-0000-0000-000000608101'
const procuracao = '00000000-0000-0000-0000-000000608102'
const BL = 'A608-1'

function sql(q: string): string {
  return execPsql(['-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: q, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    .replaceAll(String.fromCharCode(13), '').trim()
}

// `afterSweep`: SQL rodado depois da conferência, com os gatilhos ligados (a conciliação da ZPT, na 612).
type Scenario = { submittedAgo: string; approved: boolean; startedAgo?: string; exported?: boolean; afterSweep?: string }

/** Monta a solicitação, roda a conferência e devolve os alertas e avisos. */
function run(s: Scenario): Record<string, string | number | null> {
  const at = (ago: string) => `now() - interval '${ago}'`
  const start = s.startedAgo ? at(s.startedAgo) : at(s.submittedAgo)
  const out = sql(`BEGIN;
    SET LOCAL session_replication_role=replica;
    INSERT INTO public.ce_unlock_requests(id,customer_id,source,state,created_by,protocol) VALUES('${request}',${customer},'request','${s.approved ? 'completed' : 'submitted'}','${client}','CE-A608');
    INSERT INTO public.ce_unlock_documents(id,customer_id,request_id,type,source,status,storage_path,file_name,size_bytes,hash,uploaded_by,reviewed_at) VALUES
      ('${termo}',${customer},'${request}','termo','request','${s.approved ? 'approved' : 'uploaded'}','p/t','t.pdf',10,repeat('a',64),'${client}',${s.approved ? start : 'NULL'}),
      ('${procuracao}',${customer},'${request}','procuracao','request','${s.approved ? 'approved' : 'uploaded'}','p/p','p.pdf',10,repeat('b',64),'${client}',${s.approved ? start : 'NULL'});
    INSERT INTO public.ce_unlock_events(customer_id,request_id,action,actor_id,created_at) VALUES(${customer},'${request}','submit','${client}',${at(s.submittedAgo)});
    INSERT INTO public.bls(id,voyage_id,customer_id,ce_mercante) VALUES('${BL}',${customer},${customer},'998608000000101');
    INSERT INTO public.bl_receivables(id,bl_id,customer_id,original_amount_brl,settled_amount_brl,balance_brl,status)
      VALUES(998608,'${BL}',${customer},100,100,0,'settled');
    INSERT INTO public.ledger_settlements(receivable_id,amount_brl,source,created_at) VALUES(998608,100,'manual',${start});
    INSERT INTO public.ce_unlock_request_bls(request_id,bl_id,ce_at_request,termo_document_id,procuracao_document_id,termo_approved,procuracao_approved,exported_at)
      VALUES('${request}','${BL}','998608000000101','${termo}','${procuracao}',${s.approved},${s.approved},${s.exported ? 'now()' : 'NULL'});
    INSERT INTO public.ce_unlock_bl_deliveries(bl_id,delivered,updated_at) VALUES('${BL}',true,${start});
    SET LOCAL session_replication_role=origin;
    SELECT public.reconcile_ce_unlock_alerts('teste_608') >= 0;
    ${s.afterSweep ?? ''}
    SELECT jsonb_build_object(
      'request', (SELECT concat_ws('|', i.status, i.severity, i.department) FROM public.alert_items i JOIN public.alerts a ON a.id=i.alert_id
        WHERE a.entity_id='${request}' AND i.item_type='desbloqueio_solicitacao_sem_analise'),
      'deadline', (SELECT concat_ws('|', i.status, i.severity, i.metadata->>'milestone') FROM public.alert_items i JOIN public.alerts a ON a.id=i.alert_id
        WHERE a.entity_id='${BL}' AND i.item_type='desbloqueio_prazo_vencendo'),
      'message', (SELECT i.message FROM public.alert_items i JOIN public.alerts a ON a.id=i.alert_id
        WHERE a.entity_id='${BL}' AND i.item_type='desbloqueio_prazo_vencendo'),
      'doc', (SELECT count(*) FROM public.internal_notifications n JOIN public.alerts a ON a.id=n.alert_id WHERE a.entity_id='${request}' AND n.recipient_id='${doc}'),
      'adm', (SELECT count(*) FROM public.internal_notifications n JOIN public.alerts a ON a.id=n.alert_id WHERE a.entity_id='${request}' AND n.recipient_id='${adm}'));
    ROLLBACK;`)
  return JSON.parse(out.split('\n').at(-1) ?? 'null') as Record<string, string | number | null>
}

local('Alertas do Desbloqueio de CE (migration 608)', () => {
  const cleanup = () => sql(`SET session_replication_role=replica;
    DELETE FROM public.internal_notifications WHERE recipient_id IN('${doc}','${adm}');
    DELETE FROM public.voyages WHERE id=${customer}; DELETE FROM public.vessels WHERE id=${customer}; DELETE FROM public.carriers WHERE id=${customer};
    DELETE FROM public.customers WHERE id=${customer};
    DELETE FROM public.user_profiles WHERE id IN('${doc}','${adm}');
    DELETE FROM auth.users WHERE id IN('${client}','${doc}','${adm}');
    SET session_replication_role=origin;`)
  beforeAll(() => {
    cleanup()
    sql(`INSERT INTO auth.users(id,email) VALUES('${client}','a608@example.test'),('${doc}','a608-doc@example.test'),('${adm}','a608-adm@example.test');
      INSERT INTO public.user_profiles(id,full_name,role,active) VALUES('${doc}','A608 Doc','documentacao',true),('${adm}','A608 Adm','administrativo',true);
      INSERT INTO public.customers(id,cnpj_cpf,name) VALUES(${customer},'${syntheticCnpj(60801)}','A608');
      INSERT INTO public.carriers(id,name) VALUES(${customer},'A608 carrier');
      INSERT INTO public.vessels(id,name,carrier_id) VALUES(${customer},'A608 vessel',${customer});
      INSERT INTO public.voyages(id,vessel_id,voyage_number,status) VALUES(${customer},${customer},'A608','active');`)
  })
  afterAll(cleanup)

  it('horas úteis: sexta 16h30 + 2h cai na segunda 9h30; sábado vai para segunda 10h; antes das 8h conta das 8h', () => {
    expect(sql(`SELECT concat_ws(',',
      to_char(public._add_business_hours('2026-11-06 16:30-03', 2) AT TIME ZONE 'America/Sao_Paulo', 'DY HH24:MI'),
      to_char(public._add_business_hours('2026-11-07 10:00-03', 2) AT TIME ZONE 'America/Sao_Paulo', 'DY HH24:MI'),
      to_char(public._add_business_hours('2026-11-05 07:00-03', 2) AT TIME ZONE 'America/Sao_Paulo', 'DY HH24:MI'));`))
      .toBe('MON 09:30,MON 10:00,THU 10:00')
  })

  it('solicitação recém-enviada: ainda sem alerta', () => {
    expect(run({ submittedAgo: '1 minute', approved: false }).request).toBeNull()
  })

  it('solicitação sem análise depois de 2 horas úteis: Crítico da Documentação, avisa Documentação e Administrativo', () => {
    const r = run({ submittedAgo: '6 days', approved: false })
    expect(r.request).toBe('active|critical|documentacao')
    expect(r.doc).toBe(1)
    expect(r.adm).toBe(1)
  })

  it('prazo no começo: sem alerta; 3 horas depois: Normal; perto do vencimento: Crítico', () => {
    expect(run({ submittedAgo: '6 days', approved: true, startedAgo: '1 hour' }).deadline).toBeNull()
    // O prazo dura ao menos 5 horas (antes do meio-dia vence às 17h; depois, no meio-dia seguinte).
    expect(run({ submittedAgo: '6 days', approved: true, startedAgo: '3 hours' }).deadline).toBe('active|normal|prazo_correndo')
    const late = run({ submittedAgo: '6 days', approved: true, startedAgo: '5 days' })
    expect(late.deadline).toBe('active|critical|prazo_critico')
    // Análise concluída: o alerta da solicitação não abre.
    expect(late.request).toBeNull()
  })

  it('612: exportar não fecha; segue Crítico e diz que falta a conciliação da ZPT', () => {
    const r = run({ submittedAgo: '6 days', approved: true, startedAgo: '5 days', exported: true })
    expect(r.deadline).toBe('active|critical|prazo_critico')
    expect(r.message).toContain('Exportado para a ZPT; falta a conciliação trazer o B/L desbloqueado.')
  })

  it('612: a conciliação da ZPT com "Desbloqueado" no CE atual fecha na hora; no CE antigo, não', () => {
    const zpt = (ce: string) => `INSERT INTO public.ce_unlock_zpt_status(bl_id,ce_mercante,status,zpt_status,reconciled_by)
      VALUES('${BL}','${ce}','unlocked','Desbloqueado','${doc}');`
    expect(run({ submittedAgo: '6 days', approved: true, startedAgo: '5 days', exported: true, afterSweep: zpt('998608000000101') }).deadline)
      .toMatch(/^resolved\|/)
    expect(run({ submittedAgo: '6 days', approved: true, startedAgo: '5 days', exported: true, afterSweep: zpt('998608000000999') }).deadline)
      .toBe('active|critical|prazo_critico')
  })
})

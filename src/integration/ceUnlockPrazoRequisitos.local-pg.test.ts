// Ponto 10 das observações de 2026-10-23 (migration 448): o prazo do
// desbloqueio só começa com os quatro requisitos cumpridos — taxas locais
// liquidadas, termo de devolução aprovado, procuração aprovada e B/L original
// entregue. Cada cenário roda numa transação desfeita no fim.
import { execPsql } from './localPsql'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { syntheticCnpj } from './localTestData'

const db = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const local = process.env.LOCAL_PG_INTEGRATION === '1' ? describe : describe.skip
const customer = 998448
const client = '00000000-0000-0000-0000-000000448002'
const admin = '00000000-0000-0000-0000-000000448001'
const request = '00000000-0000-0000-0000-000000448100'
const termo = '00000000-0000-0000-0000-000000448101'
const procuracao = '00000000-0000-0000-0000-000000448102'

function sql(q: string): string {
  return execPsql(['-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: q, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    .replaceAll(String.fromCharCode(13), '').trim()
}

type Requirements = { paid: boolean; termo: boolean; procuracao: boolean; delivered: boolean }

/** Monta um pedido enviado com um B/L (ou dois) e devolve o que o banco diz sobre o prazo. */
function scenario(req: Requirements, extra = '') {
  const bl = (id: string, ce: string, receivable: number, r: Requirements) => `
    INSERT INTO public.bls(id,voyage_id,customer_id,ce_mercante) VALUES('${id}',${customer},${customer},'${ce}');
    INSERT INTO public.bl_receivables(id,bl_id,customer_id,original_amount_brl,settled_amount_brl,balance_brl,status)
      VALUES(${receivable},'${id}',${customer},100,${r.paid ? 100 : 0},${r.paid ? 0 : 100},'${r.paid ? 'settled' : 'open'}');
    ${r.paid ? `INSERT INTO public.ledger_settlements(receivable_id,amount_brl,source) VALUES(${receivable},100,'manual');` : ''}
    SET LOCAL session_replication_role=origin;
    INSERT INTO public.ce_unlock_request_bls(request_id,bl_id,ce_at_request,termo_document_id,procuracao_document_id,termo_approved,procuracao_approved)
      VALUES('${request}','${id}','${ce}','${termo}','${procuracao}',${r.termo},${r.procuracao});
    INSERT INTO public.ce_unlock_bl_deliveries(bl_id,delivered) VALUES('${id}',${r.delivered});
    SET LOCAL session_replication_role=replica;`
  const out = sql(`BEGIN;
    SET LOCAL session_replication_role=replica;
    INSERT INTO public.ce_unlock_requests(id,customer_id,source,state,created_by) VALUES('${request}',${customer},'request','in_review','${client}');
    INSERT INTO public.ce_unlock_documents(id,customer_id,request_id,type,source,status,storage_path,file_name,size_bytes,hash,uploaded_by,reviewed_at) VALUES
      ('${termo}',${customer},'${request}','termo','request','${req.termo ? 'approved' : 'uploaded'}','p/t','t.pdf',10,repeat('a',64),'${client}',${req.termo ? "now()-interval '1 hour'" : 'NULL'}),
      ('${procuracao}',${customer},'${request}','procuracao','request','${req.procuracao ? 'approved' : 'uploaded'}','p/p','p.pdf',10,repeat('b',64),'${client}',${req.procuracao ? "now()-interval '30 minutes'" : 'NULL'});
    INSERT INTO public.ce_unlock_events(customer_id,request_id,action,actor_id,created_at) VALUES(${customer},'${request}','submit','${client}',now()-interval '2 hours');
    ${bl('CE448-A', '998448000000101', 998448, req)}
    ${extra}
    SET LOCAL session_replication_role=origin;
    SET LOCAL request.jwt.claim.sub='${admin}';
    SELECT jsonb_build_object(
      'item', ce_unlock_private.item('CE448-A','${request}')->>'sla_started_at',
      'request', ce_unlock_private.request_sla_start('${request}'),
      'portal', (SELECT x->>'sla_started_at' FROM jsonb_array_elements(ce_unlock_private.list(${customer},'{}',1,true)->'items') x WHERE x->>'id'='${request}'),
      'ficha', (SELECT x->>'sla_started_at' FROM jsonb_array_elements(public.ce_unlock_customer_requests(${customer},NULL,1)->'items') x WHERE x->>'id'='${request}'),
      'ficha_exported_at', (SELECT x->>'exported_at' FROM jsonb_array_elements(public.ce_unlock_customer_requests(${customer},NULL,1)->'items') x WHERE x->>'id'='${request}'),
      'submit', (SELECT max(created_at) FROM public.ce_unlock_events WHERE request_id='${request}' AND action='submit'),
      'termo_at', (SELECT reviewed_at FROM public.ce_unlock_documents WHERE id='${termo}'),
      'procuracao_at', (SELECT reviewed_at FROM public.ce_unlock_documents WHERE id='${procuracao}'));
    ROLLBACK;`)
  return JSON.parse(out.split('\n').at(-1) ?? 'null') as Record<string, string | null>
}

const COMBINATIONS: Requirements[] = []
for (let mask = 0; mask < 16; mask += 1) {
  COMBINATIONS.push({ paid: Boolean(mask & 1), termo: Boolean(mask & 2), procuracao: Boolean(mask & 4), delivered: Boolean(mask & 8) })
}
const label = (r: Requirements) => Object.entries(r).map(([k, v]) => `${k}=${v ? 'sim' : 'não'}`).join(', ')

local('desbloqueio CE — prazo só com os quatro requisitos (migration 448)', () => {
  const cleanup = () => sql(`SET session_replication_role=replica;
    DELETE FROM public.ce_unlock_email_outbox WHERE customer_id=${customer};
    DELETE FROM public.portal_notifications WHERE customer_id=${customer};
    DELETE FROM public.ce_unlock_events WHERE customer_id=${customer};
    DELETE FROM public.ce_unlock_request_bls WHERE bl_id LIKE 'CE448-%';
    DELETE FROM public.ce_unlock_documents WHERE customer_id=${customer};
    DELETE FROM public.ce_unlock_requests WHERE customer_id=${customer};
    DELETE FROM public.ce_unlock_bl_deliveries WHERE bl_id LIKE 'CE448-%';
    DELETE FROM public.ledger_settlements WHERE receivable_id IN(998448,998449);
    DELETE FROM public.bl_receivables WHERE id IN(998448,998449);
    DELETE FROM public.bls WHERE id LIKE 'CE448-%';
    DELETE FROM public.voyages WHERE id=${customer}; DELETE FROM public.vessels WHERE id=${customer}; DELETE FROM public.carriers WHERE id=${customer};
    DELETE FROM public.customers WHERE id=${customer};
    DELETE FROM public.user_profiles WHERE id='${admin}';
    DELETE FROM auth.users WHERE id IN('${client}','${admin}');
    SET session_replication_role=origin;`)
  beforeAll(() => {
    cleanup()
    sql(`INSERT INTO auth.users(id,email) VALUES('${client}','ce448@example.test'),('${admin}','ce448-admin@example.test');
      INSERT INTO public.user_profiles(id,full_name,role,active) VALUES('${admin}','CE448 admin','administrativo',true);
      INSERT INTO public.customers(id,cnpj_cpf,name) VALUES(${customer},'${syntheticCnpj(44801)}','CE 448');
      INSERT INTO public.carriers(id,name) VALUES(${customer},'CE448 carrier');
      INSERT INTO public.vessels(id,name,carrier_id) VALUES(${customer},'CE448 vessel',${customer});
      INSERT INTO public.voyages(id,vessel_id,voyage_number,status) VALUES(${customer},${customer},'CE-448','active');`)
  })
  afterAll(cleanup)

  for (const req of COMBINATIONS) {
    const all = req.paid && req.termo && req.procuracao && req.delivered
    it(`${label(req)} → ${all ? 'tem prazo' : 'sem prazo'}`, () => {
      const r = scenario(req)
      if (!all) {
        // Nenhuma tela do Portal ou do Vela recebe prazo enquanto falta requisito.
        expect(r).toMatchObject({ item: null, request: null, portal: null, ficha: null })
        return
      }
      expect(r.item).not.toBeNull()
      // O prazo parte do último requisito cumprido: aqui, a entrega do original (agora), depois do envio e das aprovações.
      expect(Date.parse(r.item!)).toBeGreaterThan(Date.parse(r.procuracao_at!))
      expect(Date.parse(r.item!)).toBeGreaterThan(Date.parse(r.submit!))
      expect(Date.parse(r.request!)).toBe(Date.parse(r.item!))
      expect(Date.parse(r.portal!)).toBe(Date.parse(r.item!))
      expect(Date.parse(r.ficha!)).toBe(Date.parse(r.item!))
    })
  }

  it('documentação validada pelo desk sem a entrega do original não dá prazo; registrar a entrega dá', () => {
    const before = scenario({ paid: true, termo: true, procuracao: true, delivered: false })
    expect(before.item).toBeNull()
    const after = scenario({ paid: true, termo: true, procuracao: true, delivered: true })
    expect(after.item).not.toBeNull()
  })

  it('cliente entregou o original e pediu, mas a documentação não foi validada: sem prazo', () => {
    expect(scenario({ paid: true, termo: false, procuracao: false, delivered: true })).toMatchObject({ item: null, portal: null })
    expect(scenario({ paid: true, termo: true, procuracao: false, delivered: true })).toMatchObject({ item: null, portal: null })
  })

  it('com dois B/Ls, um pronto e outro sem a entrega, a solicitação fica sem prazo', () => {
    const out = sql(`BEGIN;
      SET LOCAL session_replication_role=replica;
      INSERT INTO public.ce_unlock_requests(id,customer_id,source,state,created_by) VALUES('${request}',${customer},'request','in_review','${client}');
      INSERT INTO public.ce_unlock_documents(id,customer_id,request_id,type,source,status,storage_path,file_name,size_bytes,hash,uploaded_by,reviewed_at) VALUES
        ('${termo}',${customer},'${request}','termo','request','approved','p/t','t.pdf',10,repeat('a',64),'${client}',now()),
        ('${procuracao}',${customer},'${request}','procuracao','request','approved','p/p','p.pdf',10,repeat('b',64),'${client}',now());
      INSERT INTO public.ce_unlock_events(customer_id,request_id,action,actor_id) VALUES(${customer},'${request}','submit','${client}');
      INSERT INTO public.bls(id,voyage_id,customer_id,ce_mercante) VALUES('CE448-A',${customer},${customer},'998448000000101'),('CE448-B',${customer},${customer},'998448000000102');
      INSERT INTO public.bl_receivables(id,bl_id,customer_id,original_amount_brl,settled_amount_brl,balance_brl,status) VALUES(998448,'CE448-A',${customer},100,100,0,'settled'),(998449,'CE448-B',${customer},100,100,0,'settled');
      INSERT INTO public.ledger_settlements(receivable_id,amount_brl,source) VALUES(998448,100,'manual'),(998449,100,'manual');
      SET LOCAL session_replication_role=origin;
      INSERT INTO public.ce_unlock_request_bls(request_id,bl_id,ce_at_request,termo_document_id,procuracao_document_id,termo_approved,procuracao_approved) VALUES
        ('${request}','CE448-A','998448000000101','${termo}','${procuracao}',true,true),('${request}','CE448-B','998448000000102','${termo}','${procuracao}',true,true);
      INSERT INTO public.ce_unlock_bl_deliveries(bl_id,delivered) VALUES('CE448-A',true),('CE448-B',false);
      SELECT jsonb_build_object('a',ce_unlock_private.item('CE448-A','${request}')->>'sla_started_at','b',ce_unlock_private.item('CE448-B','${request}')->>'sla_started_at','request',ce_unlock_private.request_sla_start('${request}'));
      ROLLBACK;`)
    const r = JSON.parse(out.split('\n').at(-1) ?? 'null')
    expect(r.a).not.toBeNull()
    expect(r.b).toBeNull()
    expect(r.request).toBeNull()
  })

  // 450 (revisão final): exportado, o prazo fica; antes, o anual VIP que vence
  // na virada do ano ou a entrega desmarcada depois da exportação apagavam o
  // prazo e "Exportado no prazo" virava "Sem prazo".
  it('B/L exportado mantém o prazo quando um requisito cai depois, e a ficha recebe a exportação', () => {
    const exported = scenario({ paid: true, termo: true, procuracao: true, delivered: true },
      `UPDATE public.ce_unlock_request_bls SET exported_at=now()-interval '10 minutes', termo_approved=false WHERE bl_id='CE448-A';
       UPDATE public.ce_unlock_bl_deliveries SET delivered=false WHERE bl_id='CE448-A';`)
    expect(exported.item).not.toBeNull()
    expect(exported.request).not.toBeNull()
    expect(Date.parse(exported.ficha!)).toBe(Date.parse(exported.item!))
    expect(exported.ficha_exported_at).not.toBeNull()
    // Sem exportação, o mesmo requisito que cai tira o prazo (regra da 448).
    const pending = scenario({ paid: true, termo: true, procuracao: true, delivered: true },
      `UPDATE public.ce_unlock_request_bls SET termo_approved=false WHERE bl_id='CE448-A';`)
    expect(pending).toMatchObject({ item: null, request: null, ficha: null, ficha_exported_at: null })
  })

  // 450 (revisão final): a solicitação com A pronto há dias e B sem a entrega
  // só se completa quando B muda para outra solicitação (caminho A). Esse fato
  // não está na lista da 448; o prazo nascia três dias atrás, já vencido, e o
  // e-mail "documentação validada" saía com ele. A validação passa a ser fato.
  it('validação por fato fora da lista (B/L pendente muda de solicitação): o prazo parte da validação', () => {
    const out = sql(`BEGIN;
      SET LOCAL session_replication_role=replica;
      INSERT INTO public.ce_unlock_requests(id,customer_id,source,state,created_by) VALUES('${request}',${customer},'request','in_review','${client}');
      INSERT INTO public.ce_unlock_documents(id,customer_id,request_id,type,source,status,storage_path,file_name,size_bytes,hash,uploaded_by,reviewed_at) VALUES
        ('${termo}',${customer},'${request}','termo','request','approved','p/t','t.pdf',10,repeat('a',64),'${client}',now()-interval '3 days'),
        ('${procuracao}',${customer},'${request}','procuracao','request','approved','p/p','p.pdf',10,repeat('b',64),'${client}',now()-interval '3 days');
      INSERT INTO public.ce_unlock_events(customer_id,request_id,action,actor_id,created_at) VALUES(${customer},'${request}','submit','${client}',now()-interval '4 days');
      INSERT INTO public.bls(id,voyage_id,customer_id,ce_mercante) VALUES('CE448-A',${customer},${customer},'998448000000101'),('CE448-B',${customer},${customer},'998448000000102');
      INSERT INTO public.bl_receivables(id,bl_id,customer_id,original_amount_brl,settled_amount_brl,balance_brl,status) VALUES(998448,'CE448-A',${customer},100,100,0,'settled');
      INSERT INTO public.ledger_settlements(receivable_id,amount_brl,source,created_at) VALUES(998448,100,'manual',now()-interval '3 days');
      INSERT INTO public.ce_unlock_request_bls(request_id,bl_id,ce_at_request,termo_document_id,procuracao_document_id,termo_approved,procuracao_approved,active) VALUES
        ('${request}','CE448-A','998448000000101','${termo}','${procuracao}',true,true,true),
        ('${request}','CE448-B','998448000000102','${termo}','${procuracao}',true,true,false);
      INSERT INTO public.ce_unlock_bl_deliveries(bl_id,delivered,updated_at) VALUES('CE448-A',true,now()-interval '3 days'),('CE448-B',false,now()-interval '3 days');
      INSERT INTO public.ce_unlock_events(customer_id,request_id,bl_id,action,actor_id) VALUES(${customer},'${request}','CE448-B','bl_moved','${client}');
      SET LOCAL session_replication_role=origin;
      SELECT ce_unlock_private.refresh_completion('${request}');
      SELECT jsonb_build_object(
        'state', (SELECT state FROM public.ce_unlock_requests WHERE id='${request}'),
        'now', now(),
        'request', ce_unlock_private.request_sla_start('${request}'),
        'item', ce_unlock_private.item('CE448-A','${request}')->>'sla_started_at',
        'deadline', to_char(ce_unlock_private.sla_deadline(ce_unlock_private.request_sla_start('${request}')) AT TIME ZONE 'America/Sao_Paulo','DD/MM "às" HH24:MI'),
        'email', (SELECT string_agg(body,' | ') FROM public.ce_unlock_email_outbox WHERE request_id='${request}' AND kind='documentation_validated'));
      ROLLBACK;`)
    const r = JSON.parse(out.split('\n').at(-1) ?? 'null') as Record<string, string>
    expect(r.state).toBe('completed')
    // Sem a 450, request e item seriam de três dias atrás.
    expect(Date.parse(r.request)).toBe(Date.parse(r.now))
    expect(Date.parse(r.item)).toBe(Date.parse(r.now))
    expect(r.email).toContain(`Prazo para o desbloqueio: até ${r.deadline}`)
  })

  it('o aviso "documentação validada" (sino e e-mail) só sai com os quatro requisitos, com o prazo', () => {
    const notices = (req: Requirements) => sql(`BEGIN;
      SET LOCAL session_replication_role=replica;
      INSERT INTO public.ce_unlock_requests(id,customer_id,source,state,created_by) VALUES('${request}',${customer},'request','in_review','${client}');
      INSERT INTO public.ce_unlock_documents(id,customer_id,request_id,type,source,status,storage_path,file_name,size_bytes,hash,uploaded_by,reviewed_at) VALUES
        ('${termo}',${customer},'${request}','termo','request','approved','p/t','t.pdf',10,repeat('a',64),'${client}',now()),
        ('${procuracao}',${customer},'${request}','procuracao','request','approved','p/p','p.pdf',10,repeat('b',64),'${client}',now());
      INSERT INTO public.ce_unlock_events(customer_id,request_id,action,actor_id) VALUES(${customer},'${request}','submit','${client}');
      INSERT INTO public.bls(id,voyage_id,customer_id,ce_mercante) VALUES('CE448-A',${customer},${customer},'998448000000101');
      INSERT INTO public.bl_receivables(id,bl_id,customer_id,original_amount_brl,settled_amount_brl,balance_brl,status) VALUES(998448,'CE448-A',${customer},100,${req.paid ? 100 : 0},${req.paid ? 0 : 100},'${req.paid ? 'settled' : 'open'}');
      ${req.paid ? "INSERT INTO public.ledger_settlements(receivable_id,amount_brl,source) VALUES(998448,100,'manual');" : ''}
      SET LOCAL session_replication_role=origin;
      INSERT INTO public.ce_unlock_request_bls(request_id,bl_id,ce_at_request,termo_document_id,procuracao_document_id,termo_approved,procuracao_approved) VALUES('${request}','CE448-A','998448000000101','${termo}','${procuracao}',${req.termo},${req.procuracao});
      INSERT INTO public.ce_unlock_bl_deliveries(bl_id,delivered) VALUES('CE448-A',${req.delivered});
      SELECT ce_unlock_private.refresh_completion('${request}');
      SELECT coalesce(string_agg(body,' | '),'') FROM public.ce_unlock_email_outbox WHERE request_id='${request}' AND kind='documentation_validated';
      ROLLBACK;`).split('\n').at(-1) ?? ''
    for (const req of COMBINATIONS) {
      const body = notices(req)
      if (req.paid && req.termo && req.procuracao && req.delivered) expect(body, label(req)).toMatch(/Prazo para o desbloqueio: até \d{2}\/\d{2} às \d{2}:\d{2}/)
      else expect(body, label(req)).toBe('')
    }
  })
})

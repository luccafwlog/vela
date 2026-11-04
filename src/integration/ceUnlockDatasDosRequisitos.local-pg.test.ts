// Migration 590 (pedido do dono de 2026-11-04): a planilha comum do Desbloqueio
// de CE traz a data e a hora em que cada requisito se cumpriu. A leitura
// `requirement_dates` devolve, por B/L, a aprovação do termo e da procuração
// que contam para ele, a última baixa das Taxas Locais e a entrega do original.
// Cada cenário roda numa transação desfeita no fim.
import { execPsql } from './localPsql'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { syntheticCnpj } from './localTestData'

const db = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const local = process.env.LOCAL_PG_INTEGRATION === '1' ? describe : describe.skip
const customer = 998590
const client = '00000000-0000-0000-0000-000000590002'
const admin = '00000000-0000-0000-0000-000000590001'
const request = '00000000-0000-0000-0000-000000590100'
const termo = '00000000-0000-0000-0000-000000590101'
const procuracao = '00000000-0000-0000-0000-000000590102'

function sql(q: string): string {
  return execPsql(['-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: q, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    .replaceAll(String.fromCharCode(13), '').trim()
}

type Dates = { bl_id: string; termo_at: string | null; procuracao_at: string | null; paid_at: string | null; delivered_at: string | null }

/**
 * Solicitação no estado pedido, com o termo e a procuração aprovados em horários
 * fixos, a baixa e a entrega também fixas; devolve a leitura e o item do B/L.
 */
function scenario({ state = 'in_review', delivered = true, paid = true, termoApproved = true } = {}) {
  const out = sql(`BEGIN;
    SET LOCAL session_replication_role=replica;
    INSERT INTO public.ce_unlock_requests(id,customer_id,source,state,created_by) VALUES('${request}',${customer},'request','${state}','${client}');
    INSERT INTO public.ce_unlock_documents(id,customer_id,request_id,type,source,status,storage_path,file_name,size_bytes,hash,uploaded_by,reviewed_at) VALUES
      ('${termo}',${customer},'${request}','termo','request','${termoApproved ? 'approved' : 'changes_requested'}','p590/t','t.pdf',10,repeat('a',64),'${client}','2026-11-02 10:15:00-03'),
      ('${procuracao}',${customer},'${request}','procuracao','request','approved','p590/p','p.pdf',10,repeat('b',64),'${client}','2026-11-02 11:30:00-03');
    INSERT INTO public.bls(id,voyage_id,customer_id,ce_mercante) VALUES('CE590-A',${customer},${customer},'998590000000101');
    INSERT INTO public.bl_receivables(id,bl_id,customer_id,source,original_amount_brl,settled_amount_brl,balance_brl,status)
      VALUES(998590,'CE590-A',${customer},'local_charges',100,${paid ? 100 : 0},${paid ? 0 : 100},'${paid ? 'settled' : 'open'}');
    ${paid ? `INSERT INTO public.ledger_settlements(receivable_id,amount_brl,source,created_at) VALUES(998590,100,'manual','2026-11-03 14:45:00-03');` : ''}
    INSERT INTO public.ce_unlock_request_bls(request_id,bl_id,ce_at_request,termo_document_id,procuracao_document_id,termo_approved,procuracao_approved)
      VALUES('${request}','CE590-A','998590000000101','${termo}','${procuracao}',${termoApproved},true);
    INSERT INTO public.ce_unlock_bl_deliveries(bl_id,delivered,updated_at) VALUES('CE590-A',${delivered},'2026-11-03 16:20:00-03');
    SET LOCAL session_replication_role=origin;
    SET LOCAL request.jwt.claim.sub='${admin}';
    SELECT public.ce_unlock_read('requirement_dates', jsonb_build_object('bl_ids', jsonb_build_array('CE590-A','CE590-A','NAO-EXISTE')));
    ROLLBACK;`)
  return JSON.parse(out.split('\n').at(-1) ?? 'null') as Dates[]
}

local('desbloqueio CE — data e hora de cada requisito para a planilha (migration 590)', () => {
  const cleanup = () => sql(`SET session_replication_role=replica;
    DELETE FROM public.ce_unlock_request_bls WHERE bl_id LIKE 'CE590-%';
    DELETE FROM public.ce_unlock_documents WHERE customer_id=${customer};
    DELETE FROM public.ce_unlock_requests WHERE customer_id=${customer};
    DELETE FROM public.ce_unlock_bl_deliveries WHERE bl_id LIKE 'CE590-%';
    DELETE FROM public.ledger_settlements WHERE receivable_id=998590;
    DELETE FROM public.bl_receivables WHERE id=998590;
    DELETE FROM public.bls WHERE id LIKE 'CE590-%';
    DELETE FROM public.voyages WHERE id=${customer}; DELETE FROM public.vessels WHERE id=${customer}; DELETE FROM public.carriers WHERE id=${customer};
    DELETE FROM public.customers WHERE id=${customer};
    DELETE FROM public.user_profiles WHERE id='${admin}';
    DELETE FROM auth.users WHERE id IN('${client}','${admin}');
    SET session_replication_role=origin;`)
  beforeAll(() => {
    cleanup()
    sql(`INSERT INTO auth.users(id,email) VALUES('${client}','ce590@example.test'),('${admin}','ce590-admin@example.test');
      INSERT INTO public.user_profiles(id,full_name,role,active) VALUES('${admin}','CE590 financeiro','financeiro',true);
      INSERT INTO public.customers(id,cnpj_cpf,name) VALUES(${customer},'${syntheticCnpj(59001)}','CE 590');
      INSERT INTO public.carriers(id,name) VALUES(${customer},'CE590 carrier');
      INSERT INTO public.vessels(id,name,carrier_id) VALUES(${customer},'CE590 vessel',${customer});
      INSERT INTO public.voyages(id,vessel_id,voyage_number,status) VALUES(${customer},${customer},'CE-590','active');`)
  })
  afterAll(cleanup)

  it('solicitação em análise: aprovação de cada documento, a última baixa e a entrega, uma linha por B/L', () => {
    const rows = scenario()
    // B/L repetido sai uma vez; B/L que não existe não sai.
    expect(rows.map((row) => row.bl_id)).toEqual(['CE590-A'])
    const [row] = rows
    expect(Date.parse(row.termo_at!)).toBe(Date.parse('2026-11-02T10:15:00-03:00'))
    expect(Date.parse(row.procuracao_at!)).toBe(Date.parse('2026-11-02T11:30:00-03:00'))
    expect(Date.parse(row.paid_at!)).toBe(Date.parse('2026-11-03T14:45:00-03:00'))
    expect(Date.parse(row.delivered_at!)).toBe(Date.parse('2026-11-03T16:20:00-03:00'))
  })

  it('documento recusado, taxas sem baixa e original não entregue ficam sem data', () => {
    const [row] = scenario({ termoApproved: false, delivered: false, paid: false })
    expect(row.termo_at).toBeNull()
    expect(row.delivered_at).toBeNull()
    expect(row.paid_at).toBeNull()
    expect(row.procuracao_at).not.toBeNull()
  })

  it('rascunho não segura o B/L: sem anual VIP cobrindo, termo e procuração ficam sem data', () => {
    const [row] = scenario({ state: 'draft' })
    expect(row).toMatchObject({ termo_at: null, procuracao_at: null })
    expect(row.paid_at).not.toBeNull()
  })

  it('recusa lista que não é array ou com mais de 500 B/Ls', () => {
    const call = (payload: string) => () => sql(`BEGIN; SET LOCAL request.jwt.claim.sub='${admin}';
      SELECT public.ce_unlock_read('requirement_dates', ${payload}); ROLLBACK;`)
    expect(call(`'{"bl_ids":"CE590-A"}'::jsonb`)).toThrow(/Seleção inválida/)
    expect(call(`jsonb_build_object('bl_ids', (SELECT jsonb_agg('B'||g) FROM generate_series(1,501) g))`)).toThrow(/Seleção inválida/)
  })
})

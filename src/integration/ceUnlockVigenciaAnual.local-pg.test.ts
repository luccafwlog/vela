// Ponto 11 das observações de 2026-10-23 (migration 449): a vigência do termo
// e da procuração anuais vale só para os B/Ls importados no Vela dentro dela
// (bls.created_at, dia de Brasília). Não retroage: o B/L importado antes segue
// com termo e procuração anexados à solicitação.
import { execPsql } from './localPsql'
import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'vitest'
import { syntheticCnpj } from './localTestData'

const db = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const local = process.env.LOCAL_PG_INTEGRATION === '1' ? describe : describe.skip
const admin = '00000000-0000-0000-0000-000000449001'
const client = '00000000-0000-0000-0000-000000449002'
const C = 998449
function sql(q: string, uid?: string): string {
  return execPsql(['-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: uid ? `SET ROLE authenticated; SET request.jwt.claim.sub='${uid}'; ${q}` : q, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).replaceAll(String.fromCharCode(13), '').trim()
}
function error(q: string, uid?: string) { try { sql(q, uid); return '' } catch (e) { return String((e as { stderr: string }).stderr) } }
const key = () => crypto.randomUUID()
const command = (action: string, payload: object, uid = admin) => JSON.parse(sql(`SELECT public.${uid === admin ? '' : 'portal_'}ce_unlock_command('${action}', '${JSON.stringify(payload)}'::jsonb);`, uid))
const commandError = (action: string, payload: object, uid = admin) => error(`SELECT public.${uid === admin ? '' : 'portal_'}ce_unlock_command('${action}', '${JSON.stringify(payload)}'::jsonb);`, uid)
const item = (bl: string, request?: string) => JSON.parse(sql(`SELECT ce_unlock_private.item('${bl}'${request ? `,'${request}'` : ''});`))
const Y = () => Number(sql('SELECT extract(year FROM ce_unlock_private.today())::int;'))

function annual(type: 'termo' | 'procuracao', year: number, validFrom = `${year}-01-01`): string {
  const id = sql(`INSERT INTO public.ce_unlock_documents(customer_id,type,source,status,file_name,storage_path,size_bytes,hash,uploaded_by,created_at)
    VALUES(${C},'${type}','vip_annual','uploaded','${type}.pdf','ce449/'||gen_random_uuid(),100,repeat('e',64),'${client}',clock_timestamp()) RETURNING id;`)
  command('review', { document_id: id, expected_document_version: 0, decision: 'approved', coverage_year: year, valid_from: validFrom, valid_until: `${year}-12-31`, request_key: key() })
  return id
}

local('desbloqueio CE — vigência do termo anual pela data de importação do B/L (migration 449)', () => {
  const reset = () => sql(`SET session_replication_role=replica;
    DELETE FROM ce_unlock_private.receipts WHERE actor_id IN ('${admin}','${client}');
    DELETE FROM public.ce_unlock_email_outbox WHERE customer_id=${C};
    DELETE FROM public.portal_notifications WHERE customer_id=${C};
    DELETE FROM public.ce_unlock_events WHERE customer_id=${C} OR bl_id LIKE 'CE449-%';
    DELETE FROM public.ce_unlock_request_bls WHERE bl_id LIKE 'CE449-%';
    DELETE FROM public.ce_unlock_documents WHERE customer_id=${C};
    DELETE FROM public.ce_unlock_requests WHERE customer_id=${C};
    DELETE FROM public.ce_unlock_vip_customers WHERE customer_id=${C};
    DELETE FROM public.ce_unlock_bl_deliveries WHERE bl_id LIKE 'CE449-%';
    SET session_replication_role=origin;`)
  beforeAll(() => {
    reset()
    const y = new Date().getFullYear()
    sql(`INSERT INTO auth.users(id,email) VALUES ('${admin}','ce449-admin@example.test'),('${client}','ce449@example.test') ON CONFLICT DO NOTHING;
      INSERT INTO public.user_profiles(id,full_name,role,active) VALUES ('${admin}','CE449 admin','administrativo',true) ON CONFLICT DO NOTHING;
      INSERT INTO public.customers(id,cnpj_cpf,name) VALUES (${C},'${syntheticCnpj(44901)}','CE449') ON CONFLICT DO NOTHING;
      INSERT INTO public.customer_portal_accounts(customer_id,auth_user_id,active,account_situation) VALUES(${C},'${client}',true,'ativo') ON CONFLICT(customer_id) DO UPDATE SET auth_user_id=EXCLUDED.auth_user_id,active=true;
      INSERT INTO public.carriers(id,name) VALUES(${C},'CE449 carrier') ON CONFLICT DO NOTHING;
      INSERT INTO public.vessels(id,name,carrier_id) VALUES(${C},'CE449 vessel',${C}) ON CONFLICT DO NOTHING;
      INSERT INTO public.voyages(id,vessel_id,voyage_number,status) VALUES(${C},${C},'CE-449','active') ON CONFLICT DO NOTHING;
      SET session_replication_role=replica;
      -- O exemplo do pedido: B/L importado em 20/12 do ano anterior e outro já neste ano.
      INSERT INTO public.bls(id,voyage_id,customer_id,ce_mercante,created_at) VALUES
        ('CE449-DEZ',${C},${C},'998449000000001','${y - 1}-12-20T15:00:00-03:00'),
        ('CE449-JAN',${C},${C},'998449000000002','${y}-01-02T09:00:00-03:00'),
        ('CE449-VIRADA',${C},${C},'998449000000003','${y}-01-01T00:30:00-03:00')
        ON CONFLICT(id) DO UPDATE SET customer_id=EXCLUDED.customer_id,ce_mercante=EXCLUDED.ce_mercante,created_at=EXCLUDED.created_at,cancelled_at=NULL;
      INSERT INTO public.bl_receivables(id,bl_id,customer_id,original_amount_brl,settled_amount_brl,balance_brl,status) VALUES
        (998449,'CE449-DEZ',${C},100,100,0,'settled'),(998450,'CE449-JAN',${C},100,100,0,'settled'),(998451,'CE449-VIRADA',${C},100,100,0,'settled') ON CONFLICT DO NOTHING;
      INSERT INTO public.ledger_settlements(receivable_id,amount_brl,source) SELECT x,100,'manual' FROM unnest(ARRAY[998449,998450,998451]) x
        WHERE NOT EXISTS(SELECT 1 FROM public.ledger_settlements s WHERE s.receivable_id=x);
      SET session_replication_role=origin;`)
  })
  beforeEach(reset)
  afterAll(() => {
    reset()
    sql(`SET session_replication_role=replica;
      DELETE FROM public.ledger_settlements WHERE receivable_id IN(998449,998450,998451);
      DELETE FROM public.bl_receivables WHERE id IN(998449,998450,998451);
      DELETE FROM public.bls WHERE id LIKE 'CE449-%';
      DELETE FROM public.customer_portal_accounts WHERE customer_id=${C};
      DELETE FROM public.voyages WHERE id=${C}; DELETE FROM public.vessels WHERE id=${C}; DELETE FROM public.carriers WHERE id=${C};
      DELETE FROM public.customers WHERE id=${C};
      DELETE FROM public.user_profiles WHERE id='${admin}';
      DELETE FROM auth.users WHERE id IN('${admin}','${client}');
      SET session_replication_role=origin;`)
  })

  it('B/L importado em 20/12, antes do anual do ano novo, não ganha a condição VIP: segue com termo e procuração do pedido', () => {
    const y = Y()
    command('set_vip', { customer_id: C, enabled: true, reason: 'VIP desde a virada', request_key: key() })
    annual('termo', y); annual('procuracao', y)
    // O anual é deste ano: cobre o B/L de janeiro e o da virada (00:30 de Brasília), não o de dezembro.
    expect(item('CE449-DEZ')).toMatchObject({ vip: true, vip_covered: false })
    expect(item('CE449-JAN')).toMatchObject({ vip: true, vip_covered: true })
    expect(item('CE449-VIRADA')).toMatchObject({ vip_covered: true })

    const old = command('draft', { bl_ids: ['CE449-DEZ'], request_key: key() }, client)
    expect(old.source).toBe('request')
    expect(commandError('submit', { request_id: old.id, expected_version: old.version, request_key: key() }, client)).toContain('Anexe versões atuais')
    command('cancel', { request_id: old.id, expected_version: old.version, request_key: key() }, client)

    const current = command('draft', { bl_ids: ['CE449-JAN'], request_key: key() }, client)
    expect(current.source).toBe('vip_annual')
    const sent = command('submit', { request_id: current.id, expected_version: current.version, request_key: key() }, client)
    expect(sent.items[0]).toMatchObject({ termo: true, procuracao: true })
  })

  it('pedido com um B/L de antes e outro de depois da vigência segue inteiro como pedido comum', () => {
    const y = Y()
    command('set_vip', { customer_id: C, enabled: true, reason: 'VIP', request_key: key() })
    annual('termo', y); annual('procuracao', y)
    const mixed = command('draft', { bl_ids: ['CE449-DEZ', 'CE449-JAN'], request_key: key() }, client)
    expect(mixed.source).toBe('request')
  })

  it('renovação com início no meio do ano não cobre o que entrou antes dela, e o pedido VIP antigo perde o B/L sem cobertura', () => {
    const y = Y()
    command('set_vip', { customer_id: C, enabled: true, reason: 'VIP', request_key: key() })
    const termo = annual('termo', y); const procuracao = annual('procuracao', y)
    const draft = command('draft', { bl_ids: ['CE449-JAN'], request_key: key() }, client)
    const sent = command('submit', { request_id: draft.id, expected_version: draft.version, request_key: key() }, client)
    expect(sent.items[0]).toMatchObject({ termo: true, procuracao: true })
    // A vigência passa a começar depois da importação do B/L: deixa de cobrir (não retroage).
    sql(`UPDATE public.ce_unlock_documents SET valid_from=make_date(${y},1,10) WHERE id IN('${termo}','${procuracao}');`)
    expect(item('CE449-JAN', draft.id)).toMatchObject({ termo: false, procuracao: false, vip_covered: false })
    expect(item('CE449-JAN', draft.id).reasons).toContain('Procuração pendente, vencida ou revogada')
  })

  it('o banco usa a data de importação, não a de hoje nem a da reimportação', () => {
    const y = Y()
    expect(sql("SELECT ce_unlock_private.bl_import_day('CE449-DEZ');")).toBe(`${y - 1}-12-20`)
    // 00:30 de 01/01 em Brasília ainda é 31/12 em UTC: vale o dia de Brasília.
    expect(sql("SELECT ce_unlock_private.bl_import_day('CE449-VIRADA');")).toBe(`${y}-01-01`)
  })
})

// Vigência do termo e da procuração anuais. Desde a migration 479 (decisão do
// dono de 2026-10-27, ficha 08-desbloqueio-ce:4; ADR 0110) o anual cobre todo
// CE cujo desbloqueio foi solicitado dentro da vigência (dia de Brasília do
// envio; antes do envio, hoje), sem olhar a importação do B/L nem o vínculo do
// CE, e continua cobrindo depois de vencer o que foi solicitado nela. O dia do
// vínculo do CE (`ce_link_day`, migrations 449, 456 e 460) segue calculado, mas
// não decide mais a cobertura.
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
const item = (bl: string, request?: string) => JSON.parse(sql(`SELECT ce_unlock_private.item('${bl}'${request ? `,'${request}'` : ''});`))
const Y = () => Number(sql('SELECT extract(year FROM ce_unlock_private.today())::int;'))

function annual(type: 'termo' | 'procuracao', year: number, validFrom = `${year}-01-01`): string {
  const id = sql(`INSERT INTO public.ce_unlock_documents(customer_id,type,source,status,file_name,storage_path,size_bytes,hash,uploaded_by,created_at)
    VALUES(${C},'${type}','vip_annual','uploaded','${type}.pdf','ce449/'||gen_random_uuid(),100,repeat('e',64),'${client}',clock_timestamp()) RETURNING id;`)
  command('review', { document_id: id, expected_document_version: 0, decision: 'approved', coverage_year: year, valid_from: validFrom, valid_until: `${year}-12-31`, request_key: key() })
  return id
}

local('desbloqueio CE — vigência do termo anual pela data da solicitação (migration 479)', () => {
  const reset = () => sql(`SET session_replication_role=replica;
    DELETE FROM ce_unlock_private.receipts WHERE actor_id IN ('${admin}','${client}');
    -- Sem isto, rodar a suíte de novo em 24 h esbarra no limite de 20 uploads do Cliente.
    DELETE FROM ce_unlock_private.upload_attempts WHERE customer_id=${C};
    DELETE FROM public.ce_unlock_email_outbox WHERE customer_id=${C};
    DELETE FROM public.portal_notifications WHERE customer_id=${C};
    DELETE FROM public.ce_unlock_events WHERE customer_id=${C} OR bl_id LIKE 'CE449-%';
    DELETE FROM public.ce_unlock_request_bls WHERE bl_id LIKE 'CE449-%';
    DELETE FROM public.ce_unlock_documents WHERE customer_id=${C};
    DELETE FROM public.ce_unlock_requests WHERE customer_id=${C};
    DELETE FROM public.ce_unlock_vip_customers WHERE customer_id=${C};
    DELETE FROM public.ce_unlock_bl_deliveries WHERE bl_id LIKE 'CE449-%';
    DELETE FROM public.audit_logs WHERE entity_type IN ('bl','bls') AND entity_id='CE449-LIGADO' AND field_name='ce_mercante';
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
      -- O exemplo do pedido: B/L que nasceu com o CE em 20/12 do ano anterior e outro já neste ano.
      -- CE449-LIGADO foi importado em 20/12 do ano anterior; o vínculo do CE vem da auditoria, por teste.
      INSERT INTO public.bls(id,voyage_id,customer_id,ce_mercante,created_at) VALUES
        ('CE449-DEZ',${C},${C},'998449000000001','${y - 1}-12-20T15:00:00-03:00'),
        ('CE449-JAN',${C},${C},'998449000000002','${y}-01-02T09:00:00-03:00'),
        ('CE449-VIRADA',${C},${C},'998449000000003','${y}-01-01T00:30:00-03:00'),
        -- 22:30 de 31/12 em Brasília já é 01/01 em UTC: só o dia de Brasília o deixa fora do anual novo.
        ('CE449-REVEILLON',${C},${C},'998449000000004','${y - 1}-12-31T22:30:00-03:00'),
        ('CE449-LIGADO',${C},${C},'998449000000005','${y - 1}-12-20T15:00:00-03:00')
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

  // Pedido enviado no ano anterior, com o B/L dele, para fixar o dia da solicitação.
  function requestSubmittedLastYear(bl: string, termo?: string, procuracao?: string): string {
    const y = Y()
    const request = sql(`SET session_replication_role=replica;
      INSERT INTO public.ce_unlock_requests(customer_id,source,state,created_by,created_at) VALUES(${C},'vip_annual','submitted','${client}','${y - 1}-12-20T10:00:00-03:00') RETURNING id;`)
    sql(`SET session_replication_role=replica;
      INSERT INTO public.ce_unlock_request_bls(request_id,bl_id,ce_at_request,termo_document_id,procuracao_document_id)
        SELECT '${request}', id, ce_mercante, ${termo ? `'${termo}'` : 'NULL'}, ${procuracao ? `'${procuracao}'` : 'NULL'} FROM public.bls WHERE id='${bl}';
      INSERT INTO public.ce_unlock_events(customer_id,request_id,action,actor_id,created_at) VALUES(${C},'${request}','submit','${client}','${y - 1}-12-20T10:00:00-03:00');`)
    return request
  }

  it('o anual vigente cobre qualquer B/L pedido agora, importado ou com o CE vinculado antes da vigência', () => {
    const y = Y()
    command('set_vip', { customer_id: C, enabled: true, reason: 'VIP', request_key: key() })
    annual('termo', y); annual('procuracao', y)
    for (const bl of ['CE449-DEZ', 'CE449-JAN', 'CE449-VIRADA', 'CE449-REVEILLON']) {
      expect(item(bl), bl).toMatchObject({ vip: true, vip_covered: true })
    }
    const mixed = command('draft', { bl_ids: ['CE449-DEZ', 'CE449-JAN'], request_key: key() }, client)
    expect(mixed.source).toBe('vip_annual')
    const sent = command('submit', { request_id: mixed.id, expected_version: mixed.version, request_key: key() }, client)
    expect(sent.items.map((row: { termo: boolean; procuracao: boolean }) => [row.termo, row.procuracao])).toEqual([[true, true], [true, true]])
  })

  it('pedido enviado antes da vigência não é coberto pelo anual novo', () => {
    const y = Y()
    command('set_vip', { customer_id: C, enabled: true, reason: 'VIP', request_key: key() })
    annual('termo', y); annual('procuracao', y)
    const request = requestSubmittedLastYear('CE449-JAN')
    expect(sql("SELECT ce_unlock_private.request_day('CE449-JAN');")).toBe(`${y - 1}-12-20`)
    expect(item('CE449-JAN', request)).toMatchObject({ termo: false, procuracao: false, vip_covered: false })
  })

  // Ponto 13 de 2026-10-23: VIP com procuração anual inválida, vencida ou faltando abre a
  // solicitação comum e anexa o termo de procuração comum; o VIP coberto continua sem anexo avulso.
  it('VIP com procuração anual vencida, recusada ou faltando anexa a procuração comum; VIP coberto segue sem anexo avulso', () => {
    const y = Y()
    const prepare = (requestId: string, type: string) => `SELECT public.ce_unlock_prepare_upload(jsonb_build_object('source','request','type','${type}','request_id','${requestId}','file_name','${type}.pdf','size_bytes',100))->>'storage_path';`
    command('set_vip', { customer_id: C, enabled: true, reason: 'VIP', request_key: key() })
    annual('termo', y)
    const cases: Array<[string, () => void]> = [
      ['faltando', () => {}],
      ['vencida', () => { annual('procuracao', y - 1) }],
      ['recusada', () => {
        const id = sql(`INSERT INTO public.ce_unlock_documents(customer_id,type,source,status,file_name,storage_path,size_bytes,hash,uploaded_by)
          VALUES(${C},'procuracao','vip_annual','uploaded','p.pdf','ce449/'||gen_random_uuid(),100,repeat('f',64),'${client}') RETURNING id;`)
        command('review', { document_id: id, expected_document_version: 0, decision: 'changes_requested', reason: 'Assinatura ilegível', request_key: key() })
      }],
    ]
    for (const [label, setup] of cases) {
      sql(`DELETE FROM public.ce_unlock_documents WHERE customer_id=${C} AND type='procuracao';`)
      setup()
      const draft = command('draft', { bl_ids: ['CE449-JAN'], request_key: key() }, client)
      expect(draft.source, label).toBe('request')
      expect(sql(prepare(draft.id, 'procuracao'), client), label).toMatch(/\.pdf$/)
      expect(sql(prepare(draft.id, 'termo'), client), label).toMatch(/\.pdf$/)
      const current = JSON.parse(sql(`SELECT public.portal_get_ce_unlock_request('${draft.id}');`, client))
      command('cancel', { request_id: draft.id, expected_version: current.version, request_key: key() }, client)
    }
    sql(`DELETE FROM public.ce_unlock_documents WHERE customer_id=${C} AND type='procuracao';`)
    annual('procuracao', y)
    const vipDraft = command('draft', { bl_ids: ['CE449-JAN'], request_key: key() }, client)
    expect(vipDraft.source).toBe('vip_annual')
    expect(error(prepare(vipDraft.id, 'procuracao'), client)).toContain('Pedido não aceita anexos')
  })

  it('anual vencido continua cobrindo o que foi solicitado na vigência dele; revogado não cobre', () => {
    const y = Y()
    command('set_vip', { customer_id: C, enabled: true, reason: 'VIP do ano passado', request_key: key() })
    const termo = annual('termo', y - 1); const procuracao = annual('procuracao', y - 1)
    // Pedido de agora: o anual do ano passado não cobre.
    expect(item('CE449-DEZ')).toMatchObject({ vip_covered: false })
    const request = requestSubmittedLastYear('CE449-DEZ', termo, procuracao)
    expect(item('CE449-DEZ', request)).toMatchObject({ vip: true, vip_covered: true, termo: true, procuracao: true })
    sql(`UPDATE public.ce_unlock_documents SET status='revoked' WHERE id='${termo}';`)
    expect(item('CE449-DEZ', request)).toMatchObject({ termo: false, vip_covered: false })
  })

  it('limpeza não expurga o anual vencido que ainda cobre B/L pendente; expurga quando não cobre mais', () => {
    const y = Y()
    const candidates = () => (JSON.parse(sql('SELECT public.ce_unlock_cleanup_candidates();')) as Array<{ id: string }>).map((c) => c.id)
    command('set_vip', { customer_id: C, enabled: true, reason: 'VIP', request_key: key() })
    const oldTermo = annual('termo', y - 1); const oldProcuracao = annual('procuracao', y - 1)
    annual('termo', y); annual('procuracao', y)
    requestSubmittedLastYear('CE449-DEZ', oldTermo, oldProcuracao)
    expect(candidates()).not.toContain(oldTermo)
    sql(`UPDATE public.ce_unlock_documents SET coverage_year=${y - 2},valid_from=make_date(${y - 2},1,1),valid_until=make_date(${y - 2},12,31) WHERE id='${oldTermo}';`)
    expect(candidates()).toContain(oldTermo)
  })

  it('limpeza guarda o anual vencido que cobre B/L exportado e ainda não conferido; conferido, expurga', () => {
    const y = Y()
    const candidates = () => (JSON.parse(sql('SELECT public.ce_unlock_cleanup_candidates();')) as Array<{ id: string }>).map((c) => c.id)
    command('set_vip', { customer_id: C, enabled: true, reason: 'VIP', request_key: key() })
    const oldTermo = annual('termo', y - 1); const oldProcuracao = annual('procuracao', y - 1)
    annual('termo', y); annual('procuracao', y)
    requestSubmittedLastYear('CE449-DEZ', oldTermo, oldProcuracao)
    sql(`SET session_replication_role=replica; UPDATE public.ce_unlock_request_bls SET exported_at=now()-interval '1 day' WHERE bl_id='CE449-DEZ';`)
    expect(candidates()).not.toContain(oldTermo)
    sql(`SET session_replication_role=replica; UPDATE public.ce_unlock_request_bls SET confirmed_at=now() WHERE bl_id='CE449-DEZ';`)
    expect(candidates()).toContain(oldTermo)
  })

  // 479 (08-desbloqueio-ce:2 e 5): a ficha lista as solicitações VIP sem o B/L movido, e a
  // Inspeção mostra os documentos a todos os setores.
  it('ficha do Cliente lista a solicitação VIP; Inspeção mostra os documentos a todos os setores', () => {
    const y = Y()
    command('set_vip', { customer_id: C, enabled: true, reason: 'VIP', request_key: key() })
    annual('termo', y); annual('procuracao', y)
    const vip = command('draft', { bl_ids: ['CE449-JAN'], request_key: key() }, client)
    expect(vip.source).toBe('vip_annual')
    const list = JSON.parse(sql(`SELECT public.ce_unlock_customer_requests(${C});`, admin))
    expect(list.items).toEqual([expect.objectContaining({ id: vip.id, source: 'vip_annual', bl_ids: ['CE449-JAN'] })])
    for (const name of ['portal_inspect_get_ce_unlock_request', 'portal_inspect_get_ce_unlock_vip_coverage']) {
      const body = sql(`SELECT prosrc FROM pg_proc WHERE proname = '${name}';`)
      expect(body, name).not.toContain("IN('administrativo','documentacao')")
    }
  })

  // 460: um B/L excluído e importado de novo com o mesmo número não herda o vínculo do CE do antigo.
  it('vínculo do CE ignora a auditoria anterior à criação do B/L atual', () => {
    const y = Y()
    const day = () => sql("SELECT ce_unlock_private.ce_link_day('CE449-LIGADO');")
    // Troca para o CE atual registrada antes de 20/12 do ano anterior, quando o B/L atual foi criado.
    sql(`INSERT INTO public.audit_logs(entity_type,entity_id,field_name,old_value,new_value,changed_at)
      VALUES('bls','CE449-LIGADO','ce_mercante','998449000000077','998449000000005','${y - 1}-06-01T10:00:00-03:00');`)
    expect(day()).toBe(`${y - 1}-12-20`)
  })

  it('vale o vínculo do CE atual: CE vinculado depois da importação, troca de número e reformatação', () => {
    const y = Y()
    const day = () => sql("SELECT ce_unlock_private.ce_link_day('CE449-LIGADO');")
    const audit = (entity: string, oldCe: string, newCe: string, at: string) => sql(`INSERT INTO public.audit_logs(entity_type,entity_id,field_name,old_value,new_value,changed_at)
      VALUES('${entity}','CE449-LIGADO','ce_mercante','${oldCe}','${newCe}','${at}');`)
    // Sem registro de troca, o B/L nasceu com o CE: vale a criação (20/12 do ano anterior).
    expect(day()).toBe(`${y - 1}-12-20`)
    // Importado em dezembro sem CE; o CE chegou em 05/01 pela importação (registro explícito, entidade bl).
    audit('bl', '', '998449000000005', `${y}-01-05T10:00:00-03:00`)
    expect(day()).toBe(`${y}-01-05`)
    // Reformatar o mesmo número (mesma chave) não muda o vínculo.
    audit('bls', '998449000000005', '998.449.000.000.005', `${y}-02-01T10:00:00-03:00`)
    expect(day()).toBe(`${y}-01-05`)
    // Trocar o número muda: vale a troca para o CE atual.
    audit('bls', '998449000000099', '998449000000005', `${y}-03-01T10:00:00-03:00`)
    expect(day()).toBe(`${y}-03-01`)
  })

  it('o banco usa o dia do vínculo do CE em Brasília, não o de hoje nem o de UTC', () => {
    const y = Y()
    expect(sql("SELECT ce_unlock_private.ce_link_day('CE449-DEZ');")).toBe(`${y - 1}-12-20`)
    expect(sql("SELECT ce_unlock_private.ce_link_day('CE449-VIRADA');")).toBe(`${y}-01-01`)
    // 22:30 de 31/12 em Brasília é 01:30 de 01/01 em UTC: vale o dia de Brasília.
    expect(sql("SELECT ce_unlock_private.ce_link_day('CE449-REVEILLON');")).toBe(`${y - 1}-12-31`)
  })
})

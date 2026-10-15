import { spawn } from 'node:child_process'
import { execPsql } from './localPsql'
import { describe, expect, it, beforeAll } from 'vitest'
// Matriz complementar do Desbloqueio de CE (plano 2026-10-04): comandos reais, fixture própria
// (Clientes 998600/998601, B/Ls CE600-*, usuários ...600xxx) e limpeza própria no beforeAll.
const db = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const local = process.env.LOCAL_PG_INTEGRATION === '1' ? describe : describe.skip
const admin = '00000000-0000-0000-0000-000000600001'
const client = '00000000-0000-0000-0000-000000600002'
const foreign = '00000000-0000-0000-0000-000000600003'
const finance = '00000000-0000-0000-0000-000000600004'
function sql(q:string, uid?:string):string {
  // SQL por stdin: argv do psql no Windows corrompe acentos.
  return execPsql(['-X','-Atq','-v','ON_ERROR_STOP=1','-d',db,'-f','-'],{input:uid ? `SET ROLE authenticated; SET request.jwt.claim.sub='${uid}'; ${q}` : q,encoding:'utf8',stdio:['pipe','pipe','pipe']}).replaceAll(String.fromCharCode(13),'').trim()
}
function rawError(q:string) { try {sql(q);return ''} catch(e) {return String((e as {stderr:string}).stderr)} }
const key = () => crypto.randomUUID()
const command = (action:string, payload:object, uid=admin) => JSON.parse(sql(`SELECT public.${uid===client?'portal_':''}ce_unlock_command('${action}', '${JSON.stringify(payload)}'::jsonb);`, uid))
async function heldTransaction(q:string) {
  const process = spawn('psql',['-X','-Atq','-v','ON_ERROR_STOP=1','-d',db,'-f','-'],{stdio:['pipe','pipe','pipe']})
  const done = new Promise<void>((resolve,reject)=> { let stderr=''; process.stderr.on('data',c=>{stderr+=c}); process.on('exit',code => code===0 ? resolve() : reject(new Error('Worker SQL failed: '+stderr))); process.on('error',reject) })
  process.stdin.end(q.replaceAll(';', ';\n'))
  await new Promise<void>((resolve,reject)=> { process.stdout.on('data',chunk=> { if(String(chunk).includes('LOCKED')) resolve() }); process.on('error',reject) })
  return { done }
}
type Item = { bl_id:string; paid:boolean; can_submit:boolean; can_export:boolean; termo:boolean; procuracao:boolean; delivered:boolean; state:string; reasons:string[]; delivery_version:number; export_state:string; request_id:string|null }
const item = (bl:string):Item => JSON.parse(sql(`SELECT ce_unlock_private.item('${bl}');`))
const version = (id:string) => Number(sql(`SELECT version FROM public.ce_unlock_requests WHERE id='${id}';`))
const ids = (r:{items:Array<{bl_id:string}>}) => r.items.map(i=>i.bl_id)
const deskList = (filters:object, page=1) => JSON.parse(sql(`SELECT public.ce_unlock_read('bls','${JSON.stringify({filters,page})}'::jsonb);`, admin))
const portalList = (filters:object, page=1, uid=client) => JSON.parse(sql(`SELECT public.portal_list_ce_unlock_bls('${JSON.stringify(filters)}'::jsonb,${page});`, uid))
const exportBls = (bls:string[], request_key=key()) => command('export',{bl_ids:bls,request_key})
function deliver(bl:string, delivered:boolean) {
  return command('delivery',{bl_id:bl,delivered,reason:delivered?undefined:'Original devolvido para conferência',expected_version:item(bl).delivery_version,request_key:key()})
}
function attachDocs(requestId:string) {
  sql(`INSERT INTO public.ce_unlock_documents(customer_id,request_id,type,source,status,file_name,storage_path,size_bytes,hash,uploaded_by) VALUES
    (998600,'${requestId}','termo','request','uploaded','termo.pdf','matriz/termo-${requestId}',10,'hash','${client}'),
    (998600,'${requestId}','procuracao','request','uploaded','proc.pdf','matriz/proc-${requestId}',10,'hash','${client}');`)
}
// Decisão do desk sobre o documento atual do tipo, pelo comando real.
function review(requestId:string, type:'termo'|'procuracao', decision:'approved'|'changes_requested') {
  const [id, docVersion] = sql(`SELECT id||'|'||version FROM public.ce_unlock_documents WHERE request_id='${requestId}' AND type='${type}' ORDER BY created_at DESC LIMIT 1;`).split('|')
  return command('review',{request_id:requestId,expected_version:version(requestId),document_id:id,expected_document_version:Number(docVersion),decision,reason:decision==='approved'?undefined:`${type} ilegível`,request_key:key()})
}
// Pedido enviado pelo Portal, documentos aprovados e originais entregues (exceto `undelivered`).
function readyRequest(bls:string[], undelivered:string[]=[]) {
  const draft = command('draft',{bl_ids:bls,request_key:key()},client)
  attachDocs(draft.id)
  command('submit',{request_id:draft.id,expected_version:draft.version,request_key:key()},client)
  review(draft.id,'termo','approved')
  review(draft.id,'procuracao','approved')
  for (const bl of bls) if (!undelivered.includes(bl)) deliver(bl,true)
  return draft.id as string
}
// Fatura individual aberta do B/L, para baixa e cancelamento de baixa pelos comandos do financeiro.
function invoiceFixture(bl:string, id:number, ce:string) {
  sql(`SET session_replication_role=replica;
    INSERT INTO public.bls(id,voyage_id,customer_id,ce_mercante) VALUES('${bl}',998600,998600,'${ce}');
    INSERT INTO public.bl_receivables(id,bl_id,customer_id,source,original_amount_brl,settled_amount_brl,balance_brl,status,voyage_id) VALUES(${id},'${bl}',998600,'local_charges',100,0,100,'open',998600);
    INSERT INTO public.invoices(id,invoice_number,customer_id,bl_id,total_brl,total_paid_brl,balance_brl,status,invoice_type,issued_by) VALUES(${id},'${bl}-IND',998600,'${bl}',100,0,100,'issued','individual','${admin}');
    INSERT INTO public.invoice_bls(invoice_id,bl_id,subtotal_brl) VALUES(${id},'${bl}',100);
    INSERT INTO public.invoice_receivable_links(invoice_id,receivable_id,bl_id,subtotal_brl,status) VALUES(${id},${id},'${bl}',100,'active');
    SET session_replication_role=origin;`)
}
const pay = (id:number, note:string) => JSON.parse(sql(`SELECT public.register_ledger_invoice_payment(${id},100,'ted',now(),NULL,'manual','${note}',NULL);`, admin)).payment_id as number
const reverse = (paymentId:number) => sql(`SELECT public.reverse_invoice_payment(${paymentId},'Baixa lançada por engano',NULL);`, admin)

const pages = Array.from({length:30},(_,n)=>String(n+1).padStart(2,'0'))
// B/L isento sem recebível: pagamento atendido sem fatura (ADR 0087, item 2).
const exemptBls: Array<[string,string|null,number]> = [
  ['CE600-NOCE',null,998600],['CE600-COD','600600000000002',998600],['CE600-DUP','600600000000003',998600],['CE600-SUB','600600000000004',998600],
  ['CE600-CANC','600600000000005',998600],['CE600-CORR','600600000000006',998600],['CE600-REM','600600000000007',998600],['CE600-SNAP','600600000000008',998600],
  ['CE600-L-NOREQ','600600000000010',998600],['CE600-L-MIX1','600600000000011',998600],['CE600-L-MIX2','600600000000012',998600],['CE600-L-NOCE',null,998600],['CE600-L-FOREIGN','600600000000013',998601],
  ...pages.map((n):[string,string,number]=>[`CE600-PG-${n}`,`6006010000000${n}`,998600]),
]

local('desbloqueio CE — matriz SQL de requisitos, filtros e concorrência',()=>{
  beforeAll(()=> {
    sql(`BEGIN; SET LOCAL session_replication_role=replica;
      CREATE TEMP TABLE r600 ON COMMIT DROP AS SELECT request_id AS id FROM public.ce_unlock_request_bls WHERE bl_id LIKE 'CE600-%' UNION SELECT id FROM public.ce_unlock_requests WHERE customer_id IN(998600,998601);
      DELETE FROM ce_unlock_private.receipts WHERE actor_id IN('${admin}','${client}','${foreign}','${finance}');
      DELETE FROM public.ce_unlock_email_outbox WHERE request_id IN(SELECT id FROM r600);
      DELETE FROM public.ce_unlock_events WHERE request_id IN(SELECT id FROM r600) OR customer_id IN(998600,998601) OR bl_id LIKE 'CE600-%';
      DELETE FROM public.ce_unlock_request_bls WHERE request_id IN(SELECT id FROM r600) OR bl_id LIKE 'CE600-%';
      DELETE FROM public.ce_unlock_documents WHERE customer_id IN(998600,998601);
      DELETE FROM public.ce_unlock_requests WHERE id IN(SELECT id FROM r600);
      DELETE FROM public.ce_unlock_vip_customers WHERE customer_id IN(998600,998601);
      DELETE FROM public.ce_unlock_bl_deliveries WHERE bl_id LIKE 'CE600-%';
      DELETE FROM public.ce_unlock_zpt_status WHERE bl_id LIKE 'CE600-%';
      DELETE FROM public.ce_unlock_exports WHERE created_by='${admin}';
      DELETE FROM public.portal_notifications WHERE customer_id IN(998600,998601);
      DELETE FROM public.cod_adjustments WHERE bl_id LIKE 'CE600-%';
      DELETE FROM public.ledger_settlements WHERE receivable_id IN(SELECT id FROM public.bl_receivables WHERE bl_id LIKE 'CE600-%') OR invoice_id BETWEEN 998600 AND 998699;
      DELETE FROM public.invoice_lifecycle_events WHERE invoice_id BETWEEN 998600 AND 998699;
      DELETE FROM public.payments WHERE invoice_id BETWEEN 998600 AND 998699;
      DELETE FROM public.invoice_receivable_links WHERE invoice_id BETWEEN 998600 AND 998699;
      DELETE FROM public.invoice_bls WHERE invoice_id BETWEEN 998600 AND 998699;
      DELETE FROM public.invoices WHERE id BETWEEN 998600 AND 998699;
      DELETE FROM public.bl_receivables WHERE bl_id LIKE 'CE600-%';
      DELETE FROM public.bls WHERE id LIKE 'CE600-%';
      INSERT INTO auth.users(id,email) VALUES ('${admin}','ce600-admin@example.test'),('${client}','ce600-client@example.test'),('${foreign}','ce600-foreign@example.test'),('${finance}','ce600-finance@example.test') ON CONFLICT DO NOTHING;
      INSERT INTO public.user_profiles(id,full_name,role,active) VALUES ('${admin}','CE600 admin','administrativo',true),('${finance}','CE600 finance','financeiro',true) ON CONFLICT DO NOTHING;
      INSERT INTO public.customers(id,cnpj_cpf,name) VALUES (998600,'00000000600001','CE600 A'),(998601,'00000000600002','CE600 B') ON CONFLICT DO NOTHING;
      INSERT INTO public.customer_portal_accounts(customer_id,auth_user_id,active,account_situation) VALUES(998600,'${client}',true,'ativo'),(998601,'${foreign}',true,'ativo') ON CONFLICT(customer_id) DO UPDATE SET auth_user_id=EXCLUDED.auth_user_id,active=true;
      UPDATE public.customer_portal_accounts SET contact_email='ce600-a@example.test',portal_email='ce600-a@example.test',login_cnpj='00000000600001',
        provisioning_decision='aprovado_para_provisionar',recovery_email='ce600-a@example.test',recovery_email_source='informado_manualmente',recovery_email_status='ok' WHERE customer_id=998600;
      INSERT INTO public.carriers(id,name) VALUES(998600,'CE600 carrier') ON CONFLICT DO NOTHING;
      INSERT INTO public.vessels(id,name,carrier_id) VALUES(998600,'CE600 vessel',998600) ON CONFLICT DO NOTHING;
      INSERT INTO public.voyages(id,vessel_id,voyage_number,status) VALUES(998600,998600,'CE-600','active') ON CONFLICT DO NOTHING;
      INSERT INTO public.bls(id,voyage_id,customer_id,ce_mercante,charge_status,charge_exemption_reason) VALUES
        ${exemptBls.map(([id,ce,cid])=>`('${id}',998600,${cid},${ce?`'${ce}'`:'NULL'},'exempt','Isento (matriz CE600)')`).join(',\n        ')},
        ('CE600-NOREC',998600,998600,'600600000000001','calculated',NULL);
      COMMIT;`)
  })

  // Item 1: anônimo, B/L sem importação/CE/recebível e obrigação de COD.
  it('anônimo não executa nenhuma RPC pública do desbloqueio nem lê o schema privado',()=>{
    const calls = sql(`SELECT format('SELECT public.%I(%s);',p.proname,coalesce((SELECT string_agg('NULL::'||format_type(t,NULL),',') FROM unnest(p.proargtypes) t),''))
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE '%ce_unlock%' ORDER BY 1;`).split('\n')
    expect(calls.length).toBeGreaterThanOrEqual(20)
    for (const call of calls) expect(rawError(`SET ROLE anon; ${call}`), call).toContain('permission denied')
    expect(rawError("SET ROLE anon; SELECT ce_unlock_private.item('CE600-COD');")).toContain('permission denied')
    expect(rawError('SET ROLE anon; SELECT * FROM public.ce_unlock_requests;')).toContain('permission denied')
  })
  it('B/L inexistente ou sem CE não é selecionável; sem recebível (não isento) não está pago',()=>{
    expect(()=>command('draft',{bl_ids:['CE600-INEXISTENTE'],request_key:key()},client)).toThrow(/42501/)
    expect(()=>command('draft',{bl_ids:['CE600-NOCE'],request_key:key()},client)).toThrow(/42501/)
    expect(ids(portalList({search:'CE600-NO'}))).toEqual(['CE600-NOREC'])
    const noReceivable = item('CE600-NOREC')
    expect(noReceivable).toMatchObject({paid:false,can_submit:false})
    expect(noReceivable.reasons).toContain('Taxas locais sem liquidação integral confirmada')
    expect(()=>command('draft',{bl_ids:['CE600-NOREC'],request_key:key()},client)).toThrow(/não pode ser solicitado/)
    expect(item('CE600-NOCE').reasons).toContain('CE Mercante não informado')
  })
  it('ajuste de COD pendente com diferença a cobrar bloqueia o pagamento até ser cancelado',()=>{
    expect(item('CE600-COD')).toMatchObject({paid:true,can_submit:true})
    sql(`SET session_replication_role=replica;
      INSERT INTO public.cod_adjustments(id,bl_id,omission_id,original_value_brl,new_destination_value_brl,difference_brl,action,status) VALUES(998600,'CE600-COD',0,100,150,50,'complementary_invoice','pending');
      SET session_replication_role=origin;`)
    try {
      expect(item('CE600-COD')).toMatchObject({paid:false,can_submit:false})
      expect(()=>command('draft',{bl_ids:['CE600-COD'],request_key:key()},client)).toThrow(/não pode ser solicitado/)
      // Diferença a favor do Cliente (reembolso) não cria obrigação.
      sql("SET session_replication_role=replica; UPDATE public.cod_adjustments SET new_destination_value_brl=50,difference_brl=-50,action='refund_overpayment' WHERE id=998600; SET session_replication_role=origin;")
      expect(item('CE600-COD').paid).toBe(true)
      sql("SET session_replication_role=replica; UPDATE public.cod_adjustments SET new_destination_value_brl=150,difference_brl=50,action='complementary_invoice',status='cancelled' WHERE id=998600; SET session_replication_role=origin;")
      expect(item('CE600-COD').paid).toBe(true)
    } finally { sql('SET session_replication_role=replica; DELETE FROM public.cod_adjustments WHERE id=998600; SET session_replication_role=origin;') }
  })

  // Item 2: concorrência.
  it('dois rascunhos concorrentes para o mesmo B/L deixam uma única reserva ativa',async()=>{
    const first = JSON.stringify({bl_ids:['CE600-DUP'],request_key:key()})
    const worker = await heldTransaction(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${client}'; SELECT public.portal_ce_unlock_command('draft','${first}'::jsonb) IS NOT NULL; SELECT 'LOCKED'; SELECT pg_sleep(1.5); COMMIT;`)
    try { expect(()=>command('draft',{bl_ids:['CE600-DUP'],request_key:key()},client)).toThrow(/não pode ser solicitado/) }
    finally { await worker.done }
    expect(sql("SELECT count(*) FROM public.ce_unlock_request_bls WHERE bl_id='CE600-DUP' AND active;")).toBe('1')
  })
  it('dois envios concorrentes do mesmo pedido: só um é aceito, o outro recebe conflito de versão',async()=>{
    const draft = command('draft',{bl_ids:['CE600-SUB'],request_key:key()},client)
    attachDocs(draft.id)
    const first = JSON.stringify({request_id:draft.id,expected_version:draft.version,request_key:key()})
    const worker = await heldTransaction(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${client}'; SELECT public.portal_ce_unlock_command('submit','${first}'::jsonb) IS NOT NULL; SELECT 'LOCKED'; SELECT pg_sleep(1.5); COMMIT;`)
    try { expect(()=>command('submit',{request_id:draft.id,expected_version:draft.version,request_key:key()},client)).toThrow(/Solicitação alterada/) }
    finally { await worker.done }
    expect(sql(`SELECT state||':'||(SELECT count(*) FROM public.ce_unlock_events WHERE request_id='${draft.id}' AND action='submit') FROM public.ce_unlock_requests WHERE id='${draft.id}';`)).toBe('submitted:1')
  })
  it('exportação aguarda cancelamento concorrente da baixa (comando real) e recusa o B/L',async()=>{
    invoiceFixture('CE600-RACE',998620,'600600000000020')
    const payment = pay(998620,'Baixa CE600 corrida')
    readyRequest(['CE600-RACE'])
    expect(item('CE600-RACE').can_export).toBe(true)
    const worker = await heldTransaction(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${admin}'; SELECT public.reverse_invoice_payment(${payment},'Cancelamento de baixa concorrente à exportação',NULL) IS NOT NULL; SELECT 'LOCKED'; SELECT pg_sleep(1.5); COMMIT;`)
    try { expect(()=>exportBls(['CE600-RACE'])).toThrow(/CE600-RACE não apto: .*Taxas locais sem liquidação integral confirmada/) }
    finally { await worker.done }
    expect(sql("SELECT exported_at IS NULL AND export_id IS NULL FROM public.ce_unlock_request_bls WHERE bl_id='CE600-RACE' AND active;")).toBe('t')
    expect(item('CE600-RACE')).toMatchObject({paid:false,can_export:false})
  })

  // Item 3: cancelamento de B/L, remoção/correção do CE e reconferência completa.
  it('cancelamento do B/L remove a aptidão e bloqueia a exportação',()=>{
    readyRequest(['CE600-CANC'])
    expect(item('CE600-CANC').can_export).toBe(true)
    expect(JSON.parse(sql("SELECT public.cancel_bl('CE600-CANC','Cancelado pelo armador');", admin)).cancelled).toBe(true)
    const cancelled = item('CE600-CANC')
    expect(cancelled).toMatchObject({can_export:false,can_submit:false})
    expect(cancelled.reasons).toContain('B/L cancelado')
    expect(()=>exportBls(['CE600-CANC'])).toThrow(/CE600-CANC não apto: .*B\/L cancelado/)
  })
  it('remoção do CE bloqueia a exportação e tira o B/L das listas',()=>{
    readyRequest(['CE600-REM'])
    sql("SELECT public.remove_bl_ce_mercante('CE600-REM','CE lançado no B/L errado','600600000000007');", admin)
    expect(item('CE600-REM').reasons).toContain('CE Mercante não informado')
    expect(()=>exportBls(['CE600-REM'])).toThrow(/CE600-REM não apto/)
    expect(ids(deskList({search:'CE600-REM'}))).toEqual([])
    expect(ids(portalList({search:'CE600-REM'}))).toEqual([])
  })
  it('correção do CE exige reconferência: aprovações voltam à fila e o B/L volta a ser exportável com o CE novo',()=>{
    const requestId = readyRequest(['CE600-CORR'])
    expect(exportBls(['CE600-CORR']).rows).toHaveLength(1)
    sql("SELECT public.correct_bl_ce_mercante('CE600-CORR','600600000000099','Erro de digitação no CE','600600000000006');", admin)
    const changed = item('CE600-CORR')
    expect(changed.reasons).toContain('CE alterado: reconferência necessária')
    expect(changed.can_export).toBe(false)
    expect(()=>exportBls(['CE600-CORR'])).toThrow(/CE alterado: reconferência necessária/)
    const reconfirmed = command('reconfirm_ce',{request_id:requestId,expected_version:version(requestId),bl_id:'CE600-CORR',reason:'CE corrigido pela ficha',request_key:key()})
    expect(reconfirmed.state).toBe('in_review')
    expect(reconfirmed.items[0]).toMatchObject({termo:false,procuracao:false,can_export:false,export_state:'not_exported'})
    const queue = JSON.parse(sql("SELECT public.ce_unlock_read('review_queue','{}');", admin)).items
    expect(queue.some((r:{id:string})=>r.id===requestId)).toBe(true)
    review(requestId,'termo','approved')
    const approved = review(requestId,'procuracao','approved')
    expect(approved.state).toBe('completed')
    expect(item('CE600-CORR')).toMatchObject({can_export:true,export_state:'not_exported'})
    const again = exportBls(['CE600-CORR'])
    expect(again.snapshot[0].ce_mercante).toBe('600600000000099')
  })

  // Item 4: filtros Sem solicitação, exclusão sem CE, paginação e pedidos mistos.
  it('filtros do desk: Sem solicitação, exclusão sem CE, Cliente e pedido misto',()=>{
    const requestId = readyRequest(['CE600-L-MIX1','CE600-L-MIX2'],['CE600-L-MIX2'])
    expect(sql(`SELECT state FROM public.ce_unlock_requests WHERE id='${requestId}';`)).toBe('in_review')
    const search = 'CE600-L-'
    expect(ids(deskList({search}))).toEqual(['CE600-L-FOREIGN','CE600-L-MIX1','CE600-L-MIX2','CE600-L-NOREQ'])
    expect(ids(deskList({search,situation:'no_request'}))).toEqual(['CE600-L-FOREIGN','CE600-L-NOREQ'])
    expect(ids(deskList({search,situation:'in_review'}))).toEqual(['CE600-L-MIX1','CE600-L-MIX2'])
    expect(ids(deskList({search,situation:'ready'}))).toEqual(['CE600-L-MIX1'])
    expect(ids(deskList({search,situation:'ready_not_exported'}))).toEqual(['CE600-L-MIX1'])
    expect(ids(deskList({search,pending_requirement:'bl_fisico'}))).toEqual(['CE600-L-FOREIGN','CE600-L-MIX2','CE600-L-NOREQ'])
    expect(ids(deskList({search,pending_requirement:'termo'}))).toEqual(['CE600-L-FOREIGN','CE600-L-NOREQ'])
    expect(ids(deskList({search,pending_requirement:'taxas'}))).toEqual([])
    expect(ids(deskList({search,customer_id:998601}))).toEqual(['CE600-L-FOREIGN'])
    expect(ids(deskList({search:'600600000000012'}))).toEqual(['CE600-L-MIX2'])
    // Portal: só o próprio Cliente, sem B/L sem CE; o pedido misto aparece nos dois B/Ls.
    const portal = portalList({search})
    expect(ids(portal)).toEqual(['CE600-L-MIX1','CE600-L-MIX2','CE600-L-NOREQ'])
    expect(new Set(portal.items.filter((i:Item)=>i.bl_id.includes('MIX')).map((i:Item)=>i.request_id))).toEqual(new Set([requestId]))
    expect(ids(portalList({search,situation:'no_request'}))).toEqual(['CE600-L-NOREQ'])
    expect(ids(portalList({search},1,foreign))).toEqual(['CE600-L-FOREIGN'])
  })
  it('paginação de 25 por página no desk e no Portal, sem repetir nem perder B/L',()=>{
    const expected = pages.map(n=>`CE600-PG-${n}`)
    for (const list of [deskList, (f:object,p:number)=>portalList(f,p)]) {
      const [p1,p2,p3] = [1,2,3].map(p=>list({search:'CE600-PG-'},p))
      expect([p1.total,p1.items.length,p2.items.length,p3.items.length]).toEqual([30,25,5,0])
      expect([...ids(p1),...ids(p2)]).toEqual(expected)
    }
    expect(()=>deskList({search:'CE600-PG-'},0)).toThrow(/Página inválida/)
  })

  // Item 5: bloqueio por requisito, snapshot imutável e retry do mesmo lote.
  it('exportação recusa cada requisito perdido (pagamento, termo, procuração, entrega) e volta a aceitar quando restabelecido',()=>{
    invoiceFixture('CE600-REQ',998610,'600600000000030')
    const payment = pay(998610,'Baixa CE600 requisitos')
    const requestId = readyRequest(['CE600-REQ'])
    expect(item('CE600-REQ').can_export).toBe(true)
    reverse(payment)
    expect(()=>exportBls(['CE600-REQ'])).toThrow(/CE600-REQ não apto: .*Taxas locais sem liquidação integral confirmada/)
    pay(998610,'Nova baixa CE600 requisitos')
    expect(item('CE600-REQ').can_export).toBe(true)
    review(requestId,'termo','changes_requested')
    expect(()=>exportBls(['CE600-REQ'])).toThrow(/não apto: .*Termo de devolução pendente/)
    review(requestId,'termo','approved')
    review(requestId,'procuracao','changes_requested')
    expect(()=>exportBls(['CE600-REQ'])).toThrow(/não apto: .*Procuração pendente/)
    review(requestId,'procuracao','approved')
    deliver('CE600-REQ',false)
    expect(()=>exportBls(['CE600-REQ'])).toThrow(/não apto: .*B\/L físico aguardando entrega/)
    deliver('CE600-REQ',true)
    expect(exportBls(['CE600-REQ']).rows[0]).toMatchObject({bl_id:'CE600-REQ',paid:true,termo:true,procuracao:true,delivered:true})
    expect(sql("SELECT count(*) FROM public.ce_unlock_exports e WHERE e.rows @> '[{\"bl_id\":\"CE600-REQ\"}]';")).toBe('1')
  })
  it('retry do mesmo lote devolve a mesma exportação e o snapshot não muda depois',()=>{
    readyRequest(['CE600-SNAP'])
    const requestKey = key()
    const first = exportBls(['CE600-SNAP'],requestKey)
    const retry = exportBls(['CE600-SNAP'],requestKey)
    expect(retry).toEqual(first)
    expect(sql(`SELECT count(*) FROM public.ce_unlock_exports WHERE rows @> '[{"bl_id":"CE600-SNAP"}]';`)).toBe('1')
    expect(()=>command('export',{bl_ids:['CE600-SNAP','CE600-REQ'],request_key:requestKey})).toThrow(/Chave já utilizada/)
    deliver('CE600-SNAP',false)
    const stored = JSON.parse(sql("SELECT public.ce_unlock_read('exports','{}');", admin)).find((e:{id:string})=>e.id===first.id)
    expect(stored.snapshot).toEqual(first.snapshot)
    expect(stored.rows).toEqual(first.rows)
    expect(stored.snapshot[0].delivered).toBe(true)
    expect(rawError(`SET ROLE authenticated; SET request.jwt.claim.sub='${admin}'; UPDATE public.ce_unlock_exports SET snapshot='[]' WHERE id='${first.id}';`)).toContain('permission denied')
  })
})

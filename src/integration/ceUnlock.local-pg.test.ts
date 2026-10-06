import { execFileSync, spawn } from 'node:child_process'
import { describe, expect, it, beforeAll } from 'vitest'
const db = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const local = process.env.LOCAL_PG_INTEGRATION === '1' ? describe : describe.skip
const admin = '00000000-0000-0000-0000-000000557001'
const client = '00000000-0000-0000-0000-000000557002'
const foreign = '00000000-0000-0000-0000-000000557003'
const finance = '00000000-0000-0000-0000-000000557004'
function sql(q:string, uid?:string):string {
  return execFileSync('psql',['-X','-Atq','-v','ON_ERROR_STOP=1','-d',db,'-c',uid ? `SET ROLE authenticated; SET request.jwt.claim.sub='${uid}'; ${q}` : q],{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
}
function error(q:string, uid:string) { try {sql(q,uid);return ''} catch(e) {return String((e as {stderr:string}).stderr)} }
const command = (action:string, payload:object, uid=admin) => JSON.parse(sql(`SELECT public.${uid===client?'portal_':''}ce_unlock_command('${action}', '${JSON.stringify(payload)}'::jsonb);`, uid))
async function heldTransaction(q:string) {
  const process = spawn('psql',['-X','-Atq','-v','ON_ERROR_STOP=1','-d',db,'-f','-'],{stdio:['pipe','pipe','pipe']})
  const done = new Promise<void>((resolve,reject)=> { process.on('exit',code => code===0 ? resolve() : reject(new Error('Worker SQL failed'))); process.on('error',reject) })
  process.stdin.end(q.replaceAll(';', ';\n'))
  await new Promise<void>((resolve,reject)=> { process.stdout.on('data',chunk=> { if(String(chunk).includes('LOCKED')) resolve() }); process.on('error',reject) })
  return { done }
}

// All review regressions roll back their isolated scenario, including receipts/events.
const reviewRequest = '00000000-0000-0000-0000-000000557847'
const reviewTerm = '00000000-0000-0000-0000-000000557848'
function reviewScenario(query: string) {
  return sql(`BEGIN;
    SET LOCAL session_replication_role=replica;
    INSERT INTO public.bls(id,voyage_id,customer_id,ce_mercante) VALUES('CE557-REVIEW',998557,998557,'123456789018470');
    INSERT INTO public.bl_receivables(id,bl_id,customer_id,original_amount_brl,settled_amount_brl,balance_brl,status) VALUES(998847,'CE557-REVIEW',998557,100,100,0,'settled');
    INSERT INTO public.ledger_settlements(receivable_id,amount_brl,source) VALUES(998847,100,'manual');
    SET LOCAL session_replication_role=origin;
    INSERT INTO public.ce_unlock_requests(id,customer_id,source,state,created_by) VALUES('${reviewRequest}',998557,'request','draft','${client}');
    INSERT INTO public.ce_unlock_documents(id,customer_id,request_id,type,source,status,storage_path,file_name,size_bytes,hash,uploaded_by,created_at) VALUES
      ('${reviewTerm}',998557,'${reviewRequest}','termo','request','uploaded','review/term','term.pdf',10,repeat('a',64),'${client}',now()-interval '2 days'),
      ('00000000-0000-0000-0000-000000557849',998557,'${reviewRequest}','procuracao','request','uploaded','review/proc','proc.pdf',10,repeat('b',64),'${client}',now()-interval '2 days');
    INSERT INTO public.ce_unlock_request_bls(request_id,bl_id,ce_at_request,termo_document_id,procuracao_document_id,termo_approved,procuracao_approved) VALUES
      ('${reviewRequest}','CE557-REVIEW','123456789018470','${reviewTerm}','00000000-0000-0000-0000-000000557849',true,true);
    INSERT INTO public.ce_unlock_bl_deliveries(bl_id,delivered) VALUES('CE557-REVIEW',true);
    ${query}
    ROLLBACK;`)
}

local('desbloqueio CE — SQL real, autorização e requisitos',()=>{
  beforeAll(()=> {
    sql(`SET session_replication_role=replica;
      DELETE FROM ce_unlock_private.receipts WHERE actor_id IN ('${admin}','${client}','${foreign}');
      DELETE FROM public.ce_unlock_events WHERE customer_id IN(998557,998558);
      DELETE FROM public.ce_unlock_request_bls WHERE bl_id LIKE 'CE557-%';
      DELETE FROM public.ce_unlock_documents WHERE customer_id IN(998557,998558);
      DELETE FROM public.ce_unlock_requests WHERE customer_id IN(998557,998558);
      DELETE FROM public.ce_unlock_vip_customers WHERE customer_id IN(998557,998558);
      DELETE FROM public.ce_unlock_bl_deliveries WHERE bl_id LIKE 'CE557-%';
      DELETE FROM public.ce_unlock_exports WHERE created_by='${admin}';
      DELETE FROM public.ledger_settlements WHERE receivable_id IN(998557,998558,998559);
      DELETE FROM public.bl_receivables WHERE id IN(998557,998558,998559);
      INSERT INTO auth.users(id,email) VALUES ('${admin}','ce-admin@example.test'),('${client}','ce-client@example.test'),('${foreign}','ce-foreign@example.test'),('${finance}','ce-finance@example.test') ON CONFLICT DO NOTHING;
      INSERT INTO public.user_profiles(id,full_name,role,active) VALUES ('${admin}','CE admin','administrativo',true),('${finance}','CE finance','financeiro',true) ON CONFLICT DO NOTHING;
      INSERT INTO public.customers(id,cnpj_cpf,name) VALUES (998557,'00000000557001','CE A'),(998558,'00000000557002','CE B') ON CONFLICT DO NOTHING;
      INSERT INTO public.customer_portal_accounts(customer_id,auth_user_id,active,account_situation) VALUES(998557,'${client}',true,'ativo'),(998558,'${foreign}',true,'ativo') ON CONFLICT(customer_id) DO UPDATE SET auth_user_id=EXCLUDED.auth_user_id,active=true;
      INSERT INTO public.carriers(id,name) VALUES(998557,'CE carrier') ON CONFLICT DO NOTHING;
      INSERT INTO public.vessels(id,name,carrier_id) VALUES(998557,'CE vessel',998557) ON CONFLICT DO NOTHING;
      INSERT INTO public.voyages(id,vessel_id,voyage_number,status) VALUES(998557,998557,'CE-557','active') ON CONFLICT DO NOTHING;
      INSERT INTO public.bls(id,voyage_id,customer_id,ce_mercante) VALUES('CE557-A',998557,998557,'123456789012345'),('CE557-B',998557,998558,'123456789012346'),('CE557-NO',998557,998557,NULL),('CE557-PART',998557,998557,'123456789012347'),('CE557-SECOND',998557,998557,'123456789012348') ON CONFLICT(id) DO UPDATE SET customer_id=EXCLUDED.customer_id,ce_mercante=EXCLUDED.ce_mercante,cancelled_at=NULL;
      INSERT INTO public.bl_receivables(id,bl_id,customer_id,original_amount_brl,settled_amount_brl,balance_brl,status) VALUES(998557,'CE557-A',998557,100,100,0,'settled'),(998558,'CE557-PART',998557,100,50,50,'partially_settled'),(998559,'CE557-SECOND',998557,100,100,0,'settled') ON CONFLICT DO NOTHING;
      INSERT INTO public.ledger_settlements(receivable_id,amount_brl,source) VALUES(998557,100,'manual'),(998558,50,'manual'),(998559,100,'manual'); SET session_replication_role=origin;`)
  })
  it('lista somente BLs com CE do próprio cliente e mantém não pagos visíveis',()=>{
    const r=JSON.parse(sql("SELECT public.portal_list_ce_unlock_bls('{}',1);",client))
    expect(r.items.map((i:{bl_id:string})=>i.bl_id)).toContain('CE557-A')
    expect(r.items.map((i:{bl_id:string})=>i.bl_id)).not.toContain('CE557-B')
    expect(r.items.map((i:{bl_id:string})=>i.bl_id)).not.toContain('CE557-NO')
    expect(r.items.find((i:{bl_id:string})=>i.bl_id==='CE557-PART').paid).toBe(false)
  })
  it('nega ação interna a Portal e Financeiro e acesso direto a tabela',()=>{
    expect(error("SELECT public.ce_unlock_command('set_vip','{\"customer_id\":998557,\"enabled\":true,\"reason\":\"VIP\"}');",client)).toContain('42501')
    expect(error("SELECT public.ce_unlock_command('set_vip','{\"customer_id\":998557,\"enabled\":true,\"reason\":\"VIP\"}');",finance)).toContain('42501')
    expect(error('SELECT * FROM public.ce_unlock_documents;',client)).toContain('permission denied')
  })
  it('recusa draft de outro CNPJ e parcial; anual VIP pendente não permite submit',()=>{
    expect(()=>command('draft',{bl_ids:['CE557-B'],request_key:crypto.randomUUID()},client)).toThrow()
    expect(()=>command('draft',{bl_ids:['CE557-PART'],request_key:crypto.randomUUID()},client)).toThrow()
    command('set_vip',{customer_id:998557,enabled:true,reason:'Termos anuais',request_key:crypto.randomUUID()})
    const draft=command('draft',{bl_ids:['CE557-A'],request_key:crypto.randomUUID()},client)
    expect(()=>command('submit',{request_id:draft.id,expected_version:draft.version,request_key:crypto.randomUUID()},client)).toThrow()
    expect(error(`SELECT public.portal_get_ce_unlock_request('${draft.id}');`,foreign)).toContain('42501')
  })
  it('documentos anuais aprovados atendem múltiplos pedidos, mas original continua obrigatório',()=>{
    sql(`INSERT INTO public.ce_unlock_documents(customer_id,type,source,status,file_name,storage_path,size_bytes,hash,coverage_year,valid_from,valid_until,uploaded_by) VALUES
    (998557,'termo','vip_annual','approved','termo.pdf','annual/termo',100,'hash',extract(year from now())::int,make_date(extract(year from now())::int,1,1),make_date(extract(year from now())::int,12,31),'${admin}'),
    (998557,'procuracao','vip_annual','approved','proc.pdf','annual/proc',100,'hash',extract(year from now())::int,make_date(extract(year from now())::int,1,1),make_date(extract(year from now())::int,12,31),'${admin}');`)
    const draft=JSON.parse(sql("SELECT public.portal_list_ce_unlock_requests('{}',1);",client)).items[0]
    const sent=command('submit',{request_id:draft.id,expected_version:draft.version,request_key:crypto.randomUUID()},client)
    expect(sent.items[0]).toMatchObject({termo:true,procuracao:true,paid:true,delivered:false,can_export:false})
    const key=crypto.randomUUID()
    const second=command('draft',{bl_ids:['CE557-SECOND'],request_key:key},client)
    expect(command('draft',{bl_ids:['CE557-SECOND'],request_key:key},client).id).toBe(second.id)
    const sent2=command('submit',{request_id:second.id,expected_version:second.version,request_key:crypto.randomUUID()},client)
    expect(sent2.items[0].termo).toBe(true)
    expect(()=>command('export',{bl_ids:['CE557-A'],request_key:crypto.randomUUID()})).toThrow()
  })
  it('recusa revisão anual com versão desatualizada e downloads por Financeiro',()=>{
    const id=sql("SELECT id FROM public.ce_unlock_documents WHERE customer_id=998557 AND type='termo' AND source='vip_annual' LIMIT 1;")
    expect(()=>command('review',{document_id:id,decision:'approved',expected_document_version:999,coverage_year:new Date().getFullYear(),valid_from:`${new Date().getFullYear()}-01-01`,valid_until:`${new Date().getFullYear()}-12-31`,request_key:crypto.randomUUID()})).toThrow()
    expect(error(`SELECT public.ce_unlock_document_access('${id}');`,finance)).toContain('42501')
    expect(error('SELECT public.ce_unlock_cleanup_candidates();',client)).toContain('permission denied')
  })
  it('exportar não desbloqueia; baixa cancelada e revogação anual removem aptidão',()=>{
    command('delivery',{bl_id:'CE557-A',delivered:true,expected_version:0,request_key:crypto.randomUUID()})
    const exp=command('export',{bl_ids:['CE557-A'],request_key:crypto.randomUUID()})
    expect(exp.rows).toHaveLength(1)
    expect(JSON.parse(sql("SELECT public.portal_list_ce_unlock_bls('{}',1);",client)).items.find((i:{bl_id:string})=>i.bl_id==='CE557-A').confirmed).toBe(false)
    sql("UPDATE public.bl_receivables SET settled_amount_brl=50,balance_brl=50,status='partially_settled' WHERE id=998557;")
    expect(()=>command('export',{bl_ids:['CE557-A'],request_key:crypto.randomUUID()})).toThrow()
    sql("UPDATE public.bl_receivables SET settled_amount_brl=100,balance_brl=0,status='settled' WHERE id=998557; UPDATE public.ce_unlock_documents SET status='revoked' WHERE source='vip_annual' AND type='termo' AND customer_id=998557;")
    expect(()=>command('export',{bl_ids:['CE557-A'],request_key:crypto.randomUUID()})).toThrow()
  })
  it('correção de termo permanece acessível após aprovação da procuração',()=>{
    command('set_vip',{customer_id:998557,enabled:false,reason:'Fluxo comum',request_key:crypto.randomUUID()})
    const pending=JSON.parse(sql("SELECT public.portal_list_ce_unlock_requests('{}',1);",client)).items.filter((r:{state:string})=>!['completed','cancelled'].includes(r.state))
    for(const r of pending) command('cancel',{request_id:r.id,expected_version:r.version,reason:'Preparar teste comum',request_key:crypto.randomUUID()})
    const draft=command('draft',{bl_ids:['CE557-A'],request_key:crypto.randomUUID()},client)
    sql(`INSERT INTO public.ce_unlock_documents(customer_id,request_id,type,source,status,file_name,storage_path,size_bytes,hash,uploaded_by) VALUES
      (998557,'${draft.id}','termo','request','uploaded','term.pdf','request/term-${draft.id}',10,'hash','${client}'),
      (998557,'${draft.id}','procuracao','request','uploaded','proc.pdf','request/proc-${draft.id}',10,'hash','${client}');`)
    let request=command('submit',{request_id:draft.id,expected_version:draft.version,request_key:crypto.randomUUID()},client)
    const termo=request.documents.find((d:{type:string})=>d.type==='termo')
    const proc=request.documents.find((d:{type:string})=>d.type==='procuracao')
    request=command('review',{request_id:draft.id,expected_version:request.version,document_id:termo.id,expected_document_version:termo.version,bl_ids:['CE557-A'],decision:'changes_requested',reason:'Assinatura ausente',request_key:crypto.randomUUID()})
    request=command('review',{request_id:draft.id,expected_version:request.version,document_id:proc.id,expected_document_version:proc.version,bl_ids:['CE557-A'],decision:'approved',request_key:crypto.randomUUID()})
    expect(request.state).toBe('changes_requested')
    expect(request.items[0].can_export).toBe(false)
  })

  it('não aprova anexo substituto antes de o cliente reenviar o pedido',()=>{
    let request=JSON.parse(sql("SELECT public.portal_list_ce_unlock_requests('{}',1);",client)).items.find((r:{state:string})=>r.state==='changes_requested')
    const replacement=sql(`INSERT INTO public.ce_unlock_documents(customer_id,request_id,type,source,status,file_name,storage_path,size_bytes,hash,uploaded_by) VALUES(998557,'${request.id}','termo','request','uploaded','replacement.pdf','request/replacement-${request.id}',10,'hash','${client}') RETURNING id;`)
    expect(()=>command('review',{request_id:request.id,expected_version:request.version,document_id:replacement,expected_document_version:0,bl_ids:['CE557-A'],decision:'approved',request_key:crypto.randomUUID()})).toThrow()
    request=command('submit',{request_id:request.id,expected_version:request.version,request_key:crypto.randomUUID()},client)
    request=command('review',{request_id:request.id,expected_version:request.version,document_id:replacement,expected_document_version:0,bl_ids:['CE557-A'],decision:'approved',request_key:crypto.randomUUID()})
    expect(request.items[0].termo).toBe(true)
  })
  it('mudança de Cliente bloqueia exportação e não expõe dados do novo Cliente ao anterior',()=>{
    const request=JSON.parse(sql("SELECT public.portal_list_ce_unlock_requests('{}',1);",client)).items.find((r:{state:string})=>!['completed','cancelled'].includes(r.state))
    sql("UPDATE public.bls SET customer_id=998558 WHERE id='CE557-A';")
    try {
      const oldCustomer=JSON.parse(sql(`SELECT public.portal_get_ce_unlock_request('${request.id}');`,client))
      expect(oldCustomer.items.some((i:{customer_id:number})=>i.customer_id===998558)).toBe(false)
      expect(()=>command('export',{bl_ids:['CE557-A'],request_key:crypto.randomUUID()})).toThrow()
    } finally { sql("UPDATE public.bls SET customer_id=998557 WHERE id='CE557-A';") }
  })
  it('vigência anual já aprovada exige novo documento para outro ano',()=>{
    const doc=sql("SELECT id FROM public.ce_unlock_documents WHERE customer_id=998557 AND source='vip_annual' AND type='procuracao' LIMIT 1;")
    const nextYear=new Date().getFullYear()+1
    expect(()=>command('review',{document_id:doc,expected_document_version:0,decision:'approved',coverage_year:nextYear,valid_from:`${nextYear}-01-01`,valid_until:`${nextYear}-12-31`,request_key:crypto.randomUUID()})).toThrow()
  })
  it('reenvio não reutiliza versão antiga quando o documento mais recente foi rejeitado',()=>{
    const request=JSON.parse(sql("SELECT public.portal_list_ce_unlock_requests('{}',1);",client)).items.find((r:{state:string})=>!['completed','cancelled'].includes(r.state))
    const doc=sql(`SELECT id FROM public.ce_unlock_documents WHERE request_id='${request.id}' AND type='termo' ORDER BY created_at DESC LIMIT 1;`)
    sql(`UPDATE public.ce_unlock_requests SET state='changes_requested' WHERE id='${request.id}'; UPDATE public.ce_unlock_documents SET status='approved' WHERE request_id='${request.id}' AND type='termo' AND id<>'${doc}'; UPDATE public.ce_unlock_documents SET status='changes_requested' WHERE id='${doc}';`)
    try { expect(()=>command('submit',{request_id:request.id,expected_version:request.version,request_key:crypto.randomUUID()},client)).toThrow() }
    finally { sql(`UPDATE public.ce_unlock_requests SET state='in_review' WHERE id='${request.id}'; UPDATE public.ce_unlock_documents SET status='approved' WHERE id='${doc}';`) }
  })
  it('confirmação aguarda reversão financeira concorrente e recusa requisito perdido',async()=>{
    sql("UPDATE public.ce_unlock_request_bls SET termo_approved=true,procuracao_approved=true WHERE bl_id='CE557-A' AND active;")
    expect(JSON.parse(sql("SELECT public.portal_list_ce_unlock_bls('{}',1);",client)).items.find((i:{bl_id:string})=>i.bl_id==='CE557-A').can_export).toBe(true)
    const request=JSON.parse(sql("SELECT public.portal_list_ce_unlock_requests('{}',1);",client)).items.find((r:{state:string})=>!['completed','cancelled'].includes(r.state))
    const worker=await heldTransaction("BEGIN; UPDATE public.bl_receivables SET status='partially_settled',balance_brl=50,settled_amount_brl=50 WHERE id=998557; SELECT 'LOCKED'; SELECT pg_sleep(1.5); COMMIT;")
    try { expect(()=>command('confirm',{request_id:request.id,expected_version:request.version,bl_id:'CE557-A',ce_mercante:'123456789012345',reference:'External proof',request_key:crypto.randomUUID()})).toThrow() }
    finally { await worker.done; sql(`UPDATE public.bl_receivables SET status='settled',balance_brl=0,settled_amount_brl=100 WHERE id=998557; UPDATE public.ce_unlock_request_bls SET confirmed_at=NULL,confirmed_by=NULL,confirmed_ce=NULL,external_reference=NULL,active=true WHERE request_id='${request.id}'; UPDATE public.ce_unlock_requests SET state='in_review' WHERE id='${request.id}';`) }
  })
  it('registro de envio aguarda cancelamento concorrente e recusa lote',async()=>{
    const exp=command('export',{bl_ids:['CE557-A'],request_key:crypto.randomUUID()})
    const request=JSON.parse(sql("SELECT public.portal_list_ce_unlock_requests('{}',1);",client)).items.find((r:{state:string})=>!['completed','cancelled'].includes(r.state))
    const worker=await heldTransaction(`BEGIN; UPDATE public.ce_unlock_requests SET state='cancelled' WHERE id='${request.id}'; SELECT 'LOCKED'; SELECT pg_sleep(1.5); COMMIT;`)
    try { expect(()=>command('sent',{export_id:exp.id,reference:'ZPT evidence',request_key:crypto.randomUUID()})).toThrow() }
    finally { await worker.done; sql(`UPDATE public.ce_unlock_requests SET state='in_review' WHERE id='${request.id}'; UPDATE public.ce_unlock_exports SET sent_at=NULL,reference=NULL WHERE id='${exp.id}';`) }
  })
  it('expurgo reivindica rascunho sob lock antes de remover arquivo e libera BL',()=>{
    const draft=command('draft',{bl_ids:['CE557-SECOND'],request_key:crypto.randomUUID()},client)
    sql(`UPDATE public.ce_unlock_requests SET created_at=now()-interval '8 days' WHERE id='${draft.id}';`)
    const doc=sql(`INSERT INTO public.ce_unlock_documents(customer_id,request_id,type,source,status,file_name,storage_path,size_bytes,hash,uploaded_by) VALUES(998557,'${draft.id}','termo','request','uploaded','old.pdf','request/old-${draft.id}',10,'hash','${client}') RETURNING id;`)
    expect(sql(`SELECT public.ce_unlock_cleanup_claim('${doc}');`)).toContain(doc)
    expect(sql(`SELECT state FROM public.ce_unlock_requests WHERE id='${draft.id}';`)).toBe('cancelled')
    expect(error(`SELECT public.ce_unlock_document_access('${doc}');`,client)).not.toBe('')
    expect(sql(`SELECT active FROM public.ce_unlock_request_bls WHERE request_id='${draft.id}';`)).toBe('f')
    sql(`SELECT public.ce_unlock_cleanup_record('${doc}');`)
    expect(sql(`SELECT purged_at IS NOT NULL FROM public.ce_unlock_documents WHERE id='${doc}';`)).toBe('t')
  })
  it('pedido com dois BLs só conclui após confirmações individuais e CE divergente é recusado',()=>{
    command('set_vip',{customer_id:998557,enabled:true,reason:'Teste misto VIP',request_key:crypto.randomUUID()})
    sql("UPDATE public.ce_unlock_documents SET status='approved' WHERE customer_id=998557 AND source='vip_annual'; UPDATE public.bl_receivables SET status='settled',balance_brl=0,settled_amount_brl=100 WHERE id=998558;")
    const draft=command('draft',{bl_ids:['CE557-SECOND','CE557-PART'],request_key:crypto.randomUUID()},client)
    let request=command('submit',{request_id:draft.id,expected_version:draft.version,request_key:crypto.randomUUID()},client)
    for(const bid of ['CE557-SECOND','CE557-PART']) command('delivery',{bl_id:bid,delivered:true,expected_version:0,request_key:crypto.randomUUID()})
    request=command('confirm',{request_id:request.id,expected_version:request.version,bl_id:'CE557-SECOND',ce_mercante:'123456789012348',reference:'Confirmação ZPT individual',request_key:crypto.randomUUID()})
    expect(request.state).not.toBe('completed')
    expect(request.items.filter((i:{confirmed:boolean})=>i.confirmed)).toHaveLength(1)
    sql("UPDATE public.bls SET ce_mercante='123456789019999' WHERE id='CE557-PART';")
    expect(()=>command('confirm',{request_id:request.id,expected_version:request.version,bl_id:'CE557-PART',ce_mercante:'123456789012347',reference:'CE antigo',request_key:crypto.randomUUID()})).toThrow()
    request=command('reconfirm_ce',{request_id:request.id,expected_version:request.version,bl_id:'CE557-PART',reason:'CE corrigido após conferência',request_key:crypto.randomUUID()})
    request=command('confirm',{request_id:request.id,expected_version:request.version,bl_id:'CE557-PART',ce_mercante:'123456789019999',reference:'Confirmação ZPT CE atual',request_key:crypto.randomUUID()})
    expect(request.state).toBe('completed')
    expect(request.items.every((i:{confirmed:boolean})=>i.confirmed)).toBe(true)
    sql("UPDATE public.bl_receivables SET status='partially_settled',balance_brl=50,settled_amount_brl=50 WHERE id=998558;")
    expect(JSON.parse(sql(`SELECT public.portal_get_ce_unlock_request('${request.id}');`,client)).items.find((i:{bl_id:string})=>i.bl_id==='CE557-PART').confirmed).toBe(true)
  })
  it('envio VIP aguarda revogação anual concorrente e recusa cobertura perdida',async()=>{
    const pending=JSON.parse(sql("SELECT public.portal_list_ce_unlock_requests('{}',1);",client)).items.filter((r:{state:string})=>!['completed','cancelled'].includes(r.state))
    for(const r of pending) command('cancel',{request_id:r.id,expected_version:r.version,reason:'Preparar concorrência VIP',request_key:crypto.randomUUID()})
    const draft=command('draft',{bl_ids:['CE557-A'],request_key:crypto.randomUUID()},client)
    expect(JSON.parse(sql('SELECT public.portal_get_ce_unlock_vip_coverage();',client)).termo).toBe(true)
    const worker=await heldTransaction("BEGIN; UPDATE public.ce_unlock_documents SET status='revoked' WHERE customer_id=998557 AND source='vip_annual' AND type='termo'; SELECT 'LOCKED'; SELECT pg_sleep(1.5); COMMIT;")
    try { expect(()=>command('submit',{request_id:draft.id,expected_version:draft.version,request_key:crypto.randomUUID()},client)).toThrow() }
    finally { await worker.done; sql("UPDATE public.ce_unlock_documents SET status='approved' WHERE customer_id=998557 AND source='vip_annual' AND type='termo';") }
  })
  it('reenvio preserva documentos de BL já confirmado e exige pagamento só dos pendentes',()=>{
    const pending=JSON.parse(sql("SELECT public.portal_list_ce_unlock_requests('{}',1);",client)).items.filter((r:{state:string})=>!['completed','cancelled'].includes(r.state))
    for(const r of pending) command('cancel',{request_id:r.id,expected_version:r.version,reason:'Teste de reenvio parcial',request_key:crypto.randomUUID()})
    command('set_vip',{customer_id:998557,enabled:false,reason:'Documentos por pedido',request_key:crypto.randomUUID()})
    sql("UPDATE public.bls SET ce_mercante='123456789018888' WHERE id='CE557-SECOND';")
    let request=command('draft',{bl_ids:['CE557-A','CE557-SECOND'],request_key:crypto.randomUUID()},client)
    sql(`INSERT INTO public.ce_unlock_documents(customer_id,request_id,type,source,status,file_name,storage_path,size_bytes,hash,uploaded_by) VALUES
      (998557,'${request.id}','termo','request','uploaded','partial-term.pdf','partial/term-${request.id}',10,'hash','${client}'),
      (998557,'${request.id}','procuracao','request','uploaded','partial-proc.pdf','partial/proc-${request.id}',10,'hash','${client}');`)
    request=command('submit',{request_id:request.id,expected_version:request.version,request_key:crypto.randomUUID()},client)
    for(const type of ['termo','procuracao']) {
      const doc=request.documents.find((d:{type:string})=>d.type===type)
      request=command('review',{request_id:request.id,expected_version:request.version,document_id:doc.id,expected_document_version:doc.version,bl_ids:['CE557-A','CE557-SECOND'],decision:'approved',request_key:crypto.randomUUID()})
    }
    request=command('confirm',{request_id:request.id,expected_version:request.version,bl_id:'CE557-A',ce_mercante:'123456789012345',reference:'Conclusão individual',request_key:crypto.randomUUID()})
    const old=request.documents.find((d:{type:string})=>d.type==='procuracao')
    request=command('review',{request_id:request.id,expected_version:request.version,document_id:old.id,expected_document_version:old.version,bl_ids:['CE557-SECOND'],decision:'changes_requested',reason:'Corrigir aplicabilidade do segundo BL',request_key:crypto.randomUUID()})
    const replacement=sql(`INSERT INTO public.ce_unlock_documents(customer_id,request_id,type,source,status,file_name,storage_path,size_bytes,hash,uploaded_by) VALUES(998557,'${request.id}','procuracao','request','uploaded','replacement-partial.pdf','partial/new-${request.id}',10,'hash','${client}') RETURNING id;`)
    sql("UPDATE public.bl_receivables SET status='partially_settled',balance_brl=50,settled_amount_brl=50 WHERE id=998557;")
    request=command('submit',{request_id:request.id,expected_version:request.version,request_key:crypto.randomUUID()},client)
    expect(sql(`SELECT procuracao_document_id FROM public.ce_unlock_request_bls WHERE request_id='${request.id}' AND bl_id='CE557-A';`)).toBe(old.id)
    expect(sql(`SELECT procuracao_document_id FROM public.ce_unlock_request_bls WHERE request_id='${request.id}' AND bl_id='CE557-SECOND';`)).toBe(replacement)
    expect(request.items.find((i:{bl_id:string})=>i.bl_id==='CE557-A').confirmed).toBe(true)
  })
  it('referência externa e CE confirmado ficam consultáveis só pelo desk',()=>{
    const id=sql("SELECT r.id FROM public.ce_unlock_requests r WHERE r.customer_id=998557 AND r.source='request' AND EXISTS(SELECT 1 FROM public.ce_unlock_request_bls i WHERE i.request_id=r.id AND i.confirmed_at IS NOT NULL) ORDER BY r.created_at DESC LIMIT 1;")
    const internal=JSON.parse(sql(`SELECT public.ce_unlock_read('request',jsonb_build_object('request_id','${id}'));`,admin))
    expect(internal.confirmation_records).toEqual(expect.arrayContaining([expect.objectContaining({bl_id:'CE557-A',ce_mercante:'123456789012345',reference:'Conclusão individual'})]))
    expect(JSON.parse(sql(`SELECT public.portal_get_ce_unlock_request('${id}');`,client)).confirmation_records).toEqual([])
    expect(JSON.parse(sql(`SELECT public.ce_unlock_read('request',jsonb_build_object('request_id','${id}'));`,finance)).confirmation_records).toEqual([])
  })
  it('novo Cliente do BL não recebe protocolo/documentação do Cliente anterior na lista',()=>{
    sql("UPDATE public.bls SET customer_id=998558 WHERE id='CE557-A';")
    try {
      const moved=JSON.parse(sql("SELECT public.portal_list_ce_unlock_bls('{}',1);",foreign)).items.find((i:{bl_id:string})=>i.bl_id==='CE557-A')
      expect(moved).toMatchObject({request_id:null,protocol:null,termo:false,procuracao:false})
    } finally {sql("UPDATE public.bls SET customer_id=998557 WHERE id='CE557-A';")}
  })
  it('cancelar pedido antigo só libera novo pedido após liquidação do Cliente atual',()=>{
    const old=JSON.parse(sql("SELECT public.portal_list_ce_unlock_requests('{}',1);",client)).items.find((r:{state:string})=>r.state==='submitted')
    sql("UPDATE public.bls SET customer_id=998558 WHERE id='CE557-SECOND';")
    let newRequest:{id:string;version:number}|undefined
    try {
      command('cancel',{request_id:old.id,expected_version:old.version,reason:'Consignatário alterado',request_key:crypto.randomUUID()})
      const current=JSON.parse(sql("SELECT public.portal_list_ce_unlock_bls('{}',1);",foreign)).items.find((i:{bl_id:string})=>i.bl_id==='CE557-SECOND')
      expect(current.can_submit).toBe(false)
      // O pagamento anterior permanece histórico; o Cliente atual tem sua própria liquidação.
      sql(`SET session_replication_role=replica;
        UPDATE public.bl_receivables SET source='local_charges_archived:998559',status='void' WHERE id=998559;
        INSERT INTO public.bl_receivables(id,bl_id,customer_id,original_amount_brl,settled_amount_brl,balance_brl,status) VALUES(998560,'CE557-SECOND',998558,100,100,0,'settled');
        INSERT INTO public.ledger_settlements(receivable_id,amount_brl,source) VALUES(998560,100,'manual');
        SET session_replication_role=origin;`)
      const paid=JSON.parse(sql("SELECT public.portal_list_ce_unlock_bls('{}',1);",foreign)).items.find((i:{bl_id:string})=>i.bl_id==='CE557-SECOND')
      expect(paid.can_submit).toBe(true)
      newRequest=JSON.parse(sql(`SELECT public.portal_ce_unlock_command('draft','${JSON.stringify({bl_ids:['CE557-SECOND'],request_key:crypto.randomUUID()})}'::jsonb);`,foreign))
      expect(newRequest?.id).toBeTruthy()
    } finally {
      if(newRequest) command('cancel',{request_id:newRequest.id,expected_version:newRequest.version,reason:'Encerrar fixture',request_key:crypto.randomUUID()})
      sql(`SET session_replication_role=replica;
        DELETE FROM public.ledger_settlements WHERE receivable_id=998560;
        DELETE FROM public.bl_receivables WHERE id=998560;
        UPDATE public.bl_receivables SET source='local_charges',status='settled' WHERE id=998559;
        UPDATE public.bls SET customer_id=998557 WHERE id='CE557-SECOND';
        SET session_replication_role=origin;`)
    }
  })
  it('cleanup de falha de upload não reivindica documento já registrado',()=>{
    const registered=sql("SELECT id FROM public.ce_unlock_documents WHERE customer_id=998557 AND status='uploaded' LIMIT 1;")
    expect(sql(`SELECT public.ce_unlock_abort_upload('${registered}');`)).toBe('')
    expect(sql(`SELECT cleanup_claimed_at IS NULL FROM public.ce_unlock_documents WHERE id='${registered}';`)).toBe('t')
    const pending=sql(`INSERT INTO public.ce_unlock_documents(customer_id,type,source,status,file_name,storage_path,size_bytes,uploaded_by) VALUES(998557,'termo','vip_annual','uploading','orphan.pdf','abort/own-test',10,'${client}') RETURNING id;`)
    expect(sql(`SELECT public.ce_unlock_abort_upload('${pending}');`)).toBe('abort/own-test')
    expect(sql(`SELECT status FROM public.ce_unlock_documents WHERE id='${pending}';`)).toBe('revoked')
    expect(error(`SELECT public.ce_unlock_abort_upload('${pending}');`,client)).toContain('permission denied')
  })
  it('pagamento integral considera o valor corrigido e ainda exige liquidação real',()=>{
    const result=reviewScenario(`
      UPDATE public.bl_receivables SET correction_amount_brl=20,settled_amount_brl=80 WHERE id=998847;
      UPDATE public.ledger_settlements SET amount_brl=80 WHERE receivable_id=998847;
      SELECT ce_unlock_private.item('CE557-REVIEW')->'paid';
      DELETE FROM public.ledger_settlements WHERE receivable_id=998847;
      SELECT ce_unlock_private.item('CE557-REVIEW')->'paid';`)
    expect(result.split('\n')).toEqual(['true','false'])
  })
  it('histórico do cliente e do Financeiro não revela a referência enviada pela UI do desk',()=>{
    const payload=JSON.stringify({request_id:reviewRequest,expected_version:0,bl_id:'CE557-REVIEW',ce_mercante:'123456789018470',reason:'CE-PRIVATE-REFERENCE',reference:'CE-PRIVATE-REFERENCE',request_key:crypto.randomUUID()})
    const result=reviewScenario(`
      UPDATE public.ce_unlock_requests SET state='submitted' WHERE id='${reviewRequest}';
      SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${admin}';
      DO $$ BEGIN PERFORM public.ce_unlock_command('confirm','${payload}'::jsonb); END $$;
      SELECT public.ce_unlock_read('request',jsonb_build_object('request_id','${reviewRequest}'));
      SET LOCAL request.jwt.claim.sub='${client}';
      SELECT public.portal_get_ce_unlock_request('${reviewRequest}');
      SET LOCAL request.jwt.claim.sub='${finance}';
      SELECT public.ce_unlock_read('request',jsonb_build_object('request_id','${reviewRequest}'));`)
    const [desk,portal,summary]=result.split('\n').map(line=>JSON.parse(line))
    expect(desk.confirmation_records[0].reference).toBe('CE-PRIVATE-REFERENCE')
    for(const view of [portal,summary]) {
      expect(view.events.some((e:{action:string})=>e.action==='confirm')).toBe(true)
      expect(JSON.stringify(view)).not.toContain('CE-PRIVATE-REFERENCE')
    }
  })
  it('repetição de comando sanitiza referências em respostas históricas sem alterar o snapshot',()=>{
    const key=crypto.randomUUID()
    const payload=JSON.stringify({request_id:reviewRequest,expected_version:0,request_key:key})
    const result=reviewScenario(`
      INSERT INTO ce_unlock_private.receipts(actor_id,action,request_key,payload,result)
        VALUES('${client}','submit','${key}','${payload}'::jsonb,
          jsonb_build_object('id','${reviewRequest}','version',7,'state','submitted','events',
            jsonb_build_array(jsonb_build_object('action','confirm','reason','CE-PRIVATE-REFERENCE'),jsonb_build_object('action','reject','reason','Documento ilegível'))));
      SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${client}';
      SELECT public.portal_ce_unlock_command('submit','${payload}'::jsonb);`)
    const snapshot=JSON.parse(result)
    expect(snapshot).toEqual({id:reviewRequest,version:7,state:'submitted',events:[{action:'confirm',reason:null},{action:'reject',reason:'Documento ilegível'}]})
  })
  it('tentativa expurgada sem PDF registrado não substitui o termo enviado nem impede sua revisão',()=>{
    const submit=JSON.stringify({request_id:reviewRequest,expected_version:0,request_key:crypto.randomUUID()})
    const review=JSON.stringify({request_id:reviewRequest,expected_version:1,document_id:reviewTerm,expected_document_version:0,bl_ids:['CE557-REVIEW'],decision:'approved',request_key:crypto.randomUUID()})
    const result=reviewScenario(`
      INSERT INTO public.ce_unlock_documents(customer_id,request_id,type,source,status,storage_path,file_name,size_bytes,uploaded_by,created_at)
        VALUES(998557,'${reviewRequest}','termo','request','uploading','review/failed','failed.pdf',10,'${client}',now()-interval '25 hours');
      SELECT public.ce_unlock_cleanup_claim(id) FROM public.ce_unlock_documents WHERE storage_path='review/failed';
      SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${client}';
      SELECT public.portal_ce_unlock_command('submit','${submit}'::jsonb);
      SET LOCAL request.jwt.claim.sub='${admin}';
      SELECT public.ce_unlock_command('review','${review}'::jsonb);`)
    const request=JSON.parse(result.split('\n').at(-1)!)
    expect(request.items[0].termo).toBe(true)
    expect(request.documents.some((d:{file_name:string})=>d.file_name==='failed.pdf')).toBe(false)
  })

  it('reservas abortadas não consomem a quota ativa de PDFs',()=>{
    const result=reviewScenario(`
      INSERT INTO public.ce_unlock_documents(customer_id,request_id,type,source,status,storage_path,file_name,size_bytes,uploaded_by,cleanup_claimed_at,purged_at)
        SELECT 998557,'${reviewRequest}','termo','request','revoked','review/aborted-'||n,'failed.pdf',10485760,'${client}',now(),now() FROM generate_series(1,10) n;
      SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${client}';
      SELECT public.ce_unlock_prepare_upload(jsonb_build_object('source','request','type','termo','request_id','${reviewRequest}','file_name','new.pdf','size_bytes',100))->>'id';`)
    expect(result).toMatch(/^[0-9a-f-]{36}$/)
  })

})

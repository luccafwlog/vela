import { execFileSync } from 'node:child_process'
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
local('desbloqueio CE — SQL real, autorização e requisitos',()=>{
  beforeAll(()=> {
    sql(`SET session_replication_role=replica;
      DELETE FROM ce_unlock_private.receipts WHERE actor_id IN ('${admin}','${client}');
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
      INSERT INTO public.bls(id,voyage_id,customer_id,ce_mercante) VALUES('CE557-A',998557,998557,'123456789012345'),('CE557-B',998557,998558,'123456789012346'),('CE557-NO',998557,998557,NULL),('CE557-PART',998557,998557,'123456789012347'),('CE557-SECOND',998557,998557,'123456789012348') ON CONFLICT DO NOTHING;
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
})

import { execPsql } from './localPsql'
import { describe, expect, it, beforeAll, beforeEach } from 'vitest'

// Desbloqueio de CE (docs/modules/desbloqueio-ce.md, ADR 0087): matriz VIP/anual, expurgo e lotes de
// exportação pelos comandos reais. Fixtures próprias (clientes 998700/998701, B/Ls CE700-*); cada caso
// recomeça do zero em beforeEach, então a ordem dos casos não importa.
const db = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const local = process.env.LOCAL_PG_INTEGRATION === '1' ? describe : describe.skip
const admin = '00000000-0000-0000-0000-000000700001'
const clientA = '00000000-0000-0000-0000-000000700002'
const clientB = '00000000-0000-0000-0000-000000700003'
const A = 998700, B = 998701
function sql(q: string, uid?: string): string {
  // SQL por stdin: argv do psql no Windows corrompe acentos.
  return execPsql(['-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: uid ? `SET ROLE authenticated; SET request.jwt.claim.sub='${uid}'; ${q}` : q, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).replaceAll(String.fromCharCode(13), '').trim()
}
function error(q: string, uid?: string) { try { sql(q, uid); return '' } catch (e) { return String((e as { stderr: string }).stderr) } }
const key = () => crypto.randomUUID()
const command = (action: string, payload: object, uid = admin) => JSON.parse(sql(`SELECT public.${uid === admin ? '' : 'portal_'}ce_unlock_command('${action}', '${JSON.stringify(payload)}'::jsonb);`, uid))
const commandError = (action: string, payload: object, uid = admin) => error(`SELECT public.${uid === admin ? '' : 'portal_'}ce_unlock_command('${action}', '${JSON.stringify(payload)}'::jsonb);`, uid)
const item = (bl: string, request?: string) => JSON.parse(sql(`SELECT ce_unlock_private.item('${bl}'${request ? `,'${request}'` : ''});`))
const view = (id: string) => JSON.parse(sql(`SELECT public.ce_unlock_read('request',jsonb_build_object('request_id','${id}'));`, admin))
const coverage = (uid: string) => JSON.parse(sql('SELECT public.portal_get_ce_unlock_vip_coverage();', uid))
const Y = () => Number(sql('SELECT extract(year FROM ce_unlock_private.today())::int;'))

const reset = `SET session_replication_role=replica;
  DELETE FROM ce_unlock_private.receipts WHERE actor_id IN ('${admin}','${clientA}','${clientB}');
  DELETE FROM ce_unlock_private.upload_attempts WHERE customer_id IN(${A},${B}) OR actor_id IN ('${admin}','${clientA}','${clientB}');
  DELETE FROM public.ce_unlock_email_outbox WHERE customer_id IN(${A},${B});
  DELETE FROM public.portal_notifications WHERE customer_id IN(${A},${B});
  DELETE FROM public.ce_unlock_events WHERE customer_id IN(${A},${B}) OR bl_id LIKE 'CE700-%';
  DELETE FROM public.ce_unlock_request_bls WHERE bl_id LIKE 'CE700-%';
  DELETE FROM public.ce_unlock_exports WHERE created_by='${admin}';
  DELETE FROM public.ce_unlock_documents WHERE customer_id IN(${A},${B});
  DELETE FROM public.ce_unlock_requests WHERE customer_id IN(${A},${B});
  DELETE FROM public.ce_unlock_vip_customers WHERE customer_id IN(${A},${B});
  DELETE FROM public.ce_unlock_bl_deliveries WHERE bl_id LIKE 'CE700-%';
  DELETE FROM public.ce_unlock_zpt_status WHERE bl_id LIKE 'CE700-%';
  DELETE FROM public.ledger_settlements WHERE receivable_id BETWEEN 998700 AND 998709;
  DELETE FROM public.bl_receivables WHERE id BETWEEN 998700 AND 998709;
  INSERT INTO public.bl_receivables(id,bl_id,customer_id,original_amount_brl,settled_amount_brl,balance_brl,status) VALUES
    (998700,'CE700-A1',${A},100,100,0,'settled'),(998701,'CE700-A2',${A},100,100,0,'settled'),(998702,'CE700-A3',${A},100,100,0,'settled'),
    (998703,'CE700-UNPAID',${A},100,0,100,'open'),(998704,'CE700-B1',${B},100,100,0,'settled');
  INSERT INTO public.ledger_settlements(receivable_id,amount_brl,source) VALUES(998700,100,'manual'),(998701,100,'manual'),(998702,100,'manual'),(998704,100,'manual');
  SET session_replication_role=origin;`

// Anexo anual enviado (o upload real depende do Storage); a aprovação passa pelo comando de revisão.
function annual(customer: number, type: 'termo' | 'procuracao', year?: number): string {
  const id = sql(`INSERT INTO public.ce_unlock_documents(customer_id,type,source,status,file_name,storage_path,size_bytes,hash,uploaded_by,created_at)
    VALUES(${customer},'${type}','vip_annual','uploaded','${type}.pdf','ce700/'||gen_random_uuid(),100,repeat('d',64),'${customer === A ? clientA : clientB}',clock_timestamp()) RETURNING id;`)
  if (year !== undefined) command('review', { document_id: id, expected_document_version: 0, decision: 'approved', coverage_year: year, valid_from: `${year}-01-01`, valid_until: `${year}-12-31`, request_key: key() })
  return id
}
const setVip = (customer: number, enabled: boolean) => command('set_vip', { customer_id: customer, enabled, reason: enabled ? 'Cliente VIP' : 'VIP encerrado', request_key: key() })
const deliver = (bl: string) => command('delivery', { bl_id: bl, delivered: true, expected_version: item(bl).delivery_version, request_key: key() })
function submitVip(bls: string[], uid = clientA) {
  const draft = command('draft', { bl_ids: bls, request_key: key() }, uid)
  return command('submit', { request_id: draft.id, expected_version: draft.version, request_key: key() }, uid)
}
// Passagem do tempo: o banco não simula outra data, então a vigência aprovada recua um ano.
const ageOneYear = (ids: string[]) => sql(`UPDATE public.ce_unlock_documents SET coverage_year=coverage_year-1,valid_from=(valid_from-interval '1 year')::date,valid_until=make_date(coverage_year-1,12,31) WHERE id IN (${ids.map(i => `'${i}'`).join(',')});`)
const candidates = () => (JSON.parse(sql('SELECT public.ce_unlock_cleanup_candidates();')) as Array<{ id: string }>).map(c => c.id)

local('desbloqueio CE — matriz VIP, anual, expurgo e lotes', () => {
  beforeAll(() => {
    sql(`INSERT INTO auth.users(id,email) VALUES ('${admin}','ce700-admin@example.test'),('${clientA}','ce700-a@example.test'),('${clientB}','ce700-b@example.test') ON CONFLICT DO NOTHING;
      INSERT INTO public.user_profiles(id,full_name,role,active) VALUES ('${admin}','CE700 admin','administrativo',true) ON CONFLICT DO NOTHING;
      INSERT INTO public.customers(id,cnpj_cpf,name) VALUES (${A},'70000100010085','CE700 A'),(${B},'70000200010001','CE700 B') ON CONFLICT DO NOTHING;
      INSERT INTO public.customer_portal_accounts(customer_id,auth_user_id,active,account_situation) VALUES(${A},'${clientA}',true,'ativo'),(${B},'${clientB}',true,'ativo') ON CONFLICT(customer_id) DO UPDATE SET auth_user_id=EXCLUDED.auth_user_id,active=true;
      INSERT INTO public.carriers(id,name) VALUES(998700,'CE700 carrier') ON CONFLICT DO NOTHING;
      INSERT INTO public.vessels(id,name,carrier_id) VALUES(998700,'CE700 vessel',998700) ON CONFLICT DO NOTHING;
      INSERT INTO public.voyages(id,vessel_id,voyage_number,status) VALUES(998700,998700,'CE-700','active') ON CONFLICT DO NOTHING;
      SET session_replication_role=replica;
      INSERT INTO public.bls(id,voyage_id,customer_id,ce_mercante) VALUES('CE700-A1',998700,${A},'998700000000001'),('CE700-A2',998700,${A},'998700000000002'),('CE700-A3',998700,${A},'998700000000003'),('CE700-UNPAID',998700,${A},'998700000000004'),('CE700-B1',998700,${B},'998700000000005')
        ON CONFLICT(id) DO UPDATE SET customer_id=EXCLUDED.customer_id,ce_mercante=EXCLUDED.ce_mercante,cancelled_at=NULL;
      SET session_replication_role=origin;`)
  })
  beforeEach(() => { sql(`BEGIN; ${reset} COMMIT;`) })

  it('matriz VIP: sem VIP o anual não se aplica; anual vencido não cobre; perda do VIP derruba o requisito', () => {
    const y = Y()
    annual(A, 'termo', y); annual(A, 'procuracao', y)
    // Sem VIP: o rascunho nasce no fluxo comum e exige anexos do pedido.
    const common = command('draft', { bl_ids: ['CE700-A1'], request_key: key() }, clientA)
    expect(common.source).toBe('request')
    expect(commandError('submit', { request_id: common.id, expected_version: common.version, request_key: key() }, clientA)).toContain('Anexe versões atuais')
    command('cancel', { request_id: common.id, expected_version: common.version, request_key: key() }, clientA)
    // Anual vencido não conta como cobertura.
    sql(`DELETE FROM public.ce_unlock_documents WHERE customer_id=${A};`)
    annual(A, 'termo', y - 1); annual(A, 'procuracao', y - 1)
    setVip(A, true)
    expect(coverage(clientA)).toMatchObject({ enabled: true, termo: false, procuracao: false })
    const expired = command('draft', { bl_ids: ['CE700-A1'], request_key: key() }, clientA)
    expect(commandError('submit', { request_id: expired.id, expected_version: expired.version, request_key: key() }, clientA)).toContain('Regularize os documentos anuais VIP')
    expect(commandError('apply_vip', { request_id: expired.id, expected_version: expired.version, request_key: key() })).toContain('Cobertura anual incompleta')
    // Com anual vigente o pedido VIP conclui; ao perder o VIP, a varredura reabre e a exportação é recusada.
    annual(A, 'termo', y); annual(A, 'procuracao', y)
    const sent = command('submit', { request_id: expired.id, expected_version: expired.version, request_key: key() }, clientA)
    expect(sent.items[0]).toMatchObject({ termo: true, procuracao: true })
    deliver('CE700-A1')
    expect(view(expired.id).state).toBe('completed')
    setVip(A, false)
    sql('SELECT public.ce_unlock_refresh_open();')
    expect(view(expired.id).state).toBe('in_review')
    expect(item('CE700-A1')).toMatchObject({ vip: false, termo: false, procuracao: false, can_export: false })
    expect(commandError('export', { bl_ids: ['CE700-A1'], request_key: key() })).toContain('não apto')
    expect(commandError('apply_vip', { request_id: expired.id, expected_version: view(expired.id).version, request_key: key() })).toContain('Cobertura VIP indisponível')
  })

  it('matriz VIP: anual de outro CNPJ não cobre o cliente nem pode ser aplicado', () => {
    const y = Y()
    setVip(A, true); setVip(B, true)
    annual(B, 'termo', y); annual(B, 'procuracao', y)
    expect(coverage(clientB)).toMatchObject({ termo: true, procuracao: true })
    expect(coverage(clientA)).toMatchObject({ termo: false, procuracao: false, documents: [] })
    const draft = command('draft', { bl_ids: ['CE700-A1'], request_key: key() }, clientA)
    expect(commandError('submit', { request_id: draft.id, expected_version: draft.version, request_key: key() }, clientA)).toContain('Regularize os documentos anuais VIP')
    expect(commandError('apply_vip', { request_id: draft.id, expected_version: draft.version, request_key: key() })).toContain('Cobertura anual incompleta')
    expect(sql(`SELECT count(*) FROM public.ce_unlock_request_bls WHERE request_id='${draft.id}' AND (termo_document_id IS NOT NULL OR procuracao_document_id IS NOT NULL);`)).toBe('0')
    // O cliente B também não alcança o pedido do cliente A.
    expect(commandError('submit', { request_id: draft.id, expected_version: draft.version, request_key: key() }, clientB)).toContain('42501')
  })

  it('matriz VIP: VIP nunca dispensa pagamento nem entrega do original', () => {
    const y = Y()
    setVip(A, true); annual(A, 'termo', y); annual(A, 'procuracao', y)
    expect(commandError('draft', { bl_ids: ['CE700-UNPAID'], request_key: key() }, clientA)).toContain('Taxas locais sem liquidação integral confirmada')
    const sent = submitVip(['CE700-A1'])
    expect(sent.state).toBe('submitted')
    expect(sent.items[0]).toMatchObject({ termo: true, procuracao: true, paid: true, delivered: false, can_export: false })
    expect(item('CE700-A1').reasons).toEqual(['B/L físico aguardando entrega'])
    expect(commandError('export', { bl_ids: ['CE700-A1'], request_key: key() })).toContain('B/L físico aguardando entrega')
    deliver('CE700-A1')
    expect(view(sent.id).state).toBe('completed')
    sql("UPDATE public.bl_receivables SET status='partially_settled',balance_brl=50,settled_amount_brl=50 WHERE id=998700; SELECT public.ce_unlock_refresh_open();")
    expect(view(sent.id).state).toBe('in_review')
    expect(commandError('export', { bl_ids: ['CE700-A1'], request_key: key() })).toContain('Taxas locais sem liquidação integral confirmada')
  })

  it('matriz anual: termo vigente com procuração vencida não cobre; vencimento no meio do pedido reabre e a renovação vale para vários itens sem alterar lote anterior', () => {
    const y = Y()
    setVip(A, true)
    const termo = annual(A, 'termo', y)
    const oldProc = annual(A, 'procuracao', y - 1)
    expect(coverage(clientA)).toMatchObject({ termo: true, procuracao: false })
    const draft = command('draft', { bl_ids: ['CE700-A1', 'CE700-A2'], request_key: key() }, clientA)
    expect(commandError('submit', { request_id: draft.id, expected_version: draft.version, request_key: key() }, clientA)).toContain('Regularize')
    const proc = annual(A, 'procuracao', y)
    const first = command('submit', { request_id: draft.id, expected_version: draft.version, request_key: key() }, clientA)
    const second = submitVip(['CE700-A3'])
    for (const bl of ['CE700-A1', 'CE700-A2', 'CE700-A3']) deliver(bl)
    expect([view(first.id).state, view(second.id).state]).toEqual(['completed', 'completed'])
    const lot = command('export', { bl_ids: ['CE700-A1'], request_key: key() })
    const before = sql(`SELECT hash||'|'||snapshot::text FROM public.ce_unlock_exports WHERE id='${lot.id}';`)
    // Pedido atravessa o vencimento: os dois pedidos reabrem e o requisito aponta o documento vencido.
    ageOneYear([termo, proc])
    sql('SELECT public.ce_unlock_refresh_open();')
    expect([view(first.id).state, view(second.id).state]).toEqual(['in_review', 'in_review'])
    expect(item('CE700-A2').reasons).toEqual(['Termo de devolução pendente, vencido ou revogado', 'Procuração pendente, vencida ou revogada'])
    // Renovação: novos anuais aprovados e aplicados a todos os itens abertos.
    const newTermo = annual(A, 'termo', y), newProc = annual(A, 'procuracao', y)
    for (const id of [first.id, second.id]) command('apply_vip', { request_id: id, expected_version: view(id).version, request_key: key() })
    expect([view(first.id).state, view(second.id).state]).toEqual(['completed', 'completed'])
    expect(sql(`SELECT string_agg(bl_id||':'||(termo_document_id='${newTermo}')||(procuracao_document_id='${newProc}'),',' ORDER BY bl_id) FROM public.ce_unlock_request_bls WHERE bl_id LIKE 'CE700-A%';`))
      .toBe('CE700-A1:truetrue,CE700-A2:truetrue,CE700-A3:truetrue')
    // Lote anterior intacto, ainda citando os documentos e a vigência da época.
    expect(sql(`SELECT hash||'|'||snapshot::text FROM public.ce_unlock_exports WHERE id='${lot.id}';`)).toBe(before)
    const snap = JSON.parse(sql(`SELECT snapshot FROM public.ce_unlock_exports WHERE id='${lot.id}';`))[0].documents
    expect(snap).toMatchObject({ termo_id: termo, procuracao_id: proc, termo: { coverage_year: y, valid_until: `${y}-12-31` } })
    expect(error(`UPDATE public.ce_unlock_exports SET snapshot='[]' WHERE id='${lot.id}';`)).not.toBe('')
    expect(oldProc).not.toBe(newProc)
  })

  it('expurgo: reivindicar e registrar de novo não duplica eventos; reivindicado sem registro volta como candidato', () => {
    const draft = command('draft', { bl_ids: ['CE700-A1'], request_key: key() }, clientA)
    const doc = sql(`INSERT INTO public.ce_unlock_documents(customer_id,request_id,type,source,status,file_name,storage_path,size_bytes,hash,uploaded_by) VALUES(${A},'${draft.id}','termo','request','uploaded','t.pdf','ce700/expire-'||gen_random_uuid(),10,'h','${clientA}') RETURNING id;`)
    sql(`UPDATE public.ce_unlock_requests SET created_at=now()-interval '8 days' WHERE id='${draft.id}';`)
    expect(candidates()).toContain(doc)
    expect(sql(`SELECT public.ce_unlock_cleanup_claim('${doc}')->>'id';`)).toBe(doc)
    // Falha física antes do registro: o arquivo continua candidato e a nova reivindicação não repete eventos.
    expect(candidates()).toContain(doc)
    expect(sql(`SELECT public.ce_unlock_cleanup_claim('${doc}')->>'id';`)).toBe(doc)
    expect(sql(`SELECT count(*) FROM public.ce_unlock_events WHERE request_id='${draft.id}' AND action='expire_draft';`)).toBe('1')
    expect(sql(`SELECT state||':'||version FROM public.ce_unlock_requests WHERE id='${draft.id}';`)).toBe('cancelled:1')
    sql(`SELECT public.ce_unlock_cleanup_record('${doc}');`)
    const purged = sql(`SELECT purged_at||'|'||version FROM public.ce_unlock_documents WHERE id='${doc}';`)
    expect(candidates()).not.toContain(doc)
    expect(sql(`SELECT public.ce_unlock_cleanup_claim('${doc}') IS NULL;`)).toBe('t')
    expect(error(`SELECT public.ce_unlock_cleanup_record('${doc}');`)).toContain('não reivindicado')
    expect(sql(`SELECT purged_at||'|'||version FROM public.ce_unlock_documents WHERE id='${doc}';`)).toBe(purged)
    expect(sql(`SELECT count(*) FROM public.ce_unlock_events WHERE request_id='${draft.id}';`)).toBe('2') // draft + expire_draft
  })

  it('expurgo preserva anuais vigentes sem pedido, inclusive os usados por pedido enviado há mais de 30 dias', () => {
    const y = Y()
    setVip(A, true)
    const termo = annual(A, 'termo', y), proc = annual(A, 'procuracao', y)
    const pending = annual(A, 'termo')
    sql(`UPDATE public.ce_unlock_documents SET created_at=now()-interval '3 days' WHERE id='${pending}';`)
    const sent = submitVip(['CE700-A1'])
    sql(`UPDATE public.ce_unlock_events SET created_at=now()-interval '31 days' WHERE request_id='${sent.id}' AND action='submit';`)
    const all = candidates()
    for (const id of [termo, proc, pending]) expect(all).not.toContain(id)
    expect(sql(`SELECT public.ce_unlock_cleanup_claim('${termo}') IS NULL;`)).toBe('t')
    expect(item('CE700-A1', sent.id)).toMatchObject({ termo: true, procuracao: true })
  })

  it('quota VIP: reservas reivindicadas ou expurgadas não consomem; anuais ativos consomem', () => {
    setVip(A, true)
    const prepare = (fill: string) => sql(`BEGIN;
      INSERT INTO public.ce_unlock_documents(customer_id,type,source,status,storage_path,file_name,size_bytes,uploaded_by,cleanup_claimed_at,purged_at)
        SELECT ${A},'termo','vip_annual','${fill}','ce700/quota-'||n,'q.pdf',10485760,'${clientA}',${fill === 'revoked' ? 'now(),CASE WHEN n%2=0 THEN now() END' : 'NULL,NULL'} FROM generate_series(1,10) n;
      SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${clientA}';
      SELECT public.ce_unlock_prepare_upload('{"source":"vip_annual","type":"procuracao","file_name":"p.pdf","size_bytes":100}')->>'storage_path';
      ROLLBACK;`)
    expect(prepare('revoked')).toMatch(/^998700\/[0-9a-f-]{36}\.pdf$/)
    expect(() => prepare('uploaded')).toThrow(/Quota de documentos ativos/)
  })

  it('exportação: revogação entre pedido e exportação recusa novo lote e preserva o anterior com origem, versão e vigência', () => {
    const y = Y()
    setVip(A, true)
    const termo = annual(A, 'termo', y), proc = annual(A, 'procuracao', y)
    submitVip(['CE700-A1', 'CE700-A2'])
    deliver('CE700-A1'); deliver('CE700-A2')
    const lot = command('export', { bl_ids: ['CE700-A1'], request_key: key() })
    const row = JSON.parse(sql(`SELECT row_to_json(e) FROM public.ce_unlock_exports e WHERE id='${lot.id}';`))
    expect(row.snapshot).toHaveLength(1)
    expect(row.snapshot[0]).toMatchObject({ bl_id: 'CE700-A1', source: 'vip_annual', vip: true, paid: true, delivered: true })
    expect(row.snapshot[0].documents).toMatchObject({
      termo_id: termo, procuracao_id: proc,
      termo: { id: termo, source: 'vip_annual', status: 'approved', version: 1, coverage_year: y, valid_from: `${y}-01-01`, valid_until: `${y}-12-31`, customer_id: A },
      procuracao: { id: proc, source: 'vip_annual', status: 'approved', version: 1, coverage_year: y },
    })
    // Revogação pela revisão real: a procuração deixa de valer para o item ainda não exportado.
    command('review', { document_id: proc, expected_document_version: 1, decision: 'revoked', reason: 'Procuração revogada pelo cliente', request_key: key() })
    expect(commandError('export', { bl_ids: ['CE700-A2'], request_key: key() })).toContain('Procuração pendente, vencida ou revogada')
    expect(commandError('export', { bl_ids: ['CE700-A1', 'CE700-A2'], request_key: key() })).toContain('não apto')
    const after = JSON.parse(sql(`SELECT row_to_json(e) FROM public.ce_unlock_exports e WHERE id='${lot.id}';`))
    expect(after).toEqual(row)
    expect(sql(`SELECT count(*) FROM public.ce_unlock_exports WHERE created_by='${admin}';`)).toBe('1')
    expect(sql("SELECT string_agg(bl_id||':'||(export_id IS NOT NULL),',' ORDER BY bl_id) FROM public.ce_unlock_request_bls WHERE bl_id IN('CE700-A1','CE700-A2');")).toBe('CE700-A1:true,CE700-A2:false')
    // Vencimento entre pedido e exportação também recusa.
    const p2 = annual(A, 'procuracao', y)
    const req = sql("SELECT request_id FROM public.ce_unlock_request_bls WHERE bl_id='CE700-A2';")
    // A revisão anual não reabre o pedido concluído; a varredura do job reabre antes de reaplicar.
    expect(view(req).state).toBe('completed')
    sql('SELECT public.ce_unlock_refresh_open();')
    expect(view(req).state).toBe('in_review')
    command('apply_vip', { request_id: req, expected_version: view(req).version, request_key: key() })
    ageOneYear([termo])
    expect(commandError('export', { bl_ids: ['CE700-A2'], request_key: key() })).toContain('Termo de devolução pendente, vencido ou revogado')
    expect(sql(`SELECT procuracao_document_id FROM public.ce_unlock_request_bls WHERE bl_id='CE700-A2';`)).toBe(p2)
  })

  it('fluxo VIP completo: dois pedidos sem reanexação, vencimento, renovação e histórico preservado', () => {
    const y = Y()
    setVip(A, true)
    const termo = annual(A, 'termo', y), proc = annual(A, 'procuracao', y)
    const one = submitVip(['CE700-A1']), two = submitVip(['CE700-A2'])
    // Nenhum anexo próprio do pedido: os dois usam os mesmos anuais.
    expect(sql(`SELECT count(*) FROM public.ce_unlock_documents WHERE request_id IN('${one.id}','${two.id}');`)).toBe('0')
    expect(sql(`SELECT count(DISTINCT termo_document_id)||':'||count(DISTINCT procuracao_document_id) FROM public.ce_unlock_request_bls WHERE request_id IN('${one.id}','${two.id}');`)).toBe('1:1')
    deliver('CE700-A1'); deliver('CE700-A2')
    const lot = command('export', { bl_ids: ['CE700-A1', 'CE700-A2'], request_key: key() })
    expect(lot.rows).toHaveLength(2)
    // Vencimento e renovação.
    ageOneYear([termo, proc])
    sql('SELECT public.ce_unlock_refresh_open();')
    expect([view(one.id).state, view(two.id).state]).toEqual(['in_review', 'in_review'])
    const termo2 = annual(A, 'termo', y), proc2 = annual(A, 'procuracao', y)
    expect(coverage(clientA)).toMatchObject({ termo: true, procuracao: true })
    for (const id of [one.id, two.id]) command('apply_vip', { request_id: id, expected_version: view(id).version, request_key: key() })
    expect([view(one.id).state, view(two.id).state]).toEqual(['completed', 'completed'])
    const relot = command('export', { bl_ids: ['CE700-A1', 'CE700-A2'], request_key: key(), reexport_of: lot.id })
    expect(relot.snapshot.map((s: { documents: { termo_id: string } }) => s.documents.termo_id)).toEqual([termo2, termo2])
    expect(lot.snapshot.map((s: { documents: { termo_id: string } }) => s.documents.termo_id)).toEqual([termo, termo])
    expect(sql(`SELECT snapshot->0->'documents'->>'procuracao_id' FROM public.ce_unlock_exports WHERE id='${lot.id}';`)).toBe(proc)
    expect(proc2).not.toBe(proc)
    // Histórico: eventos de ciclo de vida preservados; o Portal não vê exportação nem aplicação interna.
    const actions = view(one.id).events.map((e: { action: string }) => e.action)
    for (const a of ['draft', 'submit', 'complete', 'reopen', 'apply_vip']) expect(actions).toContain(a)
    expect(actions.filter((a: string) => a === 'complete')).toHaveLength(2)
    const portal = JSON.parse(sql(`SELECT public.portal_get_ce_unlock_request('${one.id}');`, clientA))
    expect(portal.events.map((e: { action: string }) => e.action)).not.toContain('apply_vip')
    // Anuais antigos seguem no banco; só saem no expurgo agora que há renovação aprovada.
    expect(sql(`SELECT count(*) FROM public.ce_unlock_documents WHERE id IN('${termo}','${proc}') AND purged_at IS NULL;`)).toBe('2')
    const all = candidates()
    expect(all).toEqual(expect.arrayContaining([termo, proc]))
    for (const id of [termo2, proc2]) expect(all).not.toContain(id)
  })
})

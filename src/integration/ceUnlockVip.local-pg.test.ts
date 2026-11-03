import { execPsql } from './localPsql'
import { describe, expect, it, beforeAll, beforeEach } from 'vitest'
import { legacyVipRequest } from './ceUnlockLegacyVip'

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
  DELETE FROM public.ce_unlock_direct_validations WHERE bl_id LIKE 'CE700-%';
  DELETE FROM public.ce_unlock_direct_exports WHERE bl_id LIKE 'CE700-%';
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
// 581 (ADR 0119): o B/L coberto pelos anuais não entra mais em solicitação. As VIP abertas
// antes continuam em produção; o fixture as grava como o envio de antes gravava.
function submitVip(bls: string[], uid = clientA) {
  const legacy = legacyVipRequest(A, bls, uid)
  sql(legacy.sql)
  return JSON.parse(sql(`SELECT public.portal_get_ce_unlock_request('${legacy.id}');`, uid))
}
const VIP_REFUSAL = 'não precisa de solicitação: pela condição VIP'
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
    // 449/ponto 13: com o anual vencido, o pedido do VIP nasce comum e pede termo e procuração anexados.
    const fallback = command('draft', { bl_ids: ['CE700-A1'], request_key: key() }, clientA)
    expect(fallback.source).toBe('request')
    expect(commandError('submit', { request_id: fallback.id, expected_version: fallback.version, request_key: key() }, clientA)).toContain('Anexe versões atuais')
    expect(commandError('apply_vip', { request_id: fallback.id, expected_version: fallback.version, request_key: key() })).toContain('Cobertura VIP indisponível')
    command('cancel', { request_id: fallback.id, expected_version: fallback.version, request_key: key() }, clientA)
    // Com anual vigente o B/L não entra mais em solicitação (581); a VIP aberta antes conclui
    // e, ao perder o VIP, a varredura reabre e a exportação é recusada.
    annual(A, 'termo', y); annual(A, 'procuracao', y)
    expect(commandError('draft', { bl_ids: ['CE700-A1'], request_key: key() }, clientA)).toContain(VIP_REFUSAL)
    const expired = submitVip(['CE700-A1'])
    expect(expired.source).toBe('vip_annual')
    expect(expired.items[0]).toMatchObject({ termo: true, procuracao: true })
    deliver('CE700-A1')
    expect(view(expired.id).state).toBe('completed')
    setVip(A, false)
    sql('SELECT public.ce_unlock_refresh_open();')
    expect(view(expired.id).state).toBe('in_review')
    expect(item('CE700-A1')).toMatchObject({ vip: false, termo: false, procuracao: false, can_export: false })
    expect(commandError('export', { bl_ids: ['CE700-A1'], request_key: key() })).toContain('não apto')
    expect(commandError('apply_vip', { request_id: expired.id, expected_version: view(expired.id).version, request_key: key() })).toContain('Cobertura VIP indisponível')
  })

  it('581: o B/L VIP coberto pelos dois anuais fica apto sem solicitação com o pagamento e a entrega', () => {
    const y = Y()
    // Sem VIP, sem solicitação: pendente, mesmo com anuais aprovados.
    annual(A, 'termo', y)
    expect(item('CE700-A1')).toMatchObject({ state: 'no_request', vip: false, vip_covered: false, vip_direct: false, direct: false, termo: false, procuracao: false })
    // VIP com só um dos anuais: segue o fluxo comum, com solicitação e os dois documentos.
    setVip(A, true)
    expect(item('CE700-A1')).toMatchObject({ vip: true, vip_direct: false, direct: false, termo: false, procuracao: false, can_submit: true })
    annual(A, 'procuracao', y)
    // Os dois anuais cobrindo: não há solicitação; falta só o original.
    expect(item('CE700-A1')).toMatchObject({ state: 'no_request', vip_covered: true, vip_direct: true, direct: true, termo: true, procuracao: true,
      paid: true, delivered: false, can_submit: false, can_export: false, sla_started_at: null })
    expect(item('CE700-A1').reasons).toEqual(['B/L físico aguardando entrega'])
    expect(commandError('draft', { bl_ids: ['CE700-A1'], request_key: key() }, clientA)).toContain(VIP_REFUSAL)
    expect(commandError('export', { bl_ids: ['CE700-A1'], request_key: key() })).toContain('B/L físico aguardando entrega')
    // A entrega deixa o B/L apto, valida na hora e avisa o Cliente pelo B/L (sino e e-mail).
    deliver('CE700-A1')
    const ready = item('CE700-A1')
    expect(ready).toMatchObject({ can_export: true, reasons: [] })
    expect(ready.sla_started_at).not.toBeNull()
    expect(sql(`SELECT count(*) FROM public.ce_unlock_direct_validations WHERE bl_id='CE700-A1' AND customer_id=${A};`)).toBe('1')
    const notice = sql(`SELECT message FROM public.portal_notifications WHERE customer_id=${A} AND bl_id='CE700-A1';`)
    expect(notice).toContain('A documentação do B/L CE700-A1 (CE 998700000000001) foi validada pela sua condição VIP')
    expect(notice).toContain('Prazo para o desbloqueio: até')
    expect(notice).toContain('SISCARGA')
    expect(notice).not.toMatch(/ZPT/i)
    expect(sql(`SELECT kind||':'||(request_id IS NULL) FROM public.ce_unlock_email_outbox WHERE customer_id=${A} AND bl_id='CE700-A1';`)).toBe('documentation_validated:true')
    // A fila de envio entrega o B/L do aviso.
    expect(JSON.parse(sql('SELECT public.ce_unlock_email_pending(100);')).find((r: { bl_id: string | null }) => r.bl_id === 'CE700-A1'))
      .toMatchObject({ request_id: null, kind: 'documentation_validated' })
    // Desmarcar e marcar de novo, e a varredura, não repetem o aviso.
    command('delivery', { bl_id: 'CE700-A1', delivered: false, reason: 'Conferência', expected_version: item('CE700-A1').delivery_version, request_key: key() })
    expect(item('CE700-A1')).toMatchObject({ can_export: false, sla_started_at: null })
    deliver('CE700-A1')
    sql('SELECT public.ce_unlock_refresh_open();')
    expect(sql(`SELECT count(*) FROM public.portal_notifications WHERE customer_id=${A} AND bl_id='CE700-A1';`)).toBe('1')
    // O histórico do B/L mostra a validação.
    const history = JSON.parse(sql(`SELECT public.ce_unlock_read('bl_history',jsonb_build_object('bl_id','CE700-A1'));`, admin)) as { events: Array<{ event: string; actor: string | null }> }
    expect(history.events.find((e) => e.event === 'vip_validated')).toMatchObject({ actor: 'CE700 admin' })
    // Exportação: as quatro colunas "Sim", com o envio guardado no B/L.
    const lot = command('export', { bl_ids: ['CE700-A1'], request_key: key() })
    expect(lot.rows).toEqual([{ bl_id: 'CE700-A1', termo: true, procuracao: true, delivered: true, paid: true }])
    expect(item('CE700-A1')).toMatchObject({ direct: true, export_state: 'exported', sent_to_zpt: true })
    // Perdido o VIP depois do envio: o envio fica e o B/L não passa a pedir solicitação.
    setVip(A, false)
    expect(item('CE700-A1')).toMatchObject({ direct: true, vip_direct: false, export_state: 'exported', can_submit: false, can_export: false })
    // O filtro "Requisito pendente" da aba Andamento lê os mesmos campos: o B/L sem VIP volta a pendente.
    const pending = (req: string) => (JSON.parse(sql(`SELECT public.ce_unlock_read('bls',jsonb_build_object('filters',jsonb_build_object('search','CE700-A2','pending_requirement','${req}'),'page',1));`, admin)) as { items: Array<{ bl_id: string }> }).items.map((i) => i.bl_id)
    expect(pending('termo')).toContain('CE700-A2')
    // O Portal recebe vip_direct, mas nunca o envio à ZPT.
    setVip(A, true)
    const portal = (JSON.parse(sql("SELECT public.portal_list_ce_unlock_bls('{}',1);", clientA)) as { items: Array<Record<string, unknown>> }).items.find((i) => i.bl_id === 'CE700-A2')
    expect(portal).toMatchObject({ vip_direct: true, direct: true, can_submit: false })
    expect(portal).not.toHaveProperty('export_state')
  })

  it('581: a varredura valida o B/L pago fora do módulo; o anual cobre o dia do pagamento e da entrega', () => {
    const y = Y()
    setVip(A, true); annual(A, 'termo', y); annual(A, 'procuracao', y)
    // Entregue e sem pagamento: direto, mas não apto e sem aviso.
    deliver('CE700-UNPAID')
    expect(item('CE700-UNPAID')).toMatchObject({ direct: true, vip_direct: true, paid: false, can_export: false })
    expect(item('CE700-UNPAID').reasons).toEqual(['Taxas locais sem liquidação integral confirmada'])
    expect(sql(`SELECT count(*) FROM public.portal_notifications WHERE customer_id=${A};`)).toBe('0')
    // Baixa feita fora do módulo: a varredura do job valida e avisa.
    sql(`UPDATE public.bl_receivables SET status='settled',balance_brl=0,settled_amount_brl=100 WHERE id=998703;
      INSERT INTO public.ledger_settlements(receivable_id,amount_brl,source) VALUES(998703,100,'manual');`)
    expect(item('CE700-UNPAID')).toMatchObject({ can_export: true, sla_started_at: null })
    expect(Number(sql('SELECT public.ce_unlock_refresh_open();'))).toBeGreaterThanOrEqual(1)
    expect(item('CE700-UNPAID').sla_started_at).not.toBeNull()
    expect(sql(`SELECT count(*) FROM public.portal_notifications WHERE customer_id=${A} AND bl_id='CE700-UNPAID';`)).toBe('1')
    // Vigência: só o anual do ano passado. Pago e entregue hoje, o B/L não é coberto e segue
    // o fluxo comum; pago e entregue em 20/12 do ano passado, é coberto mesmo exportado agora.
    sql(`DELETE FROM public.ce_unlock_documents WHERE customer_id=${A};`)
    annual(A, 'termo', y - 1); annual(A, 'procuracao', y - 1)
    deliver('CE700-A2')
    expect(item('CE700-A2')).toMatchObject({ vip_direct: false, direct: false, can_submit: true, can_export: false })
    sql(`SET session_replication_role=replica;
      UPDATE public.ce_unlock_bl_deliveries SET updated_at='${y - 1}-12-20T10:00:00-03:00' WHERE bl_id='CE700-A2';
      UPDATE public.ledger_settlements SET created_at='${y - 1}-12-19T10:00:00-03:00' WHERE receivable_id=998701;`)
    expect(sql("SELECT ce_unlock_private.direct_day('CE700-A2');")).toBe(`${y - 1}-12-20`)
    expect(item('CE700-A2')).toMatchObject({ vip_direct: true, direct: true, termo: true, procuracao: true, can_submit: false, can_export: true })
    // Ainda não pago e entregue, vale hoje: o anual do ano passado não cobre o B/L A3.
    expect(item('CE700-A3')).toMatchObject({ vip_direct: false, direct: false })
  })

  it('581: rascunho não segura o B/L VIP coberto; o envio do rascunho é recusado e a VIP enviada continua', () => {
    const y = Y()
    // Rascunho comum, criado sem VIP, com termo e procuração anexados.
    annual(A, 'termo', y); annual(A, 'procuracao', y)
    const common = command('draft', { bl_ids: ['CE700-A1'], request_key: key() }, clientA)
    expect(common.source).toBe('request')
    sql(`INSERT INTO public.ce_unlock_documents(customer_id,request_id,type,source,status,file_name,storage_path,size_bytes,hash,uploaded_by)
      SELECT ${A},'${common.id}',t,'request','uploaded',t||'.pdf','ce700/draft-'||t||'-'||gen_random_uuid(),10,'h','${clientA}' FROM unnest(array['termo','procuracao']) t;`)
    // Virou VIP coberto: o rascunho não segura o B/L, que segue sem solicitação.
    setVip(A, true)
    expect(item('CE700-A1')).toMatchObject({ state: 'no_request', direct: true, vip_direct: true, termo: true, procuracao: true })
    const current = JSON.parse(sql(`SELECT public.portal_get_ce_unlock_request('${common.id}');`, clientA))
    const refused = commandError('submit', { request_id: common.id, expected_version: current.version, request_key: key() }, clientA)
    expect(refused).toContain(VIP_REFUSAL)
    expect(refused).toContain('Cancele este rascunho')
    // Rascunho VIP aberto antes da 581: a mesma recusa.
    const legacy = legacyVipRequest(A, ['CE700-A2'], clientA, 'draft')
    sql(legacy.sql)
    expect(item('CE700-A2')).toMatchObject({ state: 'no_request', direct: true })
    expect(commandError('submit', { request_id: legacy.id, expected_version: 0, request_key: key() }, clientA)).toContain(VIP_REFUSAL)
    command('cancel', { request_id: legacy.id, expected_version: 0, request_key: key() }, clientA)
    // Solicitação VIP enviada antes da 581: continua sendo o caminho do B/L.
    const sent = submitVip(['CE700-A3'])
    expect(item('CE700-A3')).toMatchObject({ request_id: sent.id, state: 'submitted', direct: false, vip_direct: true, termo: true, procuracao: true, can_submit: false })
    deliver('CE700-A3')
    expect(view(sent.id).state).toBe('completed')
    // A validação do B/L direto não vale para o B/L da solicitação: o aviso é o da solicitação.
    expect(sql(`SELECT count(*) FROM public.ce_unlock_direct_validations WHERE bl_id='CE700-A3';`)).toBe('0')
    expect(sql(`SELECT count(*) FROM public.ce_unlock_email_outbox WHERE request_id='${sent.id}';`)).toBe('1')
  })

  it('577: busca com espaço e "&", filtros de requisito atendido e VIP, e histórico do B/L sem solicitação', () => {
    const list = (filters: object) => (JSON.parse(sql(`SELECT public.ce_unlock_read('bls',jsonb_build_object('filters','${JSON.stringify(filters)}'::jsonb,'page',1));`, admin)) as { items: Array<{ bl_id: string }> })
      .items.map((i) => i.bl_id).filter((b) => b.startsWith('CE700-')).sort()
    // Busca: espaço nas pontas ou no meio do B/L, e "&" com ou sem espaço.
    expect(list({ search: ' CE700-A2 ' })).toEqual(['CE700-A2'])
    expect(list({ search: 'CE700 -A2' })).toEqual(['CE700-A2'])
    expect(list({ search: 'CE700-A1&CE700-A2' })).toEqual(['CE700-A1', 'CE700-A2'])
    expect(list({ search: 'CE700-A1 & CE700-A3' })).toEqual(['CE700-A1', 'CE700-A3'])
    // Entrega sem solicitação: registrar e desmarcar, com motivo.
    deliver('CE700-A2')
    command('delivery', { bl_id: 'CE700-A2', delivered: false, reason: 'Marcado no B/L errado', expected_version: item('CE700-A2').delivery_version, request_key: key() })
    deliver('CE700-A2')
    // Requisito atendido: o inverso do pendente.
    expect(list({ search: 'CE700', met_requirement: 'bl_fisico' })).toEqual(['CE700-A2'])
    expect(list({ search: 'CE700', met_requirement: 'taxas' })).toEqual(['CE700-A1', 'CE700-A2', 'CE700-A3', 'CE700-B1'])
    // VIP: Cliente VIP, solicitação VIP e Cliente sem VIP.
    const y = Y()
    setVip(A, true); annual(A, 'termo', y); annual(A, 'procuracao', y)
    submitVip(['CE700-A1'])
    expect(list({ search: 'CE700', vip: 'customer' })).toEqual(['CE700-A1', 'CE700-A2', 'CE700-A3', 'CE700-UNPAID'])
    expect(list({ search: 'CE700', vip: 'request' })).toEqual(['CE700-A1'])
    expect(list({ search: 'CE700', vip: 'none' })).toEqual(['CE700-B1'])
    // Histórico do B/L sem solicitação: entrega com quem e motivo, baixa das Taxas Locais e anuais que o cobrem.
    const history = JSON.parse(sql(`SELECT public.ce_unlock_read('bl_history',jsonb_build_object('bl_id','CE700-A2'));`, admin)) as {
      item: { bl_id: string; state: string }; events: Array<{ requirement: string; event: string; actor: string | null; reason: string | null; amount: number | null; detail: string | null }>
    }
    expect(history.item).toMatchObject({ bl_id: 'CE700-A2', state: 'no_request' })
    expect(history.events.filter((e) => e.requirement === 'bl_original').map((e) => [e.event, e.actor, e.reason])).toEqual([
      ['delivered', 'CE700 admin', null], ['undelivered', 'CE700 admin', 'Marcado no B/L errado'], ['delivered', 'CE700 admin', null],
    ])
    expect(history.events.find((e) => e.requirement === 'taxas')).toMatchObject({ event: 'settled', amount: 100, detail: 'baixa manual' })
    expect(history.events.filter((e) => e.requirement === 'termo' || e.requirement === 'procuracao').map((e) => [e.requirement, e.event, e.detail]).sort())
      .toEqual([['procuracao', 'approved', `Anual VIP ${y}`], ['termo', 'approved', `Anual VIP ${y}`]])
    // O B/L da solicitação traz o andamento dela.
    const sent = JSON.parse(sql(`SELECT public.ce_unlock_read('bl_history',jsonb_build_object('bl_id','CE700-A1'));`, admin)) as { events: Array<{ event: string; actor: string | null }> }
    expect(sent.events.map((e) => e.event)).toEqual(expect.arrayContaining(['request_draft', 'request_submit']))
    expect(sent.events.find((e) => e.event === 'request_submit')?.actor).toBe('Cliente pelo Portal')
    // Leitura do Portal não tem o histórico.
    expect(error(`SELECT public.ce_unlock_read('bl_history',jsonb_build_object('bl_id','CE700-A1'));`, clientA)).toContain('42501')
  })

  it('matriz VIP: anual de outro CNPJ não cobre o cliente nem pode ser aplicado', () => {
    const y = Y()
    setVip(A, true); setVip(B, true)
    annual(B, 'termo', y); annual(B, 'procuracao', y)
    expect(coverage(clientB)).toMatchObject({ termo: true, procuracao: true })
    expect(coverage(clientA)).toMatchObject({ termo: false, procuracao: false, documents: [] })
    const draft = command('draft', { bl_ids: ['CE700-A1'], request_key: key() }, clientA)
    // O anual de B não cobre A: o pedido de A nasce comum (449).
    expect(draft.source).toBe('request')
    expect(commandError('submit', { request_id: draft.id, expected_version: draft.version, request_key: key() }, clientA)).toContain('Anexe versões atuais')
    expect(commandError('apply_vip', { request_id: draft.id, expected_version: draft.version, request_key: key() })).toContain('Cobertura VIP indisponível')
    expect(sql(`SELECT count(*) FROM public.ce_unlock_request_bls WHERE request_id='${draft.id}' AND (termo_document_id IS NOT NULL OR procuracao_document_id IS NOT NULL);`)).toBe('0')
    // O cliente B também não alcança o pedido do cliente A.
    expect(commandError('submit', { request_id: draft.id, expected_version: draft.version, request_key: key() }, clientB)).toContain('42501')
  })

  it('matriz VIP: VIP nunca dispensa pagamento nem entrega do original', () => {
    const y = Y()
    setVip(A, true); annual(A, 'termo', y); annual(A, 'procuracao', y)
    // 581: sem solicitação, o B/L não pago fica pendente das taxas; o Cliente não pede.
    expect(commandError('draft', { bl_ids: ['CE700-UNPAID'], request_key: key() }, clientA)).toContain(VIP_REFUSAL)
    expect(item('CE700-UNPAID').reasons).toEqual(['Taxas locais sem liquidação integral confirmada', 'B/L físico aguardando entrega'])
    expect(commandError('export', { bl_ids: ['CE700-UNPAID'], request_key: key() })).toContain('Taxas locais sem liquidação integral confirmada')
    // Na VIP aberta antes da 581, também.
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
    const common = command('draft', { bl_ids: ['CE700-A1', 'CE700-A2'], request_key: key() }, clientA)
    // Procuração anual vencida: o pedido nasce comum e pede os anexos (449, ponto 13).
    expect(common.source).toBe('request')
    expect(commandError('submit', { request_id: common.id, expected_version: common.version, request_key: key() }, clientA)).toContain('Anexe versões atuais')
    command('cancel', { request_id: common.id, expected_version: common.version, request_key: key() }, clientA)
    const proc = annual(A, 'procuracao', y)
    const first = submitVip(['CE700-A1', 'CE700-A2'])
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

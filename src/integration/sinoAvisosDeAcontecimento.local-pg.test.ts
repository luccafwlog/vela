import { describe, expect, it } from 'vitest'
import { spawnPsql } from './localPsql'
import { syntheticCnpj } from './localTestData'

// Migration 595 (decisão do dono de 2026-11-05, ADR 0126): o sino avisa a
// Documentação da solicitação de Desbloqueio de CE enviada e o Financeiro e o
// Administrativo de cada novo pagamento, com o Aviso de acontecimento (sem
// Alerta), que fica no sino até ser lido. Cada cenário roda numa transação
// desfeita no fim.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const DOC = '59500000-0000-4000-8000-000000000001'
const FIN = '59500000-0000-4000-8000-000000000002'
const ADM = '59500000-0000-4000-8000-000000000003'
const OPE = '59500000-0000-4000-8000-000000000004'
const INT = '59500000-0000-4000-8000-000000000005'
// Conta do Portal: usuário do Auth sem linha em `user_profiles`.
const PORTAL = '59500000-0000-4000-8000-000000000006'
const CUSTOMER = 595001
const REQUEST = '59500000-0000-4000-8000-0000000000a1'
const VIP_REQUEST = '59500000-0000-4000-8000-0000000000a2'

const FIXTURES = `
  INSERT INTO auth.users (id, email) VALUES ('${DOC}', 'r595-doc@example.test'), ('${FIN}', 'r595-fin@example.test'),
    ('${ADM}', 'r595-adm@example.test'), ('${OPE}', 'r595-ope@example.test'), ('${INT}', 'r595-int@example.test'),
    ('${PORTAL}', 'r595-portal@example.test');
  INSERT INTO public.user_profiles (id, full_name, role, active, account_kind) VALUES
    ('${DOC}', 'R595 Documentação', 'documentacao', true, 'pessoa'),
    ('${FIN}', 'R595 Financeiro', 'financeiro', true, 'pessoa'),
    ('${ADM}', 'R595 Administrativo', 'administrativo', true, 'pessoa'),
    ('${OPE}', 'R595 Operações', 'operacoes', true, 'pessoa'),
    ('${INT}', 'R595 Integração', 'documentacao', true, 'integracao');
  INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER}, 'R595 Cliente', '${syntheticCnpj(595001)}');
`

function scenario(sql: string): string[] {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `BEGIN; ${FIXTURES} ${sql} ROLLBACK;`],
    { encoding: 'utf8' })
  expect(run.stderr).not.toMatch(/ERROR/)
  return run.stdout.split('\n').filter((line) => line.startsWith('>'))
}

/** Avisos dos usuários da suíte: `>setor|título|mensagem|destino`, na ordem dos setores. */
const notices = (keyPrefix: string) => `SELECT '>' || n.recipient_department || '|' || n.title || '|' || n.message || '|' || n.destination
  FROM public.internal_notifications n
  WHERE n.event_key LIKE '${keyPrefix}%' AND n.recipient_id IN ('${DOC}', '${FIN}', '${ADM}', '${OPE}', '${INT}')
  ORDER BY n.recipient_department, n.id;`

const asUser = (id: string) => `SELECT set_config('request.jwt.claim.role', 'authenticated', true) IS NOT NULL,
  set_config('request.jwt.claim.sub', '${id}', true) IS NOT NULL;`

describeLocal('595 — sino avisa solicitação de Desbloqueio de CE e pagamento', () => {
  it('pagamento de fatura avisa Financeiro e Administrativo, com o valor e o meio', () => {
    const lines = scenario(`
      INSERT INTO public.invoices (id, invoice_number, customer_id, status, total_brl) VALUES (595001, 'FAT-595', ${CUSTOMER}, 'issued', 2000);
      INSERT INTO public.payments (invoice_id, amount_brl, payment_method, paid_at) VALUES (595001, 1234.5, 'pix', now());
      ${notices('payment:')}`)
    expect(lines).toEqual([
      '>administrativo|Novo pagamento|Fatura FAT-595 — R595 Cliente: R$ 1.234,50 (Pix).|/taxas-locais?invoice=595001',
      '>financeiro|Novo pagamento|Fatura FAT-595 — R595 Cliente: R$ 1.234,50 (Pix).|/taxas-locais?invoice=595001',
    ])
  })

  it('Invoice de Demurrage paga avisa os dois setores; a quitação por desconto integral (R$ 0) não avisa', () => {
    // A Invoice entra sem gatilhos nem B/L; o que se mede é a passagem para paga.
    const lines = scenario(`
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.bls (id, voyage_id) VALUES ('R595BL1', 595001), ('R595BL2', 595001);
      INSERT INTO public.demurrage_invoices (id, doc_number, bl_id, customer_id, total_usd, current_total_brl, status) VALUES
        (595001, 'DEM-595-1', 'R595BL1', ${CUSTOMER}, 100, 550, 'issued'),
        (595002, 'DEM-595-2', 'R595BL2', ${CUSTOMER}, 100, 0, 'issued');
      SET LOCAL session_replication_role = origin;
      UPDATE public.demurrage_invoices SET status = 'paid', pix_txid = 'R595TXID' WHERE id = 595001;
      UPDATE public.demurrage_invoices SET status = 'paid' WHERE id = 595002;
      SELECT '>meio|' || payment_method FROM public.demurrage_invoices WHERE id = 595001;
      ${notices('demurrage_payment:')}`)
    // 599: o meio vem de `payment_method` (519). TXID que o Itaú não conhece é
    // conciliação pelo extrato; antes o texto dizia "(Pix)" para qualquer TXID.
    expect(lines).toEqual([
      '>meio|extrato',
      '>administrativo|Novo pagamento de Demurrage|Invoice DEM-595-1 — R595 Cliente: R$ 550,00 (Extrato).|/demurrage?fatura=595001',
      '>financeiro|Novo pagamento de Demurrage|Invoice DEM-595-1 — R595 Cliente: R$ 550,00 (Extrato).|/demurrage?fatura=595001',
    ])
  })

  it('baixa manual da Invoice de Demurrage diz "Registro manual"', () => {
    const lines = scenario(`
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.bls (id, voyage_id) VALUES ('R595BL1', 595001);
      INSERT INTO public.demurrage_invoices (id, doc_number, bl_id, customer_id, total_usd, current_total_brl, status) VALUES
        (595001, 'DEM-595-1', 'R595BL1', ${CUSTOMER}, 100, 550, 'issued');
      SET LOCAL session_replication_role = origin;
      UPDATE public.demurrage_invoices SET status = 'paid' WHERE id = 595001;
      ${notices('demurrage_payment:')}`)
    expect(lines).toEqual([
      '>administrativo|Novo pagamento de Demurrage|Invoice DEM-595-1 — R595 Cliente: R$ 550,00 (Registro manual).|/demurrage?fatura=595001',
      '>financeiro|Novo pagamento de Demurrage|Invoice DEM-595-1 — R595 Cliente: R$ 550,00 (Registro manual).|/demurrage?fatura=595001',
    ])
  })

  // 605 (ADR 0131, D1): o aviso vai também ao Administrativo.
  it('solicitação enviada avisa a Documentação e o Administrativo (sem a conta de integração); reenvio diz "reenviada"; VIP não avisa', () => {
    const lines = scenario(`
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.ce_unlock_requests (id, customer_id, protocol, state, source, created_by) VALUES
        ('${REQUEST}', ${CUSTOMER}, 'CE-R595', 'submitted', 'request', '${DOC}'),
        ('${VIP_REQUEST}', ${CUSTOMER}, 'CE-R595VIP', 'submitted', 'vip_annual', '${DOC}');
      INSERT INTO public.ce_unlock_request_bls (request_id, bl_id, ce_at_request) VALUES
        ('${REQUEST}', 'R595BL1', 'CE1'), ('${REQUEST}', 'R595BL2', 'CE2');
      SET LOCAL session_replication_role = origin;
      INSERT INTO public.ce_unlock_events (customer_id, request_id, action, actor_id) VALUES
        (${CUSTOMER}, '${REQUEST}', 'draft', '${PORTAL}'),
        (${CUSTOMER}, '${REQUEST}', 'submit', '${PORTAL}'),
        (${CUSTOMER}, '${VIP_REQUEST}', 'submit', '${PORTAL}');
      INSERT INTO public.ce_unlock_events (customer_id, request_id, action, actor_id) VALUES
        (${CUSTOMER}, '${REQUEST}', 'submit', '${PORTAL}');
      ${notices('ce_unlock_submit:')}`)
    expect(lines).toEqual(['administrativo', 'documentacao'].flatMap((department) => [
      `>${department}|Nova solicitação de desbloqueio de CE|R595 Cliente enviou a solicitação CE-R595 (2 B/Ls).|/desbloqueio-ce?pedido=` + REQUEST,
      `>${department}|Solicitação de desbloqueio de CE reenviada|R595 Cliente enviou a solicitação CE-R595 (2 B/Ls).|/desbloqueio-ce?pedido=` + REQUEST,
    ]))
  })

  // 599: o aviso diz que o Cliente enviou; o envio pela equipe interna não avisa.
  it('solicitação enviada por usuário interno não avisa a Documentação', () => {
    const lines = scenario(`
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.ce_unlock_requests (id, customer_id, protocol, state, source, created_by) VALUES
        ('${REQUEST}', ${CUSTOMER}, 'CE-R595', 'submitted', 'request', '${DOC}');
      SET LOCAL session_replication_role = origin;
      INSERT INTO public.ce_unlock_events (customer_id, request_id, action, actor_id) VALUES
        (${CUSTOMER}, '${REQUEST}', 'submit', '${DOC}');
      SELECT '>eventos|' || count(*) FROM public.ce_unlock_events WHERE request_id = '${REQUEST}';
      ${notices('ce_unlock_submit:')}`)
    expect(lines).toEqual(['>eventos|1'])
  })

  it('o aviso aparece no sino e no número até ser lido; ler tira dos dois', () => {
    const lines = scenario(`
      INSERT INTO public.invoices (id, invoice_number, customer_id, status, total_brl) VALUES (595001, 'FAT-595', ${CUSTOMER}, 'issued', 2000);
      INSERT INTO public.payments (invoice_id, amount_brl, payment_method, paid_at) VALUES (595001, 10, 'ted', now());
      ${asUser(FIN)}
      SET LOCAL ROLE authenticated;
      SELECT '>antes|' || public.count_unread_internal_notifications() || '|'
        || (SELECT string_agg(x->>'title', ',') FROM public.list_internal_notifications() x);
      SELECT public.mark_all_internal_notifications_read() IS NOT NULL;
      SELECT '>depois|' || public.count_unread_internal_notifications() || '|'
        || coalesce((SELECT string_agg(x->>'title', ',') FROM public.list_internal_notifications() x), '');
      RESET ROLE;`)
    expect(lines).toEqual(['>antes|1|Novo pagamento', '>depois|0|'])
  })

  it('a notificação precisa ser de Alerta (três ids) ou de acontecimento (chave), nunca as duas coisas', () => {
    const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `BEGIN; ${FIXTURES}
      INSERT INTO public.internal_notifications (recipient_id, recipient_department, item_type, severity, title, message)
      VALUES ('${FIN}', 'financeiro', 'pagamento_recebido', 'normal', 'Sem origem', 'x'); ROLLBACK;`], { encoding: 'utf8' })
    expect(run.stderr).toContain('internal_notifications_origin_check')
  })
})

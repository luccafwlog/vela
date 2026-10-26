import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 453 (ponto 9 de 2026-10-23): colar vários B/Ls ou contêineres na
// busca de /bls e /containers acha cada um; o texto inteiro segue valendo.
// Migration 455: só conta como termo da lista o que tem cara de número (4+
// caracteres com dígito), então um nome de várias palavras não vira lista.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADMIN_ID = '45300000-0000-4000-8000-0000000000a1'
const CARRIER_ID = 4530001
const VESSEL_ID = 4530002
const VOYAGE_ID = 4530003
const CUSTOMER_ID = 4530010
const BLS = ['B453AAA1', 'B453BBB2', 'B453CCC3']
// Pedidos de Desbloqueio de CE da ficha do Cliente, um por B/L (migration 454).
const REQUESTS = ['45300000-0000-4000-8000-0000000000b1', '45300000-0000-4000-8000-0000000000b2', '45300000-0000-4000-8000-0000000000b3']

function psql(sql: string) {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.search_term_tokens(text)') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migration 453 (search_term_tokens)')

// Como a tela: sessão autenticada do Administrativo, RLS do chamador.
function asAdmin(sql: string) {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SELECT set_config('request.jwt.claims', '{"sub":"${ADMIN_ID}","role":"authenticated"}', true);
    SET LOCAL ROLE authenticated;
    ${sql}
    COMMIT;
  `], { encoding: 'utf8' })
  expect(run.status, run.stderr).toBe(0)
  return JSON.parse(run.stdout.trim().split('\n').pop() ?? '{}')
}

const lit = (value: string) => `'${value.replace(/'/g, "''")}'`
const bls = (search: string) => asAdmin(`SELECT public.operational_list_bls(p_page => 1, p_page_size => 50, p_voyage_id => ${VOYAGE_ID}, p_search => ${lit(search)})::text;`)
  .rows.map((row: { id: string }) => row.id).sort()
const summary = (search: string) => asAdmin(`SELECT public.operational_list_bl_summary(p_voyage_id => ${VOYAGE_ID}, p_search => ${lit(search)})::text;`).totalBls
const containers = (search: string) => asAdmin(`SELECT public.operational_list_containers(p_page => 1, p_page_size => 50, p_voyage_id => ${VOYAGE_ID}, p_search => ${lit(search)})::text;`)
  .rows.map((row: { container_number: string }) => row.container_number).sort()
// Funções patchadas pela 454, chamadas de verdade (não só o texto do corpo).
const customerRequests = (search: string) => asAdmin(`SELECT public.ce_unlock_customer_requests(${CUSTOMER_ID}, ${lit(search)}, 1)::text;`)
  .items.flatMap((item: { bl_ids: string[] }) => item.bl_ids).sort()
const consolidatable = (search: string) => asAdmin(`SELECT coalesce(json_agg(r.bl_id ORDER BY r.bl_id), '[]')::text
    FROM public.list_consolidatable_receivables(${CUSTOMER_ID}, NULL, ${lit(search)}) AS r;`)
// O núcleo do Portal só é executável pelo dono; o envelope público resolve o Cliente da sessão.
const portalDemurrage = (search: string) => (JSON.parse(psql(`SELECT public._portal_list_demurrage_invoices_page_core(${CUSTOMER_ID}, 25, 0, NULL, NULL, ${lit(search)}, NULL, NULL, NULL)::text;`)) as { rows: Array<{ bl_id: string }> })
  .rows.map((row) => row.bl_id).sort()

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.ce_unlock_request_bls WHERE bl_id LIKE 'B453%';
    DELETE FROM public.ce_unlock_requests WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.demurrage_invoices WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.bl_receivables WHERE bl_id LIKE 'B453%';
    DELETE FROM public.customers WHERE id = ${CUSTOMER_ID};
    DELETE FROM public.bl_containers WHERE bl_id LIKE 'B453%';
    DELETE FROM public.bls WHERE id LIKE 'B453%';
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.user_profiles WHERE id = '${ADMIN_ID}';
    DELETE FROM auth.users WHERE id = '${ADMIN_ID}';
    SET session_replication_role = origin;
  `)
}

describeLocal('453 — busca por vários B/Ls e contêineres', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email, aud, role) VALUES ('${ADMIN_ID}', 'adm453@test.local', 'authenticated', 'authenticated');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${ADMIN_ID}', 'Administrativo 453', 'administrativo', true)
        ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = true;
      SET session_replication_role = replica;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Carrier 453');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Vessel 453', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'V453', 'active');
      INSERT INTO public.bls (id, voyage_id, pol, pod, consignee, ce_mercante, cargo_mode, financial_status, charge_status, review_status) VALUES
        ('${BLS[0]}', ${VOYAGE_ID}, 'CNSHA', 'BRSSZ', 'ACME 2 IMPORTADORA', '453000000000001', 'container', 'pending', 'not_calculated', 'ok'),
        ('${BLS[1]}', ${VOYAGE_ID}, 'CNSHA', 'BRSSZ', 'BETA LTDA', '453000000000002', 'container', 'pending', 'not_calculated', 'ok'),
        ('${BLS[2]}', ${VOYAGE_ID}, 'CNSHA', 'BRSSZ', 'GAMA SA', '453000000000003', 'container', 'pending', 'not_calculated', 'ok');
      INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES
        ('${BLS[0]}', 'TCNU4530001', '40HC'), ('${BLS[1]}', 'TCNU4530002', '40HC'), ('${BLS[2]}', 'TCNU4530003', '20DV');
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${CUSTOMER_ID}, '45300000000110', 'Cliente 453');
      INSERT INTO public.bl_receivables (bl_id, customer_id, voyage_id, original_amount_brl, balance_brl, status)
        SELECT bl, ${CUSTOMER_ID}, ${VOYAGE_ID}, 100, 100, 'open' FROM unnest(ARRAY['${BLS.join("','")}']) AS bl;
      INSERT INTO public.ce_unlock_requests (id, customer_id, state, source, created_by) VALUES
        ${REQUESTS.map((id) => `('${id}', ${CUSTOMER_ID}, 'submitted', 'request', '${ADMIN_ID}')`).join(', ')};
      INSERT INTO public.ce_unlock_request_bls (request_id, bl_id, ce_at_request) VALUES
        ${REQUESTS.map((id, index) => `('${id}', '${BLS[index]}', '45300000000000${index + 1}')`).join(', ')};
      INSERT INTO public.demurrage_invoices (doc_number, bl_id, customer_id, total_usd, status, billed_at)
        SELECT 'DEM-' || bl, bl, ${CUSTOMER_ID}, 100, 'issued', now() FROM unnest(ARRAY['${BLS.join("','")}']) AS bl;
      SET session_replication_role = origin;
    `)
  })

  afterAll(cleanup)

  it('lista colada com vírgula, ponto e vírgula e quebra de linha acha cada B/L', () => {
    expect(bls(`${BLS[0]}, ${BLS[2]}`)).toEqual([BLS[0], BLS[2]])
    expect(bls(`${BLS[0]};${BLS[1]}\n${BLS[2]}`)).toEqual(BLS)
    expect(summary(`${BLS[0]} ${BLS[1]}`)).toBe(2)
    expect(bls(`${BLS[1]}\n${BLS[1]}`)).toEqual([BLS[1]])
    // 455: espaço não separável separa, como na tela; palavra solta no meio fica de fora.
    expect(bls(`${BLS[0]}\u00a0${BLS[2]}`)).toEqual([BLS[0], BLS[2]])
    expect(bls(`${BLS[0]} e ${BLS[2]}`)).toEqual([BLS[0], BLS[2]])
    // 461: os demais espaços Unicode separam como na tela (o \s do banco depende do locale).
    expect(bls(`${BLS[0]}\u202f${BLS[2]}`)).toEqual([BLS[0], BLS[2]])
    expect(bls(`${BLS[0]}\u2007${BLS[1]}`)).toEqual([BLS[0], BLS[1]])
  })

  it('um termo só e o texto inteiro seguem a busca de antes', () => {
    expect(bls('BBB2')).toEqual([BLS[1]])
    expect(bls('NADA453')).toEqual([])
  })

  // 455: antes, o "2" de "ACME 2" virava termo e trazia todo B/L com o algarismo 2.
  it('nome de várias palavras acha pelo texto inteiro e não traz B/L sem relação', () => {
    expect(bls('ACME 2 IMPORTADORA')).toEqual([BLS[0]])
    expect(bls('ACME 2')).toEqual([BLS[0]])
    expect(summary('ACME 2')).toBe(1)
  })

  // Migration 454: contrato SQL das demais buscas (o comportamento das listas do
  // Desbloqueio de CE e das Faturas do Portal está em ceUnlock e
  // portalConsolidadaPaga; as outras três são chamadas no teste seguinte).
  it('as demais buscas por B/L no banco usam a mesma regra de lista', () => {
    for (const fn of [
      'ce_unlock_private.list(bigint,jsonb,integer,boolean)',
      'public.ce_unlock_customer_requests(bigint,text,integer)',
      'public.list_consolidatable_receivables(bigint,bigint,text)',
      'public._portal_list_invoices_page_core(bigint,integer,integer,text,text,text,text,date,date)',
      'public._portal_list_demurrage_invoices_page_core(bigint,integer,integer,text,text,text,text,date,date)',
    ]) {
      expect(psql(`SELECT position('search_term_tokens' IN pg_get_functiondef('${fn}'::regprocedure)) > 0;`), fn).toBe('t')
    }
  })

  it('solicitações da ficha do Cliente, Consolidar fatura e Demurrage do Portal acham cada B/L da lista', () => {
    const list = `${BLS[0]}, ${BLS[2]}`
    expect(customerRequests(list)).toEqual([BLS[0], BLS[2]])
    expect(consolidatable(list)).toEqual([BLS[0], BLS[2]])
    expect(portalDemurrage(list)).toEqual([BLS[0], BLS[2]])
    // Um termo só segue a busca de antes; nome de várias palavras não vira lista.
    expect(customerRequests('BBB2')).toEqual([BLS[1]])
    expect(consolidatable('BBB2')).toEqual([BLS[1]])
    expect(portalDemurrage('BBB2')).toEqual([BLS[1]])
    expect(portalDemurrage('ACME 2')).toEqual([])
  })

  it('a lista de contêineres acha vários contêineres ou B/Ls colados', () => {
    expect(containers('TCNU4530001 TCNU4530003')).toEqual(['TCNU4530001', 'TCNU4530003'])
    expect(containers(`${BLS[1]}, TCNU4530003`)).toEqual(['TCNU4530002', 'TCNU4530003'])
  })
})

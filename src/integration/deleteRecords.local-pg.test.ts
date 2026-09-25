import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Migration 087 (ADR 0071; plano 2026-09-24-politica-de-exclusao, Fase 2):
// delete_records exclui cada item por inteiro ou devolve o motivo, sem deixar
// filhos apagados pela metade (achado A2), e recusa quem não é Administrativo
// em vez de apagar 0 linhas em silêncio (achado A1).

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function functionPresent() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.delete_records(text,text[],boolean,text)') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = functionPresent() ? describe : describe.skip

const ADMIN_ID = '08700000-0000-4000-8000-0000000000a1'
const FIN_ID = '08700000-0000-4000-8000-0000000000f1'
const CARRIER_ID = 8700001
const VESSEL_ID = 8700002
const VOYAGE_ID = 8700003
const CUSTOMER_FREE = 8700004
const CUSTOMER_BILLED = 8700005
const BL_FREE = 'BL087FREE'
const BL_BILLED = 'BL087BILLED'

function as(userId: string, sql: string) {
  const run = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SELECT set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
    SET LOCAL ROLE authenticated;
    ${sql}
    COMMIT;
  `], { encoding: 'utf8' })
  return { ...run, json: run.status === 0 ? JSON.parse(run.stdout.trim().split('\n').pop() ?? 'null') : null }
}

const callDelete = (userId: string, kind: string, ids: string[], dryRun = false) =>
  as(userId, `SELECT public.delete_records('${kind}', ARRAY[${ids.map((id) => `'${id}'`).join(',')}]::text[], ${dryRun}, 'teste 087');`)

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE entity_id IN ('${BL_FREE}', '${BL_BILLED}', '${CUSTOMER_FREE}', '${CUSTOMER_BILLED}');
    DELETE FROM public.invoices WHERE customer_id IN (${CUSTOMER_FREE}, ${CUSTOMER_BILLED});
    DELETE FROM public.vehicles WHERE bl_id IN ('${BL_FREE}', '${BL_BILLED}');
    DELETE FROM public.bl_containers WHERE bl_id IN ('${BL_FREE}', '${BL_BILLED}');
    DELETE FROM public.bls WHERE id IN ('${BL_FREE}', '${BL_BILLED}');
    DELETE FROM public.customer_contacts WHERE customer_id IN (${CUSTOMER_FREE}, ${CUSTOMER_BILLED});
    DELETE FROM public.portal_provisioning_events WHERE customer_id IN (${CUSTOMER_FREE}, ${CUSTOMER_BILLED});
    DELETE FROM public.portal_notifications WHERE customer_id IN (${CUSTOMER_FREE}, ${CUSTOMER_BILLED});
    DELETE FROM public.portal_inspection_events WHERE customer_id IN (${CUSTOMER_FREE}, ${CUSTOMER_BILLED});
    DELETE FROM public.customer_portal_sessions WHERE customer_id IN (${CUSTOMER_FREE}, ${CUSTOMER_BILLED});
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${CUSTOMER_FREE}, ${CUSTOMER_BILLED});
    DELETE FROM public.customers WHERE id IN (${CUSTOMER_FREE}, ${CUSTOMER_BILLED});
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.user_profiles WHERE id IN ('${ADMIN_ID}', '${FIN_ID}');
    DELETE FROM auth.users WHERE id IN ('${ADMIN_ID}', '${FIN_ID}');
    SET session_replication_role = origin;
  `)
}

function seedBl(blId: string, billed: boolean) {
  psql(`
    INSERT INTO public.bls (id, voyage_id, customer_id) VALUES ('${blId}', ${VOYAGE_ID}, ${CUSTOMER_BILLED});
    WITH c AS (
      INSERT INTO public.bl_containers (bl_id, container_number) VALUES ('${blId}', '${blId.slice(-4)}1234567') RETURNING id
    )
    INSERT INTO public.vehicles (voyage_id, container_id, bl_id, chassis, brand, model, weight_kg, cbm)
      SELECT ${VOYAGE_ID}, id, '${blId}', 'CH-${blId}', 'Marca', 'Modelo', 1000, 10 FROM c;
    ${billed ? `INSERT INTO public.invoices (invoice_number, customer_id, bl_id, total_brl, status)
      VALUES ('INV-${blId}', ${CUSTOMER_BILLED}, '${blId}', 10, 'draft');` : ''}
  `)
}

describeLocal('087 — delete_records: exclusão atômica com prévia', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email, aud, role) VALUES
        ('${ADMIN_ID}', 'adm087@test.local', 'authenticated', 'authenticated'),
        ('${FIN_ID}', 'fin087@test.local', 'authenticated', 'authenticated');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${ADMIN_ID}', 'Administrativo 087', 'administrativo', true),
        ('${FIN_ID}', 'Financeiro 087', 'financeiro', true)
        ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = true;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Carrier 087');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Vessel 087', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'V087', 'active');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES
        (${CUSTOMER_FREE}, 'Cliente livre 087', '45997418000153'),
        (${CUSTOMER_BILLED}, 'Cliente faturado 087', '60701190000104');
      INSERT INTO public.customer_contacts (customer_id, name, email) VALUES
        (${CUSTOMER_FREE}, 'Contato livre', 'livre@test.local'),
        (${CUSTOMER_BILLED}, 'Contato faturado', 'faturado@test.local');
    `)
    seedBl(BL_FREE, false)
    seedBl(BL_BILLED, true)
  })

  afterAll(cleanup)

  it('recusa quem não é Administrativo, sem apagar nada', () => {
    const run = callDelete(FIN_ID, 'bl', [BL_FREE])
    expect(run.status).not.toBe(0)
    expect(run.stderr).toMatch(/Somente o Administrativo/)
    expect(psql(`SELECT count(*) FROM public.bls WHERE id = '${BL_FREE}';`)).toBe('1')
  })

  it('prévia informa deletáveis e bloqueados sem apagar nada', () => {
    const run = callDelete(ADMIN_ID, 'bl', [BL_FREE, BL_BILLED], true)
    expect(run.status).toBe(0)
    expect(run.json.deleted).toEqual([BL_FREE])
    expect(run.json.blocked).toEqual([{ id: BL_BILLED, reasons: ['vinculado a fatura'] }])
    expect(psql(`SELECT count(*) FROM public.vehicles WHERE bl_id IN ('${BL_FREE}', '${BL_BILLED}');`)).toBe('2')
  })

  it('B/L bloqueado mantém veículos e containers; o livre sai inteiro, com rastro', () => {
    const run = callDelete(ADMIN_ID, 'bl', [BL_FREE, BL_BILLED])
    expect(run.json.deleted).toEqual([BL_FREE])
    expect(run.json.blocked[0].id).toBe(BL_BILLED)

    expect(psql(`SELECT count(*) FROM public.bls WHERE id = '${BL_FREE}';`)).toBe('0')
    expect(psql(`SELECT count(*) FROM public.vehicles WHERE bl_id = '${BL_BILLED}';`)).toBe('1')
    expect(psql(`SELECT count(*) FROM public.bl_containers WHERE bl_id = '${BL_BILLED}';`)).toBe('1')
    expect(psql(`SELECT changed_by || '|' || justification FROM public.audit_logs
      WHERE entity_type = 'bl' AND entity_id = '${BL_FREE}' AND field_name = 'deleted';`)).toBe(`${ADMIN_ID}|teste 087`)
  })

  it('cliente recusado pelo banco mantém os contatos (antes eram apagados primeiro)', () => {
    // Todo cliente com CNPJ ganha eventos de provisionamento do Portal, que são
    // somente inclusão: hoje nenhum desses clientes pode ser excluído. O que
    // importa aqui é o item voltar inteiro, com o motivo.
    const run = callDelete(ADMIN_ID, 'customer', [String(CUSTOMER_FREE), String(CUSTOMER_BILLED)])
    expect(run.json.deleted).toEqual([])
    expect(run.json.blocked).toEqual([
      { id: String(CUSTOMER_FREE), reasons: ['portal_provisioning_events é somente inclusão'] },
      { id: String(CUSTOMER_BILLED), reasons: ['vinculado a B/L'] },
    ])
    expect(psql(`SELECT count(*) FROM public.customer_contacts
      WHERE customer_id IN (${CUSTOMER_FREE}, ${CUSTOMER_BILLED});`)).toBe('2')
  })

  it('item inexistente aparece como bloqueado', () => {
    const run = callDelete(ADMIN_ID, 'vehicle', ['999999999'])
    expect(run.json.blocked).toEqual([{ id: '999999999', reasons: ['não encontrado'] }])
  })
})

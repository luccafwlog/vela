// Etapa 11 do plano de correção das importações (migration 186; ADR 0078,
// item 25). Reimportar a planilha COSCO da mesma Viagem atualiza os B/Ls de
// Granito pelo número, preservando CE e Cliente, sem duplicar linhas; B/L
// ausente do arquivo novo só sai com confirmação e nunca com Invoice.
//
// Namespace exclusivo: ids 99233xxx, B/Ls 'A233-*', usuário ...0000002330NN.
import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const userId = '00000000-0000-0000-0000-000000233001'
const carrierId = 99233001
const vesselId = 99233002
const voyageId = 99233003
const customerId = 99233004

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function asUser(sql: string): { stdout: string; stderr: string } {
  const run = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${userId}'; ${sql}`],
  { encoding: 'utf8' })
  return { stdout: run.stdout.trim(), stderr: run.stderr }
}

const granite = `(SELECT g.id FROM public.granite_bls g JOIN public.granite_manifests m ON m.id = g.manifest_id WHERE m.voyage_id = ${voyageId})`

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.import_effect_attempts WHERE effect_id IN (SELECT id FROM public.import_pending_effects WHERE entity_id IN (SELECT id::text FROM ${granite} AS x));
    DELETE FROM public.import_pending_effects WHERE entity_id IN (SELECT id::text FROM ${granite} AS x) OR created_by = '${userId}';
    DELETE FROM public.granite_bls WHERE id IN ${granite};
    DELETE FROM public.granite_manifests WHERE voyage_id = ${voyageId};
    DELETE FROM public.audit_logs WHERE changed_by = '${userId}' OR entity_id LIKE 'A233-%';
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.portal_email_attempts WHERE account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id IN (SELECT id FROM public.customers WHERE id = ${customerId}));
    DELETE FROM public.portal_provisioning_events WHERE customer_id IN (SELECT id FROM public.customers WHERE id = ${customerId}) OR account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id IN (SELECT id FROM public.customers WHERE id = ${customerId}));
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (SELECT id FROM public.customers WHERE id = ${customerId});
    DELETE FROM public.customers WHERE id = ${customerId};
    DELETE FROM public.user_profiles WHERE id = '${userId}';
    DELETE FROM auth.users WHERE id = '${userId}';
    SET session_replication_role = origin;
  `)
}

function bl(number: string, weight: number, clientId: number | null = null) {
  return { bl_number: number, client_id: clientId, sequence: 1, real_weight_kg: weight, blocks_qty: 2, vessel_voyage: 'A233 NAVIO/A233', loading_port: 'BRVIX', discharge_port: 'CNXMN' }
}

function importFile(bls: unknown[], remove: string[] = []) {
  const removeSql = remove.length ? `ARRAY[${remove.map((n) => `'${n}'`).join(', ')}]::text[]` : 'NULL'
  return asUser(`SELECT public.import_granite_manifest_transactional(${voyageId}, 'A233 NAVIO/A233', 'BRVIX', 'CNXMN',
    ${bls.length}, 1000, '${userId}', '${JSON.stringify(bls)}'::jsonb, ${removeSql});`)
}

function rows(): string {
  return psql(`SELECT string_agg(g.bl_number || ':' || g.real_weight_kg::int || ':' || COALESCE(g.ce_mercante, '-') || ':' || COALESCE(g.client_id::text, '-'), ',' ORDER BY g.bl_number)
    FROM public.granite_bls g JOIN public.granite_manifests m ON m.id = g.manifest_id WHERE m.voyage_id = ${voyageId};`)
}

describeLocal('Granito: reimportação por número do B/L na Viagem (migration 186)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${userId}', 'a233-doc@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${userId}', 'A233 Documentação', 'documentacao', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customerId}, '99233004000187', 'A233 CLIENTE');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'A233 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'A233 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'A233', 'active');
    `)
  })

  afterAll(cleanup)

  it('a reimportação atualiza pelo número, preserva CE e Cliente e não duplica', () => {
    expect(importFile([bl('A233-1', 100), bl('A233-2', 200)]).stderr).toBe('')
    psql(`UPDATE public.granite_bls SET ce_mercante = '992330000000001', client_id = ${customerId} WHERE bl_number = 'A233-1';`)

    const again = importFile([bl('A233-1', 150), bl('A233-2', 200), bl('A233-3', 300)])
    expect(again.stderr).toBe('')
    expect(JSON.parse(again.stdout)).toMatchObject({ inserted_bls: 1, updated_bls: 1, removed_bl_numbers: [], kept_missing_bl_numbers: [] })
    expect(rows()).toBe(`A233-1:150:992330000000001:${customerId},A233-2:200:-:-,A233-3:300:-:-`)
    expect(psql(`SELECT count(*) FROM public.granite_manifests WHERE voyage_id = ${voyageId};`)).toBe('1')

    // Mesma planilha de novo: nada muda, nada duplica.
    expect(JSON.parse(importFile([bl('A233-1', 150), bl('A233-2', 200), bl('A233-3', 300)]).stdout))
      .toMatchObject({ inserted_bls: 0, updated_bls: 0 })
  })

  it('B/L ausente do arquivo novo fica sem confirmação e sai com ela', () => {
    const kept = importFile([bl('A233-1', 150), bl('A233-2', 200)])
    expect(JSON.parse(kept.stdout)).toMatchObject({ removed_bl_numbers: [], kept_missing_bl_numbers: ['A233-3'] })
    expect(rows()).toContain('A233-3')

    const removed = importFile([bl('A233-1', 150), bl('A233-2', 200)], ['A233-3'])
    expect(JSON.parse(removed.stdout)).toMatchObject({ removed_bl_numbers: ['A233-3'], kept_missing_bl_numbers: [] })
    expect(rows()).not.toContain('A233-3')
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_type = 'granite_bls' AND entity_id = 'A233-3' AND field_name = 'deleted';`)).toBe('1')
  })

  it('o CE de Granito não dispara cálculo', () => {
    expect(psql(`SELECT charge_status FROM public.granite_bls WHERE bl_number = 'A233-1';`)).toBe('not_calculated')
  })
})

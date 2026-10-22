// Lote 9 da frente das importações (ADR 0095, decisões 14 e 15; decisões do
// dono B12b e B12c; migration 410):
// - navio compartilhado: o container cujo operador (NAD+CA) não está nos
//   códigos do armador da Viagem (`carriers.baplie_codes`) não entra no
//   staging, nas marcas nem na conciliação, mesmo estando num B/L da Viagem;
//   a gravação devolve a contagem (`other_carrier`) e não recusa o arquivo;
//   armador sem códigos não separa nada;
// - transbordo (EQD 8249 = 6): entra no staging marcado (`is_transshipment`),
//   não leva IMO/OOG nem SOC/COC aos B/Ls e não vira vazio de importação.
//
// Antes da 410: `carriers.baplie_codes` e `baplie_containers.is_transshipment`
// não existiam e o servidor gravava (e marcava) o container de outro armador.
//
// Namespace exclusivo: ids 99410xxx, B/Ls 'A410-*', containers 'AQCU410xxxx',
// usuário ...000410001.
import { afterAll, beforeAll, expect, it } from 'vitest'
import { execPsql, spawnPsql } from './localPsql'
import { describeWithProbe } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000410001'
const carrierId = 99410001
const vesselId = 99410002
const voyageId = 99410003
const claims = `SET LOCAL request.jwt.claim.role = 'authenticated'; SET LOCAL request.jwt.claim.sub = '${actorId}';`

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `BEGIN; ${claims} ${sql}; COMMIT;`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function asUser(sql: string): { output: string; error: string | null } {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; ${claims} ${sql}; COMMIT;`], { encoding: 'utf8' })
  const error = run.stderr.split('\n').find((line) => line.startsWith('ERROR:')) ?? null
  return { output: run.stdout.trim(), error: error?.trim() ?? null }
}

function probe(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.import_baplie_file_atomic(bigint,jsonb,text[],jsonb,jsonb)') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(probe, 'migration 388 aplicada')

type Row = { container_number: string; operator?: string | null; status?: 'full' | 'empty'; is_imo?: boolean; ownership?: string | null; is_transshipment?: boolean }

function rows(list: Row[]) {
  return list.map((row) => ({
    container_number: row.container_number, size_type: '40HC', status: row.status ?? 'full', weight_kg: 3800,
    pol: 'CNSHA', pod: 'BRSSZ', final_dest: null, bl_ref: null, slot: null,
    is_imo: row.is_imo ?? false, imo_class: row.is_imo ? '3' : null, un_number: row.is_imo ? '1263' : null,
    is_oog: false, ownership: row.ownership ?? null, operator: row.operator ?? null,
    is_transshipment: row.is_transshipment ?? false,
  }))
}

function expected(): string {
  return psql(`SELECT (public._baplie_staging_version(${voyageId}) || jsonb_build_object('vazios_manifest',
    public._baplie_vazios_manifest_version(${voyageId})))::text`)
}

function importBaplie(list: Row[]) {
  return asUser(`SELECT public.import_baplie_file_atomic(${voyageId}, $r$${JSON.stringify(rows(list))}$r$::jsonb,
    ARRAY['BRSSZ']::text[], '${expected()}'::jsonb, '{"voyage_number":"A410V"}'::jsonb)`)
}

function staging(): string {
  return psql(`SELECT string_agg(container_number || ':' || status
    || CASE WHEN is_transshipment THEN ':transbordo' ELSE '' END, ',' ORDER BY container_number)
    FROM public.baplie_containers WHERE voyage_id = ${voyageId}`)
}

function blContainer(blId: string): string {
  return psql(`SELECT is_imo || '/' || COALESCE(ownership, '-') || '/' || COALESCE(profile_source, '-') FROM public.bl_containers WHERE bl_id = '${blId}'`)
}

function insertBl(id: string, container: string) {
  psql(`
    INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode, financial_status, charge_status, customer_reconciliation_status, review_status)
    VALUES ('${id}', ${voyageId}, 'CNSHA', 'BRSSZ', 'container', 'pending', 'not_calculated', 'missing_customer', 'ok');
    INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${id}', '${container}', '40HC')
  `)
}

function cleanup() {
  psql(`
    SET LOCAL session_replication_role = replica;
    CREATE TEMP TABLE a410_bls ON COMMIT DROP AS SELECT id FROM public.bls WHERE id LIKE 'A410-%';
    DELETE FROM public.baplie_containers WHERE voyage_id = ${voyageId};
    DELETE FROM public.vazios_importacao_containers WHERE manifest_id IN (SELECT id FROM public.vazios_importacao_manifests WHERE voyage_id = ${voyageId});
    DELETE FROM public.vazios_importacao_manifests WHERE voyage_id = ${voyageId};
    DELETE FROM public.import_effect_attempts WHERE effect_id IN (SELECT id FROM public.import_pending_effects
      WHERE entity_id IN (SELECT id FROM a410_bls) OR entity_id = '${voyageId}' OR created_by = '${actorId}');
    DELETE FROM public.import_pending_effects WHERE entity_id IN (SELECT id FROM a410_bls) OR entity_id = '${voyageId}' OR created_by = '${actorId}';
    DELETE FROM public.invoice_basis_pending_changes WHERE bl_id IN (SELECT id FROM a410_bls);
    DELETE FROM public.bl_containers WHERE bl_id IN (SELECT id FROM a410_bls);
    DELETE FROM public.bls WHERE id IN (SELECT id FROM a410_bls);
    DELETE FROM public.internal_notifications WHERE entity_id = '${voyageId}' OR entity_id LIKE '${voyageId}::%' OR entity_id IN (SELECT id FROM a410_bls);
    DELETE FROM public.alert_items WHERE metadata->>'voyage_id' = '${voyageId}'
      OR alert_id IN (SELECT id FROM public.alerts WHERE entity_id = '${voyageId}' OR entity_id LIKE '${voyageId}::%' OR entity_id IN (SELECT id FROM a410_bls));
    DELETE FROM public.alerts WHERE entity_id = '${voyageId}' OR entity_id LIKE '${voyageId}::%' OR entity_id IN (SELECT id FROM a410_bls);
    DELETE FROM public.audit_logs WHERE changed_by = '${actorId}' OR entity_id = '${voyageId}' OR entity_id LIKE '${voyageId}::%'
      OR entity_id IN (SELECT id FROM a410_bls);
    DELETE FROM public.voyage_documental_pending WHERE voyage_id = ${voyageId};
    DELETE FROM public.voyage_documental_state WHERE voyage_id = ${voyageId};
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.user_profiles WHERE id = '${actorId}';
    DELETE FROM auth.users WHERE id = '${actorId}'
  `)
}

describeLocal('Lote 9 das importações — Baplie: armador da Viagem e transbordo (402)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'a410@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${actorId}', 'A410 Administrativo', 'administrativo', true);
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'A410 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'A410 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'A410V', 'active')
    `)
    insertBl('A410-B1', 'AQCU4100001')
    insertBl('A410-B2', 'AQCU4100002')
    insertBl('A410-B3', 'AQCU4100003')
  })

  afterAll(cleanup)

  it('decisão 14: container de outro armador fica fora do staging e das marcas, mesmo num B/L da Viagem, com contagem', () => {
    psql(`UPDATE public.carriers SET baplie_codes = ARRAY['COS', 'COSCO'] WHERE id = ${carrierId}`)
    const list: Row[] = [
      { container_number: 'AQCU4100001', operator: 'COS', is_imo: true },
      // Parceiro de slot: no B/L B2 por engano, mas é MSC; não leva a marca IMO nem o SOC.
      { container_number: 'AQCU4100002', operator: 'msc', is_imo: true, ownership: 'SOC' },
      // Sem operador no container: não se sabe de quem é; fica.
      { container_number: 'AQCU4100004' },
    ]
    // A prévia das marcas também deixa o de outro armador de fora.
    const preview = asUser(`SELECT public.preview_baplie_physical_flags(${voyageId}, $r$${JSON.stringify(rows(list))}$r$::jsonb, ARRAY['BRSSZ'])`)
    expect(preview.error).toBeNull()
    expect((JSON.parse(preview.output) as { apply: Array<{ container: string }> }).apply.map((item) => item.container)).toEqual(['AQCU4100001'])

    const result = importBaplie(list)
    expect(result.error).toBeNull()
    expect(JSON.parse(result.output)).toMatchObject({ staged: 2, other_carrier: 1 })
    expect(staging()).toBe('AQCU4100001:full,AQCU4100004:full')
    expect(blContainer('A410-B1')).toBe('true/-/baplie')
    expect(blContainer('A410-B2')).toBe('false/-/-')
    expect(psql(`SELECT justification FROM public.audit_logs WHERE entity_type = 'voyage' AND entity_id = '${voyageId}'
      AND field_name = 'baplie_import' ORDER BY id DESC LIMIT 1`)).toBe('Baplie importado (portos BRSSZ); 1 container(s) de outro armador fora')
  })

  it('decisão 14: arquivo só de outro armador não apaga o Baplie gravado; armador sem códigos não separa nada', () => {
    const before = staging()
    const only = importBaplie([{ container_number: 'AQCU4100002', operator: 'MSC' }])
    expect(only.error).toMatch(/de outro armador \(códigos do armador da Viagem: COS, COSCO\)/)
    expect(staging()).toBe(before)

    psql(`UPDATE public.carriers SET baplie_codes = '{}' WHERE id = ${carrierId}`)
    const all = importBaplie([{ container_number: 'AQCU4100001', operator: 'COS' }, { container_number: 'AQCU4100002', operator: 'MSC' }])
    expect(all.error).toBeNull()
    expect(JSON.parse(all.output)).toMatchObject({ staged: 2, other_carrier: 0 })
    psql(`UPDATE public.carriers SET baplie_codes = ARRAY['COS', 'COSCO'] WHERE id = ${carrierId}`)
  })

  it('decisão 15: transbordo entra marcado no staging, não leva IMO nem SOC ao B/L e não vira vazio de importação', () => {
    const result = importBaplie([
      { container_number: 'AQCU4100001', operator: 'COS' },
      { container_number: 'AQCU4100003', operator: 'COS', is_imo: true, ownership: 'SOC', is_transshipment: true },
      { container_number: 'AQCU4100011', operator: 'COS', status: 'empty' },
      { container_number: 'AQCU4100012', operator: 'COS', status: 'empty', is_transshipment: true },
    ])
    expect(result.error).toBeNull()
    expect(staging()).toBe('AQCU4100001:full,AQCU4100003:full:transbordo,AQCU4100011:empty,AQCU4100012:empty:transbordo')
    expect(blContainer('A410-B3')).toBe('false/-/-')

    const vazios = asUser(`SELECT public.replace_vazios_from_baplie_transactional(${voyageId}, NULL, '${actorId}'::uuid, false)`)
    expect(vazios.error).toBeNull()
    expect(JSON.parse(vazios.output)).toMatchObject({ total: 1 })
    expect(psql(`SELECT string_agg(c.container_number, ',') FROM public.vazios_importacao_containers c
      JOIN public.vazios_importacao_manifests m ON m.id = c.manifest_id WHERE m.voyage_id = ${voyageId}`)).toBe('AQCU4100011')
  })
})

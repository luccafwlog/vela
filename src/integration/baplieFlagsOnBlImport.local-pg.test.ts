import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Migration 118: Baplie importado ANTES do B/L. O import do B/L precisa aplicar
// as flags IMO/OOG do Baplie na mesma transação, sem depender do
// import-effects-runner (inerte em produção).
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000118001'
const blId = 'BAPLIE118-BL'
const otherBlId = 'BAPLIE150-BL'
const carrierId = 1180011
const vesselId = 1180012
const voyageId = 1180013
const imoContainer = 'BPFU1180001'
const oogContainer = 'BPFU1180002'
let initialPricingVersionIds: string[] | null = null

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

function asAuthenticated(sql: string): { ok: boolean; output: string } {
  const result = spawnSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '${actorId}'; ${sql} COMMIT;`,
  ], { encoding: 'utf8' })
  return { ok: result.status === 0, output: `${result.stdout}\n${result.stderr}`.trim() }
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.import_pending_effects WHERE entity_id IN ('${voyageId}', '${blId}', '${otherBlId}');
    DELETE FROM public.audit_logs WHERE entity_id IN ('${voyageId}', '${blId}', '${otherBlId}');
    DELETE FROM public.charge_calculations WHERE bl_id IN ('${blId}', '${otherBlId}');
    ${initialPricingVersionIds === null ? '' : `DELETE FROM public.pricing_rule_versions p WHERE p.id <> ALL(ARRAY[${initialPricingVersionIds.join(',')}]::bigint[]) AND NOT EXISTS (SELECT 1 FROM public.invoice_items i WHERE i.pricing_rule_version_id = p.id) AND NOT EXISTS (SELECT 1 FROM public.charge_calculations c WHERE c.pricing_rule_version_id = p.id);`}
    DELETE FROM public.bl_containers WHERE bl_id IN ('${blId}', '${otherBlId}');
    DELETE FROM public.bls WHERE id IN ('${blId}', '${otherBlId}');
    DELETE FROM public.import_batches WHERE voyage_id = ${voyageId};
    DELETE FROM public.baplie_containers WHERE voyage_id = ${voyageId};
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.user_profiles WHERE id = '${actorId}';
    DELETE FROM auth.users WHERE id = '${actorId}';
    SET session_replication_role = origin;
  `)
}

function flags(containerNumber: string): string {
  return psql(`SELECT is_imo || ',' || is_oog || ',' || COALESCE(imo_class, '-') || ',' || COALESCE(un_number, '-')
    FROM public.bl_containers WHERE bl_id = '${blId}' AND container_number = '${containerNumber}'`)
}

describeLocal('import_bl_freight_with_metadata — flags do Baplie em qualquer ordem', () => {
  beforeAll(() => {
    initialPricingVersionIds = psql('SELECT id FROM public.pricing_rule_versions ORDER BY id').split('\n').filter(Boolean)
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'baplie118@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${actorId}', 'Baplie 118', 'administrativo', true);
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Baplie118 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Baplie118 Vessel', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'B118', 'active');
      INSERT INTO public.baplie_containers (voyage_id, container_number, status, is_imo, imo_class, un_number, is_oog) VALUES
        (${voyageId}, '${imoContainer}', 'full', true, '3', '1263', false),
        (${voyageId}, '${oogContainer}', 'full', false, NULL, NULL, true);
    `)
  })

  afterAll(cleanup)

  it('aplica IMO/OOG do Baplie já importado aos containers do B/L importado depois', () => {
    const payload = JSON.stringify([{
      id: blId,
      voyage_id: voyageId,
      pod: 'BRVIX',
      containers: [
        { container_number: imoContainer, type: '40HC', is_imo: false, is_oog: false },
        { container_number: oogContainer, type: '40FR', is_imo: false, is_oog: false },
      ],
    }])
    const result = asAuthenticated(`SELECT public.import_bl_freight_with_metadata('${payload}'::jsonb, '${actorId}',
      '{"filename":"bl-118.xlsx","voyage_id":${voyageId},"cargo_mode":"container"}'::jsonb);`)
    expect(result.ok, result.output).toBe(true)

    expect(flags(imoContainer)).toBe('true,false,3,1263')
    expect(flags(oogContainer)).toBe('false,true,-,-')
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_type = 'voyage' AND entity_id = '${voyageId}' AND field_name = 'baplie_physical_flags'`)).toBe('1')
  })

  it('reaplicar o Baplie sem diferença é no-op', () => {
    const result = asAuthenticated(`SELECT public.apply_baplie_physical_flags_atomic(${voyageId}, NULL, '${actorId}');`)
    expect(result.ok, result.output).toBe(true)
    expect(result.output).toContain('"applied": 0')
  })

  it('perfil alterado pelo Baplie recalcula as taxas do B/L na mesma operação', () => {
    psql(`UPDATE public.baplie_containers SET is_oog = false WHERE voyage_id = ${voyageId} AND container_number = '${oogContainer}'`)
    const result = asAuthenticated(`SELECT public.apply_baplie_physical_flags_atomic(${voyageId}, NULL, '${actorId}');`)
    expect(result.ok, result.output).toBe(true)
    expect(result.output).toContain('"applied": 1')
    expect(result.output).toMatch(/"recalculated": 1|"calculation_errors": \[\{"bl_id": "BAPLIE118-BL"/)
    expect(flags(oogContainer)).toBe('false,false,-,-')
  })

  it('migration 150: importar outro B/L só reaplica o Baplie aos containers do lote', () => {
    psql(`UPDATE public.baplie_containers SET is_oog = true WHERE voyage_id = ${voyageId} AND container_number = '${oogContainer}'`)
    const payload = JSON.stringify([{
      id: otherBlId,
      voyage_id: voyageId,
      pod: 'BRVIX',
      containers: [{ container_number: 'BPFU1500001', type: '40HC', is_imo: false, is_oog: false }],
    }])
    const result = asAuthenticated(`SELECT public.import_bl_freight_with_metadata('${payload}'::jsonb, '${actorId}',
      '{"filename":"bl-150.xlsx","voyage_id":${voyageId},"cargo_mode":"container"}'::jsonb);`)
    expect(result.ok, result.output).toBe(true)
    // O container do outro B/L fica como estava; a varredura da viagem inteira
    // continua disponível pela importação do Baplie.
    expect(flags(oogContainer)).toBe('false,false,-,-')
  })
})

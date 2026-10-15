import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000020201'
const customerId = 992201
const carrierId = 992202
const vesselId = 992203
const voyageId = 992204
const blIds = ['S12-BL-A', 'S12-BL-B', 'S12-BL-C']
const containerIds = [992205, 992206]
const vehicleId = 992207

function psql(sql: string) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

function callAs(userId: string, sql: string) {
  const result = spawnSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${userId}', true); ${sql} COMMIT;`,
  ], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`)
  return result.stdout.trim()
}

function callAsAuthenticated(sql: string) {
  return callAs(actorId, sql)
}

function lastJson(output: string) {
  return output.split('\n').map((line) => line.trim()).filter(Boolean).at(-1) ?? '{}'
}

describeLocal('S12 — leituras operacionais paginadas', () => {
  beforeAll(() => {
    psql(`
      SET session_replication_role = replica;
      DELETE FROM public.vehicles WHERE id = ${vehicleId};
      DELETE FROM public.bl_containers WHERE id = ANY(ARRAY[${containerIds.join(',')}]::bigint[]);
      DELETE FROM public.bls WHERE id = ANY(ARRAY['${blIds.join("','")}']::text[]);
      DELETE FROM public.voyages WHERE id = ${voyageId};
      DELETE FROM public.vessels WHERE id = ${vesselId};
      DELETE FROM public.carriers WHERE id = ${carrierId};
      DELETE FROM public.customers WHERE id = ${customerId};
      DELETE FROM public.user_profiles WHERE id = '${actorId}';
      DELETE FROM auth.users WHERE id = '${actorId}';
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 's12@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${actorId}', 'S12', 'operacoes', true);
      -- CNPJ derivado do namespace de ids desta suite: customers.cnpj_cpf e UNIQUE e
      -- a limpeza remove por id, entao um CNPJ compartilhado com outra suite colide
      -- na execucao em serie do gate de CI.
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customerId}, '99220100000195', 'S12 Customer');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'S12 Carrier');
      INSERT INTO public.vessels (id, name, imo, carrier_id) VALUES (${vesselId}, 'S12 Vessel', 'IMO992203', ${carrierId});
      -- Exercita o legado nullable: a migration 037 deve preservar a viagem
      -- e o frontend a normaliza como ativa.
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'S12-V', NULL);
      INSERT INTO public.bls (id, voyage_id, customer_id, consignee, cargo_mode, pol, pod, financial_status, review_status, charge_status, bb_machine_qty, bb_packages_qty, bb_packages_total, bb_weight_ton, total_cbm, created_at) VALUES
        ('${blIds[0]}', ${voyageId}, ${customerId}, 'Alpha', 'container', 'CNSHA', 'BRVIX', 'pending', 'ok', 'ready_for_billing', NULL, NULL, NULL, NULL, NULL, '2026-01-01T00:00:00Z'),
        ('${blIds[1]}', ${voyageId}, ${customerId}, 'Beta', 'container', 'CNSHA', 'BRVIX', 'pending', 'pending_review', 'review_required', NULL, NULL, NULL, NULL, NULL, '2026-01-02T00:00:00Z'),
        ('${blIds[2]}', ${voyageId}, ${customerId}, 'Gamma', 'carga_solta', 'CNSHA', 'BRSSZ', 'paid', 'ok', 'exempt', 2, 12, 12, 1.5, 4.25, '2026-01-03T00:00:00Z');
      INSERT INTO public.bl_containers (id, bl_id, container_number, type, is_imo, is_oog) VALUES
        (${containerIds[0]}, '${blIds[0]}', 'MSCU0000001', '20GP', false, false),
        (${containerIds[1]}, '${blIds[1]}', 'MSCU0000002', '40HC', true, false);
      INSERT INTO public.vehicles (id, voyage_id, container_id, bl_id, chassis, brand, model, weight_kg, cbm)
      VALUES (${vehicleId}, ${voyageId}, ${containerIds[1]}, '${blIds[1]}', 'CH-12', 'Make', 'Model', 1000, 10);
      SET session_replication_role = origin;
    `)
  })

  afterAll(() => {
    psql(`
      SET session_replication_role = replica;
      DELETE FROM public.vehicles WHERE id = ${vehicleId};
      DELETE FROM public.bl_containers WHERE id = ANY(ARRAY[${containerIds.join(',')}]::bigint[]);
      DELETE FROM public.bls WHERE id = ANY(ARRAY['${blIds.join("','")}']::text[]);
      DELETE FROM public.voyages WHERE id = ${voyageId};
      DELETE FROM public.vessels WHERE id = ${vesselId};
      DELETE FROM public.carriers WHERE id = ${carrierId};
      DELETE FROM public.customers WHERE id = ${customerId};
      DELETE FROM public.user_profiles WHERE id = '${actorId}';
      DELETE FROM auth.users WHERE id = '${actorId}';
      SET session_replication_role = origin;
    `)
  })

  // Migration 232: SECURITY INVOKER, então vale a RLS de quem chama.
  it('opções de filtro trazem POL, POD e tipos distintos para o usuário interno e nada para quem não tem perfil', () => {
    const options = JSON.parse(lastJson(callAsAuthenticated('SELECT public.operational_list_filter_options();'))) as { pols: string[]; pods: string[]; containerTypes: string[] }
    expect(options.pols).toContain('CNSHA')
    expect(options.pods).toEqual(expect.arrayContaining(['BRVIX', 'BRSSZ']))
    expect(options.containerTypes).toEqual(expect.arrayContaining(['20GP', '40HC']))
    expect(new Set(options.pols).size).toBe(options.pols.length)

    const stranger = JSON.parse(lastJson(callAs('00000000-0000-0000-0000-0000000202ff', 'SELECT public.operational_list_filter_options();')))
    expect(stranger).toEqual({ pols: [], pods: [], containerTypes: [] })
  })

  it('pagina sem perder o total e conserva filtros de perfil/status', () => {
    const page = JSON.parse(lastJson(callAsAuthenticated(`SELECT public.operational_list_bls(1, 2, NULL, ${voyageId}, NULL, NULL, NULL, NULL, NULL, NULL, NULL);`))) as { rows: Array<{ id: string }>; count: number }
    expect(page.count).toBe(3)
    expect(page.rows.map((row) => row.id)).toEqual(['S12-BL-C', 'S12-BL-B'])

    const standard = JSON.parse(lastJson(callAsAuthenticated(`SELECT public.operational_list_bls(1, 100, NULL, ${voyageId}, 'container', NULL, NULL, NULL, NULL, NULL, 'standard');`))) as { rows: Array<{ id: string }>; count: number }
    expect(standard.rows.map((row) => row.id)).toEqual(['S12-BL-A'])

    const summary = JSON.parse(lastJson(callAsAuthenticated(`SELECT public.operational_list_bl_summary(NULL, ${voyageId}, NULL, NULL, NULL, NULL, NULL, NULL, NULL);`))) as { totalBls: number; totalDistinctContainers: number; chargeExempt: number; totalMachines: number; totalPackages: number; totalWeightTon: number; totalCbm: number }
    expect(summary).toMatchObject({ totalBls: 3, totalDistinctContainers: 2, chargeExempt: 1, totalMachines: 2, totalPackages: 12, totalWeightTon: 1.5, totalCbm: 4.25 })
  })

  it('pagina containers e calcula agregados no mesmo conjunto filtrado', () => {
    const page = JSON.parse(lastJson(callAsAuthenticated(`SELECT public.operational_list_containers(1, 100, NULL, ${voyageId}, NULL, NULL, NULL, NULL, NULL, NULL, 'imo', NULL, true);`))) as {
      rows: Array<{ id: number; bl?: { id: string } | null }>
      count: number
      distinctCount: number
      imoDistinctCount: number
      blCount: number
    }
    expect(page).toMatchObject({ count: 1, distinctCount: 1, imoDistinctCount: 1, blCount: 1 })
    expect(page.rows[0]?.bl?.id).toBe(blIds[1])
  })

  it('entrega o rail com agregados de viagem sem materializar o detalhe', () => {
    const page = JSON.parse(lastJson(callAsAuthenticated(`SELECT public.operational_list_voyage_summaries(1, 100);`))) as {
      rows: Array<{
        id: number
        blCount: number
        containerCount: number
        baplieCount: number
        containerBlCount: number
        breakbulkBlCount: number
        ceCoverage: { filled: number; total: number }
        routes: Array<{ pol: string; pod: string; blCount: number }>
      }>
      count: number
    }
    const voyage = page.rows.find((row) => row.id === voyageId)
    expect(page.count).toBeGreaterThanOrEqual(1)
    expect(voyage).toMatchObject({
      id: voyageId,
      status: null,
      blCount: 3,
      containerCount: 2,
      baplieCount: 0,
      containerBlCount: 2,
      breakbulkBlCount: 1,
      ceCoverage: { filled: 0, total: 3 },
    })
    expect(voyage?.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ pol: 'CNSHA', pod: 'BRVIX', blCount: 2 }),
      expect.objectContaining({ pol: 'CNSHA', pod: 'BRSSZ', blCount: 1 }),
    ]))
  })
})

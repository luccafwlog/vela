// Etapa 9 do plano de correção das importações (migration 182; ADR 0078,
// item 21): marcas físicas do Baplie em todos os B/Ls ativos que dividem o
// container, perfil manual protegido, Baplie completo (o que sai apaga as
// marcas vindas dele, com prévia) e "Vale o B/L" na divergência de SOC/COC.
// Migration 194 (revisão da PR 929): E9-06, E9-07, E9-10, E9-11, E9-14 e S5,
// no fim da suíte.
//
// Namespace exclusivo: ids 99229xxx, B/Ls 'A229-*', usuário ...0000002290NN,
// containers 'ADCU229xxxx'.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000229001'
const carrierId = 99229001
const vesselId = 99229002
const voyageId = 99229003

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function asAdmin(sql: string): { output: string; error: string | null } {
  const run = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`],
  { encoding: 'utf8' })
  const error = run.stderr.split('\n').find((line) => line.startsWith('ERROR:')) ?? null
  return { output: run.stdout.trim(), error: error?.trim() ?? null }
}

function json<T>(sql: string): T {
  const result = asAdmin(sql)
  if (result.error) throw new Error(result.error)
  return JSON.parse(result.output) as T
}

type Staged = { container_number: string; status?: string; is_imo?: boolean; imo_class?: string | null; un_number?: string | null; is_oog?: boolean; ownership?: string | null }

function stage(rows: Staged[]) {
  const payload = rows.map((row) => ({
    container_number: row.container_number, size_type: '40HC', status: row.status ?? 'full', weight_kg: 10000,
    pol: 'A229O', pod: 'A229P', final_dest: null, bl_ref: null, slot: null,
    is_imo: row.is_imo ?? false, imo_class: row.imo_class ?? null, un_number: row.un_number ?? null,
    is_oog: row.is_oog ?? false, ownership: row.ownership ?? null,
  }))
  expect(asAdmin(`SELECT public.import_baplie_staging_transactional(${voyageId}, $json$${JSON.stringify(payload)}$json$::jsonb);`).error).toBeNull()
  return payload
}

type ApplyResult = {
  applied: number
  updated_ids: number[]
  applied_to: Array<{ container: string; bl_id: string; flags?: string }>
  cleared: Array<{ container: string; bl_id: string }>
  divergent_manual: Array<{ container: string; bl_id: string }>
  recalculated: number
  calculation_errors: Array<{ bl_id: string; message: string }>
}

function apply() {
  return json<ApplyResult>(`SELECT public.apply_baplie_physical_flags_atomic(${voyageId}, NULL, '${actorId}'::uuid);`)
}

function containerId(blId: string, number: string): number {
  return Number(psql(`SELECT id FROM public.bl_containers WHERE bl_id = '${blId}' AND container_number = '${number}';`))
}

function container(blId: string, number: string): { is_imo: boolean; is_oog: boolean; ownership: string | null; profile_source: string | null; ownership_source: string | null } {
  return JSON.parse(psql(`
    SELECT row_to_json(t) FROM (SELECT is_imo, is_oog, ownership, profile_source, ownership_source FROM public.bl_containers
    WHERE bl_id = '${blId}' AND container_number = '${number}') AS t;
  `))
}

/** psql em outra sessão, sem bloquear o teste (para abrir uma janela de concorrência). */
function runAsync(sql: string): Promise<{ code: number | null; stderr: string }> {
  const child = spawn('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })
  return new Promise((resolve) => child.on('close', (code) => resolve({ code, stderr })))
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    CREATE TEMP TABLE a229_bls AS SELECT id FROM public.bls WHERE id LIKE 'A229-%';
    DELETE FROM public.baplie_reconciliation_resolutions WHERE voyage_id = ${voyageId};
    DELETE FROM public.baplie_containers WHERE voyage_id = ${voyageId};
    DELETE FROM public.charge_calculations WHERE bl_id IN (SELECT id FROM a229_bls);
    DELETE FROM public.billing_run_logs WHERE bl_id IN (SELECT id FROM a229_bls);
    DELETE FROM public.import_effect_attempts WHERE effect_id IN (SELECT id FROM public.import_pending_effects WHERE entity_id IN (SELECT id FROM a229_bls) OR entity_id = '${voyageId}');
    DELETE FROM public.import_pending_effects WHERE entity_id IN (SELECT id FROM a229_bls) OR entity_id = '${voyageId}';
    DELETE FROM public.audit_logs WHERE entity_id IN (SELECT id FROM a229_bls) OR (entity_type IN ('voyage', 'voyages') AND entity_id = '${voyageId}') OR changed_by = '${actorId}';
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM public.alerts WHERE entity_id IN ('${voyageId}') OR entity_id IN (SELECT id FROM a229_bls));
    DELETE FROM public.alerts WHERE entity_id IN ('${voyageId}') OR entity_id IN (SELECT id FROM a229_bls);
    DELETE FROM public.vehicles WHERE bl_id IN (SELECT id FROM a229_bls);
    DELETE FROM public.bl_freight_lines WHERE bl_id IN (SELECT id FROM a229_bls);
    DELETE FROM public.invoice_basis_pending_changes WHERE bl_id IN (SELECT id FROM a229_bls);
    DELETE FROM public.bl_containers WHERE bl_id IN (SELECT id FROM a229_bls);
    DELETE FROM public.customer_reconciliation_queue WHERE bl_id IN (SELECT id FROM a229_bls);
    DELETE FROM public.bls WHERE id IN (SELECT id FROM a229_bls);
    DELETE FROM public.voyage_documental_pending WHERE voyage_id = ${voyageId};
    DELETE FROM public.voyage_documental_state WHERE voyage_id = ${voyageId};
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.user_profiles WHERE id = '${actorId}';
    DELETE FROM auth.users WHERE id = '${actorId}';
    SET session_replication_role = origin;
  `)
}

function insertBl(id: string, containers: Array<{ number: string; ownership?: 'SOC' | 'COC' }>) {
  psql(`
    INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode, financial_status, charge_status, customer_reconciliation_status, review_status)
    VALUES ('${id}', ${voyageId}, 'A229O', 'A229P', 'container', 'pending', 'not_calculated', 'missing_customer', 'ok');
    INSERT INTO public.bl_containers (bl_id, container_number, type, ownership, ownership_source) VALUES
    ${containers.map((c) => `('${id}', '${c.number}', '40HC', ${c.ownership ? `'${c.ownership}', 'bl'` : 'NULL, NULL'})`).join(', ')};
  `)
}

describeLocal('Etapa 9 — Baplie em todos os B/Ls do container, perfil manual, Baplie completo e Vale o B/L (migration 182)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'a229-admin@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${actorId}', 'A229 Administrativo', 'administrativo', true);
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'A229 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'A229 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'A229', 'active');
    `)
    insertBl('A229-S1', [{ number: 'ADCU2290001' }])
    insertBl('A229-S2', [{ number: 'ADCU2290001' }, { number: 'ADCU2290002' }])
    insertBl('A229-SX', [{ number: 'ADCU2290001' }])
    insertBl('A229-M1', [{ number: 'ADCU2290003' }])
    insertBl('A229-O1', [{ number: 'ADCU2290004', ownership: 'COC' }])
    expect(JSON.parse(asAdmin(`SELECT public.cancel_bl('A229-SX', 'Armador reemitiu (A229)', false);`).output)).toMatchObject({ cancelled: true })
  })

  afterAll(cleanup)

  it('a marca do Baplie vale para todos os B/Ls ativos que dividem o container; o cancelado fica de fora', () => {
    stage([
      { container_number: 'ADCU2290001', is_imo: true, imo_class: '3', un_number: '1263' },
      { container_number: 'ADCU2290002', is_oog: true },
      { container_number: 'ADCU2290003' },
      { container_number: 'ADCU2290004', ownership: 'SOC' },
    ])
    const result = apply()
    expect(result.applied_to.filter((item) => item.container === 'ADCU2290001').map((item) => item.bl_id).sort()).toEqual(['A229-S1', 'A229-S2'])
    expect(container('A229-S1', 'ADCU2290001')).toMatchObject({ is_imo: true, profile_source: 'baplie' })
    expect(container('A229-S2', 'ADCU2290001')).toMatchObject({ is_imo: true, profile_source: 'baplie' })
    expect(container('A229-SX', 'ADCU2290001')).toMatchObject({ is_imo: false })
    expect(container('A229-S2', 'ADCU2290002')).toMatchObject({ is_oog: true })
    // SOC/COC: vale o B/L; o Baplie não troca.
    expect(container('A229-O1', 'ADCU2290004')).toMatchObject({ ownership: 'COC', ownership_source: 'bl' })
  })

  it('perfil corrigido à mão não é sobrescrito: o Baplie diferente vira divergência', () => {
    expect(asAdmin(`SELECT public.set_bl_container_profile((SELECT id FROM public.bl_containers WHERE bl_id = 'A229-M1'), 'imo', 'Armador confirmou IMO fora do Baplie (A229)', '${actorId}'::uuid);`).error).toBeNull()
    expect(container('A229-M1', 'ADCU2290003')).toMatchObject({ is_imo: true, profile_source: 'manual' })
    const result = apply()
    expect(container('A229-M1', 'ADCU2290003')).toMatchObject({ is_imo: true, profile_source: 'manual' })
    expect(result.divergent_manual).toEqual([{ container: 'ADCU2290003', bl_id: 'A229-M1' }])
  })

  it('Baplie completo: a prévia lista o que cai e a gravação apaga só as marcas vindas do Baplie anterior', () => {
    const next = [
      { container_number: 'ADCU2290002', is_oog: true },
      { container_number: 'ADCU2290003' },
      { container_number: 'ADCU2290004', ownership: 'SOC' },
    ].map((row) => ({ ...row, status: 'full', is_imo: false, imo_class: null, un_number: null, is_oog: row.is_oog ?? false, ownership: row.ownership ?? null }))
    const preview = json<{ clear: Array<{ container: string; bl_id: string; before: string; after: string }> }>(
      `SELECT public.preview_baplie_physical_flags(${voyageId}, $json$${JSON.stringify(next)}$json$::jsonb);`)
    expect(preview.clear.map((item) => [item.container, item.bl_id, item.before, item.after])).toEqual([
      ['ADCU2290001', 'A229-S1', 'IMO', 'sem marca'],
      ['ADCU2290001', 'A229-S2', 'IMO', 'sem marca'],
    ])
    // A prévia não grava.
    expect(container('A229-S1', 'ADCU2290001')).toMatchObject({ is_imo: true })

    stage(next)
    const result = apply()
    expect(result.cleared.map((item) => item.bl_id).sort()).toEqual(['A229-S1', 'A229-S2'])
    expect(container('A229-S1', 'ADCU2290001')).toMatchObject({ is_imo: false, profile_source: null })
    // O manual continua.
    expect(container('A229-M1', 'ADCU2290003')).toMatchObject({ is_imo: true, profile_source: 'manual' })
  })

  it('Vale o B/L encerra a divergência de SOC/COC com motivo', () => {
    const id = psql(`SELECT id FROM public.bl_containers WHERE bl_id = 'A229-O1';`)
    expect(asAdmin(`SELECT public.resolve_baplie_divergence(${id}, 'ownership', NULL);`).error).toMatch(/motivo/)
    const resolved = json<{ baplie_value: string; bl_value: string }>(`SELECT public.resolve_baplie_divergence(${id}, 'ownership', 'B/L confirma COC (A229)');`)
    expect(resolved).toMatchObject({ baplie_value: 'SOC', bl_value: 'COC' })
    // Migration 194 (E9-10): a origem continua do B/L; só a resolução é registrada.
    expect(container('A229-O1', 'ADCU2290004')).toMatchObject({ ownership: 'COC', ownership_source: 'bl' })
    expect(psql(`SELECT resolution || ':' || baplie_value || ':' || manifest_value || ':' || justification FROM public.baplie_reconciliation_resolutions WHERE bl_container_id = ${id};`))
      .toBe('vale_o_bl:SOC:COC:B/L confirma COC (A229)')
  })

  // --- Migration 194: correções da revisão da PR 929 ---------------------------

  it('E9-10: depois de "Vale o B/L", a reimportação do B/L ainda corrige o SOC/COC do armador', () => {
    const payload = [{ id: 'A229-O1', voyage_id: voyageId, containers: [{ container_number: 'ADCU2290004', type: '40HC', ownership: 'SOC' }] }]
    expect(asAdmin(`SELECT public.import_bl_freight_transactional($json$${JSON.stringify(payload)}$json$::jsonb, '${actorId}'::uuid);`).error).toBeNull()
    expect(container('A229-O1', 'ADCU2290004')).toMatchObject({ ownership: 'SOC', ownership_source: 'bl' })
  })

  it('S5: "Vale o B/L" recusa divergência que não existe e B/L cancelado', () => {
    // ADCU2290002 no A229-S2: nenhum dos lados informa SOC/COC.
    const semDivergencia = containerId('A229-S2', 'ADCU2290002')
    expect(asAdmin(`SELECT public.resolve_baplie_divergence(${semDivergencia}, 'ownership', 'Teste (A229)');`).error)
      .toMatch(/Não há divergência de SOC\/COC/)
    // OOG do Baplie e do B/L iguais: perfil sem divergência.
    expect(asAdmin(`SELECT public.resolve_baplie_divergence(${semDivergencia}, 'profile', 'Teste (A229)');`).error)
      .toMatch(/Não há divergência de perfil/)
    const cancelado = containerId('A229-SX', 'ADCU2290001')
    expect(asAdmin(`SELECT public.resolve_baplie_divergence(${cancelado}, 'profile', 'Teste (A229)');`).error).toMatch(/cancelado/)
    expect(psql(`SELECT count(*) FROM public.baplie_reconciliation_resolutions WHERE bl_container_id IN (${semDivergencia}, ${cancelado});`)).toBe('0')
  })

  it('E9-11: correção manual de perfil e de SOC/COC e "Vale o B/L" valem para o container em todos os B/Ls ativos', () => {
    const s1 = containerId('A229-S1', 'ADCU2290001')
    const s2 = containerId('A229-S2', 'ADCU2290001')
    const result = json<{ propagated_to: Array<{ bl_id: string }> }>(
      `SELECT public.set_bl_container_profile(${s1}, 'oog', 'Armador confirmou OOG (A229)', '${actorId}'::uuid);`)
    expect(result.propagated_to.map((item) => item.bl_id)).toEqual(['A229-S2'])
    expect(container('A229-S1', 'ADCU2290001')).toMatchObject({ is_imo: false, is_oog: true, profile_source: 'manual' })
    expect(container('A229-S2', 'ADCU2290001')).toMatchObject({ is_imo: false, is_oog: true, profile_source: 'manual' })
    // O B/L cancelado fica de fora, e a correção não parte dele.
    expect(container('A229-SX', 'ADCU2290001')).toMatchObject({ is_oog: false })
    expect(asAdmin(`SELECT public.set_bl_container_profile(${containerId('A229-SX', 'ADCU2290001')}, 'imo', 'Teste (A229)', '${actorId}'::uuid);`).error)
      .toMatch(/cancelado: somente leitura/)
    expect(psql(`SELECT string_agg(entity_id, ',' ORDER BY entity_id) FROM public.audit_logs WHERE field_name = 'container_profile' AND entity_id IN ('A229-S1', 'A229-S2', 'A229-SX');`))
      .toBe('A229-S1,A229-S2')

    expect(asAdmin(`SELECT public.set_bl_container_ownership(${s2}, 'SOC', 'Cliente confirmou SOC (A229)', '${actorId}'::uuid);`).error).toBeNull()
    expect(container('A229-S1', 'ADCU2290001')).toMatchObject({ ownership: 'SOC', ownership_source: 'manual' })
    expect(container('A229-S2', 'ADCU2290001')).toMatchObject({ ownership: 'SOC', ownership_source: 'manual' })
    expect(container('A229-SX', 'ADCU2290001')).toMatchObject({ ownership: null })

    // O Baplie traz o container sem marca: a divergência de perfil aparece nos
    // dois B/Ls, e "Vale o B/L" num deles encerra os dois.
    stage([{ container_number: 'ADCU2290001' }, { container_number: 'ADCU2290002', is_oog: true }, { container_number: 'ADCU2290004', ownership: 'SOC' }])
    const resolved = json<{ resolved: Array<{ bl_id: string }> }>(
      `SELECT public.resolve_baplie_divergence(${s2}, 'profile', 'B/L confirma OOG (A229)');`)
    expect(resolved.resolved.map((item) => item.bl_id).sort()).toEqual(['A229-S1', 'A229-S2'])
    expect(psql(`SELECT string_agg(bl_container_id::text || ':' || baplie_value || ':' || manifest_value, ',' ORDER BY bl_container_id)
      FROM public.baplie_reconciliation_resolutions WHERE bl_container_id IN (${s1}, ${s2}) AND field_name = 'profile';`))
      .toBe(`${s1}:sem marca:OOG,${s2}:sem marca:OOG`)
  })

  it('E9-06: container Divergente que troca SOC/COC pelo Baplie entra no recálculo, na auditoria e no resultado', () => {
    insertBl('A229-M2', [{ number: 'ADCU2290005' }])
    const id = containerId('A229-M2', 'ADCU2290005')
    expect(asAdmin(`SELECT public.set_bl_container_profile(${id}, 'imo', 'Armador confirmou IMO fora do Baplie (A229)', '${actorId}'::uuid);`).error).toBeNull()
    stage([{ container_number: 'ADCU2290005', ownership: 'SOC' }])
    const result = apply()
    expect(container('A229-M2', 'ADCU2290005')).toMatchObject({ is_imo: true, profile_source: 'manual', ownership: 'SOC', ownership_source: 'baplie' })
    expect(result.divergent_manual).toContainEqual({ container: 'ADCU2290005', bl_id: 'A229-M2' })
    expect(result.updated_ids).toContain(id)
    expect(result.applied_to).toContainEqual({ container: 'ADCU2290005', bl_id: 'A229-M2', flags: 'IMO, SOC' })
    // Auditoria da Viagem com o container.
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_type = 'voyage' AND entity_id = '${voyageId}'
      AND field_name = 'baplie_physical_flags' AND new_value::jsonb->'updated_ids' @> '[${id}]'::jsonb;`)).toBe('1')
    // Cada B/L (não faturado) dos containers alterados é recalculado na hora,
    // ou a falha do recálculo fica registrada para a fila.
    const bls = Number(psql(`SELECT count(DISTINCT bl_id) FROM public.bl_containers WHERE id = ANY(ARRAY[${result.updated_ids.join(',')}]::bigint[]);`))
    expect(result.recalculated + result.calculation_errors.length).toBe(bls)
  })

  it('E9-07: IMO declarado no B/L é do B/L; o Baplie que confirma não troca a origem e o seguinte sem o container não o apaga', () => {
    const payload = [{
      id: 'A229-BL1', voyage_id: voyageId, cargo_mode: 'container',
      containers: [{ container_number: 'ADCU2290006', type: '40HC', is_imo: true, imo_class: '3', un_number: '1263' }],
    }]
    expect(asAdmin(`SELECT public.import_bl_freight_transactional($json$${JSON.stringify(payload)}$json$::jsonb, '${actorId}'::uuid);`).error).toBeNull()
    expect(container('A229-BL1', 'ADCU2290006')).toMatchObject({ is_imo: true, profile_source: 'bl' })

    // Baplie V1 confirma o IMO: a origem continua do B/L.
    stage([{ container_number: 'ADCU2290006', is_imo: true, imo_class: '3', un_number: '1263' }])
    apply()
    expect(container('A229-BL1', 'ADCU2290006')).toMatchObject({ is_imo: true, profile_source: 'bl' })

    // Baplie V2 sem o container: a prévia não o lista e a gravação não apaga o IMO.
    const next = [{ container_number: 'ADCU2290005', status: 'full', is_imo: false, imo_class: null, un_number: null, is_oog: false, ownership: 'SOC' }]
    const preview = json<{ clear: Array<{ container: string }> }>(
      `SELECT public.preview_baplie_physical_flags(${voyageId}, $json$${JSON.stringify(next)}$json$::jsonb);`)
    expect(preview.clear.map((item) => item.container)).not.toContain('ADCU2290006')
    stage(next)
    const result = apply()
    expect(result.cleared.map((item) => item.container)).not.toContain('ADCU2290006')
    expect(container('A229-BL1', 'ADCU2290006')).toMatchObject({ is_imo: true, profile_source: 'bl' })
  })

  it('E9-14: correção manual que chega entre o plano e a gravação do Baplie não é sobrescrita', async () => {
    insertBl('A229-R0', [{ number: 'ADCU2290008' }])
    insertBl('A229-R1', [{ number: 'ADCU2290007' }])
    const first = containerId('A229-R0', 'ADCU2290008')
    const target = containerId('A229-R1', 'ADCU2290007')
    expect(first).toBeLessThan(target)
    stage([
      { container_number: 'ADCU2290005', ownership: 'SOC' },
      { container_number: 'ADCU2290007', is_imo: true, imo_class: '3', un_number: '1263' },
      { container_number: 'ADCU2290008', is_imo: true, imo_class: '3', un_number: '1263' },
    ])

    // Uma sessão segura o primeiro container do plano: a aplicação lê o plano
    // (o alvo ainda não é manual) e para nele.
    const holder = runAsync(`BEGIN; SELECT id FROM public.bl_containers WHERE id = ${first} FOR UPDATE; SELECT pg_sleep(3); COMMIT;`)
    await sleep(500)
    const applying = runAsync(`SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${actorId}';
      SELECT public.apply_baplie_physical_flags_atomic(${voyageId}, NULL, '${actorId}'::uuid);`)
    await sleep(1000)
    // A correção manual do alvo confirma nessa janela. Pelo app os gatilhos de
    // bl_containers travam a Viagem e a correção esperaria a aplicação (ou uma
    // das duas cairia por deadlock); aqui ela é gravada sem gatilhos para cair
    // exatamente entre o plano e a gravação.
    psql(`SET session_replication_role = replica;
      UPDATE public.bl_containers SET is_imo = false, imo_class = NULL, un_number = NULL, is_oog = true, profile_source = 'manual' WHERE id = ${target};
      SET session_replication_role = origin;`)
    const [held, applied] = await Promise.all([holder, applying])
    expect(held.code, held.stderr).toBe(0)
    expect(applied.code, applied.stderr).toBe(0)
    expect(container('A229-R1', 'ADCU2290007')).toMatchObject({ is_imo: false, is_oog: true, profile_source: 'manual' })
    expect(container('A229-R0', 'ADCU2290008')).toMatchObject({ is_imo: true, profile_source: 'baplie' })
  }, 30000)
})

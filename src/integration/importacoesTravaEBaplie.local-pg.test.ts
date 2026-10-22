// Lote 1 da frente das importações (ADR 0095, decisões 6, 11 e 13; revisão de
// 2026-10-21, achados F-04, F-11, F-16, F-20, F-21, F-22 e F-26; migrations
// 387 e 388):
// - trava `import_voyage:<id>` em toda importação de Viagem: duas importações
//   da mesma Viagem em sessões paralelas não caem em deadlock (B/L × B/L,
//   B/L × Baplie) e Baplie × Baplie não deixa as duas listas;
// - o Baplie substitui só os PODs marcados; o resto da Viagem (containers,
//   marcas, vazios com natureza e Nº do manifesto Mercante de vazios) fica;
// - Viagem do arquivo, escalas, PODs marcados e container repetido conferidos
//   no servidor; prévia velha (`expected`) recusada;
// - staging, marcas e vazios numa transação: falha nas marcas desfaz tudo;
// - índice único no staging e rastro dos "Vazios pelo Baplie" de volta;
// - migration 390: porto marcado sem container no arquivo é recusado (antes
//   apagava o Baplie, as marcas e os vazios desse porto) e o manifesto de
//   vazios do Baplie que a prévia leu (id e total) é conferido depois da trava
//   (antes, outro recadastro entre a prévia e a gravação passava sem aviso).
//
// Antes da 387/388: o par B/L × B/L desta suíte terminava em 40P01 ("deadlock
// detected", import_bl_freight_with_metadata_legacy_189 linha 42) e a
// `import_baplie_file_atomic` não existia.
//
// Namespace exclusivo: ids 99387xxx, B/Ls 'A387-*', containers 'AQCU387xxxx',
// usuário ...000387001, Nº de Manifesto '1226A3870000x'.
import { spawn } from 'node:child_process'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { execPsql, spawnPsql } from './localPsql'
import { describeWithProbe } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000387001'
const carrierId = 99387001
const vesselId = 99387002
const voyageId = 99387003
const claims = `SET LOCAL request.jwt.claim.role = 'authenticated'; SET LOCAL request.jwt.claim.sub = '${actorId}';`

/** Superusuário (fixture, inspeção e limpeza), com o ator na sessão. */
function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `BEGIN; ${claims} ${sql}; COMMIT;`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** Papel `authenticated`, como o PostgREST executa a chamada da tela. */
function asUser(sql: string): { output: string; error: string | null } {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; ${claims} ${sql}; COMMIT;`], { encoding: 'utf8' })
  const error = run.stderr.split('\n').find((line) => line.startsWith('ERROR:')) ?? null
  return { output: run.stdout.trim(), error: error?.trim() ?? null }
}

/** psql em outra sessão, sem bloquear o teste (janela de concorrência). */
function runAsync(sql: string): Promise<{ code: number | null; stderr: string; endedAt: number }> {
  const child = spawn('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; ${claims} ${sql}; COMMIT;`], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })
  return new Promise((resolve) => child.on('close', (code) => resolve({ code, stderr, endedAt: Date.now() })))
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function probe(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.import_baplie_file_atomic(bigint,jsonb,text[],jsonb,jsonb)') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(probe, 'migration 388 aplicada')

type Row = { container_number: string; pod: string | null; status?: 'full' | 'empty'; is_imo?: boolean; is_oog?: boolean }

function rows(list: Row[]) {
  return list.map((row) => ({
    container_number: row.container_number, size_type: '40HC', status: row.status ?? 'full', weight_kg: 3800,
    pol: 'CNSHA', pod: row.pod, final_dest: null, bl_ref: null, slot: null,
    is_imo: row.is_imo ?? false, imo_class: row.is_imo ? '3' : null, un_number: row.is_imo ? '1263' : null,
    is_oog: row.is_oog ?? false, ownership: null,
  }))
}

/**
 * O que a prévia lê (`reimportBaplie`): versão do staging e o manifesto de
 * vazios do Baplie (id e total, ou nulo), montado aqui como a tela monta.
 */
function version(): string {
  return psql(`SELECT (public._baplie_staging_version(${voyageId}) || jsonb_build_object('vazios_manifest',
    (SELECT jsonb_build_object('id', m.id, 'total', m.total_containers) FROM public.vazios_importacao_manifests m
      WHERE m.voyage_id = ${voyageId} AND m.source = 'baplie' ORDER BY m.imported_at DESC LIMIT 1)))::text`)
}

function vaziosManifest(): string {
  return psql(`SELECT string_agg(id::text || ':' || total_containers, ',') FROM public.vazios_importacao_manifests
    WHERE voyage_id = ${voyageId} AND source = 'baplie'`)
}

function importSql(list: Row[], pods: string[], options: { expected?: string; file?: object } = {}) {
  const expected = options.expected ?? version()
  const file = options.file ?? { voyage_number: 'A387V' }
  return `SELECT public.import_baplie_file_atomic(${voyageId}, $r$${JSON.stringify(rows(list))}$r$::jsonb,
    ARRAY[${pods.map((pod) => `'${pod}'`).join(',')}]::text[], '${expected}'::jsonb, '${JSON.stringify(file)}'::jsonb)`
}

function importBaplie(list: Row[], pods: string[], options: { expected?: string; file?: object } = {}) {
  return asUser(importSql(list, pods, options))
}

function staging(): string {
  return psql(`SELECT string_agg(container_number || ':' || pod || ':' || status, ',' ORDER BY container_number)
    FROM public.baplie_containers WHERE voyage_id = ${voyageId}`)
}

function blContainer(blId: string, number: string): string {
  return psql(`SELECT is_imo || '/' || is_oog || '/' || COALESCE(profile_source, '-') FROM public.bl_containers
    WHERE bl_id = '${blId}' AND container_number = '${number}'`)
}

function vazios(): string {
  return psql(`SELECT string_agg(c.container_number || ':' || COALESCE(c.natureza, '-'), ',' ORDER BY c.container_number)
    FROM public.vazios_importacao_containers c JOIN public.vazios_importacao_manifests m ON m.id = c.manifest_id
    WHERE m.voyage_id = ${voyageId}`)
}

function blPayload(id: string, container: string) {
  return JSON.stringify([{ id, voyage_id: voyageId, cargo_mode: 'container', pol: 'CNSHA', pod: 'BRSSZ',
    containers: [{ container_number: container, type: '40HC' }] }])
}

function blImportSql(id: string, container: string) {
  return `SELECT public.import_bl_freight_file_atomic('${blPayload(id, container)}'::jsonb, '${actorId}'::uuid,
    '{"filename":"a387.xlsx","voyage_id":${voyageId},"cargo_mode":"container"}'::jsonb) IS NOT NULL`
}

function dropTestTriggers() {
  psql(`
    DROP TRIGGER IF EXISTS a387_slow_bl ON public.bls;
    DROP TRIGGER IF EXISTS a387_fail_marks ON public.bl_containers;
    DROP FUNCTION IF EXISTS public.a387_slow_bl();
    DROP FUNCTION IF EXISTS public.a387_fail_marks();
  `)
}

function cleanup() {
  dropTestTriggers()
  psql(`
    SET LOCAL session_replication_role = replica;
    CREATE TEMP TABLE a387_bls ON COMMIT DROP AS SELECT id FROM public.bls WHERE id LIKE 'A387-%';
    DELETE FROM public.baplie_reconciliation_resolutions WHERE voyage_id = ${voyageId};
    DELETE FROM public.baplie_containers WHERE voyage_id = ${voyageId};
    DELETE FROM public.vazios_importacao_containers WHERE manifest_id IN (SELECT id FROM public.vazios_importacao_manifests WHERE voyage_id = ${voyageId});
    DELETE FROM public.vazios_importacao_manifests WHERE voyage_id = ${voyageId};
    DELETE FROM public.voyage_route_ce_master WHERE voyage_id = ${voyageId};
    UPDATE public.bls SET manifesto_mercante_id = NULL WHERE id IN (SELECT id FROM a387_bls);
    DELETE FROM public.manifestos_mercante WHERE voyage_id = ${voyageId};
    DELETE FROM public.charge_calculations WHERE bl_id IN (SELECT id FROM a387_bls);
    DELETE FROM public.bl_charge_calculation_basis WHERE bl_id IN (SELECT id FROM a387_bls);
    DELETE FROM public.billing_run_logs WHERE bl_id IN (SELECT id FROM a387_bls);
    DELETE FROM public.import_effect_attempts WHERE effect_id IN (SELECT id FROM public.import_pending_effects
      WHERE entity_id IN (SELECT id FROM a387_bls) OR entity_id = '${voyageId}' OR created_by = '${actorId}');
    DELETE FROM public.import_pending_effects WHERE entity_id IN (SELECT id FROM a387_bls) OR entity_id = '${voyageId}' OR created_by = '${actorId}';
    DELETE FROM public.invoice_basis_pending_changes WHERE bl_id IN (SELECT id FROM a387_bls);
    DELETE FROM public.customer_reconciliation_queue WHERE bl_id IN (SELECT id FROM a387_bls);
    DELETE FROM public.bl_freight_lines WHERE bl_id IN (SELECT id FROM a387_bls);
    DELETE FROM public.bl_containers WHERE bl_id IN (SELECT id FROM a387_bls);
    DELETE FROM public.vehicles WHERE bl_id IN (SELECT id FROM a387_bls);
    DELETE FROM public.bls WHERE id IN (SELECT id FROM a387_bls);
    DELETE FROM public.import_batches WHERE voyage_id = ${voyageId};
    DELETE FROM public.internal_notifications WHERE entity_id = '${voyageId}' OR entity_id LIKE '${voyageId}::%' OR entity_id IN (SELECT id FROM a387_bls);
    DELETE FROM public.alert_items WHERE metadata->>'voyage_id' = '${voyageId}'
      OR alert_id IN (SELECT id FROM public.alerts WHERE entity_id = '${voyageId}' OR entity_id LIKE '${voyageId}::%' OR entity_id IN (SELECT id FROM a387_bls));
    DELETE FROM public.alerts WHERE entity_id = '${voyageId}' OR entity_id LIKE '${voyageId}::%' OR entity_id IN (SELECT id FROM a387_bls);
    DELETE FROM public.audit_logs WHERE changed_by = '${actorId}' OR entity_id = '${voyageId}' OR entity_id LIKE '${voyageId}::%'
      OR entity_id IN (SELECT id FROM a387_bls);
    DELETE FROM public.voyage_documental_pending WHERE voyage_id = ${voyageId};
    DELETE FROM public.voyage_documental_state WHERE voyage_id = ${voyageId};
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.user_profiles WHERE id = '${actorId}';
    DELETE FROM auth.users WHERE id = '${actorId}'
  `)
}

function insertBl(id: string, pod: string, container: string) {
  psql(`
    INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode, financial_status, charge_status, customer_reconciliation_status, review_status)
    VALUES ('${id}', ${voyageId}, 'CNSHA', '${pod}', 'container', 'pending', 'not_calculated', 'missing_customer', 'ok');
    INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${id}', '${container}', '40HC')
  `)
}

describeLocal('Lote 1 das importações — trava por Viagem e Baplie no servidor (387, 388, 390)', () => {
  beforeAll(() => {
    cleanup()
    const eta = psql(`SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 60)::text`)
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'a387@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${actorId}', 'A387 Administrativo', 'administrativo', true);
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'A387 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'A387 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'A387V', 'active');
      -- Escalas ativas da Viagem: Santos e Rio Grande.
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by) VALUES
        ('voyage_pod_schedule', '${voyageId}::BRSSZ', 'eta', NULL, '${eta}', '${actorId}'),
        ('voyage_pod_schedule', '${voyageId}::BRRIG', 'eta', NULL, '${eta}', '${actorId}')
    `)
    insertBl('A387-B1', 'BRSSZ', 'AQCU3870001')
    insertBl('A387-B2', 'BRRIG', 'AQCU3870002')
  })

  afterAll(cleanup)

  it('F-21 (decisão 11): o Baplie substitui só os PODs marcados; containers, marcas, vazios com natureza e Nº dos outros ficam', () => {
    const first = importBaplie([
      { container_number: 'AQCU3870001', pod: 'BRSSZ', is_imo: true },
      { container_number: 'AQCU3870002', pod: 'BRRIG' },
      { container_number: 'AQCU3870011', pod: 'BRSSZ', status: 'empty' },
      { container_number: 'AQCU3870012', pod: 'BRRIG', status: 'empty' },
    ], ['BRSSZ', 'BRRIG'])
    expect(first.error).toBeNull()
    const firstResult = JSON.parse(first.output) as { staged: number; flags: { applied: number }; vazios: unknown }
    // As marcas vêm na mesma chamada.
    expect(firstResult).toMatchObject({ staged: 4, flags: { applied: 1 }, vazios: null })
    expect(blContainer('A387-B1', 'AQCU3870001')).toBe('true/false/baplie')

    // Vazios cadastrados pelo Baplie, natureza digitada e Nº da rota de Santos.
    expect(asUser(`SELECT public.replace_vazios_from_baplie_transactional(${voyageId}, NULL, '${actorId}'::uuid, false)`).error).toBeNull()
    psql(`UPDATE public.vazios_importacao_containers SET natureza = 'cama' WHERE container_number = 'AQCU3870011';
      INSERT INTO public.manifestos_mercante (voyage_id, pol, pod, numero, natureza) VALUES (${voyageId}, 'CNSHA', 'BRSSZ', '1226A38700001', 'vazio')`)
    // F-26: o recadastro dos vazios grava o contexto da importação no Histórico.
    expect(psql(`SELECT DISTINCT justification FROM public.audit_logs WHERE entity_type = 'vazios_importacao_manifests' AND changed_by = '${actorId}'`))
      .toBe('Importação de Vazios pelo Baplie · Viagem A387 NAVIO A387V')

    // Arquivo novo com só Rio Grande marcado: OOG no 0002, vazio 0012 sai, 0013 entra.
    const second = importBaplie([
      { container_number: 'AQCU3870002', pod: 'BRRIG', is_oog: true },
      { container_number: 'AQCU3870013', pod: 'BRRIG', status: 'empty' },
    ], ['BRRIG'])
    expect(second.error).toBeNull()
    expect(JSON.parse(second.output)).toMatchObject({ staged: 2, replaced: 2, previous_total: 4, total: 4, pods: ['BRRIG'] })
    expect(staging()).toBe('AQCU3870001:BRSSZ:full,AQCU3870002:BRRIG:full,AQCU3870011:BRSSZ:empty,AQCU3870013:BRRIG:empty')
    expect(blContainer('A387-B1', 'AQCU3870001')).toBe('true/false/baplie')
    expect(blContainer('A387-B2', 'AQCU3870002')).toBe('false/true/baplie')
    // Vazios recadastrados na mesma transação: Santos mantém a natureza e o Nº.
    expect(vazios()).toBe('AQCU3870011:cama,AQCU3870013:-')
    expect(psql(`SELECT numero FROM public.manifestos_mercante WHERE voyage_id = ${voyageId} AND natureza = 'vazio'`)).toBe('1226A38700001')
    expect(psql(`SELECT justification FROM public.audit_logs WHERE entity_type = 'voyage' AND entity_id = '${voyageId}'
      AND field_name = 'baplie_import' ORDER BY id DESC LIMIT 1`)).toBe('Baplie substituído (portos BRRIG)')
  })

  it('F-16 (decisão 13): escalas, PODs marcados e container repetido conferidos no servidor; nada é gravado', () => {
    const before = staging()
    const cases: Array<[Row[], string[], object | undefined, RegExp]> = [
      [[{ container_number: 'AQCU3870002', pod: 'BRRIG' }, { container_number: 'AQCU3870002', pod: 'BRRIG', status: 'empty' }],
        ['BRRIG'], undefined, /Container repetido no Baplie \(AQCU3870002\)/],
      [[{ container_number: 'AQCU3870021', pod: 'BRPNG' }], ['BRPNG'], undefined, /fora das escalas da Viagem \(BRPNG\)/],
      [[{ container_number: 'AQCU3870021', pod: 'BRSSZ' }], ['BRRIG'], undefined, /fora dos portos marcados \(BRSSZ\)/],
    ]
    for (const [list, pods, file, message] of cases) {
      const result = importBaplie(list, pods, { file })
      expect(result.error).toMatch(message)
    }
    expect(staging()).toBe(before)

    // ADR 0096, decisão 2 (migration 409): o número de viagem não é conferido;
    // outro número ou nenhum (sem confirmação) é aceito.
    expect(importBaplie([{ container_number: 'AQCU3870002', pod: 'BRRIG', is_oog: true }, { container_number: 'AQCU3870013', pod: 'BRRIG', status: 'empty' }],
      ['BRRIG'], { file: {} }).error).toBeNull()
    expect(importBaplie([{ container_number: 'AQCU3870002', pod: 'BRRIG', is_oog: true }, { container_number: 'AQCU3870013', pod: 'BRRIG', status: 'empty' }],
      ['BRRIG'], { file: { voyage_number: '260911000000' } }).error).toBeNull()
    expect(staging()).toBe(before)
  })

  it('F-20: prévia velha (expected diferente do staging gravado) é recusada sem gravar', () => {
    const before = staging()
    const stale = JSON.stringify({ count: 4, max_id: 1 })
    const result = importBaplie([{ container_number: 'AQCU3870002', pod: 'BRRIG' }], ['BRRIG'], { expected: stale })
    expect(result.error).toMatch(/mudou depois da prévia/)
    expect(staging()).toBe(before)
  })

  it('390: porto marcado sem nenhum container no arquivo é recusado; o Baplie, as marcas e os vazios desse porto ficam', () => {
    const before = { staging: staging(), vazios: vazios(), manifest: vaziosManifest(), mark: blContainer('A387-B1', 'AQCU3870001') }
    // Santos marcado, mas o arquivo só traz Rio Grande: antes da 390 o escopo
    // da exclusão apagava 0001 e 0011 (com a natureza) e a marca IMO do B/L.
    const result = importBaplie([
      { container_number: 'AQCU3870002', pod: 'BRRIG', is_oog: true },
      { container_number: 'AQCU3870013', pod: 'BRRIG', status: 'empty' },
    ], ['BRRIG', 'BRSSZ'])
    expect(result.error).toMatch(/Porto\(s\) marcado\(s\) sem nenhum container no arquivo \(BRSSZ\).*Nada foi gravado/)
    expect({ staging: staging(), vazios: vazios(), manifest: vaziosManifest(), mark: blContainer('A387-B1', 'AQCU3870001') }).toEqual(before)

    // Mesma régua de porto da 388 dos dois lados: " brrig " marcado é o BRRIG do arquivo.
    expect(importBaplie([
      { container_number: 'AQCU3870002', pod: 'BRRIG', is_oog: true },
      { container_number: 'AQCU3870013', pod: 'BRRIG', status: 'empty' },
    ], [' brrig ']).error).toBeNull()
    expect(staging()).toBe(before.staging)
  })

  it('390: o manifesto de vazios do Baplie mudou depois da prévia — recusado sem gravar', () => {
    // Arquivo que troca os vazios de Rio Grande: gravado, recadastraria os vazios.
    const list: Row[] = [
      { container_number: 'AQCU3870002', pod: 'BRRIG', is_oog: true },
      { container_number: 'AQCU3870014', pod: 'BRRIG', status: 'empty' },
    ]
    const seen = version()
    expect(JSON.parse(seen).vazios_manifest).toMatchObject({ total: 2 })

    // Outra sessão recadastra os vazios do Baplie entre a prévia e a gravação (manifesto novo).
    expect(asUser(`SELECT public.replace_vazios_from_baplie_transactional(${voyageId}, NULL, '${actorId}'::uuid, true)`).error).toBeNull()
    const before = { staging: staging(), vazios: vazios(), manifest: vaziosManifest() }
    expect(before.manifest).not.toContain(JSON.parse(seen).vazios_manifest.id)
    const current = JSON.parse(version()) as { count: number; max_id: number; vazios_manifest: { id: string; total: number } }
    const stale: Array<[string, string]> = [
      ['manifesto trocado', seen],
      ['prévia sem manifesto, e agora há um', JSON.stringify({ ...current, vazios_manifest: null })],
      ['total diferente do lido', JSON.stringify({ ...current, vazios_manifest: { ...current.vazios_manifest, total: 3 } })],
      ['payload sem o manifesto lido', JSON.stringify({ count: current.count, max_id: current.max_id })],
    ]
    for (const [label, expected] of stale) {
      expect(importBaplie(list, ['BRRIG'], { expected }).error, label).toMatch(/vazios de importação do Baplie desta viagem mudaram depois da prévia.*Nada foi gravado/)
    }
    expect({ staging: staging(), vazios: vazios(), manifest: vaziosManifest() }).toEqual(before)

    // A prévia que leu o manifesto atual grava (o mesmo arquivo, sem mudar os vazios).
    expect(importBaplie([
      { container_number: 'AQCU3870002', pod: 'BRRIG', is_oog: true },
      { container_number: 'AQCU3870013', pod: 'BRRIG', status: 'empty' },
    ], ['BRRIG']).error).toBeNull()
    expect({ staging: staging(), vazios: vazios() }).toEqual({ staging: before.staging, vazios: before.vazios })
  })

  it('F-20: falha nas marcas desfaz o staging e os vazios (uma transação)', () => {
    const before = { staging: staging(), version: version(), vazios: vazios(), mark: blContainer('A387-B2', 'AQCU3870002') }
    psql(`
      CREATE FUNCTION public.a387_fail_marks() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
      BEGIN RAISE EXCEPTION 'falha forçada nas marcas (A387)'; END $f$;
      CREATE TRIGGER a387_fail_marks BEFORE UPDATE ON public.bl_containers FOR EACH ROW
        WHEN (NEW.container_number = 'AQCU3870002') EXECUTE FUNCTION public.a387_fail_marks()
    `)
    try {
      // Sem o OOG e com outro vazio: muda o staging, as marcas e os vazios.
      const result = importBaplie([
        { container_number: 'AQCU3870002', pod: 'BRRIG' },
        { container_number: 'AQCU3870014', pod: 'BRRIG', status: 'empty' },
      ], ['BRRIG'])
      expect(result.error).toMatch(/falha forçada nas marcas/)
    } finally {
      dropTestTriggers()
    }
    expect({ staging: staging(), version: version(), vazios: vazios(), mark: blContainer('A387-B2', 'AQCU3870002') }).toEqual(before)
  })

  it('F-22: o staging não aceita o mesmo container duas vezes na Viagem', () => {
    const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
      `INSERT INTO public.baplie_containers (voyage_id, container_number, status) VALUES (${voyageId}, 'AQCU3870001', 'full')`],
    { encoding: 'utf8' })
    expect(result.stderr).toMatch(/baplie_containers_voyage_container_key/)
  })

  it('F-04 (decisão 6): Baplie × Baplie em paralelo — o segundo espera, vê a prévia velha e é recusado; uma lista só', async () => {
    const expected = version()
    const firstSql = importSql([{ container_number: 'AQCU3870002', pod: 'BRRIG' }, { container_number: 'AQCU3870015', pod: 'BRRIG', status: 'empty' }],
      ['BRRIG'], { expected })
    const secondSql = importSql([{ container_number: 'AQCU3870002', pod: 'BRRIG' }, { container_number: 'AQCU3870016', pod: 'BRRIG', status: 'empty' }],
      ['BRRIG'], { expected })
    const started = Date.now()
    const first = runAsync(`${firstSql}; SELECT pg_sleep(2)`)
    await sleep(500)
    const second = runAsync(secondSql)
    const [a, b] = await Promise.all([first, second])
    expect(a.code, a.stderr).toBe(0)
    expect(b.code).not.toBe(0)
    expect(b.stderr).toMatch(/mudou depois da prévia/)
    expect(b.stderr).not.toMatch(/deadlock/)
    // O segundo só respondeu depois do COMMIT do primeiro.
    expect(b.endedAt - started).toBeGreaterThanOrEqual(1900)
    expect(staging()).toBe('AQCU3870001:BRSSZ:full,AQCU3870002:BRRIG:full,AQCU3870011:BRSSZ:empty,AQCU3870015:BRRIG:empty')
    expect(psql(`SELECT count(*) = count(DISTINCT upper(btrim(container_number))) FROM public.baplie_containers WHERE voyage_id = ${voyageId}`)).toBe('t')
  }, 30000)

  it('F-11 (decisão 6): B/L × B/L e B/L × Baplie da mesma Viagem em paralelo — sem deadlock, os dois gravam', async () => {
    // A inserção do B/L demora 1 s: as duas sessões cruzariam FOR KEY SHARE e
    // FOR UPDATE na Viagem (antes da 387: 40P01 na linha 42 do corpo _legacy_189).
    psql(`
      CREATE FUNCTION public.a387_slow_bl() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
      BEGIN IF NEW.voyage_id = ${voyageId} THEN PERFORM pg_sleep(1); END IF; RETURN NEW; END $f$;
      CREATE TRIGGER a387_slow_bl AFTER INSERT ON public.bls FOR EACH ROW EXECUTE FUNCTION public.a387_slow_bl()
    `)
    try {
      const first = runAsync(blImportSql('A387-L1', 'AQCU3871001'))
      await sleep(300)
      const second = runAsync(blImportSql('A387-L2', 'AQCU3871002'))
      const [a, b] = await Promise.all([first, second])
      expect(a.code, a.stderr).toBe(0)
      expect(b.code, b.stderr).toBe(0)

      const blFirst = runAsync(blImportSql('A387-L3', 'AQCU3871003'))
      await sleep(300)
      const baplie = runAsync(importSql([{ container_number: 'AQCU3870002', pod: 'BRRIG' }, { container_number: 'AQCU3870015', pod: 'BRRIG', status: 'empty' }],
        ['BRRIG']))
      const [c, d] = await Promise.all([blFirst, baplie])
      expect(c.code, c.stderr).toBe(0)
      expect(d.code, d.stderr).toBe(0)
    } finally {
      dropTestTriggers()
    }
    expect(psql(`SELECT string_agg(id, ',' ORDER BY id) FROM public.bls WHERE id IN ('A387-L1', 'A387-L2', 'A387-L3')`)).toBe('A387-L1,A387-L2,A387-L3')
  }, 30000)

  it('decisão 6: toda RPC de importação de Viagem pega a trava antes de gravar; o corpo órfão da 189 saiu (F-26)', () => {
    // Contrato SQL (texto das funções); o comportamento está nos testes de concorrência acima.
    const locked = psql(`SELECT string_agg(proname, ',' ORDER BY proname) FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace AND prosrc LIKE '%public._lock_import_voyages%'
        AND proname NOT LIKE '\\_lock%'`)
    // Desde a 405 a RPC pública de arquivo é um envelope; a trava fica no corpo `_core_405`.
    expect(locked.split(',').map((name) => name.replace(/_core_405$/, ''))).toEqual(expect.arrayContaining([
      'apply_baplie_physical_flags_atomic', 'apply_ce_mercante_rows_atomic', 'apply_container_dates_batch_atomic',
      'import_baplie_file_atomic', 'import_bl_freight_file_atomic', 'import_breakbulk_manifest_transactional',
      'import_granite_manifest_transactional', 'import_vazios_bookings_transactional', 'import_vazios_importacao_transactional',
      'import_vehicle_rows_transactional', 'replace_vazios_from_baplie_transactional',
    ]))
    expect(psql(`SELECT to_regprocedure('public.replace_vazios_from_baplie_transactional_legacy_189(bigint,text,uuid,boolean)') IS NULL
      AND to_regprocedure('public.import_baplie_staging_transactional(bigint,jsonb)') IS NULL`)).toBe('t')
  })
})

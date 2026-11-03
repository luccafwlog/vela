import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations')
const migration274 = fs.readFileSync(
  path.join(migrationsDir, '274_charge_table_validity_is_informational.sql'),
  'utf8',
)
const migration311Path = path.join(migrationsDir, '311_extract_local_charge_resolution.sql')
const migration311 = fs.existsSync(migration311Path) ? fs.readFileSync(migration311Path, 'utf8') : ''

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function functionBody(source: string, functionName: string) {
  const match = source.match(
    new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${functionName}\\([\\s\\S]*?\\$function\\$([\\s\\S]*?)\\$function\\$;`, 'i'),
  )
  expect(match, `função ${functionName} não encontrada`).toBeTruthy()
  return match?.[1] ?? ''
}

function psql(sql: string) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function callAsAuthenticated(userId: string, sql: string) {
  return spawnSync(
    'psql',
    [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
      '-d',
      databaseUrl,
      '-c',
      `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${userId}', true); ${sql}; COMMIT;`,
    ],
    { encoding: 'utf8' },
  )
}

describe('contrato da resolução pura de Taxa Local', () => {
  it('preserva os quatro ramos de resolução da migration 274', () => {
    expect(migration274).toMatch(/application_basis = 'weight_ton'/i)
    expect(migration274).toMatch(/review:weight_missing:/i)
    expect(migration274).toMatch(/review:thd_any_profile:/i)
    expect(migration274).toMatch(/review:unsupported_basis:/i)
    expect(migration274).toMatch(/calculation_key := CONCAT\('auto:item:'/i)

    const helper = functionBody(migration311, 'resolve_bl_local_charge_items')
    for (const marker of [
      "application_basis = 'bl'",
      "application_basis = 'weight_ton'",
      "application_basis = 'container_distinct_voyage'",
      'review:weight_missing:',
      'review:thd_any_profile:',
      'review:unsupported_basis:',
      "CONCAT('auto:item:', item.id)",
      'COALESCE(item.override_value, item.unit_value_brl, 0)',
      'v_container_shares',
    ]) {
      expect(migration274).toContain(marker)
      expect(helper).toContain(marker)
    }
    expect(migration311).toMatch(/resolve_bl_local_charge_items\(\s*p_bl_id TEXT,\s*p_pod TEXT\s*\)/i)
    expect(migration311).toMatch(/resolve_bl_local_charge_items\([\s\S]*?\)\s*RETURNS TABLE/i)
    const executableHelper = helper.replace(/--.*$/gm, '')
    expect(executableHelper).not.toMatch(/\b(?:DELETE|INSERT|UPDATE)\b/i)
    expect(executableHelper).not.toMatch(/financial_status|billed|invoic(?:ed|e)/i)
    expect(executableHelper).not.toMatch(/\bb\.pod\b/i)
    expect(helper).toMatch(/status := 'calculated'[\s\S]*?notes := NULL/i)
    expect(helper).toMatch(/resolve_local_charge_table_id|charge_tables/i)
    expect(helper).toMatch(/customer_rate_overrides/i)
    expect(helper).toMatch(/p_pod/i)
  })

  it('faz o motor consumir o helper com o POD capturado do B/L', () => {
    const calculator = functionBody(migration311, 'calculate_bl_local_charges')
    expect(calculator).toMatch(/FROM public\.resolve_bl_local_charge_items\(p_bl_id,\s*v_bl\.pod\)/i)
    expect(calculator).not.toMatch(/FROM public\.charge_table_items\s+AS\s+cti/i)
    expect(calculator).toMatch(/item\.status = 'review_required'/i)
    expect(calculator).toMatch(/item\.calculation_key/i)
    expect(calculator).toMatch(/item\.total_value_brl/i)

    const loop = calculator.match(
      /FOR item IN SELECT \* FROM public\.resolve_bl_local_charge_items[\s\S]*?END LOOP;/i,
    )?.[0] ?? ''
    const reviewPersistence = loop.match(
      /IF item\.status = 'review_required' THEN[\s\S]*?ELSE/i,
    )?.[0] ?? ''
    expect(reviewPersistence).toMatch(/INSERT INTO public\.charge_calculations/i)
    expect(reviewPersistence).toMatch(/review_reason, notes, created_by, calculated_at/i)
    expect(reviewPersistence).toMatch(/SET[\s\S]*status = EXCLUDED\.status[\s\S]*quantity = EXCLUDED\.quantity[\s\S]*total_value_brl = EXCLUDED\.total_value_brl[\s\S]*review_reason = EXCLUDED\.review_reason[\s\S]*notes = EXCLUDED\.notes/i)
    expect(reviewPersistence).not.toMatch(/charge_table_id = EXCLUDED\.charge_table_id/i)

    const calculatedPersistence = loop.match(/ELSE[\s\S]*?END IF;/i)?.[0] ?? ''
    expect(calculatedPersistence).toMatch(/INSERT INTO public\.charge_calculations/i)
    expect(calculatedPersistence).toMatch(/status,\s*calculation_key,\s*created_by,\s*calculated_at/i)
    expect(calculatedPersistence).not.toMatch(/review_reason, notes, created_by, calculated_at/i)
    expect(calculatedPersistence).not.toMatch(/notes = EXCLUDED\.notes|review_reason = EXCLUDED\.review_reason/i)
  })

  it('fecha execução direta do helper, inclusive para authenticated', () => {
    expect(migration311).toMatch(
      /REVOKE ALL ON FUNCTION public\.resolve_bl_local_charge_items\(TEXT, TEXT\) FROM PUBLIC, anon, authenticated/i,
    )
    expect(migration311).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.resolve_bl_local_charge_items\(TEXT, TEXT\) TO authenticated/i,
    )
  })
})

// Opt-in: o replay oficial é descartável, mas a instalação local atual para na
// migration 297 porque o guard dela procura funções pertencentes ao role
// `postgres`, enquanto o replay Homebrew as cria pelo superusuário do sistema.
// Mantemos o contrato executável quando o replay for concluído sem mascarar
// esse bloqueio ambiental no CI padrão.
describeLocal('contrato da resolução pura em replay local do Postgres', () => {
  const blId = 'BL-311-RESOLUTION'
  const reviewBlId = 'BL-311-PERSISTENCE'
  const thdBlId = 'BL-311-THD'
  const roundingBlIds = ['BL-311-ROUND-A', 'BL-311-ROUND-B', 'BL-311-ROUND-C']
  const authUserId = '00000000-0000-0000-0000-000000031101'
  const carrierId = 990311
  const vesselId = 990311
  const voyageId = 990311
  const tableOriginalId = 990311
  const tableNewId = 990312
  const tableThdId = 990313
  const itemOriginalId = 990311
  const itemNewId = 990312
  const itemWeightId = 990313
  const itemUnsupportedId = 990314
  const itemThdId = 990315
  const itemRoundingId = 990316
  const allBlIds = [blId, reviewBlId, thdBlId, ...roundingBlIds]

  const cleanupSql = `
    DELETE FROM public.charge_calculations WHERE bl_id IN (${allBlIds.map((id) => `'${id}'`).join(', ')});
    DELETE FROM public.bls WHERE id IN (${allBlIds.map((id) => `'${id}'`).join(', ')});
    DELETE FROM public.audit_logs WHERE changed_by = '${authUserId}';
    DELETE FROM public.user_profiles WHERE id = '${authUserId}';
    DELETE FROM auth.users WHERE id = '${authUserId}';
    DELETE FROM public.charge_table_items WHERE id IN (${itemOriginalId}, ${itemNewId}, ${itemWeightId}, ${itemUnsupportedId}, ${itemThdId}, ${itemRoundingId});
    DELETE FROM public.charge_tables WHERE id IN (${tableOriginalId}, ${tableNewId}, ${tableThdId});
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
  `

  beforeAll(() => {
    execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', databaseUrl, '-f', migration311Path], {
      encoding: 'utf8',
    })
    psql(cleanupSql)
    psql(`
      INSERT INTO auth.users (id, email)
      VALUES ('${authUserId}', 'task311-resolver@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active)
      VALUES ('${authUserId}', 'Task 311 Resolver', 'admin', true);
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Armador Task 311');
      INSERT INTO public.vessels (id, name, carrier_id)
      VALUES (${vesselId}, 'Navio Task 311', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, pod_schedule_snapshot)
      VALUES (${voyageId}, ${vesselId}, 'TASK-311', '{"ZZ311A":{"eta":"2026-08-20"},"ZZ311B":{"eta":"2026-08-21"},"ZZ311C":{"eta":"2026-08-22"}}');
      INSERT INTO public.bls (id, voyage_id, pod, cargo_mode)
      VALUES ('${blId}', ${voyageId}, 'ZZ311A', 'carga_solta');
      INSERT INTO public.bls (id, voyage_id, pod, cargo_mode)
      VALUES ('${reviewBlId}', ${voyageId}, 'ZZ311B', 'carga_solta');
      INSERT INTO public.bls (id, voyage_id, pod, cargo_mode)
      VALUES ('${thdBlId}', ${voyageId}, 'ZZ311C', 'container');
      INSERT INTO public.bl_containers (bl_id, container_number)
      VALUES ('${thdBlId}', 'MSCU1234567');
      INSERT INTO public.bls (id, voyage_id, pod, cargo_mode)
      VALUES
        ('${roundingBlIds[0]}', ${voyageId}, 'ZZ311C', 'container'),
        ('${roundingBlIds[1]}', ${voyageId}, 'ZZ311C', 'container'),
        ('${roundingBlIds[2]}', ${voyageId}, 'ZZ311C', 'container');
      INSERT INTO public.bl_containers (bl_id, container_number)
      VALUES
        ('${roundingBlIds[0]}', 'MSCU7654321'),
        ('${roundingBlIds[1]}', 'MSCU7654321'),
        ('${roundingBlIds[2]}', 'MSCU7654321');
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
      VALUES
        (${tableOriginalId}, 'Task 311 origem', 'ZZ311A', '2020-01-01', true, 'carga_solta'),
        (${tableNewId}, 'Task 311 novo POD', 'ZZ311B', '2020-01-01', true, 'carga_solta'),
        (${tableThdId}, 'Task 311 THD', 'ZZ311C', '2020-01-01', true, 'container');
      INSERT INTO public.charge_table_items
        (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, category, cargo_profile, currency)
      VALUES
        (${itemOriginalId}, ${tableOriginalId}, 'Taxa origem', 'bl', 111, 111, 'bl', 'base', 'any', 'BRL'),
        (${itemNewId}, ${tableNewId}, 'Taxa novo POD', 'bl', 222, 222, 'bl', 'base', 'any', 'BRL'),
        (${itemWeightId}, ${tableNewId}, 'Peso novo POD', 'bl', 333, 333, 'weight_ton', 'other_charge', 'any', 'BRL'),
        (${itemUnsupportedId}, ${tableNewId}, 'TEU novo POD', 'teu', 444, 444, 'teu', 'other_charge', 'any', 'BRL'),
        (${itemThdId}, ${tableThdId}, 'THD Task 311', 'container', 555, 555, 'container_distinct_voyage', 'base', 'any', 'BRL'),
        (${itemRoundingId}, ${tableThdId}, 'Rateio Task 311', 'container', 100, 100, 'container_distinct_voyage', 'other_charge', 'any', 'BRL');
    `)
  })

  afterAll(() => {
    psql(cleanupSql)
  })

  it('publica a assinatura e mantém o helper fechado para authenticated', () => {
    expect(psql("SELECT to_regprocedure('public.resolve_bl_local_charge_items(text,text)') IS NOT NULL;")).toBe('t')
    expect(
      psql(
        "SELECT NOT has_function_privilege('public', 'public.resolve_bl_local_charge_items(text,text)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.resolve_bl_local_charge_items(text,text)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.resolve_bl_local_charge_items(text,text)', 'EXECUTE');",
      ),
    ).toBe('t')
  })

  it('não escreve e resolve o POD explícito, mesmo quando diverge de bls.pod', () => {
    const before = psql(`SELECT count(*) FROM public.charge_calculations WHERE bl_id = '${blId}';`)
    const resolved = psql(`
      SELECT charge_table_id || '|' || charge_item_id || '|' || unit_value_brl
      FROM public.resolve_bl_local_charge_items('${blId}', 'ZZ311B');
    `)
    const after = psql(`SELECT count(*) FROM public.charge_calculations WHERE bl_id = '${blId}';`)

    expect(resolved).toBe(`${tableNewId}|${itemNewId}|222.00`)
    expect(before).toBe(after)
  })

  it('preserva status/notes nos quatro ramos e aplica override sem alterar o B/L', () => {
    expect(
      psql(`SELECT status || '|' || COALESCE(notes, '<NULL>') FROM public.resolve_bl_local_charge_items('${blId}', 'ZZ311B') WHERE calculation_key = 'auto:item:${itemNewId}';`),
    ).toBe('calculated|<NULL>')
    expect(
      psql(`SELECT status || '|' || COALESCE(notes, '<NULL>') FROM public.resolve_bl_local_charge_items('${blId}', 'ZZ311B') WHERE calculation_key = 'review:weight_missing:${itemWeightId}';`),
    ).toBe('review_required|Revisao manual obrigatoria')
    expect(
      psql(`SELECT status || '|' || COALESCE(notes, '<NULL>') FROM public.resolve_bl_local_charge_items('${blId}', 'ZZ311B') WHERE calculation_key = 'review:unsupported_basis:${itemUnsupportedId}';`),
    ).toBe('review_required|Revisao manual obrigatoria')

    const override = psql(`
      BEGIN;
      INSERT INTO public.customers (id, cnpj_cpf, name)
      VALUES (990313, '13532646000161', 'Cliente Task 311 Override');
      UPDATE public.bls SET customer_id = 990313 WHERE id = '${blId}';
      INSERT INTO public.customer_rate_overrides (customer_id, charge_item_id, override_value, valid_from, valid_to)
      VALUES (990313, ${itemNewId}, 777, '2026-08-01', '2026-08-31');
      SELECT unit_value_brl || '|' || override_applied
      FROM public.resolve_bl_local_charge_items('${blId}', 'ZZ311B')
      WHERE calculation_key = 'auto:item:${itemNewId}';
      ROLLBACK;
    `)
    expect(override.split('\n').find((line) => line.includes('|'))).toBe('777.00|true')
    expect(psql(`SELECT pod || '|' || COALESCE(customer_id::text, '<NULL>') FROM public.bls WHERE id = '${blId}';`)).toBe('ZZ311A|<NULL>')
  })

  it('persiste os ramos calculado/revisão como a 274, incluindo o upsert parcial de revisão', () => {
    const calculated = callAsAuthenticated(
      authUserId,
      `SELECT public.calculate_bl_local_charges('${reviewBlId}', '${authUserId}', true)`,
    )
    expect(calculated.status).toBe(0)

    const persisted = psql(`
      SELECT calculation_key || '|' || status || '|' || COALESCE(notes, '<NULL>')
      FROM public.charge_calculations
      WHERE bl_id = '${reviewBlId}'
      ORDER BY calculation_key;
    `)
    expect(persisted).toContain(`auto:item:${itemNewId}|calculated|<NULL>`)
    expect(persisted).toContain(`review:weight_missing:${itemWeightId}|review_required|Revisao manual obrigatoria`)
    expect(persisted).toContain(`review:unsupported_basis:${itemUnsupportedId}|review_required|Revisao manual obrigatoria`)

    psql(`
      DELETE FROM public.charge_calculations
      WHERE bl_id = '${reviewBlId}' AND calculation_key = 'review:weight_missing:${itemWeightId}';
      INSERT INTO public.charge_calculations
        (bl_id, quantity, unit_value_brl, total_value_brl, override_applied, source, status, calculation_key, notes, review_reason, created_by)
      VALUES
        ('${reviewBlId}', 99, 999, 99, true, 'manual', 'calculated', 'review:weight_missing:${itemWeightId}', 'stale note', 'stale reason', '${authUserId}');
    `)
    const upsert = callAsAuthenticated(
      authUserId,
      `SELECT public.calculate_bl_local_charges('${reviewBlId}', '${authUserId}', false)`,
    )
    expect(upsert.status).toBe(0)
    expect(
      psql(`
        SELECT COALESCE(charge_table_id::text, '<NULL>') || '|' ||
               COALESCE(charge_item_id::text, '<NULL>') || '|' ||
               COALESCE(unit_value_brl::text, '<NULL>') || '|' ||
               override_applied || '|' || source || '|' || status || '|' || quantity || '|' || notes
        FROM public.charge_calculations
        WHERE bl_id = '${reviewBlId}' AND calculation_key = 'review:weight_missing:${itemWeightId}';
      `),
    ).toBe('<NULL>|<NULL>|999.00|true|manual|review_required|0.000|Revisao manual obrigatoria')
  })

  it('preserva o ramo THD-any como revisão, sem depender do cálculo de THD', () => {
    expect(
      psql(`SELECT status || '|' || COALESCE(notes, '<NULL>') FROM public.resolve_bl_local_charge_items('${thdBlId}', 'ZZ311C') WHERE calculation_key = 'review:thd_any_profile:${itemThdId}';`),
    ).toBe('review_required|Revisao manual obrigatoria')
  })

  it('preserva o rateio por container e o centavo absorvido pelo último B/L', () => {
    const totals = roundingBlIds.map((id) =>
      psql(`
        SELECT to_char(total_value_brl, 'FM999999990.00')
        FROM public.resolve_bl_local_charge_items('${id}', 'ZZ311C')
        WHERE calculation_key = 'auto:item:${itemRoundingId}';
      `),
    )
    expect(totals).toEqual(['33.33', '33.33', '33.34'])
  })
})

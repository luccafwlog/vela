import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000060601'
const portId = 6980601
const carrierId = 6980602
const vesselId = 6980603
const voyageId = 6980604
const mixedCustomerId = 6980605
const exceptionCustomerId = 6980606
const terminalA = '06000000-0000-0000-0000-000000000001'
const terminalB = '06000000-0000-0000-0000-000000000002'
const stateA = '06000000-0000-0000-0000-000000000011'
const stateB = '06000000-0000-0000-0000-000000000012'
const blPure = 'CLAUDE060-PURE'
const blMixed = 'CLAUDE060-MIX'
const blException = 'CLAUDE060-EXC'
const blSummary = 'CLAUDE060-SUMMARY'
const blEmpty = 'CLAUDE060-EMPTY-LOOSE'
const blLocked = 'CLAUDE060-LOCKED'
const blLoosePure = 'CLAUDE061-LOOSE-PURE'

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function asService(sql: string): string {
  return psql(`SET request.jwt.claim.role = 'service_role'; ${sql}`)
}

function asAuthenticated(sql: string): string {
  const result = spawnSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '${actorId}'; ${sql} COMMIT;`,
  ], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`)
  return result.stdout.trim()
}

describeLocal('PR 698 — revisão Claude Code no catálogo PostgreSQL', () => {
  beforeAll(() => {
    psql(`
      SET session_replication_role = replica;
      DELETE FROM public.customer_communication_automation_claims WHERE claim_key LIKE 'aviso_atracacao_nob:%';
      DELETE FROM public.customer_communications WHERE customer_id IN (${mixedCustomerId}, ${exceptionCustomerId});
      DELETE FROM public.bl_breakbulk_items WHERE bl_id LIKE 'CLAUDE060-%' OR bl_id LIKE 'CLAUDE061-%';
      DELETE FROM public.bl_containers WHERE bl_id LIKE 'CLAUDE060-%' OR bl_id LIKE 'CLAUDE061-%';
      DELETE FROM public.bls WHERE id LIKE 'CLAUDE060-%' OR id LIKE 'CLAUDE061-%';
      DELETE FROM public.voyage_escala_operation_fronts WHERE voyage_id = ${voyageId};
      DELETE FROM public.voyage_escala_terminal_state WHERE voyage_id = ${voyageId};
      DELETE FROM public.depots WHERE id IN ('${terminalA}', '${terminalB}');
      DELETE FROM public.voyages WHERE id = ${voyageId};
      DELETE FROM public.vessels WHERE id = ${vesselId};
      DELETE FROM public.carriers WHERE id = ${carrierId};
      DELETE FROM public.ports WHERE id = ${portId};
      DELETE FROM public.customer_contacts WHERE customer_id IN (${mixedCustomerId}, ${exceptionCustomerId});
      DELETE FROM public.portal_provisioning_events WHERE customer_id IN (${mixedCustomerId}, ${exceptionCustomerId});
      DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${mixedCustomerId}, ${exceptionCustomerId});
      DELETE FROM public.customers WHERE id IN (${mixedCustomerId}, ${exceptionCustomerId});
      DELETE FROM public.user_profiles WHERE id = '${actorId}';
      DELETE FROM auth.users WHERE id = '${actorId}';
      SET session_replication_role = origin;

      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'pr698-claude@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active)
      VALUES ('${actorId}', 'PR 698 Claude', 'admin', true);
      INSERT INTO public.ports (id, name, locode, country)
      VALUES (${portId}, 'PR698 Port', 'BRSSZ', 'BR');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'PR698 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'PR698 Vessel', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status)
      VALUES (${voyageId}, ${vesselId}, 'PR698', 'active');
      INSERT INTO public.depots (id, code, name, tipo, port_id) VALUES
        ('${terminalA}', 'PR698-A', 'PR698 Terminal A', 'terminal_portuario', ${portId}),
        ('${terminalB}', 'PR698-B', 'PR698 Terminal B', 'terminal_portuario', ${portId});
      INSERT INTO public.voyage_escala_terminal_state
        (id, voyage_id, port, port_id, terminal_id, terminal_atb)
      VALUES
        ('${stateA}', ${voyageId}, 'BRSSZ', ${portId}, '${terminalA}', now() - interval '1 day'),
        ('${stateB}', ${voyageId}, 'BRSSZ', ${portId}, '${terminalB}', now() - interval '2 days');
      INSERT INTO public.voyage_escala_operation_fronts
        (voyage_id, port, port_id, sentido, modalidade, terminal_id, source)
      VALUES
        (${voyageId}, 'BRSSZ', ${portId}, 'importacao', 'carga_cheia', '${terminalA}', 'operational_data'),
        (${voyageId}, 'BRSSZ', ${portId}, 'importacao', 'carga_solta', '${terminalA}', 'operational_data');
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
        (${mixedCustomerId}, '04252011000110', 'PR698 Customer Mixed'),
        (${exceptionCustomerId}, '11222333000181', 'PR698 Customer Exception');
      INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary) VALUES
        (${mixedCustomerId}, 'Docs', 'pr698-mix@example.test', 'operacional', true),
        (${exceptionCustomerId}, 'Docs', 'pr698-exc@example.test', 'operacional', true);
      INSERT INTO public.bls (id, voyage_id, customer_id, pod, cargo_mode, financial_status, total_weight_kg, bb_weight_ton) VALUES
        ('${blPure}', ${voyageId}, ${mixedCustomerId}, ' brssz ', 'container', 'pending', NULL, NULL),
        ('${blMixed}', ${voyageId}, ${mixedCustomerId}, 'BRSSZ', 'container', 'pending', NULL, NULL),
        ('${blException}', ${voyageId}, ${exceptionCustomerId}, 'BRSSZ', 'container', 'pending', NULL, NULL),
        ('${blSummary}', ${voyageId}, NULL, 'BRSSZ', 'misto', 'pending', 20000, 3);
      SET vela.bl_terminal_override = 'on';
      UPDATE public.bls
      SET terminal_id = '${terminalB}', pod_port_id = ${portId}
      WHERE id = '${blException}';
      SET vela.bl_terminal_override = 'off';
      INSERT INTO public.bl_containers (bl_id, container_number)
      VALUES ('${blMixed}', 'MSCU6980601'), ('${blSummary}', 'MSCU6980603');
      INSERT INTO public.bl_breakbulk_items (bl_id, item_description, package_qty, gross_weight_kg)
      VALUES ('${blMixed}', 'Cargo misto', 1, 1000);
    `)
  })

  afterAll(() => {
    psql(`
      SET session_replication_role = replica;
      DELETE FROM public.customer_communication_automation_claims WHERE claim_key LIKE 'aviso_atracacao_nob:%';
      DELETE FROM public.customer_communications WHERE customer_id IN (${mixedCustomerId}, ${exceptionCustomerId});
      DELETE FROM public.audit_logs WHERE changed_by = '${actorId}';
      DELETE FROM public.bl_breakbulk_items WHERE bl_id LIKE 'CLAUDE060-%' OR bl_id LIKE 'CLAUDE061-%';
      DELETE FROM public.bl_containers WHERE bl_id LIKE 'CLAUDE060-%' OR bl_id LIKE 'CLAUDE061-%';
      DELETE FROM public.bls WHERE id LIKE 'CLAUDE060-%' OR id LIKE 'CLAUDE061-%';
      DELETE FROM public.voyage_escala_operation_fronts WHERE voyage_id = ${voyageId};
      DELETE FROM public.voyage_escala_terminal_state WHERE voyage_id = ${voyageId};
      DELETE FROM public.depots WHERE id IN ('${terminalA}', '${terminalB}');
      DELETE FROM public.voyages WHERE id = ${voyageId};
      DELETE FROM public.vessels WHERE id = ${vesselId};
      DELETE FROM public.carriers WHERE id = ${carrierId};
      DELETE FROM public.ports WHERE id = ${portId};
      DELETE FROM public.customer_contacts WHERE customer_id IN (${mixedCustomerId}, ${exceptionCustomerId});
      DELETE FROM public.portal_provisioning_events WHERE customer_id IN (${mixedCustomerId}, ${exceptionCustomerId});
      DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${mixedCustomerId}, ${exceptionCustomerId});
      DELETE FROM public.customers WHERE id IN (${mixedCustomerId}, ${exceptionCustomerId});
      DELETE FROM public.user_profiles WHERE id = '${actorId}';
      DELETE FROM auth.users WHERE id = '${actorId}';
      SET session_replication_role = origin;
    `)
  })

  it('valida o catálogo real: SQL inlinable, cargo_mode misto e FK terminal única', () => {
    expect(psql(`
      SELECT l.lanname FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname = 'public' AND p.proname = 'bl_cargo_mode_matches_filter'
        AND pg_get_function_identity_arguments(p.oid) = 'p_cargo_mode text, p_filter text';
    `)).toBe('sql')
    expect(psql(`SELECT COALESCE(public.bl_operation_front_modalidade('misto'), 'NULL');`)).toBe('NULL')
    expect(psql(`SELECT cargo_mode FROM public.bls WHERE id = '${blMixed}';`)).toBe('misto')
    expect(psql(`SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.bls'::regclass AND conname = 'bls_terminal_id_fkey';`)).toBe('0')
    expect(psql(`SELECT confdeltype FROM pg_constraint WHERE conrelid = 'public.bls'::regclass AND conname = 'bls_terminal_pod_port_fk';`)).toBe('r')
    expect(psql(`SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.bl_containers'::regclass AND tgname LIKE 'trg_bl_containers_cargo_mode_%' AND NOT tgisinternal AND (tgtype & 1) = 0;`)).toBe('3')
    expect(psql(`
      SELECT count(*) FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'trg_sync_bl_cargo_mode_statement', 'trg_sync_bl_weight_cargo_mode',
          'trg_sync_bl_cargo_mode', 'guard_bl_terminal_override',
          'trg_sync_manual_local_charge_receivable', 'recalculate_bl_cargo_mode'
        )
        AND (
          has_function_privilege('public', p.oid, 'EXECUTE')
          OR has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
        );
    `)).toBe('0')
    expect(psql(`SELECT has_function_privilege('service_role', 'public.recalculate_bl_cargo_mode(text)', 'EXECUTE');`)).toBe('t')
  })

  it('preserva cargo_solta declarado sem sinal físico e soma os dois pesos do misto', () => {
    psql(`INSERT INTO public.bls (id, voyage_id, pod, cargo_mode) VALUES ('${blEmpty}', ${voyageId}, 'BRSSZ', 'carga_solta');`)
    expect(psql(`SELECT cargo_mode FROM public.bls WHERE id = '${blEmpty}';`)).toBe('carga_solta')
    expect(Number(psql(`SELECT public.operational_list_bl_summary(NULL, ${voyageId}, 'misto', NULL, NULL, NULL, NULL, NULL, NULL)->>'totalWeightTon';`))).toBe(23)
    psql(`DELETE FROM public.bls WHERE id = '${blEmpty}';`)
  })

  // Revisão final (B3-R): a soma aditiva da 060 só é correta porque a 061 deu
  // um significado único a cada coluna de peso. Estes dois casos são o eixo que
  // faltava — a carga solta pura, e o misto que chega pela ordem inversa.
  it('não conta o peso duas vezes na carga solta pura nem no misto vindo dela', () => {
    psql(`
      INSERT INTO public.bls (id, voyage_id, pod, cargo_mode, total_weight_kg, bb_weight_ton, bb_packages_qty)
      VALUES ('${blLoosePure}', ${voyageId}, 'BRPNG', 'carga_solta', NULL, 20, 5);
    `)
    const pesoDe = (filtro: string | null) => Number(psql(
      `SELECT public.operational_list_bl_summary(NULL, ${voyageId}, ${filtro === null ? 'NULL' : `'${filtro}'`}, NULL, 'BRPNG')->>'totalWeightTon';`,
    ))
    expect(pesoDe('carga_solta')).toBe(20)

    // A carga solta vira misto quando chega um contêiner. O peso da carga solta
    // não pode ser recontado como se fosse peso de contêiner.
    psql(`INSERT INTO public.bl_containers (bl_id, container_number) VALUES ('${blLoosePure}', 'MSCU6980604');`)
    expect(psql(`SELECT cargo_mode FROM public.bls WHERE id = '${blLoosePure}';`)).toBe('misto')
    expect(pesoDe('misto')).toBe(20)

    // Agora o peso de contêiner é informado: aí sim os dois componentes somam.
    psql(`UPDATE public.bls SET total_weight_kg = 12000 WHERE id = '${blLoosePure}';`)
    expect(pesoDe(null)).toBe(32)

    psql(`DELETE FROM public.bl_containers WHERE bl_id = '${blLoosePure}'; DELETE FROM public.bls WHERE id = '${blLoosePure}';`)
  })

  it('permite adicionar BB a B/L pago, reabre revisão e bloqueia remoção posterior', () => {
    psql(`
      INSERT INTO public.bls (id, voyage_id, pod, cargo_mode, financial_status, review_status)
      VALUES ('${blLocked}', ${voyageId}, 'BRSSZ', 'container', 'paid', 'reviewed');
      INSERT INTO public.bl_containers (bl_id, container_number)
      VALUES ('${blLocked}', 'MSCU6980602');
    `)
    expect(() => asAuthenticated(`
      SELECT public.import_breakbulk_manifest_transactional(
        'pr698-claude.xlsx', ${voyageId}, '${actorId}', 1,
        jsonb_build_array(jsonb_build_object(
          'id', '${blLocked}', 'financial_status', 'paid', 'review_status', 'reviewed',
          'bb_weight_ton', '1', 'bb_packages_qty', '1'
        )),
        jsonb_build_array(jsonb_build_object(
          'bl_id', '${blLocked}', 'item_description', 'BB importado',
          'package_qty', '1', 'gross_weight_kg', '1000'
        )),
        '[]'::jsonb
      );
    `)).not.toThrow()
    expect(psql(`SELECT cargo_mode || '|' || financial_status || '|' || review_status FROM public.bls WHERE id = '${blLocked}';`)).toBe('misto|paid|pending_review')
    psql(`UPDATE public.bls SET bb_weight_ton = NULL, bb_packages_qty = NULL WHERE id = '${blLocked}';`)
    expect(() => psql(`DELETE FROM public.bl_breakbulk_items WHERE bl_id = '${blLocked}';`)).toThrow(/ja foi faturado|P0003/i)
  })

  it('compõe NOB uma única vez para B/L puro + misto e aceita exceção sem frente', () => {
    const payload = JSON.parse(asService(`SELECT public.evaluate_and_dispatch_automatic_communications(now());`)) as Array<Record<string, unknown>>
    const nob = payload.filter((candidate) => candidate.kind === 'aviso_atracacao_nob')
    const mixedCustomer = nob.find((candidate) => Number(candidate.customer_id) === mixedCustomerId)
    const exceptionCustomer = nob.find((candidate) => Number(candidate.customer_id) === exceptionCustomerId)
    expect(nob).toHaveLength(2)
    expect(mixedCustomer?.bl_ids).toEqual([blMixed, blPure])
    expect(exceptionCustomer?.terminal_name).toBe('PR698-B')
    expect(exceptionCustomer?.bl_ids).toEqual([blException])
  })

  it('restaura o GUC de exceção terminal ao sair da RPC', () => {
    const output = asAuthenticated(`
      SELECT public.set_bl_terminal_override('${blException}', '${terminalA}', ${portId}, 'Teste de restauração', '${actorId}');
      SELECT current_setting('vela.bl_terminal_override', true);
    `)
    expect(output.split('\n').at(-1)).toBe('off')
    asAuthenticated(`
      SELECT public.set_bl_terminal_override('${blException}', '${terminalB}', ${portId}, 'Restaurar terminal do fixture', '${actorId}');
    `)
  })
})

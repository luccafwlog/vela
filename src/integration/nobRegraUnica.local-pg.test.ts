import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Itens B3 e B4 do plano docs/plans/2026-10-14-correcoes-decididas-na-revisao-geral.md
// (migration 243): uma regra única de quem entra no NOB de uma Atracação
// (terminal resolvido do B/L, ADR 0068 item 7), na produtora automática, na
// RPC e na Edge Function; e o Cliente sem contato não aborta a produtora.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const CARRIER_ID = 99243001
const VESSEL_ID = 99243002
const VOYAGE_ID = 99243003
const PORT_ID = 99243004
const PORT = 'BRB43'
const CUSTOMER_A = 99243011
const CUSTOMER_B = 99243012
const CONTACT_A = 99243021
const T1 = '24324300-0000-4000-8000-0000000000a1'
const T2 = '24324300-0000-4000-8000-0000000000a2'
const BERTH_T1 = '24324300-0000-4000-8000-0000000000b1'
const BL_MIX = 'B243-MIX'
const BL_EXC = 'B243-EXC'
const BL_OTHER = 'B243-OTHER'
const BL_NOCONTACT = 'B243-NOCONTACT'
const ALL_BLS = [BL_MIX, BL_EXC, BL_OTHER, BL_NOCONTACT].map((id) => `'${id}'`).join(', ')

/** Como o servidor (`service_role`): produtora e Edge Function. */
function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; ${sql}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function tryPsql(sql: string): { ok: boolean; output: string; error: string } {
  const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL request.jwt.claim.role = 'service_role'; ${sql}; ROLLBACK;`], { encoding: 'utf8' })
  return { ok: result.status === 0, output: (result.stdout ?? '').trim(), error: (result.stderr ?? '').trim() }
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    CREATE TEMP TABLE b243_alerts AS SELECT id FROM public.alerts WHERE entity_type = 'customer' AND entity_id IN ('${CUSTOMER_A}', '${CUSTOMER_B}');
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE alert_id IN (SELECT id FROM b243_alerts));
    DELETE FROM public.internal_notifications WHERE alert_id IN (SELECT id FROM b243_alerts);
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM b243_alerts);
    DELETE FROM public.alerts WHERE id IN (SELECT id FROM b243_alerts);
    DELETE FROM public.customer_communication_automation_claims WHERE claim_key LIKE '%:${CUSTOMER_A}:%' OR claim_key LIKE '%:${CUSTOMER_B}:%';
    DELETE FROM public.customer_communication_bls WHERE bl_id IN (${ALL_BLS});
    DELETE FROM public.customer_communications WHERE customer_id IN (${CUSTOMER_A}, ${CUSTOMER_B});
    DELETE FROM public.customer_contact_box_links WHERE contact_id = ${CONTACT_A};
    DELETE FROM public.customer_contacts WHERE customer_id IN (${CUSTOMER_A}, ${CUSTOMER_B});
    DELETE FROM public.audit_logs WHERE entity_id IN (${ALL_BLS});
    DELETE FROM public.bls WHERE id IN (${ALL_BLS});
    DELETE FROM public.voyage_escala_operation_fronts WHERE voyage_id = ${VOYAGE_ID};
    DELETE FROM public.voyage_escala_terminal_state WHERE voyage_id = ${VOYAGE_ID};
    DELETE FROM public.depots WHERE id IN ('${T1}', '${T2}');
    DELETE FROM public.customers WHERE id IN (${CUSTOMER_A}, ${CUSTOMER_B});
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.ports WHERE id = ${PORT_ID};
    SET session_replication_role = origin;
  `)
}

function migration243Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_proc WHERE proname = 'bl_belongs_to_atracacao';`) === '1'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration243Applied, 'migration243Applied (regra única do NOB)')

describeLocal('243 — regra única do NOB e produtora sem aborto (B3, B4)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      SET session_replication_role = replica;
      INSERT INTO public.ports (id, name, locode) VALUES (${PORT_ID}, 'Porto B243', '${PORT}');
      INSERT INTO public.depots (id, code, name, tipo, port_id) VALUES
        ('${T1}', 'T243A', 'Terminal B243 A', 'terminal_portuario', ${PORT_ID}),
        ('${T2}', 'T243B', 'Terminal B243 B', 'terminal_portuario', ${PORT_ID});
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Armador B243');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Navio B243', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'B243V', 'active');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES
        (${CUSTOMER_A}, 'CLIENTE B243 A', '${syntheticCnpj(243011)}'),
        (${CUSTOMER_B}, 'CLIENTE B243 B', '${syntheticCnpj(243012)}');
      INSERT INTO public.customer_contacts (id, customer_id, name, email, is_primary) VALUES
        (${CONTACT_A}, ${CUSTOMER_A}, 'Contato B243', 'docs-b243@example.test', true);
      INSERT INTO public.customer_contact_box_links (contact_id, box_code) VALUES (${CONTACT_A}, 'documentacao_operacao');
      -- Atracação no T1 com ATB há 2 dias. Frentes: carga cheia e carga solta
      -- no T1; a de veículo no T2 (o contêiner do B/L de exceção cai no T2).
      INSERT INTO public.voyage_escala_terminal_state (id, voyage_id, port, port_id, terminal_id, terminal_atb)
      VALUES ('${BERTH_T1}', ${VOYAGE_ID}, '${PORT}', ${PORT_ID}, '${T1}', now() - interval '2 days');
      INSERT INTO public.voyage_escala_operation_fronts (voyage_id, port, port_id, terminal_id, sentido, modalidade, source) VALUES
        (${VOYAGE_ID}, '${PORT}', ${PORT_ID}, '${T1}', 'importacao', 'carga_solta', 'operational_data'),
        (${VOYAGE_ID}, '${PORT}', ${PORT_ID}, '${T2}', 'importacao', 'carga_cheia', 'operational_data');
      INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status, review_status, terminal_id, pod_port_id) VALUES
        ('${BL_MIX}', ${VOYAGE_ID}, ${CUSTOMER_A}, 'CNSHA', '${PORT}', 'misto', 'pending', 'calculated', 'ok', NULL, NULL),
        ('${BL_EXC}', ${VOYAGE_ID}, ${CUSTOMER_A}, 'CNSHA', '${PORT}', 'container', 'pending', 'calculated', 'ok', '${T1}', ${PORT_ID}),
        ('${BL_OTHER}', ${VOYAGE_ID}, ${CUSTOMER_A}, 'CNSHA', '${PORT}', 'container', 'pending', 'calculated', 'ok', NULL, NULL),
        ('${BL_NOCONTACT}', ${VOYAGE_ID}, ${CUSTOMER_B}, 'CNSHA', '${PORT}', 'carga_solta', 'pending', 'calculated', 'ok', NULL, NULL);
      SET session_replication_role = origin;
    `)
  })
  afterAll(cleanup)

  it('B3: a regra única decide quem entra no NOB da Atracação', () => {
    // Misto só com as duas frentes no terminal: a carga cheia está no T2.
    expect(psql(`SELECT public.bl_belongs_to_atracacao('${BL_MIX}', '${BERTH_T1}');`)).toBe('f')
    // Uma frente por modalidade no porto: a de carga cheia passa para o T1.
    psql(`SET session_replication_role = replica;
      UPDATE public.voyage_escala_operation_fronts SET terminal_id = '${T1}'
      WHERE voyage_id = ${VOYAGE_ID} AND modalidade = 'carga_cheia';
      SET session_replication_role = origin;`)
    expect(psql(`SELECT public.bl_belongs_to_atracacao('${BL_MIX}', '${BERTH_T1}');`)).toBe('t')
    // A exceção de terminal do B/L vence a frente.
    expect(psql(`SELECT public.bl_belongs_to_atracacao('${BL_EXC}', '${BERTH_T1}');`)).toBe('t')
    // Sem exceção, o contêiner herda a frente de carga cheia (agora no T1).
    expect(psql(`SELECT public.bl_belongs_to_atracacao('${BL_OTHER}', '${BERTH_T1}');`)).toBe('t')
    // Exceção para outro terminal tira o B/L desta Atracação.
    psql(`SET session_replication_role = replica; UPDATE public.bls SET terminal_id = '${T2}', pod_port_id = ${PORT_ID} WHERE id = '${BL_OTHER}'; SET session_replication_role = origin;`)
    expect(psql(`SELECT public.bl_belongs_to_atracacao('${BL_OTHER}', '${BERTH_T1}');`)).toBe('f')
  })

  it('B3: a RPC grava o NOB com B/L misto e com exceção de terminal, e recusa o de outro terminal', () => {
    const create = (bls: string[]) => tryPsql(`SELECT public.create_customer_communication_atomic(${CUSTOMER_A}, 'aviso_atracacao_nob', 'avisos_operacionais',
      ${VOYAGE_ID}, '${PORT}', '${BERTH_T1}', NULL, 0, NULL, NULL, NULL, 'T243A', NULL, ARRAY[${bls.map((id) => `'${id}'`).join(', ')}]::text[])`)
    expect(create([BL_EXC, BL_MIX]).error).toBe('')
    expect(create([BL_OTHER]).error).toMatch(/Atracação não corresponde à Frente de Operação do B\/L/)
  })

  it('B4: Cliente sem contato abre o alerta catalogado e não aborta a rodada; os demais recebem o NOB', () => {
    const result = tryPsql(`SELECT public.evaluate_and_dispatch_automatic_communications(now())`)
    expect(result.error).toBe('')
    const candidates = JSON.parse(result.output) as Array<{ kind: string; customer_id: number; bl_ids: string[] }>
    const nob = candidates.filter((candidate) => candidate.kind === 'aviso_atracacao_nob' && [CUSTOMER_A, CUSTOMER_B].includes(candidate.customer_id))
    expect(nob).toEqual([expect.objectContaining({ customer_id: CUSTOMER_A, bl_ids: [BL_EXC, BL_MIX] })])

    psql(`SELECT public.evaluate_and_dispatch_automatic_communications(now());`)
    expect(psql(`SELECT i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'nob_sem_destinatario' AND a.entity_type = 'customer' AND a.entity_id = '${CUSTOMER_B}';`)).toBe('active')
    expect(psql(`SELECT active FROM public.alert_type_catalog WHERE type = 'nob_sem_destinatario';`)).toBe('t')
  })
})

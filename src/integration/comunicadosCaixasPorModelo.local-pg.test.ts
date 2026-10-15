import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Itens A22 e B20 do plano docs/plans/2026-10-14-correcoes-decididas-na-revisao-geral.md:
// o CE e Taxas alcança as caixas Documentação/Operação e Financeiro pela tabela
// customer_communication_box_kinds (a Edge Function deixa de forçar uma caixa),
// e a produtora automática deixa de ler customer_contact_preferences (migration 244).
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const CARRIER_ID = 99244001
const VESSEL_ID = 99244002
const VOYAGE_ID = 99244003
const PORT_ID = 99244004
const PORT = 'BRB44'
const CUSTOMER_ID = 99244011
const CONTACT_DOCS = 99244021
const CONTACT_FIN = 99244022
const T1 = '24424400-0000-4000-8000-0000000000a1'
const BERTH_T1 = '24424400-0000-4000-8000-0000000000b1'
const BL_ID = 'B244-SOLTA'

/** Como o servidor (`service_role`): produtora e Edge Function. */
function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; ${sql}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function tryPsql(sql: string): { output: string; error: string } {
  const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL request.jwt.claim.role = 'service_role'; ${sql}; ROLLBACK;`], { encoding: 'utf8' })
  return { output: (result.stdout ?? '').trim(), error: (result.stderr ?? '').trim() }
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.customer_communication_automation_claims WHERE claim_key LIKE '%:${CUSTOMER_ID}:%';
    DELETE FROM public.customer_communication_bls WHERE bl_id = '${BL_ID}';
    DELETE FROM public.customer_communications WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.customer_contact_preferences WHERE contact_id IN (${CONTACT_DOCS}, ${CONTACT_FIN});
    DELETE FROM public.customer_contact_box_links WHERE contact_id IN (${CONTACT_DOCS}, ${CONTACT_FIN});
    DELETE FROM public.customer_contacts WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.audit_logs WHERE entity_id = '${BL_ID}';
    DELETE FROM public.bls WHERE id = '${BL_ID}';
    DELETE FROM public.voyage_escala_operation_fronts WHERE voyage_id = ${VOYAGE_ID};
    DELETE FROM public.voyage_escala_terminal_state WHERE voyage_id = ${VOYAGE_ID};
    DELETE FROM public.depots WHERE id = '${T1}';
    DELETE FROM public.customers WHERE id = ${CUSTOMER_ID};
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.ports WHERE id = ${PORT_ID};
    SET session_replication_role = origin;
  `)
}

function migration244Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_proc WHERE proname = 'evaluate_and_dispatch_automatic_communications'
      AND prosrc NOT ILIKE '%customer_contact_preferences%';`) === '1'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration244Applied, 'migration244Applied (produtora sem preferências de contato)')

describeLocal('244 — caixas por modelo e produtora sem preferências (A22, B20)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      SET session_replication_role = replica;
      INSERT INTO public.ports (id, name, locode) VALUES (${PORT_ID}, 'Porto B244', '${PORT}');
      INSERT INTO public.depots (id, code, name, tipo, port_id) VALUES ('${T1}', 'T244A', 'Terminal B244 A', 'terminal_portuario', ${PORT_ID});
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Armador B244');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Navio B244', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'B244V', 'active');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER_ID}, 'CLIENTE B244', '${syntheticCnpj(244011)}');
      INSERT INTO public.customer_contacts (id, customer_id, name, email, is_primary) VALUES
        (${CONTACT_DOCS}, ${CUSTOMER_ID}, 'Documentação B244', 'docs-b244@example.test', true),
        (${CONTACT_FIN}, ${CUSTOMER_ID}, 'Financeiro B244', 'fin-b244@example.test', false);
      INSERT INTO public.customer_contact_box_links (contact_id, box_code) VALUES
        (${CONTACT_DOCS}, 'documentacao_operacao'), (${CONTACT_FIN}, 'financeiro');
      -- Preferência antiga desligada: a tela não a mostra e a produtora a ignora.
      INSERT INTO public.customer_contact_preferences (contact_id, nature, enabled) VALUES
        (${CONTACT_DOCS}, 'avisos_operacionais', false), (${CONTACT_DOCS}, 'documentacao', false)
      ON CONFLICT (contact_id, nature) DO UPDATE SET enabled = false;
      INSERT INTO public.voyage_escala_terminal_state (id, voyage_id, port, port_id, terminal_id, terminal_atb)
      VALUES ('${BERTH_T1}', ${VOYAGE_ID}, '${PORT}', ${PORT_ID}, '${T1}', now() - interval '2 days');
      INSERT INTO public.voyage_escala_operation_fronts (voyage_id, port, port_id, terminal_id, sentido, modalidade, source)
      VALUES (${VOYAGE_ID}, '${PORT}', ${PORT_ID}, '${T1}', 'importacao', 'carga_solta', 'operational_data');
      INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status, review_status)
      VALUES ('${BL_ID}', ${VOYAGE_ID}, ${CUSTOMER_ID}, 'CNSHA', '${PORT}', 'carga_solta', 'pending', 'calculated', 'ok');
      SET session_replication_role = origin;
    `)
  })
  afterAll(cleanup)

  it('A22: o CE e Taxas pelo modelo alcança a caixa Financeiro; a caixa forçada a recusava', () => {
    const allowed = (contactId: number, box: string | null) => psql(
      `SELECT public.customer_communication_recipient_allowed(${CUSTOMER_ID}, ${contactId}, 'ce_mercante_taxas', 'caixa', ${box ? `'${box}'` : 'NULL'});`)
    // Caixa nula: a Edge Function roteia pelo modelo (customer_communication_box_kinds).
    expect(allowed(CONTACT_FIN, null)).toBe('t')
    expect(allowed(CONTACT_DOCS, null)).toBe('t')
    // Antes, a Edge Function forçava Documentação/Operação e o Financeiro ficava de fora.
    expect(allowed(CONTACT_FIN, 'documentacao_operacao')).toBe('f')
    // Um modelo que a caixa Financeiro não recebe continua recusado.
    expect(psql(`SELECT public.customer_communication_recipient_allowed(${CUSTOMER_ID}, ${CONTACT_FIN}, 'aviso_atracacao_nob', 'caixa', NULL);`)).toBe('f')
  })

  it('B20: preferência antiga desligada não tira o contato da caixa do NOB automático', () => {
    const result = tryPsql(`SELECT public.evaluate_and_dispatch_automatic_communications(now())`)
    expect(result.error).toBe('')
    const candidates = JSON.parse(result.output) as Array<{ kind: string; customer_id: number; bl_ids: string[] }>
    expect(candidates.filter((candidate) => candidate.customer_id === CUSTOMER_ID)).toEqual([
      expect.objectContaining({ kind: 'aviso_atracacao_nob', bl_ids: [BL_ID] }),
    ])
  })
})

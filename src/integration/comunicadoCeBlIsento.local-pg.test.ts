import { execPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 578 (produção, 2026-11-03): o Cliente com B/Ls isentos das Taxas
// Locais (veículo LCL ou isenção à mão) nunca recebia o CE e Taxas, porque a
// prontidão exigia faturamento de todo B/L e o isento não tem o que faturar.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const CARRIER_ID = 99578001
const VESSEL_ID = 99578002
const VOYAGE_ID = 99578003
const ONLY_EXEMPT = 99578011
const MIXED = 99578012
const EXEMPT_WITHOUT_CE = 99578013
const NOT_INVOICED = 99578014
const CUSTOMERS = [ONLY_EXEMPT, MIXED, EXEMPT_WITHOUT_CE, NOT_INVOICED]
const CONTACTS = [99578021, 99578022, 99578023, 99578024]
const BLS = ['B578-ISENTO-1', 'B578-ISENTO-2', 'B578-MISTO-ISENTO', 'B578-MISTO-FATURADO', 'B578-ISENTO-SEM-CE', 'B578-PENDENTE']

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; ${sql}`],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function readiness(customerId: number) {
  return JSON.parse(psql(`SELECT public.customer_local_charges_communication_readiness(${VOYAGE_ID}, ${customerId});`)) as {
    ready: boolean
    reasons: string[]
    bls: Array<{ bl_id: string; exempt: boolean; blocked_reasons: string[] }>
  }
}

function cleanup() {
  const customers = CUSTOMERS.join(', ')
  const bls = BLS.map((id) => `'${id}'`).join(', ')
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.customer_communication_automation_claims WHERE claim_key LIKE '%:${VOYAGE_ID}%';
    DELETE FROM public.customer_contact_box_links WHERE contact_id IN (${CONTACTS.join(', ')});
    DELETE FROM public.customer_contacts WHERE customer_id IN (${customers});
    DELETE FROM public.audit_logs WHERE entity_id IN (${bls});
    DELETE FROM public.bls WHERE id IN (${bls});
    DELETE FROM public.customers WHERE id IN (${customers});
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    SET session_replication_role = origin;
  `)
}

function migration578Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT position('exempt' IN pg_get_functiondef('public.customer_local_charges_communication_payload(bigint,bigint)'::regprocedure)) > 0;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration578Applied, 'migration578Applied (payload do CE e Taxas traz o B/L isento)')

describeLocal('578 — CE e Taxas para o Cliente com B/L isento', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      SET session_replication_role = replica;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Armador E578');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Navio E578', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'E578V', 'active');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES
        ${CUSTOMERS.map((id, index) => `(${id}, 'CLIENTE E578 ${index + 1}', '${syntheticCnpj(578011 + index)}')`).join(',\n        ')};
      INSERT INTO public.customer_contacts (id, customer_id, name, email, is_primary) VALUES
        ${CUSTOMERS.map((id, index) => `(${CONTACTS[index]}, ${id}, 'Contato ${index + 1}', 'c${index + 1}-e578@example.test', true)`).join(',\n        ')};
      INSERT INTO public.customer_contact_box_links (contact_id, box_code) VALUES
        ${CONTACTS.map((id) => `(${id}, 'documentacao_operacao')`).join(', ')};
      INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status, review_status, ce_mercante) VALUES
        ('${BLS[0]}', ${VOYAGE_ID}, ${ONLY_EXEMPT}, 'CNSHA', 'BRSSZ', 'container', 'pending', 'exempt', 'ok', '157805000000001'),
        ('${BLS[1]}', ${VOYAGE_ID}, ${ONLY_EXEMPT}, 'CNSHA', 'BRSSZ', 'container', NULL, 'exempt', 'ok', '157805000000002'),
        ('${BLS[2]}', ${VOYAGE_ID}, ${MIXED}, 'CNSHA', 'BRSSZ', 'container', 'pending', 'exempt', 'ok', '157805000000003'),
        ('${BLS[3]}', ${VOYAGE_ID}, ${MIXED}, 'CNSHA', 'BRSSZ', 'container', 'invoiced', 'calculated', 'ok', '157805000000004'),
        ('${BLS[4]}', ${VOYAGE_ID}, ${EXEMPT_WITHOUT_CE}, 'CNSHA', 'BRSSZ', 'container', 'pending', 'exempt', 'ok', NULL),
        ('${BLS[5]}', ${VOYAGE_ID}, ${NOT_INVOICED}, 'CNSHA', 'BRSSZ', 'container', 'pending', 'calculated', 'ok', '157805000000006');
      SET session_replication_role = origin;
    `)
  })
  afterAll(cleanup)

  it('o B/L isento com CE não precisa de faturamento; o não isento continua precisando', () => {
    expect(readiness(ONLY_EXEMPT)).toMatchObject({ ready: true, reasons: [] })
    expect(readiness(ONLY_EXEMPT).bls.every((bl) => bl.exempt)).toBe(true)
    expect(readiness(MIXED)).toMatchObject({ ready: true, reasons: [] })
    expect(readiness(NOT_INVOICED)).toMatchObject({ ready: false, reasons: ['faturamento_pendente'] })
  })

  it('o B/L isento ainda precisa do CE', () => {
    expect(readiness(EXEMPT_WITHOUT_CE)).toMatchObject({ ready: false, reasons: ['ce_mercante_ausente'] })
  })

  it('o payload do e-mail marca o B/L isento', () => {
    const payload = JSON.parse(psql(`SELECT public.customer_local_charges_communication_payload(${VOYAGE_ID}, ${MIXED});`)) as {
      bls: Array<{ bl_id: string; ce_mercante: string; exempt: boolean }>
    }
    expect(payload.bls).toEqual([
      expect.objectContaining({ bl_id: BLS[3], ce_mercante: '157805000000004', exempt: false }),
      expect.objectContaining({ bl_id: BLS[2], ce_mercante: '157805000000003', exempt: true }),
    ])
  })

  it('a régua passa a listar o Cliente só com B/Ls isentos e o misto; os bloqueados, não', () => {
    const claims = psql(`SELECT string_agg(claim_key, ',' ORDER BY claim_key) FROM public.customer_communication_automation_targets(now())
      WHERE voyage_id = ${VOYAGE_ID} AND kind = 'ce_mercante_taxas';`)
    expect(claims).toBe([ONLY_EXEMPT, MIXED].map((id) => `ce_mercante_taxas:${id}:${VOYAGE_ID}`).join(','))
  }, 60_000)
})

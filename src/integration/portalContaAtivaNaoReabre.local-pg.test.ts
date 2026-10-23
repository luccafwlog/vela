import { readFileSync } from 'node:fs'
import { execPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 343 (sessão de testes de 2026-10-20, Obs. 5; decisões do Lucca de
// 2026-10-20 e 2026-10-21): B/L que entra para o Cliente, novo ou por troca,
// não muda a decisão do Portal, com a conta ativa ou não.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string) {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function functionUpdated() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.portal_reopen_on_new_process()') IS NULL
      AND to_regprocedure('public._portal_log_event(bigint,bigint,bigint,text,text,text,text,text,text,text,uuid)') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(functionUpdated, 'functionUpdated')

const CARRIER_ID = 3430001
const VESSEL_ID = 3430002
const VOYAGE_ID = 3430003
const ACTIVE = 3430011
const PENDING = 3430012
const OTHER = 3430013
const CUSTOMERS = `${ACTIVE}, ${PENDING}, ${OTHER}`

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.bls WHERE id LIKE 'BL343%';
    DELETE FROM public.portal_provisioning_events WHERE customer_id IN (${CUSTOMERS});
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${CUSTOMERS});
    DELETE FROM public.customers WHERE id IN (${CUSTOMERS});
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    SET session_replication_role = origin;
  `)
}

const account = (customerId: number) => psql(`SELECT provisioning_decision || ':' || account_situation FROM public.customer_portal_accounts WHERE customer_id = ${customerId};`)

describeLocal('343 — B/L novo não reabre a análise do Portal', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Carrier 343');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Vessel 343', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'V343', 'active');
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
        (${ACTIVE}, '34301111000150', 'Ativo 343'),
        (${PENDING}, '34302222000180', 'Convite 343'),
        (${OTHER}, '34303333000101', 'Outro 343');
      -- O cadastro do Cliente já cria a conta do Portal.
      INSERT INTO public.customer_portal_accounts (customer_id) VALUES (${ACTIVE}), (${PENDING}) ON CONFLICT (customer_id) DO NOTHING;
      UPDATE public.customer_portal_accounts SET provisioning_decision = 'aprovado_para_provisionar', account_situation = 'ativo' WHERE customer_id = ${ACTIVE};
      UPDATE public.customer_portal_accounts SET provisioning_decision = 'aprovado_para_provisionar', account_situation = 'convite_pendente' WHERE customer_id = ${PENDING};
      INSERT INTO public.bls (id, voyage_id, pol, pod, customer_id) VALUES ('BL343OTHER', ${VOYAGE_ID}, 'CNTAO', 'BRVIX', ${OTHER});
    `)
    // Eventos são só inclusão: a limpeza do preparo roda sem triggers.
    psql(`SET session_replication_role = replica; DELETE FROM public.portal_provisioning_events WHERE customer_id IN (${CUSTOMERS});`)
  })

  afterAll(cleanup)

  it('B/L novo do mesmo cliente não muda a decisão da conta ativa', () => {
    psql(`INSERT INTO public.bls (id, voyage_id, pol, pod, customer_id) VALUES ('BL343NEW', ${VOYAGE_ID}, 'CNTAO', 'BRVIX', ${ACTIVE});`)
    expect(account(ACTIVE)).toBe('aprovado_para_provisionar:ativo')
  })

  it('trocar um B/L para o cliente de conta ativa também não muda a decisão', () => {
    psql(`UPDATE public.bls SET customer_id = ${ACTIVE} WHERE id = 'BL343OTHER';`)
    expect(account(ACTIVE)).toBe('aprovado_para_provisionar:ativo')
    expect(psql(`SELECT count(*) FROM public.portal_provisioning_events WHERE customer_id = ${ACTIVE};`)).toBe('0')
  })

  it('conta ainda não ativa também fica como está com B/L novo ou trocado', () => {
    psql(`INSERT INTO public.bls (id, voyage_id, pol, pod, customer_id) VALUES ('BL343PEND', ${VOYAGE_ID}, 'CNTAO', 'BRVIX', ${PENDING});`)
    expect(account(PENDING)).toBe('aprovado_para_provisionar:convite_pendente')
    psql(`UPDATE public.bls SET customer_id = ${PENDING} WHERE id = 'BL343NEW';`)
    expect(account(PENDING)).toBe('aprovado_para_provisionar:convite_pendente')
    expect(psql(`SELECT count(*) FROM public.portal_provisioning_events WHERE customer_id = ${PENDING};`)).toBe('0')
  })

  it('a correção de dados desfaz a reabertura do trigger, ativa ou não, e não a reabertura à mão', () => {
    const reopen = (customerId: number, situation: string, reason: string) => `
      UPDATE public.customer_portal_accounts SET provisioning_decision = 'aguardando_analise' WHERE customer_id = ${customerId};
      INSERT INTO public.portal_provisioning_events (customer_id, account_id, previous_decision, new_decision, previous_situation, new_situation, actor_type, reason)
      SELECT ${customerId}, id, 'aprovado_para_provisionar', 'aguardando_analise', '${situation}', '${situation}', 'sistema', '${reason}'
      FROM public.customer_portal_accounts WHERE customer_id = ${customerId};`
    // Contas ativa e não ativa reabertas pelo trigger antigo; a do Outro, à mão.
    psql(`
      INSERT INTO public.customer_portal_accounts (customer_id) VALUES (${OTHER}) ON CONFLICT (customer_id) DO NOTHING;
      UPDATE public.customer_portal_accounts SET provisioning_decision = 'aprovado_para_provisionar' WHERE customer_id = ${OTHER};
      ${reopen(ACTIVE, 'ativo', 'Novo processo ativo reabriu a análise do Portal.')}
      ${reopen(PENDING, 'convite_pendente', 'Novo processo ativo reabriu a análise do Portal.')}
      ${reopen(OTHER, 'sem_conta', 'Reabertura pelo Administrativo.')}
    `)
    const migration = readFileSync('supabase/migrations/343_conta_ativa_do_portal_nao_reabre_por_bl.sql', 'utf8')
    psql(migration.slice(migration.indexOf('DO $$')))
    expect(account(ACTIVE)).toBe('aprovado_para_provisionar:ativo')
    expect(account(PENDING)).toBe('aprovado_para_provisionar:convite_pendente')
    expect(account(OTHER)).toBe('aguardando_analise:sem_conta')
  })
})

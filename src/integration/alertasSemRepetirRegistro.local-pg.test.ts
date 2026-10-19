import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Migration 324 (lote 5a da identidade, achados A2 e A3): a mensagem do
// alerta diz só o detalhe que o Alerta e o Registro não dizem, os alertas
// abertos são reescritos no formato novo, e o Provisionamento só marca
// "Crítico" o Cliente com alerta crítico ativo.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl =
  process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const migrationPath = resolve(process.cwd(), 'supabase/migrations/324_alertas_sem_repetir_registro_e_critico_do_portal.sql')

// Bloco de fixtures exclusivo deste arquivo.
const ID = 632101
const BL_ID = 'A321-BL-1'
const STAFF_SUB = 'dddddddd-0000-4000-8000-000000632101'

function psql(sql: string) {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

function asServer(sql: string) {
  return psql(`BEGIN; SELECT set_config('request.jwt.claim.role', 'service_role', true); ${sql}; COMMIT;`)
}

function criticalFlag() {
  const out = psql(`BEGIN;
    SELECT set_config('request.jwt.claim.sub', '${STAFF_SUB}', true);
    SELECT r->>'has_critical_alert' FROM public.portal_list_provisioning_console(${ID}) r;
    COMMIT;`)
  return out.split('\n').filter((line) => line === 'true' || line === 'false').at(-1)
}

function activeMessage(itemType: string) {
  return psql(`SELECT i.message FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE a.entity_type = 'customer' AND a.entity_id = '${ID}' AND i.item_type = '${itemType}' AND i.status = 'active';`)
}

describeLocal('migration 324 — mensagens dos alertas e "Crítico" do Provisionamento', () => {
  beforeAll(() => {
    psql(`INSERT INTO public.carriers (id, name) VALUES (${ID}, 'Carrier A321') ON CONFLICT (id) DO NOTHING;`)
    psql(`INSERT INTO public.vessels (id, name, carrier_id) VALUES (${ID}, 'Vessel A321', ${ID}) ON CONFLICT (id) DO NOTHING;`)
    psql(`INSERT INTO public.voyages (id, vessel_id, voyage_number) VALUES (${ID}, ${ID}, 'A321') ON CONFLICT (id) DO NOTHING;`)
    // Cliente novo nasce com a conta do Portal inativa e sem e-mail de recuperação.
    psql(`INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${ID}, '63210100000162', 'Cliente A321') ON CONFLICT (id) DO NOTHING;`)
    psql(`INSERT INTO public.bls (id, voyage_id, customer_id) VALUES ('${BL_ID}', ${ID}, ${ID}) ON CONFLICT (id) DO NOTHING;`)
    psql(`INSERT INTO auth.users (id, email) VALUES ('${STAFF_SUB}', 'a321-staff@example.test') ON CONFLICT (id) DO NOTHING;`)
    psql(`INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${STAFF_SUB}', 'Staff A321', 'administrativo', true)
      ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = true;`)
  })

  afterAll(() => {
    psql(`DELETE FROM public.alerts WHERE entity_type = 'customer' AND entity_id = '${ID}';`)
    psql(`UPDATE public.customer_portal_accounts SET account_situation = 'sem_conta', recovery_email = NULL WHERE customer_id = ${ID};`)
  })

  it('a pendência geral do Portal diz o que falta àquele Cliente, sem a frase genérica', () => {
    asServer('SELECT public.reconcile_client_portal_alerts()')
    expect(activeMessage('portal_pendencia_geral')).toBe('Sem conta no Portal e sem e-mail de recuperação.')
  })

  it('alerta normal não marca o Cliente como crítico; alerta crítico ativo marca (A3)', () => {
    asServer('SELECT public.reconcile_client_portal_alerts()')
    expect(criticalFlag()).toBe('false')

    asServer(`SELECT public.upsert_alert_item('review_portal_not_ready', 'customer', '${ID}',
      '1 B/L parado na Revisão: Portal sem conta.', 'a321_test', '{}'::jsonb, '/clientes/portal')`)
    expect(criticalFlag()).toBe('true')

    psql(`UPDATE public.alert_items i SET status = 'resolved', resolved_at = now()
      FROM public.alerts a WHERE a.id = i.alert_id AND a.entity_id = '${ID}' AND i.item_type = 'review_portal_not_ready';`)
    expect(criticalFlag()).toBe('false')
  })

  it('reescreve os alertas abertos que ainda têm o texto antigo (A2)', () => {
    asServer('SELECT public.reconcile_client_portal_alerts()')
    psql(`UPDATE public.alert_items i SET message = 'Cliente Cliente A321: 3 B/Ls pendentes de vínculo com cliente'
      FROM public.alerts a WHERE a.id = i.alert_id AND a.entity_id = '${ID}' AND i.item_type = 'portal_pendencia_geral';`)

    execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-q', '-1', '-d', databaseUrl, '-f', migrationPath], { encoding: 'utf8' })

    expect(activeMessage('portal_pendencia_geral')).toBe('3 B/Ls aguardam vínculo com Cliente.')
    const sql = readFileSync(migrationPath, 'utf8')
    expect(sql).not.toContain("'Baplie ausente para a viagem ' || p_voyage_id")
  })

  it('a CE Mercante reescrita diz o singular ou o plural, sem "(s)"', () => {
    asServer('SELECT public.reconcile_client_portal_alerts()')
    psql(`UPDATE public.alert_items i
      SET message = 'CE Mercante pendente para 1 B/L(s) e 2 rota(s) de vazios sem Nº de manifesto Mercante da viagem 10 (D-5 atingido)'
      FROM public.alerts a WHERE a.id = i.alert_id AND a.entity_id = '${ID}' AND i.item_type = 'portal_pendencia_geral';`)

    execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-q', '-1', '-d', databaseUrl, '-f', migrationPath], { encoding: 'utf8' })

    expect(activeMessage('portal_pendencia_geral'))
      .toBe('Falta para 1 B/L e 2 rotas de vazios sem Nº de manifesto Mercante; prazo D-5 atingido.')
  })

  it('conta suspensa diz "Conta do Portal suspensa.", no detector e na reescrita', () => {
    psql(`UPDATE public.customer_portal_accounts
      SET account_situation = 'suspenso', recovery_email = 'a321-cliente@example.test' WHERE customer_id = ${ID};`)
    asServer('SELECT public.reconcile_client_portal_alerts()')
    expect(activeMessage('portal_pendencia_geral')).toBe('Conta do Portal suspensa.')

    psql(`UPDATE public.alert_items i
      SET message = 'Cliente com processo ativo sem Portal ativo ou sem email de recuperação utilizável.'
      FROM public.alerts a WHERE a.id = i.alert_id AND a.entity_id = '${ID}' AND i.item_type = 'portal_pendencia_geral';`)
    execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-q', '-1', '-d', databaseUrl, '-f', migrationPath], { encoding: 'utf8' })
    expect(activeMessage('portal_pendencia_geral')).toBe('Conta do Portal suspensa.')
  })
})

import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 560 (decisões do dono de 2026-11-01): cada B/L criado pela
// importação deixa uma linha curta no Histórico de ações; observação de seção
// do ADR, "ciente" do impacto de taxa e modelos salvos de Comunicado também.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const USER_ID = '56056000-0000-4000-8000-000000000001'
const CARRIER_ID = 99560001
const VESSEL_ID = 99560002
const VOYAGE_ID = 99560003
const BL = 'A560-BL1'
const GRANITE_MANIFEST = '56056000-0000-4000-8000-0000000000b1'
const GRANITE_BL = '56056000-0000-4000-8000-0000000000b2'
const REPORT_ID = '56056000-0000-4000-8000-0000000000a1'
const PORT = 'BRZ60'
const CONTEXT = 'Importação de B/L · Viagem Navio 560 V560'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-F', '|', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function asUser(sql: string): { output: string; error: string } {
  const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '${USER_ID}';
     SET LOCAL request.jwt.claim.role = 'authenticated'; ${sql}; COMMIT;`], { encoding: 'utf8' })
  return { output: (result.stdout ?? '').trim(), error: (result.stderr ?? '').trim() }
}

/** Como a sessão do usuário, com o contexto que a importação grava. */
function asImport(sql: string): string {
  return psql(`BEGIN; SET LOCAL request.jwt.claim.sub = '${USER_ID}';
    SELECT set_config('vela.import_context', '${CONTEXT}', true); ${sql}; COMMIT;`)
}

function trail(where: string): string[] {
  const out = psql(`SELECT entity_type, field_name, coalesce(old_value, '-'), coalesce(new_value, '-'), coalesce(changed_by::text, '-'), coalesce(justification, '-')
    FROM public.audit_logs WHERE ${where} ORDER BY id`)
  return out ? out.split('\n') : []
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE changed_by = '${USER_ID}' OR entity_id IN ('${BL}', '${GRANITE_BL}', '${REPORT_ID}');
    DELETE FROM public.customer_communication_saved_templates WHERE created_by = '${USER_ID}';
    DELETE FROM public.bl_charge_adjustment_acks WHERE user_id = '${USER_ID}';
    DELETE FROM public.agency_departure_report_signoffs WHERE report_id = '${REPORT_ID}';
    DELETE FROM public.agency_departure_reports WHERE id = '${REPORT_ID}';
    DELETE FROM public.granite_bls WHERE id = '${GRANITE_BL}';
    DELETE FROM public.granite_manifests WHERE id = '${GRANITE_MANIFEST}';
    DELETE FROM public.bls WHERE id = '${BL}';
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.user_profiles WHERE id = '${USER_ID}';
    DELETE FROM auth.users WHERE id = '${USER_ID}';
    SET session_replication_role = origin;
  `)
}

function migration560Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_trigger WHERE tgname = 'audit_bls_created';`) === '1'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration560Applied, 'migration560Applied (B/L criado e lacunas menores no Histórico)')

describeLocal('560 — B/L criado e lacunas menores no Histórico de ações', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${USER_ID}', 'documentacao-560@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${USER_ID}', 'Diana 560', 'documentacao', true);
      SET session_replication_role = replica;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Armador 560');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Navio 560', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'V560', 'active');
      INSERT INTO public.granite_manifests (id, voyage_id, vessel_voyage) VALUES ('${GRANITE_MANIFEST}', ${VOYAGE_ID}, 'NAVIO 560 V560');
      INSERT INTO public.agency_departure_reports (id, voyage_id, port, status) VALUES ('${REPORT_ID}', ${VOYAGE_ID}, '${PORT}', 'open');
      SET session_replication_role = origin;
    `)
  })
  afterAll(cleanup)

  it('B/L criado pela importação: uma linha curta, com o contexto da importação', () => {
    asImport(`SET LOCAL session_replication_role = origin;
      INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode, financial_status, charge_status, review_status)
      VALUES ('${BL}', ${VOYAGE_ID}, 'CNSHA', 'BRSSZ', 'container', 'pending', 'not_calculated', 'ok')`)
    const rows = trail(`entity_type = 'bls' AND entity_id = '${BL}' AND field_name = 'criado'`)
    expect(rows).toHaveLength(1)
    const [, , , summary, author, justification] = rows[0].split('|')
    expect(JSON.parse(summary)).toEqual({ id: BL, voyage_id: VOYAGE_ID, cargo_mode: 'container', pol: 'CNSHA', pod: 'BRSSZ' })
    expect(author).toBe(USER_ID)
    expect(justification).toBe(CONTEXT)
  })

  it('B/L de Granito criado também deixa a linha curta', () => {
    asImport(`INSERT INTO public.granite_bls (id, manifest_id, bl_number) VALUES ('${GRANITE_BL}', '${GRANITE_MANIFEST}', 'GR-560')`)
    const rows = trail(`entity_type = 'granite_bls' AND entity_id = '${GRANITE_BL}' AND field_name = 'criado'`)
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0].split('|')[3])).toEqual({ id: GRANITE_BL, bl_number: 'GR-560', manifest_id: GRANITE_MANIFEST })
  })

  it('observação de seção do ADR grava antes e depois; regravar o mesmo texto não', () => {
    const write = (text: string) => psql(`BEGIN; SET LOCAL request.jwt.claim.sub = '${USER_ID}';
      INSERT INTO public.agency_departure_report_signoffs (report_id, section, department, observation)
      VALUES ('${REPORT_ID}', 'datas', 'operacoes', ${text ? `'${text}'` : 'NULL'})
      ON CONFLICT (report_id, section) DO UPDATE SET observation = EXCLUDED.observation; COMMIT;`)
    write('Atracação atrasou 4 horas')
    write('Atracação atrasou 6 horas')
    write('Atracação atrasou 6 horas')
    expect(trail(`entity_type = 'agency_departure_report' AND entity_id = '${REPORT_ID}'`)).toEqual([
      `agency_departure_report|observation|datas|-|Atracação atrasou 4 horas|${USER_ID}|-`,
      `agency_departure_report|observation|datas|Atracação atrasou 4 horas|Atracação atrasou 6 horas|${USER_ID}|-`,
    ])
  })

  it('"ciente" do impacto de taxa e modelo salvo de Comunicado (função da tela) ficam no Histórico', () => {
    psql(`BEGIN; SET LOCAL request.jwt.claim.sub = '${USER_ID}';
      INSERT INTO public.bl_charge_adjustment_acks (bl_id, user_id, expires_at) VALUES ('${BL}', '${USER_ID}', now() + interval '1 day'); COMMIT;`)
    expect(trail(`entity_type = 'bl_charge_adjustment_acks' AND changed_by = '${USER_ID}'`).map((row) => row.split('|')[1])).toEqual(['criado'])
    const saved = asUser(`SELECT public.save_customer_communication_saved_template('Aviso de atraso', 'Atraso', 'Texto do aviso')`)
    expect(saved.error).toBe('')
    expect(trail(`entity_type = 'customer_communication_saved_templates' AND changed_by = '${USER_ID}'`).map((row) => row.split('|')[1])).toEqual(['criado'])
  })

  // Migration 562: a limpeza dos aceites vencidos, que o "ciente" de qualquer
  // pessoa dispara, não vira exclusão com o autor de quem clicou.
  it('"ciente" pela função da tela grava só a criação; o vencido apagado na limpeza fica fora (562)', () => {
    psql(`SET session_replication_role = replica;
      DELETE FROM public.bl_charge_adjustment_acks WHERE user_id = '${USER_ID}';
      INSERT INTO public.bl_charge_adjustment_acks (bl_id, user_id, expires_at) VALUES ('${BL}', '${USER_ID}', now() - interval '1 hour');
      DELETE FROM public.audit_logs WHERE entity_type = 'bl_charge_adjustment_acks' AND changed_by = '${USER_ID}';
      SET session_replication_role = origin;`)
    const acked = asUser(`SELECT public.ack_bl_charge_adjustment_impact(ARRAY['${BL}'])`)
    expect(acked.error).toBe('')
    expect(psql(`SELECT count(*) FROM public.bl_charge_adjustment_acks WHERE user_id = '${USER_ID}' AND expires_at < now()`)).toBe('0')
    expect(trail(`entity_type = 'bl_charge_adjustment_acks' AND changed_by = '${USER_ID}'`).map((row) => row.split('|')[1])).toEqual(['criado'])
  })
})

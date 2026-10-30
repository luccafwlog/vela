import { execPsql } from './localPsql'
import { expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 513 (decisão D2 do dono na revisão da PR #1084): o "Não escala" do
// Administrativo em Chegadas e Saídas só tira da Viagem a escala sem âncora
// (B/L, ATA, ATD, Vinculada, terminais salvos). A conferência era só da tela; o
// gatilho `guard_pod_schedule_removal_mark` passa a recusar a marca de retirada
// com âncora. O Excluir escala (`delete_escala`) segue com a régua dele: apaga a
// escala com ATA, Vinculada e terminais, e recusa B/L. Tudo roda numa transação
// desfeita: nada fica no banco.
//
// Migration 549 (revisão da release #1117): as âncoras têm um dono só,
// `escala_removal_anchor_reasons`, lido pelo gatilho e pela tela. O B/L com o
// porto gravado por apelido (SALVADOR para BRSSA) ancora nos dois, e o
// Embarque de vazios anterior à 541, sem terminal, também ancora, como no
// Excluir escala.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADMIN = '51300000-0000-4000-8000-000000000001'
const VOYAGE = 99513003

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function guardExists(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_guard_pod_schedule_removal_mark';`) === '1'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(guardExists, 'guardExists (trg_guard_pod_schedule_removal_mark)')

const removal = (port: string) => JSON.stringify([{
  entity_type: 'voyage_pod_schedule', entity_id: `${VOYAGE}::${port}`, field_name: 'deleted', old_value: 'false', new_value: 'true',
}])

describeLocal('513 — "Não escala" do Administrativo respeita a âncora no banco', () => {
  it('recusa a retirada da escala com ATA, ATD, Vinculada, terminais ou B/L (também pelo POL); sem âncora retira; Excluir escala segue igual', () => {
    const lines = psql(`
      BEGIN;
      INSERT INTO auth.users (id, email) VALUES ('${ADMIN}', 'nao-escala-513@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${ADMIN}', 'Admin 513', 'administrativo', true);
      INSERT INTO public.carriers (id, name) VALUES (99513001, 'Armador 513');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (99513002, 'Navio 513', 99513001);
      INSERT INTO public.voyages (id, vessel_id, voyage_number) VALUES (${VOYAGE}, 99513002, 'V513');
      INSERT INTO public.ports (id, name, locode) VALUES (99513011, 'Porto 513 TER', 'BRZ5T');
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      SELECT 'voyage_pod_schedule', '${VOYAGE}::' || p, 'eta', NULL, '2026-11-20', NULL, 'teste 513'
      FROM unnest(ARRAY['BRZ5A', 'BRZ5D', 'BRZ5V', 'BRZ5T', 'BRZ5P', 'BRZ5L', 'BRZ5X', 'BRSSA', 'BRZ5E']) AS p;
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification) VALUES
        ('voyage_pod_schedule', '${VOYAGE}::BRZ5A', 'ata', NULL, '2026-11-20T08:00', NULL, 'teste 513'),
        ('voyage_pod_schedule', '${VOYAGE}::BRZ5D', 'atd', NULL, '2026-11-21T08:00', NULL, 'teste 513'),
        ('voyage_pod_schedule', '${VOYAGE}::BRZ5V', 'linked', NULL, 'true', NULL, 'teste 513'),
        ('voyage_pod_schedule', '${VOYAGE}::BRZ5X', 'ata', NULL, '2026-11-20T08:00', NULL, 'teste 513'),
        ('voyage_pod_schedule', '${VOYAGE}::BRZ5X', 'linked', NULL, 'true', NULL, 'teste 513');
      INSERT INTO public.voyage_escala_revision_state (voyage_id, port, port_id, revision) VALUES (${VOYAGE}, 'BRZ5T', 99513011, 1);
      INSERT INTO public.bls (id, voyage_id, pol, pod, shipper) VALUES ('BL513POL', ${VOYAGE}, 'BRZ5P', 'BRVIX', 'X');
      -- 549: POD gravado por apelido (SALVADOR é BRSSA).
      INSERT INTO public.bls (id, voyage_id, pol, pod, shipper) VALUES ('BL549ALIAS', ${VOYAGE}, 'CNSHA', 'SALVADOR', 'X');
      -- 549: Embarque de vazios anterior à 541, sem frente nem terminal (fixture).
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.vazios_export_operations (voyage_id, embark_port) VALUES (${VOYAGE}, 'BRZ5E');
      SET LOCAL session_replication_role = origin;
      CREATE FUNCTION pg_temp.tenta(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
      BEGIN
        EXECUTE p_sql;
        RETURN 'ok';
      EXCEPTION WHEN OTHERS THEN
        RETURN SQLERRM;
      END $f$;
      GRANT EXECUTE ON FUNCTION pg_temp.tenta(text) TO authenticated;
      SET LOCAL ROLE authenticated;
      SET LOCAL request.jwt.claim.sub = '${ADMIN}';
      SET LOCAL request.jwt.claim.role = 'authenticated';
      SELECT p || '=' || pg_temp.tenta(format('SELECT public.record_audit_entries(%L::jsonb)', r))
      FROM (VALUES
        ('BRZ5A', '${removal('BRZ5A')}'), ('BRZ5D', '${removal('BRZ5D')}'), ('BRZ5V', '${removal('BRZ5V')}'),
        ('BRZ5T', '${removal('BRZ5T')}'), ('BRZ5P', '${removal('BRZ5P')}'), ('BRZ5L', '${removal('BRZ5L')}'),
        ('BRSSA', '${removal('BRSSA')}'), ('BRZ5E', '${removal('BRZ5E')}')
      ) AS t(p, r);
      -- A tela lê o mesmo dono antes de montar a gravação.
      SELECT 'ANCORA_' || p || '=' || array_to_string(public.escala_removal_anchor_reasons(${VOYAGE}, p), ', ')
      FROM unnest(ARRAY['BRSSA', 'BRZ5E', 'BRZ5P', 'BRZ5L']) AS p;
      SELECT 'BRZ5X=' || (public.delete_escala(${VOYAGE}, 'BRZ5X', false, 'Teste do Excluir escala')->>'deleted');
      ROLLBACK;
    `).split('\n').filter((line) => /^(ANCORA_)?BR[A-Z0-9]{3}=/.test(line))

    const result = Object.fromEntries(lines.map((line) => line.split('=')).map(([key, ...rest]) => [key, rest.join('=')]))
    expect(result.BRZ5A, lines.join('\n')).toBe('Escala BRZ5A travada: ATA registrado.')
    expect(result.BRZ5D).toBe('Escala BRZ5D travada: ATD registrado.')
    expect(result.BRZ5V).toBe('Escala BRZ5V travada: escala Vinculada.')
    expect(result.BRZ5T).toBe('Escala BRZ5T travada: terminais salvos.')
    // O B/L que tem o porto como origem também ancora (a tela só olhava o POD).
    expect(result.BRZ5P).toBe('Escala BRZ5P travada: B/L vinculado à escala.')
    // Sem âncora, a escala sai da Viagem, como antes.
    expect(result.BRZ5L).toBe('ok')
    // Excluir escala apaga a escala com ATA e Vinculada, como antes.
    expect(result.BRZ5X).toBe('true')
    // 549: o B/L com o POD por apelido e o Embarque de vazios sem terminal
    // ancoram, e a tela lê as mesmas âncoras.
    expect(result.BRSSA).toBe('Escala BRSSA travada: B/L vinculado à escala.')
    expect(result.BRZ5E).toBe('Escala BRZ5E travada: Embarque de vazios na escala.')
    expect(result.ANCORA_BRSSA).toBe('B/L vinculado à escala')
    expect(result.ANCORA_BRZ5E).toBe('Embarque de vazios na escala')
    expect(result.ANCORA_BRZ5P).toBe('B/L vinculado à escala')
    expect(result.ANCORA_BRZ5L).toBe('')
  })

  it('a leitura das âncoras é só para usuário interno ativo (549)', () => {
    expect(psql(`SELECT has_function_privilege('anon', 'public.escala_removal_anchor_reasons(bigint, text)', 'EXECUTE'), has_function_privilege('authenticated', 'public.escala_removal_anchor_reasons(bigint, text)', 'EXECUTE');`)).toBe('f|t')
    const output = psql(`
      BEGIN;
      CREATE FUNCTION pg_temp.tenta(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
      BEGIN
        EXECUTE p_sql;
        RETURN 'ok';
      EXCEPTION WHEN OTHERS THEN
        RETURN SQLERRM;
      END $f$;
      GRANT EXECUTE ON FUNCTION pg_temp.tenta(text) TO authenticated;
      SET LOCAL ROLE authenticated;
      SET LOCAL request.jwt.claim.sub = '51300000-0000-4000-8000-0000000000ff';
      SET LOCAL request.jwt.claim.role = 'authenticated';
      SELECT pg_temp.tenta('SELECT public.escala_removal_anchor_reasons(${VOYAGE}, ''BRSSA'')');
      ROLLBACK;
    `)
    expect(output).toBe('Usuário sem permissão.')
  })
})

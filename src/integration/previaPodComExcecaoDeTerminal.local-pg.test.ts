import { execPsql } from './localPsql'
import { expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 512 (revisão da PR #1084): as prévias que simulam a troca de POD
// limpavam `terminal_id` e deixavam `pod_port_id`, o que viola
// `bls_terminal_override_pair_check` no B/L com exceção de terminal:
//   - `_apply_bl_charge_simulation_change` (prévia das taxas alteradas à mão,
//     `preview_bl_charge_adjustment_impact`): a prévia falhava e a tela gravava
//     sem o diálogo "Gravar mesmo assim";
//   - `preview_breakbulk_billing_changes` (reimportação de carga solta de B/L
//     faturado): a linha do B/L voltava com o erro do banco.
// A gravação de verdade limpa os dois campos (reimportação, COD e o gatilho
// `trg_pod_change_clears_terminal_override` da 502). Tudo roda numa transação
// desfeita: nada fica no banco.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ACTOR = '51200000-0000-4000-8000-000000000001'
const VOYAGE_ID = 99512003
const TERMINAL_P = '00000000-0000-0000-0000-0000005120d1'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function pairCheckExists(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_constraint WHERE conname = 'bls_terminal_override_pair_check';`) === '1'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(pairCheckExists, 'pairCheckExists (bls_terminal_override_pair_check)')

describeLocal('512 — prévias com troca de POD no B/L com exceção de terminal', () => {
  it('a prévia das taxas e a da carga solta tiram terminal e porto juntos, sem violar a restrição', () => {
    const lines = psql(`
      BEGIN;
      INSERT INTO auth.users (id, email) VALUES ('${ACTOR}', 'previa-512@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${ACTOR}', 'Teste 512', 'documentacao', true);
      INSERT INTO public.carriers (id, name) VALUES (99512001, 'Armador 512');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (99512002, 'Navio 512', 99512001);
      INSERT INTO public.voyages (id, vessel_id, voyage_number) VALUES (${VOYAGE_ID}, 99512002, 'V512');
      INSERT INTO public.ports (id, name, locode) VALUES (99512011, 'Porto 512 P', 'BRZ5P'), (99512012, 'Porto 512 Q', 'BRZ5Q');
      INSERT INTO public.depots (id, code, name, tipo, port_id) VALUES ('${TERMINAL_P}', 'T512P', 'Terminal 512 P', 'terminal_portuario', 99512011);
      INSERT INTO public.bls (id, voyage_id, pol, pod, shipper) VALUES
        ('BL512TAXA', ${VOYAGE_ID}, 'CNSHA', 'BRZ5P', 'X'),
        ('BL512BB', ${VOYAGE_ID}, 'CNSHA', 'BRZ5P', 'X');
      SET LOCAL request.jwt.claim.sub = '${ACTOR}';
      SET LOCAL request.jwt.claim.role = 'authenticated';
      SELECT public.set_bl_terminal_override(id, '${TERMINAL_P}', 99512011, 'Descarga no terminal P', '${ACTOR}') IS NULL
        FROM public.bls WHERE voyage_id = ${VOYAGE_ID};
      SET LOCAL session_replication_role = replica;
      UPDATE public.bls SET financial_status = 'invoiced' WHERE id = 'BL512BB';
      SET LOCAL session_replication_role = origin;
      CREATE FUNCTION pg_temp.tenta(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
      BEGIN
        EXECUTE p_sql;
        RETURN 'ok';
      EXCEPTION WHEN OTHERS THEN
        RETURN SQLERRM;
      END $f$;
      SELECT 'taxa=' || pg_temp.tenta($q$SELECT public._apply_bl_charge_simulation_change('{"bl_id":"BL512TAXA","bls":{"pod":"BRZ5Q"}}'::jsonb)$q$);
      SELECT 'taxa_bl=' || coalesce(terminal_id::text, '-') || '|' || coalesce(pod_port_id::text, '-') FROM public.bls WHERE id = 'BL512TAXA';
      SELECT 'bb=' || coalesce(e->>'reason', '-')
        FROM jsonb_array_elements(public.preview_breakbulk_billing_changes(${VOYAGE_ID}, '[{"id":"BL512BB","pod":"BRZ5Q"}]'::jsonb)) e;
      SELECT 'bb_bl=' || coalesce(terminal_id::text, '-') || '|' || coalesce(pod_port_id::text, '-') FROM public.bls WHERE id = 'BL512BB';
      ROLLBACK;
    `).split('\n').filter((line) => /^(taxa|taxa_bl|bb|bb_bl)=/.test(line))

    expect(lines, lines.join('\n')).toContain('taxa=ok')
    // A simulação tira os dois campos, como a gravação.
    expect(lines).toContain('taxa_bl=-|-')
    expect(lines.find((line) => line.startsWith('bb='))).not.toMatch(/bls_terminal_override_pair_check/)
    // A prévia da carga solta é desfeita: o B/L segue com a exceção.
    expect(lines).toContain(`bb_bl=${TERMINAL_P}|99512011`)
  })
})

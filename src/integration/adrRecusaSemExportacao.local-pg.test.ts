// Migration 618 (ADR 0133, D5): com exportação declarada na escala e o
// manifesto não vinculado à Viagem, o ADR recusa "Nada a declarar" na seção
// da exportação e recusa fechar. Com o manifesto vinculado, ou sem exportação
// declarada, segue como antes. Cada cenário roda numa transação desfeita.
//
// Namespace exclusivo: Viagem 960901, porto BRSSZ.
import { execPsql } from './localPsql'
import { describe, expect, it } from 'vitest'

const db = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const local = process.env.LOCAL_PG_INTEGRATION === '1' ? describe : describe.skip
const VOYAGE = 960901
const REPORT = '60900000-0000-4000-8000-000000000001'

type Setup = { granite: boolean; empty: boolean; graniteLinked?: boolean; emptyLinked?: boolean }

/** Monta a escala e o ADR, roda `action` e devolve 'ok' ou a mensagem de recusa. */
function run(setup: Setup, action: string): string {
  const out = execPsql(['-X', '-Atq', '-d', db, '-f', '-'], {
    input: `BEGIN;
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE}, 1, 'A609', 'active');
      INSERT INTO public.voyage_export_schedules (voyage_id, pol, tem_exportacao, has_granite, has_empty)
        VALUES (${VOYAGE}, 'BRSSZ', true, ${setup.granite}, ${setup.empty});
      ${setup.graniteLinked ? `INSERT INTO public.granite_manifests (vessel_voyage, voyage_id) VALUES ('A609', ${VOYAGE});` : ''}
      ${setup.emptyLinked ? `INSERT INTO public.vazios_manifests (voyage_id) VALUES (${VOYAGE});` : ''}
      INSERT INTO public.agency_departure_reports (id, voyage_id, port, status) VALUES ('${REPORT}', ${VOYAGE}, 'BRSSZ', 'open');
      CREATE TEMP TABLE r609 (msg text) ON COMMIT DROP;
      SET LOCAL session_replication_role = origin;
      DO $t$ BEGIN
        BEGIN
          ${action}
          INSERT INTO r609 VALUES ('ok');
        EXCEPTION WHEN check_violation THEN
          INSERT INTO r609 VALUES (SQLERRM);
        END;
      END $t$;
      SELECT msg FROM r609;
      ROLLBACK;`,
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  })
  return out.replaceAll(String.fromCharCode(13), '').trim().split('\n').at(-1) ?? ''
}

const nothing = (section: string) =>
  `INSERT INTO public.agency_departure_report_signoffs (report_id, section, state, department) VALUES ('${REPORT}', '${section}', 'nothing_to_declare', 'equipamentos');`
const close = `UPDATE public.agency_departure_reports SET status = 'closed', closed_at = now() WHERE id = '${REPORT}';`

local('ADR recusa sem a exportação lançada (migration 618)', () => {
  it('Granito declarado e sem manifesto: Carga carregada recusa Nada a declarar', () => {
    expect(run({ granite: true, empty: false }, nothing('carga_carregada'))).toContain('nenhum manifesto de Granito')
    // A seção dos vazios não depende do Granito.
    expect(run({ granite: true, empty: false }, nothing('vazios_embarcados'))).toBe('ok')
  })

  it('vazios declarados e sem manifesto: Vazios embarcados recusa Nada a declarar', () => {
    expect(run({ granite: false, empty: true }, nothing('vazios_embarcados'))).toContain('nenhum manifesto de Embarque de vazios')
  })

  it('o ADR não fecha com a exportação declarada e não lançada; com o manifesto, fecha', () => {
    expect(run({ granite: true, empty: true, emptyLinked: true }, close)).toContain('exportação (Granito)')
    expect(run({ granite: true, empty: true, graniteLinked: true, emptyLinked: true }, close)).toBe('ok')
    expect(run({ granite: true, empty: true, graniteLinked: true, emptyLinked: true }, nothing('carga_carregada'))).toBe('ok')
  })

  it('sem exportação declarada no porto: nada muda', () => {
    expect(run({ granite: false, empty: false }, close)).toBe('ok')
  })
})

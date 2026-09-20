import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function guardPresent() {
  if (!enabled) return false
  try {
    return psql(`SELECT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.voyages'::regclass
        AND tgname = 'trg_guard_voyage_hard_delete'
        AND NOT tgisinternal
    );`) === 't'
  } catch {
    return false
  }
}

const describeLocal = guardPresent() ? describe : describe.skip

const CARRIER_ID = 6706701
const VESSEL_ID = 6706702
const EMPTY_VOYAGE_ID = 6706703
const LINKED_VOYAGE_ID = 6706704
const CANCELLED_VOYAGE_ID = 6706705
const EXPORT_SCHEDULE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.voyage_export_schedules WHERE id = '${EXPORT_SCHEDULE_ID}';
    DELETE FROM public.voyages WHERE id IN (${EMPTY_VOYAGE_ID}, ${LINKED_VOYAGE_ID}, ${CANCELLED_VOYAGE_ID});
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    SET session_replication_role = origin;
  `)
}

describeLocal('067 — hard-delete de Viagem sem dados vinculados', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'VHD Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'VHD Vessel', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        (${EMPTY_VOYAGE_ID}, ${VESSEL_ID}, 'VHD-EMPTY', 'active'),
        (${LINKED_VOYAGE_ID}, ${VESSEL_ID}, 'VHD-LINKED', 'active'),
        (${CANCELLED_VOYAGE_ID}, ${VESSEL_ID}, 'VHD-CANCELLED', 'cancelled');
      INSERT INTO public.voyage_export_schedules (id, voyage_id, pol, tem_exportacao)
        VALUES ('${EXPORT_SCHEDULE_ID}', ${LINKED_VOYAGE_ID}, 'BRVIX', true);
    `)
  })

  afterAll(cleanup)

  it('permite excluir fisicamente uma Viagem que ainda nao tem dados', () => {
    psql(`DELETE FROM public.voyages WHERE id = ${EMPTY_VOYAGE_ID};`)
    expect(psql(`SELECT count(*) FROM public.voyages WHERE id = ${EMPTY_VOYAGE_ID};`)).toBe('0')
  })

  it('bloqueia a exclusao quando existe somente uma escala vinculada', () => {
    const attempt = spawnSync(
      'psql',
      ['-X', '-v', 'ON_ERROR_STOP=1', '-d', databaseUrl, '-c', `DELETE FROM public.voyages WHERE id = ${LINKED_VOYAGE_ID};`],
      { encoding: 'utf8' },
    )

    expect(attempt.status).not.toBe(0)
    expect(attempt.stderr).toMatch(/dados vinculados/i)
    expect(psql(`SELECT count(*) FROM public.voyages WHERE id = ${LINKED_VOYAGE_ID};`)).toBe('1')
    expect(psql(`SELECT count(*) FROM public.voyage_export_schedules WHERE id = '${EXPORT_SCHEDULE_ID}';`)).toBe('1')
  })

  it('mantem Viagem cancelada retida mesmo sem outro dado operacional', () => {
    const attempt = spawnSync(
      'psql',
      ['-X', '-v', 'ON_ERROR_STOP=1', '-d', databaseUrl, '-c', `DELETE FROM public.voyages WHERE id = ${CANCELLED_VOYAGE_ID};`],
      { encoding: 'utf8' },
    )

    expect(attempt.status).not.toBe(0)
    expect(attempt.stderr).toMatch(/cancelada deve permanecer retida/i)
    expect(psql(`SELECT count(*) FROM public.voyages WHERE id = ${CANCELLED_VOYAGE_ID};`)).toBe('1')
  })
})

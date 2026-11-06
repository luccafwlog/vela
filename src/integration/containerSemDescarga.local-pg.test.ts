// Migration 607 (ADR 0131, D2): "Container sem descarga" por atracação. Abre
// Normal no ATB do terminal com container sem data de descarga, vira Crítico
// 24 horas depois do ATB (com novo aviso) e fecha quando a data entra; o
// container de B/L com exceção de terminal conta no terminal dele.
//
// Namespace exclusivo: Viagem 960701, B/Ls 'A607-*', terminais T607A e T607B,
// usuário ...000000607001.
import { execPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const VOYAGE = 960701
const PORT = 'BRSSZ'
const T_A = '60700000-0000-4000-8000-00000000000a'
const T_B = '60700000-0000-4000-8000-00000000000b'
const ENTITY_A = `${VOYAGE}::${PORT}::T607A`
const ENTITY_B = `${VOYAGE}::${PORT}::T607B`
const EQU = '00000000-0000-0000-0000-000000607001'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

const sweep = () => psql(`SELECT public.reconcile_container_discharge_alerts('teste_607') >= 0;`)

function item(entityId: string): string {
  return psql(`SELECT concat_ws('|', i.status, i.severity, i.metadata->>'milestone', i.metadata->>'containers', i.department)
    FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE a.entity_id = '${entityId}' AND i.item_type = 'container_sem_descarga';`)
}

function notifications(entityId: string): number {
  return Number(psql(`SELECT count(*) FROM public.internal_notifications n JOIN public.alerts a ON a.id = n.alert_id
    WHERE a.entity_id = '${entityId}' AND n.recipient_id = '${EQU}';`))
}

function setAtb(terminal: string, hoursAgo: number | null) {
  psql(`SET session_replication_role = replica;
    UPDATE public.voyage_escala_terminal_state
       SET terminal_etb = ${hoursAgo === null ? 'NULL' : `now() - interval '${hoursAgo + 1} hours'`},
           terminal_atb = ${hoursAgo === null ? 'NULL' : `now() - interval '${hoursAgo} hours'`}
     WHERE voyage_id = ${VOYAGE} AND terminal_id = '${terminal}';
    SET session_replication_role = origin;`)
}

function cleanup() {
  psql(`
    DELETE FROM public.alerts WHERE entity_id LIKE '${VOYAGE}::%';
    SET session_replication_role = replica;
    DELETE FROM public.bl_containers WHERE bl_id LIKE 'A607-%';
    DELETE FROM public.bls WHERE id LIKE 'A607-%';
    DELETE FROM public.voyage_escala_terminal_state WHERE voyage_id = ${VOYAGE};
    DELETE FROM public.voyage_escala_operation_fronts WHERE voyage_id = ${VOYAGE};
    DELETE FROM public.voyages WHERE id = ${VOYAGE};
    DELETE FROM public.depots WHERE id IN ('${T_A}', '${T_B}');
    DELETE FROM public.internal_notifications WHERE recipient_id = '${EQU}';
    DELETE FROM public.user_profiles WHERE id = '${EQU}';
    DELETE FROM auth.users WHERE id = '${EQU}';
    SET session_replication_role = origin;
  `)
}

describeLocal('Container sem descarga por atracação (migration 607)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${EQU}', 'a607-equ@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${EQU}', 'A607 Bruno', 'equipamentos', true);
      SET session_replication_role = replica;
      INSERT INTO public.depots (id, code, name, tipo) VALUES
        ('${T_A}', 'T607A', 'Terminal 607 A', 'terminal_portuario'), ('${T_B}', 'T607B', 'Terminal 607 B', 'terminal_portuario');
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE}, 1, 'A607', 'active');
      INSERT INTO public.voyage_escala_operation_fronts (voyage_id, port, port_id, sentido, modalidade, source, terminal_id)
        VALUES (${VOYAGE}, '${PORT}', 1, 'importacao', 'carga_cheia', 'operational_data', '${T_A}');
      INSERT INTO public.voyage_escala_terminal_state (voyage_id, port, port_id, terminal_id) VALUES
        (${VOYAGE}, '${PORT}', 1, '${T_A}'), (${VOYAGE}, '${PORT}', 1, '${T_B}');
      INSERT INTO public.bls (id, voyage_id, pod, cargo_mode, terminal_id, pod_port_id) VALUES
        ('A607-BL1', ${VOYAGE}, '${PORT}', 'container', NULL, NULL),
        ('A607-BL2', ${VOYAGE}, '${PORT}', 'container', '${T_B}', 1);
      INSERT INTO public.bl_containers (bl_id, container_number, discharge_date) VALUES
        ('A607-BL1', 'AAAU6070001', NULL), ('A607-BL1', 'AAAU6070002', current_date - 1),
        ('A607-BL2', 'AAAU6070003', current_date - 1);
      SET session_replication_role = origin;
    `)
  })

  afterAll(cleanup)

  it('sem ATB, não abre', () => {
    sweep()
    expect(item(ENTITY_A)).toBe('')
  })

  it('no ATB, abre Normal para Equipamentos, contando só os containers do terminal sem descarga', () => {
    setAtb(T_A, 2)
    setAtb(T_B, 2)
    sweep()
    expect(item(ENTITY_A)).toBe('active|normal|sem_descarga|1|equipamentos')
    // O B/L com exceção de terminal conta no T607B, e lá todos têm descarga.
    expect(item(ENTITY_B)).toBe('')
  })

  it('24 horas depois do ATB, o mesmo alerta vira Crítico e avisa de novo', () => {
    const before = notifications(ENTITY_A)
    setAtb(T_A, 25)
    sweep()
    expect(item(ENTITY_A)).toBe('active|critical|sem_descarga_24h|1|equipamentos')
    expect(notifications(ENTITY_A)).toBe(before + 1)
  })

  it('gravar a descarga fecha na hora, pelo gatilho das datas', () => {
    psql(`SET request.jwt.claim.role = 'service_role';
      UPDATE public.bl_containers SET discharge_date = current_date WHERE container_number = 'AAAU6070001';`)
    expect(item(ENTITY_A)).toMatch(/^resolved\|/)
  })
})

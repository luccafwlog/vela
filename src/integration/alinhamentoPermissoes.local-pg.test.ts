import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Bloco 3 do plano docs/plans/2026-09-23-alinhamento-apresentacao-docs-codigo.md:
// execução real no Postgres descartável (scripts/setup-local-pg.sh), não só o
// texto das migrations.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function runAs(sub: string, sql: string) {
  return spawnSync(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
      `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${sub}', true); ${sql} COMMIT;`],
    { encoding: 'utf8' },
  )
}

function migration077Applied() {
  if (!enabled) return false
  try {
    return psql(`SELECT position('is_admin' IN prosrc) = 0 FROM pg_proc WHERE proname = 'import_baplie_staging_transactional';`) === 't'
  } catch {
    return false
  }
}

const describeLocal = migration077Applied() ? describe : describe.skip

const CARRIER_ID = 7701
const VESSEL_ID = 7702
const VOYAGE_ID = 7703
const DOCS_SUB = '77777777-0000-4000-8000-000000000001'
const INACTIVE_SUB = '77777777-0000-4000-8000-000000000002'

const baplieRow = JSON.stringify([{
  container_number: 'TCLU7700001', size_type: '45G1', status: 'full', weight_kg: 21000, pol: 'CNSHA', pod: 'BRSSA',
  final_dest: null, bl_ref: null, slot: '010101', is_imo: false, imo_class: null, un_number: null, is_oog: false,
  imported_by: DOCS_SUB,
}])

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.baplie_containers WHERE voyage_id = ${VOYAGE_ID};
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.user_profiles WHERE id IN ('${DOCS_SUB}', '${INACTIVE_SUB}');
    DELETE FROM auth.users WHERE id IN ('${DOCS_SUB}', '${INACTIVE_SUB}');
    SET session_replication_role = origin;
  `)
}

describeLocal('077 — Baplie importado por qualquer Departamento ativo', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${DOCS_SUB}', 'docs-077@example.test'), ('${INACTIVE_SUB}', 'off-077@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${DOCS_SUB}', 'Documentação 077', 'documentacao', true),
        ('${INACTIVE_SUB}', 'Inativo 077', 'documentacao', false);
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Carrier 077');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Vessel 077', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'V077', 'active');
    `)
  })
  afterAll(cleanup)

  it('Documentação importa o Baplie da viagem', () => {
    const result = runAs(DOCS_SUB, `SELECT public.import_baplie_staging_transactional(${VOYAGE_ID}, '${baplieRow}'::jsonb);`)
    expect(result.stderr).toBe('')
    expect(psql(`SELECT count(*) FROM public.baplie_containers WHERE voyage_id = ${VOYAGE_ID};`)).toBe('1')
  })

  it('usuário inativo continua recusado', () => {
    const result = runAs(INACTIVE_SUB, `SELECT public.import_baplie_staging_transactional(${VOYAGE_ID}, '${baplieRow}'::jsonb);`)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('sem permissao para importar Baplie')
  })
})

function migration078Applied() {
  if (!enabled) return false
  try {
    return psql(`SELECT responsible_department FROM public.alert_type_catalog WHERE type = 'pix_unreconciled';`) === 'administrativo'
  } catch {
    return false
  }
}

const describe078 = migration078Applied() ? describe : describe.skip

describe078('078 — PIX sem conciliação na fila do Administrativo', () => {
  const ENTITY = 'pix-078-local-pg'

  afterAll(() => {
    psql(`
      SET session_replication_role = replica;
      DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM public.alerts WHERE entity_id = '${ENTITY}');
      DELETE FROM public.alerts WHERE entity_id = '${ENTITY}';
      SET session_replication_role = origin;
    `)
  })

  it('abre o item com o Administrativo como setor responsável', () => {
    // Antes da 078 a fila recusava 'administrativo' ("Departamento inválido").
    psql(`
      BEGIN;
      SELECT set_config('request.jwt.claim.role', 'service_role', true);
      SELECT public.upsert_alert_item('pix_unreconciled', 'pix_transaction', '${ENTITY}', 'PIX teste 078', 'local_pg_test', '{}'::jsonb, '/reconciliacao');
      COMMIT;
    `)
    expect(psql(`SELECT ai.department || '/' || ai.severity FROM public.alert_items ai
      JOIN public.alerts a ON a.id = ai.alert_id WHERE a.entity_id = '${ENTITY}';`)).toBe('administrativo/critical')
  })

  it('rebaixa Granito sem cliente para Normal', () => {
    expect(psql(`SELECT severity FROM public.alert_type_catalog WHERE type = 'review_granite_customer_unlinked';`)).toBe('normal')
  })
})

function migration079Applied() {
  if (!enabled) return false
  try {
    return psql(`SELECT position('bl_containers' IN prosrc) > 0 FROM pg_proc WHERE proname = 'bl_timeline';`) === 't'
  } catch {
    return false
  }
}

const describe079 = migration079Applied() ? describe : describe.skip

describe079('079 — Histórico do B/L mostra mudanças nos containers', () => {
  const BL_ID = 'BL079LOCALPG'
  const USER = '77777777-0000-4000-8000-000000000079'

  function clean() {
    psql(`
      SET session_replication_role = replica;
      DELETE FROM public.audit_logs WHERE entity_type = 'bl_containers' AND entity_id IN (SELECT id::text FROM public.bl_containers WHERE bl_id = '${BL_ID}');
      DELETE FROM public.bl_containers WHERE bl_id = '${BL_ID}';
      DELETE FROM public.bls WHERE id = '${BL_ID}';
      DELETE FROM public.voyages WHERE id = 7793;
      DELETE FROM public.vessels WHERE id = 7792;
      DELETE FROM public.carriers WHERE id = 7791;
      DELETE FROM public.user_profiles WHERE id = '${USER}';
      DELETE FROM auth.users WHERE id = '${USER}';
      SET session_replication_role = origin;
    `)
  }

  beforeAll(() => {
    clean()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${USER}', 'equip-079@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${USER}', 'Equipamentos 079', 'equipamentos', true);
      INSERT INTO public.carriers (id, name) VALUES (7791, 'Carrier 079');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (7792, 'Vessel 079', 7791);
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (7793, 7792, 'V079', 'active');
      INSERT INTO public.bls (id, voyage_id) VALUES ('${BL_ID}', 7793);
      INSERT INTO public.bl_containers (bl_id, container_number, type, discharge_date) VALUES ('${BL_ID}', 'TCLU0790001', '40HC', '2026-10-14');
    `)
    // Mudança feita por um usuário, como a importação de datas em lote: passa
    // pelo gatilho audit_row_changes, que grava entity_type = 'bl_containers'.
    psql(`
      BEGIN;
      SELECT set_config('request.jwt.claim.sub', '${USER}', true);
      UPDATE public.bl_containers SET return_date = '2026-10-20', cbm = 67 WHERE bl_id = '${BL_ID}';
      COMMIT;
    `)
  })
  afterAll(clean)

  it('lista a devolução com o número do container e esconde campo técnico', () => {
    const rows = psql(`
      BEGIN;
      SELECT set_config('request.jwt.claim.sub', '${USER}', true);
      SELECT entity_type || ' ' || field_name || ' ' || coalesce(new_value, '') FROM public.bl_timeline('${BL_ID}', 50, 0);
      COMMIT;
    `)
    expect(rows).toContain('bl_container return_date|TCLU0790001 2026-10-20')
    expect(rows).not.toContain('cbm')
  })
})

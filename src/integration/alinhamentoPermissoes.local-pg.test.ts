import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Bloco 3 do plano docs/archive/plans/2026-09-23-alinhamento-apresentacao-docs-codigo.md:
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

const describeLocal = describeWithProbe(migration077Applied, 'migration077Applied')

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
    DELETE FROM public.audit_logs WHERE entity_type = 'voyage' AND entity_id = '${VOYAGE_ID}' AND field_name = 'baplie_import';
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

  it('substituição grava o autor da sessão, não o enviado pela tela, e registra o evento', () => {
    // A tela manda imported_by no corpo; com a importação aberta a todos, um
    // corpo com outro autor não pode forjar quem substituiu o Baplie.
    const forged = baplieRow.replace(DOCS_SUB, INACTIVE_SUB)
    const result = runAs(DOCS_SUB, `SELECT public.import_baplie_staging_transactional(${VOYAGE_ID}, '${forged}'::jsonb);`)
    expect(result.stderr).toBe('')
    expect(psql(`SELECT DISTINCT imported_by FROM public.baplie_containers WHERE voyage_id = ${VOYAGE_ID};`)).toBe(DOCS_SUB)
    expect(psql(`SELECT old_value || '>' || new_value || '|' || changed_by || '|' || justification FROM public.audit_logs
      WHERE entity_type = 'voyage' AND entity_id = '${VOYAGE_ID}' AND field_name = 'baplie_import' ORDER BY id DESC LIMIT 1;`))
      .toBe(`1>1|${DOCS_SUB}|Baplie substituído`)
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

const describe078 = describeWithProbe(migration078Applied, 'migration078Applied')

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

const describe079 = describeWithProbe(migration079Applied, 'migration079Applied')

describe079('079 — Histórico do B/L mostra mudanças nos containers', () => {
  const BL_ID = 'BL079LOCALPG'
  const USER = '77777777-0000-4000-8000-000000000079'

  function clean() {
    psql(`
      SET session_replication_role = replica;
      DELETE FROM public.audit_logs WHERE entity_type IN ('bl_container', 'bl_containers') AND entity_id IN (SELECT id::text FROM public.bl_containers WHERE bl_id = '${BL_ID}');
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

  it('edição com justificativa aparece uma vez só, com o motivo', () => {
    // update_container_demurrage_dates grava o evento semântico 'bl_container'
    // com justificativa e dispara o gatilho por coluna na mesma transação.
    const result = runAs(USER, `SELECT public.update_container_demurrage_dates(
      (SELECT id FROM public.bl_containers WHERE bl_id = '${BL_ID}'), '2026-10-14', '2026-10-25', NULL, 'Cliente devolveu no dia 25');`)
    expect(result.stderr).toBe('')
    const rows = psql(`
      BEGIN;
      SELECT set_config('request.jwt.claim.sub', '${USER}', true);
      SELECT field_name || ' ' || coalesce(justification, '-') FROM public.bl_timeline('${BL_ID}', 50, 0)
      WHERE new_value = '2026-10-25';
      COMMIT;
    `)
    expect(rows.split('\n').filter((line) => line.startsWith('return_date'))).toEqual(['return_date Cliente devolveu no dia 25'])
  })
})

function migration133Applied() {
  if (!enabled) return false
  try {
    return psql(`SELECT position('bl_created' IN prosrc) > 0 FROM pg_proc WHERE proname = 'bl_timeline';`) === 't'
  } catch {
    return false
  }
}

const describe133 = describeWithProbe(migration133Applied, 'migration133Applied')

describe133('133 — Histórico do B/L sem alterações fictícias da criação', () => {
  const BL_ID = 'BL122LOCALPG'
  const USER = '77777777-0000-4000-8000-000000000122'

  function clean() {
    psql(`
      SET session_replication_role = replica;
      DELETE FROM public.audit_logs WHERE entity_type = 'bl' AND entity_id = '${BL_ID}';
      DELETE FROM public.bls WHERE id = '${BL_ID}';
      DELETE FROM public.voyages WHERE id = 12293;
      DELETE FROM public.vessels WHERE id = 12292;
      DELETE FROM public.carriers WHERE id = 12291;
      DELETE FROM public.user_profiles WHERE id = '${USER}';
      DELETE FROM auth.users WHERE id = '${USER}';
      SET session_replication_role = origin;
    `)
  }

  beforeAll(() => {
    clean()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${USER}', 'ops-122@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${USER}', 'Operacao 122', 'equipamentos', true);
    `)
    psql(`
      INSERT INTO public.carriers (id, name) VALUES (12291, 'Carrier 122');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (12292, 'Vessel 122', 12291);
      INSERT INTO public.voyages (id, vessel_id, voyage_number) VALUES (12293, 12292, 'V122');
    `)
    // Como a importação: cria o B/L e grava o gate de revisão na mesma transação.
    psql(`
      BEGIN;
      INSERT INTO public.bls (id, voyage_id) VALUES ('${BL_ID}', 12293);
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, justification)
      VALUES ('bl', '${BL_ID}', 'review_status', 'ok', 'pending_review', 'Gate canonico aplicado apos importacao');
      COMMIT;
    `)
    // Alteração real, em outra transação.
    psql(`
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, justification)
      VALUES ('bl', '${BL_ID}', 'ce_mercante', '', '122600000000001', 'Importacao CE Mercante');
    `)
  })
  afterAll(clean)

  it('troca o ruído da criação por um evento "B/L criado" e mantém a alteração real', () => {
    const rows = psql(`
      BEGIN;
      SELECT set_config('request.jwt.claim.sub', '${USER}', true);
      SELECT field_name FROM public.bl_timeline('${BL_ID}', 50, 0);
      COMMIT;
    `)
    const fields = rows.split('\n').filter((line) => ['review_status', 'ce_mercante', 'bl_created'].includes(line))
    expect(fields).toEqual(['ce_mercante', 'bl_created'])
  })
})

// O bloco da migration 080 (escala de exportação removida por qualquer
// Departamento) saiu na Etapa 12 do plano de correção das importações: a
// política `voyage_export_schedules_delete_active_global` não existe mais no
// replay, e a sonda pulava o bloco em silêncio.

function migration081Applied() {
  if (!enabled) return false
  try {
    return psql(`SELECT position('administrativo' IN prosrc) > 0 FROM pg_proc WHERE proname = '_add_demurrage_dispute_message_impl_20260920';`) === 't'
  } catch {
    return false
  }
}

const describe081 = describeWithProbe(migration081Applied, 'migration081Applied')

describe081('081 — Administrativo responde disputa de Demurrage', () => {
  const ADMIN = '77777777-0000-4000-8000-000000000081'
  const DOCS = '77777777-0000-4000-8000-000000000082'
  const CUSTOMER = 7810
  const BL_ID = 'BL081LOCALPG'

  function clean() {
    psql(`
      SET session_replication_role = replica;
      DELETE FROM public.portal_notifications WHERE customer_id = ${CUSTOMER};
      DELETE FROM public.demurrage_dispute_messages WHERE dispute_id IN (SELECT d.id FROM public.demurrage_disputes d WHERE d.customer_id = ${CUSTOMER});
      DELETE FROM public.demurrage_disputes WHERE customer_id = ${CUSTOMER};
      DELETE FROM public.demurrage_invoices WHERE doc_number = 'DEM-081';
      DELETE FROM public.bls WHERE id = '${BL_ID}';
      DELETE FROM public.customer_portal_accounts WHERE customer_id = ${CUSTOMER};
      DELETE FROM public.customers WHERE id = ${CUSTOMER};
      DELETE FROM public.voyages WHERE id = 7813;
      DELETE FROM public.vessels WHERE id = 7812;
      DELETE FROM public.carriers WHERE id = 7811;
      DELETE FROM public.user_profiles WHERE id IN ('${ADMIN}', '${DOCS}');
      DELETE FROM auth.users WHERE id IN ('${ADMIN}', '${DOCS}');
      SET session_replication_role = origin;
    `)
  }

  beforeAll(() => {
    clean()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${ADMIN}', 'adm-081@example.test'), ('${DOCS}', 'docs-081@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${ADMIN}', 'Administrativo 081', 'administrativo', true),
        ('${DOCS}', 'Documentação 081', 'documentacao', true);
      INSERT INTO public.carriers (id, name) VALUES (7811, 'Carrier 081');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (7812, 'Vessel 081', 7811);
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (7813, 7812, 'V081', 'active');
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${CUSTOMER}, '61981000000104', 'Cliente 081');
      INSERT INTO public.bls (id, voyage_id, customer_id) VALUES ('${BL_ID}', 7813, ${CUSTOMER});
      INSERT INTO public.demurrage_invoices (doc_number, bl_id, customer_id, total_usd, status) VALUES ('DEM-081', '${BL_ID}', ${CUSTOMER}, 100, 'issued');
      INSERT INTO public.demurrage_disputes (demurrage_invoice_id, customer_id, state, next_responder, subject, opened_by)
        SELECT id, ${CUSTOMER}, 'aberta', 'equipamentos', 'Data de devolução', 'cliente' FROM public.demurrage_invoices WHERE doc_number = 'DEM-081';
    `)
  })
  afterAll(clean)

  const disputeId = () => psql(`SELECT id FROM public.demurrage_disputes WHERE customer_id = ${CUSTOMER};`)

  it('Documentação continua sem responder', () => {
    const result = runAs(DOCS, `SELECT public.add_demurrage_dispute_message(${disputeId()}, 'teste', 'cliente');`)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Apenas Equipamentos ou Administrativo')
  })

  it('Administrativo responde, a mensagem mostra o autor e o Cliente é avisado', () => {
    const result = runAs(ADMIN, `SELECT public.add_demurrage_dispute_message(${disputeId()}, 'Conferimos com o terminal.', 'cliente');`)
    expect(result.stderr).toBe('')
    expect(psql(`SELECT author_type FROM public.demurrage_dispute_messages WHERE dispute_id = ${disputeId()};`)).toBe('administrativo')
    expect(psql(`SELECT message FROM public.portal_notifications WHERE customer_id = ${CUSTOMER} AND type = 'dispute_responded';`))
      .toBe('Administrativo respondeu à sua disputa.')
  })
})

function migration082Applied() {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_proc WHERE proname = 'apply_ce_mercante_rows_atomic';`) === '1'
  } catch {
    return false
  }
}

const describe082 = describeWithProbe(migration082Applied, 'migration082Applied')

describe082('082 — CE Mercante por planilha tudo ou nada', () => {
  const USER = '77777777-0000-4000-8000-000000000820'
  const BL_A = 'BL082A'
  const BL_B = 'BL082B'
  const BL_C = 'BL082C'

  function clean() {
    psql(`
      SET session_replication_role = replica;
      DELETE FROM public.bls WHERE id IN ('${BL_A}', '${BL_B}', '${BL_C}');
      DELETE FROM public.audit_logs WHERE (entity_type = 'bl' AND entity_id IN ('${BL_A}', '${BL_B}', '${BL_C}'))
        OR (entity_type IN ('voyage', 'voyages') AND entity_id = '7823');
      DELETE FROM public.import_pending_effects WHERE entity_id IN ('${BL_A}', '${BL_B}', '${BL_C}');
      DELETE FROM public.voyage_route_ce_master WHERE voyage_id = 7823;
      DELETE FROM public.manifestos_mercante WHERE voyage_id = 7823;
      DELETE FROM public.voyages WHERE id = 7823;
      DELETE FROM public.vessels WHERE id = 7822;
      DELETE FROM public.carriers WHERE id = 7821;
      DELETE FROM public.user_profiles WHERE id = '${USER}';
      DELETE FROM auth.users WHERE id = '${USER}';
      SET session_replication_role = origin;
    `)
  }

  beforeAll(() => {
    clean()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${USER}', 'docs-082@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${USER}', 'Documentação 082', 'documentacao', true);
      INSERT INTO public.carriers (id, name) VALUES (7821, 'Carrier 082');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (7822, 'Vessel 082', 7821);
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (7823, 7822, 'V082', 'active');
      INSERT INTO public.bls (id, voyage_id, pol, pod) VALUES
        ('${BL_A}', 7823, 'CNNSA', 'BRVIX'), ('${BL_B}', 7823, 'CNNSA', 'BRVIX'), ('${BL_C}', 7823, 'CNSHA', 'BRVIX');
    `)
  })
  afterAll(clean)

  const call = (rows: string, numero = 'M082000000001') =>
    runAs(USER, `SELECT public.apply_ce_mercante_rows_atomic('${rows}'::jsonb, '${USER}'::uuid, 'bls', '${numero}', 7823);`)
  const payloadOf = (stdout: string) => JSON.parse(stdout.trim().split('\n').find((line) => line.startsWith('{')) ?? '{}')
  const manifestoOf = (bl: string) => psql(`SELECT coalesce(m.numero, '') FROM public.bls b LEFT JOIN public.manifestos_mercante m ON m.id = b.manifesto_mercante_id WHERE b.id = '${bl}';`)

  it('uma linha inválida desfaz a linha válida do mesmo lote', () => {
    const result = call(JSON.stringify([
      { row: 2, bl_id: BL_A, ce: '152608200000001' },
      { row: 3, bl_id: 'BL082-NAO-EXISTE', ce: '152608200000002' },
    ]))
    expect(result.stderr).toBe('')
    const payload = JSON.parse(result.stdout.trim().split('\n').find((line) => line.startsWith('{')) ?? '{}')
    expect(payload.ok).toBe(false)
    expect(payload.errors).toHaveLength(1)
    expect(payload.errors[0].row).toBe(3)
    expect(psql(`SELECT coalesce(ce_mercante, '') FROM public.bls WHERE id = '${BL_A}';`)).toBe('')
  })

  it('lote todo válido grava todas as linhas', () => {
    const result = call(JSON.stringify([
      { row: 2, bl_id: BL_A, ce: '152608200000001' },
      { row: 3, bl_id: BL_B, ce: '152608200000002' },
    ]))
    expect(result.stderr).toBe('')
    expect(psql(`SELECT count(*) FROM public.bls WHERE id IN ('${BL_A}', '${BL_B}') AND ce_mercante IS NOT NULL;`)).toBe('2')
    // 164: o manifesto informado é criado na rota dos B/Ls e vinculado na mesma transação
    expect(manifestoOf(BL_A)).toBe('M082000000001')
    expect(psql(`SELECT voyage_id || ' ' || pol || ' ' || pod || ' ' || natureza FROM public.manifestos_mercante WHERE numero = 'M082000000001';`))
      .toBe('7823 CNNSA BRVIX carga')
  })

  it('164 — sem número de manifesto nada é gravado', () => {
    const payload = payloadOf(call(JSON.stringify([{ row: 2, bl_id: BL_C, ce: '152608200000003' }]), ' ').stdout)
    expect(payload.ok).toBe(false)
    expect(payload.errors[0].message).toMatch(/Manifesto Mercante/)
    expect(psql(`SELECT coalesce(ce_mercante, '') FROM public.bls WHERE id = '${BL_C}';`)).toBe('')
  })

  it('164 — B/Ls de rotas diferentes na mesma planilha são recusados sem gravar CE nem manifesto', () => {
    const payload = payloadOf(call(JSON.stringify([
      { row: 2, bl_id: BL_A, ce: '152608200000001' },
      { row: 3, bl_id: BL_C, ce: '152608200000003' },
    ]), 'M082000000002').stdout)
    expect(payload.ok).toBe(false)
    expect(payload.errors[0].message).toMatch(/mais de uma viagem ou rota/)
    expect(psql(`SELECT coalesce(ce_mercante, '') FROM public.bls WHERE id = '${BL_C}';`)).toBe('')
    expect(psql(`SELECT count(*) FROM public.manifestos_mercante WHERE numero = 'M082000000002';`)).toBe('0')
  })

  it('164 — número já usado em outra rota é recusado; outro número na rota cria um segundo manifesto', () => {
    const reused = payloadOf(call(JSON.stringify([{ row: 2, bl_id: BL_C, ce: '152608200000003' }]), 'M082000000001').stdout)
    expect(reused.ok).toBe(false)
    expect(reused.errors[0].message).toMatch(/outra viagem, rota ou natureza/)
    expect(psql(`SELECT coalesce(ce_mercante, '') FROM public.bls WHERE id = '${BL_C}';`)).toBe('')

    const second = payloadOf(call(JSON.stringify([{ row: 2, bl_id: BL_C, ce: '152608200000003' }]), 'M082000000003').stdout)
    expect(second.ok).toBe(true)
    expect(manifestoOf(BL_C)).toBe('M082000000003')
  })

  // 181 (ADR 0078, item 7): outro número na planilha move o B/L só com
  // confirmação e motivo na prévia.
  it('181 — planilha com outro número só move o B/L com confirmação e motivo', () => {
    const payload = payloadOf(call(JSON.stringify([{ row: 2, bl_id: BL_A, ce: '152608200000001' }]), 'M082000000004').stdout)
    expect(payload.ok).toBe(false)
    expect(payload.needs_confirmation).toBe(true)
    expect(payload.errors[0].message).toMatch(/confirme na prévia, com motivo/)
    expect(manifestoOf(BL_A)).toBe('M082000000001')
    expect(psql(`SELECT count(*) FROM public.manifestos_mercante WHERE numero = 'M082000000004';`)).toBe('0')

    const confirmed = payloadOf(runAs(USER, `SELECT public.apply_ce_mercante_rows_atomic('${JSON.stringify([{ row: 2, bl_id: BL_A, ce: '152608200000001' }])}'::jsonb, '${USER}'::uuid, 'bls', 'M082000000004', 7823, true, 'Manifesto reemitido pela Receita (082)');`).stdout)
    expect(confirmed.ok).toBe(true)
    expect(manifestoOf(BL_A)).toBe('M082000000004')
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_id = '${BL_A}' AND field_name = 'manifesto_mercante' AND old_value = 'M082000000001' AND new_value = 'M082000000004';`)).toBe('1')
  })
})

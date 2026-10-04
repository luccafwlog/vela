import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'
import type { PortalInformation, ReturnGuidance } from '../services/portalInformation'

const describeLocal = process.env.LOCAL_PG_INTEGRATION === '1' ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const admin = '00000000-0000-0000-0000-000000134001'
const equipment = '00000000-0000-0000-0000-000000134002'
const inactive = '00000000-0000-0000-0000-000000134003'
const portal = '00000000-0000-0000-0000-000000134004'
const operations = '00000000-0000-0000-0000-000000134005'
const depotA = '00000000-0000-0000-0000-000000134011'
const depotB = '00000000-0000-0000-0000-000000134012'
const depotOther = '00000000-0000-0000-0000-000000134013'
const customer = 9134001
const customerOther = 9134002
const voyage = 9134001
const unit = 9134001
const shared = 9134002
const foreign = 9134003
const unreleased = 9134004
const soc = 9134005
const noRate = 9134006
const lateLinked = 9134007
const ids = [admin, equipment, inactive, portal, operations]
function quote(value: unknown) { return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb` }
function sql(statement: string) {
  return execFileSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', databaseUrl, '-c', statement], { encoding: 'utf8' }).trim()
}
function as(user: string, statement: string, rollback = false) {
  return spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${user}'; ${statement} ${rollback ? 'ROLLBACK' : 'COMMIT'};`], { encoding: 'utf8' })
}
function call<T>(user: string, statement: string): T {
  const result = as(user, statement)
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout.trim().split('\n').filter(line => /^[{[]/.test(line)).at(-1) ?? 'null') as T
}
function rollbackRead<T>(statement: string): T {
  const output = sql(`BEGIN; SET LOCAL request.jwt.claim.sub='${admin}'; ${statement} ROLLBACK;`)
  return JSON.parse(output.split('\n').filter(line => /^[{[]/.test(line)).at(-1) ?? 'null') as T
}
function save(user: string, kind: string, data: Record<string, unknown>, rollback = false) {
  const result = as(user, `SELECT public.internal_save_portal_information('${kind}', ${quote(data)});`, rollback)
  expect(result.status, result.stderr).toBe(0)
}
function guidance(container = unit) { return call<ReturnGuidance>(portal, `SELECT public.portal_get_return_guidance(${container});`) }
function indicate(depots: string[], user = equipment) {
  const result = as(user, `SELECT public.set_container_return_instruction(${unit}, ARRAY[${depots.map(id => `'${id}'`).join(',')}]::uuid[], 'motivo interno secreto');`)
  expect(result.status, result.stderr).toBe(0)
}
function metadata(depot: string, published = true) {
  return { id: depot, ports: [depot === depotOther ? 'BRSSZ' : ' brvix '], address: 'Endereço de teste', opening_hours: '8–17', emails: ['depot@example.test'], phones: ['123'], scheduling_url: 'https://example.test/agenda', instructions: 'Agende a devolução', restrictions: 'Sem carga', published }
}
function cleanup() {
  // Fixtures only, on the explicitly enabled disposable database; disabling
  // triggers avoids append-only/audit deletion guards during teardown.
  sql(`SET session_replication_role=replica;
    DO $$ BEGIN IF to_regclass('public.container_return_instruction_groups') IS NOT NULL THEN DELETE FROM public.container_return_instruction_groups WHERE voyage_id=${voyage}; END IF; IF to_regclass('public.container_return_instructions') IS NOT NULL THEN DELETE FROM public.container_return_instructions WHERE container_id BETWEEN 9134001 AND 9134007; END IF; IF to_regclass('public.port_agents') IS NOT NULL THEN DELETE FROM public.port_agents WHERE name='Info134 agent'; END IF; IF to_regclass('public.portal_information_contacts') IS NOT NULL THEN DELETE FROM public.portal_information_contacts WHERE key='info134'; END IF; END $$;
    DELETE FROM public.bl_containers WHERE bl_id LIKE 'INFO134-%';
    DELETE FROM public.bls WHERE id LIKE 'INFO134-%';
    DELETE FROM public.customer_demurrage_agreements WHERE customer_id IN (${customer},${customerOther});
    DELETE FROM public.demurrage_rates WHERE id=9134001;
    DELETE FROM public.customer_portal_accounts WHERE customer_id=${customer};
    DELETE FROM public.customers WHERE id IN (${customer},${customerOther});
    DELETE FROM public.voyages WHERE id=${voyage}; DELETE FROM public.vessels WHERE id=${voyage}; DELETE FROM public.carriers WHERE id=${voyage};
    DELETE FROM public.depots WHERE id IN ('${depotA}','${depotB}','${depotOther}');
    DELETE FROM public.user_profiles WHERE id IN (${ids.map(id => `'${id}'`).join(',')});
    DELETE FROM auth.users WHERE id IN (${ids.map(id => `'${id}'`).join(',')});`)
}

describeLocal('Portal information — executed PostgreSQL authorization and return rules', () => {
  beforeAll(() => {
    cleanup()
    sql(`INSERT INTO auth.users(id,email) VALUES ${ids.map((id, i) => `('${id}','info134-${i}@example.test')`).join(',')};
      INSERT INTO public.user_profiles(id,full_name,role,active) VALUES
       ('${admin}','Info admin','administrativo',true),('${equipment}','Info equipment','equipamentos',true),
       ('${inactive}','Info inactive','administrativo',false),('${operations}','Info operations','operacoes',true);
      INSERT INTO public.customers(id,cnpj_cpf,name) VALUES (${customer},'${syntheticCnpj(13401)}','Info A'),(${customerOther},'${syntheticCnpj(13402)}','Info B');
      INSERT INTO public.customer_portal_accounts(customer_id,active,auth_user_id,provisioning_decision,account_situation,recovery_email,portal_email,login_cnpj)
       VALUES(${customer},true,'${portal}','aprovado_para_provisionar','ativo','info134@example.test','info134@example.test','${syntheticCnpj(13401)}') ON CONFLICT(customer_id) DO UPDATE SET active=true, auth_user_id=EXCLUDED.auth_user_id, provisioning_decision=EXCLUDED.provisioning_decision, account_situation=EXCLUDED.account_situation, recovery_email=EXCLUDED.recovery_email, portal_email=EXCLUDED.portal_email, login_cnpj=EXCLUDED.login_cnpj;
      INSERT INTO public.carriers(id,name) VALUES(${voyage},'Info134 carrier');
      INSERT INTO public.vessels(id,name,carrier_id) VALUES(${voyage},'Info134 vessel',${voyage});
      INSERT INTO public.voyages(id,vessel_id,voyage_number,status) VALUES(${voyage},${voyage},'INFO134','active');
      INSERT INTO public.depots(id,code,name,active) VALUES('${depotA}','INFO134A','Depot A',true),('${depotB}','INFO134B','Depot B',true),('${depotOther}','INFO134C','Other port',true);
      SET session_replication_role=replica;
      INSERT INTO public.bls(id,voyage_id,customer_id,cargo_mode,pod,ce_mercante) VALUES
       ('INFO134-A',${voyage},${customer},'container',' brvix ','CE134A'),('INFO134-SHARED',${voyage},${customerOther},'container','BRVIX','CE134B'),
       ('INFO134-HIDDEN',${voyage},${customer},'container','BRVIX',NULL),('INFO134-LATE',${voyage},${customer},'container','BRVIX','CE134N');
      INSERT INTO public.bl_containers(id,bl_id,container_number,type,discharge_date,ownership) VALUES
       (${unit},'INFO134-A','INFU1340001','20DV','2026-09-01','COC'),(${shared},'INFO134-SHARED','INFU1340001','20DV','2026-09-01','COC'),
       (${foreign},'INFO134-SHARED','INFU1340003','20DV','2026-09-01','COC'),(${unreleased},'INFO134-HIDDEN','INFU1340004','20DV','2026-09-01','COC'),
       (${soc},'INFO134-A','INFU1340005','20DV','2026-09-01','SOC'),(${noRate},'INFO134-A','INFU1340006','45HC','2026-09-01','COC');
      INSERT INTO public.demurrage_rates(id,container_type,free_days,p1_day_from,p1_day_to,p1_usd,p2_day_from,p2_usd,valid_from,notes)
       VALUES(9134001,'20DV',7,8,14,20,15,40,'2026-01-01','nota interna tarifa');
      INSERT INTO public.customer_demurrage_agreements(customer_id,free_days,valid_from,notes) VALUES(${customer},31,'2026-01-01','nota interna acordo');
      SET session_replication_role=origin;`)
    if (sql("SELECT to_regprocedure('public.portal_get_information()') IS NOT NULL") === 't') {
      save(admin, 'depot', metadata(depotA)); save(equipment, 'depot', metadata(depotB)); save(admin, 'depot', metadata(depotOther))
    }
  })
  afterAll(cleanup)

  it('installs authenticated RPCs and denies direct customer table access', () => {
    expect(sql("SELECT to_regprocedure('public.portal_get_information()') IS NOT NULL")).toBe('t')
    for (const table of ['depot_portal_information', 'port_agents', 'portal_information_contacts', 'carrier_portal_information', 'container_return_instructions', 'container_return_instruction_groups']) {
      const result = as(portal, `SELECT count(*) FROM public.${table};`, true)
      if (result.status === 0) expect(result.stdout.trim()).toBe('0')
      else expect(result.stderr).toContain('42501')
    }
  })
  it.each([
    ['missing actor', '', ''],
    ['inactive account', `UPDATE public.customer_portal_accounts SET active=false WHERE customer_id=${customer};`, portal],
    ['deactivated customer', `UPDATE public.customers SET deactivated_at=now() WHERE id=${customer};`, portal],
    ['revoked credentials without iat', `UPDATE public.customer_portal_accounts SET credentials_revoked_at=now() WHERE customer_id=${customer};`, portal],
    ['revoked credentials with old iat', `UPDATE public.customer_portal_accounts SET credentials_revoked_at=now() WHERE customer_id=${customer}; SET LOCAL request.jwt.claims='{"iat":1}';`, portal],
    ['revoked credentials with malformed iat', `UPDATE public.customer_portal_accounts SET credentials_revoked_at=now() WHERE customer_id=${customer}; SET LOCAL request.jwt.claims='{"iat":"invalid"}';`, portal],
  ])('rejects information and return reads with %s', (_name, prepare, actor) => {
    for (const statement of ['SELECT public.portal_get_information();', `SELECT public.portal_get_return_guidance(${unit});`]) {
      const result = spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-d', databaseUrl, '-c',
        `BEGIN; SET LOCAL session_replication_role=replica; ${prepare} SET LOCAL session_replication_role=origin; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${actor}'; ${statement} ROLLBACK;`], { encoding: 'utf8' })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('28000')
    }
  })

  it('general rule includes all published active depots of normalized POD', () => {
    indicate([])
    expect(guidance()).toMatchObject({ status: 'general' })
    expect(guidance().depots.map(d => d.id)).toEqual(expect.arrayContaining([depotA, depotB]))
    expect(guidance().depots.map(d => d.id)).not.toContain(depotOther)
    expect(guidance().depots.every(d => d.ports.includes('BRVIX'))).toBe(true)
  })
  it('specific single/multiple choices restrict the list and removal restores general', () => {
    indicate([]); const generalIds = guidance().depots.map(d => d.id)
    indicate([depotA]); expect(guidance().depots.map(d => d.id)).toEqual([depotA])
    indicate([depotA, depotB]); expect(guidance()).toMatchObject({ status: 'specific' }); expect(guidance().depots).toHaveLength(2)
    indicate([]); expect(guidance().status).toBe('general'); expect(guidance().depots.map(d => d.id)).toEqual(generalIds)
  })
  it('unpublished or inactive indicated depots never fall back to general', () => {
    indicate([depotA]); save(admin, 'depot', metadata(depotA, false))
    expect(guidance()).toMatchObject({ status: 'unavailable', depots: [] })
    save(admin, 'depot', metadata(depotA)); sql(`UPDATE public.depots SET active=false WHERE id='${depotA}'`)
    expect(guidance()).toMatchObject({ status: 'unavailable', depots: [] })
    sql(`UPDATE public.depots SET active=true WHERE id='${depotA}'`)
  })
  it('SOC requires no return and foreign/unreleased units remain inaccessible', () => {
    expect(guidance(soc)).toMatchObject({ status: 'soc', depots: [] })
    for (const id of [foreign, unreleased]) expect(as(portal, `SELECT public.portal_get_return_guidance(${id});`).status).not.toBe(0)
  })
  it('shares instruction across BL records of the same container and voyage; hides its reason', () => {
    indicate([depotB])
    const internal = call<ReturnGuidance>(admin, `SELECT public.internal_get_return_guidance(${shared});`)
    expect(internal.depots.map(d => d.id)).toEqual([depotB])
    expect(guidance()).not.toHaveProperty('reason')
    expect(JSON.stringify(guidance())).not.toContain('motivo interno secreto')
    expect(sql(`SELECT count(*) FROM public.audit_logs WHERE changed_by IN ('${admin}','${equipment}') AND justification='motivo interno secreto'`)).not.toBe('0')
  })
  it('requires justification and resolves an instruction for a unit linked after indication', () => {
    const result = as(admin, `SELECT public.set_container_return_instruction(${unit},ARRAY['${depotA}']::uuid[],'   ');`, true)
    expect(result.status).not.toBe(0)
    expect(guidance().depots.map(d => d.id)).toEqual([depotB])
    sql(`SET session_replication_role=replica; INSERT INTO public.bl_containers(id,bl_id,container_number,type,ownership) VALUES(${lateLinked},'INFO134-LATE','INFU1340001','20DV','COC');`)
    expect(guidance(lateLinked)).toMatchObject({ status: 'specific' })
    expect(guidance(lateLinked).depots.map(d => d.id)).toEqual([depotB])
  })
  it('active admin/equipment maintain depots and indications; customer/inactive/operations cannot', () => {
    save(admin, 'depot', metadata(depotA)); save(equipment, 'depot', metadata(depotB)); indicate([depotA], admin); indicate([depotB], equipment)
    for (const user of [portal, inactive, operations]) {
      for (const statement of [`SELECT public.internal_save_portal_information('depot',${quote(metadata(depotA))});`, `SELECT public.set_container_return_instruction(${unit},ARRAY['${depotA}']::uuid[],'test');`]) {
        const result = as(user, statement, true); expect(result.status).not.toBe(0); expect(result.stderr).toContain('42501')
      }
    }
  })
  it('agents/contacts/tracking are admin-only and reject unsafe external URLs', () => {
    const examples = [ ['agent', { name: 'Info134 agent', ports: ['BRVIX'], emails: ['agent@example.test'], active: true }],
      ['contact', { key: 'containers', title: 'Info134 contact', emails: ['contact@example.test'], active: true }],
      ['carrier', { carrier_id: voyage, tracking_url: 'https://example.test/tracking' }] ] as const
    for (const [kind, data] of examples) {
      save(admin, kind, data, kind === 'contact')
      for (const user of [equipment, portal, inactive]) { const result = as(user, `SELECT public.internal_save_portal_information('${kind}',${quote(data)});`, true); expect(result.status).not.toBe(0); expect(result.stderr).toContain('42501') }
    }
    for (const url of ['javascript:alert(1)', 'https://user:password@example.test/', 'https:///', 'https://:443', 'https://example.test:abc', 'https://example.test:65536', 'https://999.999.999.999/', 'https://256.1.2/', 'https://9999999999/']) {
      expect(as(admin, `SELECT public.internal_save_portal_information('carrier',${quote({carrier_id: voyage, tracking_url: url})});`, true).status).not.toBe(0)
    }
  })
  it('inspection matches customer reads and global catalog does not expose internal notes/reasons', () => {
    const catalog = call<PortalInformation>(portal, 'SELECT public.portal_get_information();')
    expect(call<PortalInformation>(operations, `SELECT public.portal_inspect_get_information(${customer});`)).toEqual(catalog)
    expect(call<ReturnGuidance>(operations, `SELECT public.portal_inspect_get_return_guidance(${customer},${unit});`)).toEqual(guidance())
    expect(JSON.stringify(catalog)).not.toContain('nota interna')
    expect(JSON.stringify(catalog)).not.toContain('motivo interno secreto')
    expect(catalog.depots.some(d => d.id === depotA)).toBe(true)
    expect(as(portal, `SELECT public.portal_inspect_get_information(${customerOther});`).status).not.toBe(0)
    expect(as(inactive, 'SELECT public.internal_get_portal_information();').status).not.toBe(0)
  })

  it('return indication follows physical voyage identity across moves and renumbering', () => {
    const result = rollbackRead<Array<{ slot: string; guidance: ReturnGuidance }>>(`
      CREATE TEMP TABLE review_guidance(slot text, guidance jsonb);
      INSERT INTO public.voyages(id,vessel_id,voyage_number,status) VALUES(9234002,${voyage},'INFO134-MOVE','active');
      SELECT public.set_container_return_instruction(${unit},ARRAY['${depotA}']::uuid[],'Original voyage');
      UPDATE public.bls SET voyage_id=9234002 WHERE id='INFO134-A';
      INSERT INTO review_guidance VALUES('moved',public.internal_get_return_guidance(${unit}));
      SELECT public.set_container_return_instruction(${unit},ARRAY['${depotB}']::uuid[],'Other voyage');
      UPDATE public.bls SET voyage_id=${voyage} WHERE id='INFO134-A';
      INSERT INTO review_guidance VALUES('restored',public.internal_get_return_guidance(${unit}));
      UPDATE public.bl_containers SET container_number='INFU9234999' WHERE id=${unit};
      INSERT INTO review_guidance VALUES('renumbered',public.internal_get_return_guidance(${unit}));
      SELECT jsonb_agg(jsonb_build_object('slot',slot,'guidance',guidance) ORDER BY slot) FROM review_guidance;
    `)
    expect(result.find(row => row.slot === 'moved')!.guidance.status).toBe('general')
    expect(result.find(row => row.slot === 'restored')!.guidance.depots.map(depot => depot.id)).toEqual([depotA])
    expect(result.find(row => row.slot === 'renumbered')!.guidance.status).toBe('general')
  })
  it.each([
    ['unknown POD', `UPDATE public.bls SET pod=NULL WHERE id='INFO134-A';`],
    ['another POD', `UPDATE public.bls SET pod='BRSSZ' WHERE id='INFO134-SHARED';`],
    ['SOC ownership', `UPDATE public.bl_containers SET ownership='SOC',ownership_source='manual' WHERE id=${shared};`],
  ])('rejects a specific indication when a physical record has %s', (_name, change) => {
    const result = as(admin, `${change} SELECT public.set_container_return_instruction(${unit},ARRAY['${depotA}']::uuid[],'Invalid physical context');`, true)
    expect(result.status, `Accepted incompatible physical unit: ${change}`).not.toBe(0)
    expect(result.stderr).toContain('22023')
  })
  it('late-linked physical records return the same internal reason as the authoritative indication', () => {
    const result = rollbackRead<ReturnGuidance>(`
      SELECT public.set_container_return_instruction(${unit},ARRAY['${depotA}']::uuid[],'Reason shared with late link');
      SET LOCAL session_replication_role=replica;
      DELETE FROM public.container_return_instructions WHERE container_id=${lateLinked};
      DELETE FROM public.bl_containers WHERE id=${lateLinked};
      SET LOCAL session_replication_role=origin;
      INSERT INTO public.bl_containers(id,bl_id,container_number,type) VALUES(${lateLinked},'INFO134-LATE','INFU1340001','20DV');
      SELECT public.internal_get_return_guidance(${lateLinked});
    `)
    expect(result.reason).toBe('Reason shared with late link')
    expect(result.depots.map(depot => depot.id)).toEqual([depotA])
  })
  it('removing original BL records keeps the indication for a surviving late-linked physical record', () => {
    const result = rollbackRead<{ removal: { deleted: string[] }; guidance: ReturnGuidance }>(`
      SELECT public.set_container_return_instruction(${unit},ARRAY['${depotA}']::uuid[],'Physical guidance survives record removal');
      SET LOCAL session_replication_role=replica;
      DELETE FROM public.container_return_instructions WHERE container_id=${lateLinked};
      DELETE FROM public.bl_containers WHERE id=${lateLinked};
      SET LOCAL session_replication_role=origin;
      INSERT INTO public.bl_containers(id,bl_id,container_number,type) VALUES(${lateLinked},'INFO134-LATE','INFU1340001','20DV');
      UPDATE public.bls SET ce_mercante=NULL WHERE id IN ('INFO134-A','INFO134-SHARED');
      CREATE TEMP TABLE review_removal AS SELECT public.delete_records('container',ARRAY['${unit}','${shared}'],false,'Remove duplicate original records') result;
      SELECT jsonb_build_object('removal',(SELECT result FROM review_removal),'guidance',public.internal_get_return_guidance(${lateLinked}));
    `)
    expect(result.removal.deleted).toHaveLength(2)
    expect(result.guidance.status).toBe('specific')
    expect(result.guidance.depots.map(depot => depot.id)).toEqual([depotA])
  })

  it('voyage removal previews and removes physical return indications before the hard-delete guard', () => {
    const result = rollbackRead<{ preview: { items: Array<{ table: string }> }; removal: { deleted: string[] }; remaining: number }>(`
      INSERT INTO public.voyages(id,vessel_id,voyage_number,status) VALUES(9234002,${voyage},'INFO134-DELETE','active');
      SET LOCAL session_replication_role=replica;
      INSERT INTO public.bls(id,voyage_id,customer_id,cargo_mode,pod) VALUES('INFO134-DELETE',9234002,${customer},'container','BRVIX');
      INSERT INTO public.bl_containers(id,bl_id,container_number,type) VALUES(9234002,'INFO134-DELETE','INFU9234002','40GP');
      SET LOCAL session_replication_role=origin;
      SELECT public.set_container_return_instruction(9234002,ARRAY['${depotA}']::uuid[],'Return instruction before deletion');
      CREATE TEMP TABLE review_preview AS SELECT public.voyage_delete_preview(9234002) result;
      CREATE TEMP TABLE review_removal AS SELECT public.delete_records('voyage',ARRAY['9234002'],false,'Delete unused voyage') result;
      SELECT jsonb_build_object('preview',(SELECT result FROM review_preview),'removal',(SELECT result FROM review_removal),
        'remaining',(SELECT count(*) FROM public.container_return_instruction_groups WHERE voyage_id=9234002));
    `)
    expect(result.preview.items.some(item => item.table === 'container_return_instruction_groups')).toBe(true)
    expect(result.removal.deleted).toEqual(['9234002'])
    expect(result.remaining).toBe(0)
  })

  it('canonical tariff families choose their newest row consistently in Portal and authoritative calculation', () => {
    const result = rollbackRead<{ operation: Array<{ bl_id: string; containers: Array<{ id: number; free_time_days: number | null }> }>; catalog: PortalInformation; financial: { items: Array<{ free_days: number }> } }>(`
      SET LOCAL session_replication_role=replica;
      UPDATE public.demurrage_rates SET active=false;
      UPDATE public.customer_demurrage_agreements SET active=false WHERE customer_id=${customer};
      UPDATE public.bls SET free_time_override=NULL WHERE id='INFO134-A';
      UPDATE public.bl_containers SET type='40HC',discharge_date=CURRENT_DATE-25,return_date=CURRENT_DATE,demurrage_status='returned' WHERE id=${unit};
      INSERT INTO public.demurrage_rates(id,container_type,free_days,p1_day_from,p1_day_to,p1_usd,p2_day_from,p2_usd,valid_from,active)
        VALUES(9234001,'40GP',7,8,14,20,15,40,CURRENT_DATE-60,true),(9234002,'40HC',15,16,30,25,31,50,CURRENT_DATE-30,true);
      SET LOCAL session_replication_role=origin;
      SELECT jsonb_build_object('operation',public._portal_list_operation_bls_without_transshipment_core(${customer}),
        'catalog',public._portal_information_core(false),
        'financial',public._calculate_demurrage_invoice_authoritative('INFO134-A',ARRAY[${unit}]::bigint[],CURRENT_DATE));
    `)
    expect(result.operation.find(bl => bl.bl_id === 'INFO134-A')!.containers.find(container => container.id === unit)!.free_time_days).toBe(15)
    expect(result.catalog.demurrage_rates).toHaveLength(1)
    expect(result.catalog.demurrage_rates[0].free_days).toBe(15)
    expect(result.financial.items[0].free_days).toBe(15)
  })
  it('alias-only tariffs remain available to canonical and alias containers', () => {
    const result = rollbackRead<Array<{ bl_id: string; containers: Array<{ id: number; free_time_days: number | null }> }>>(`
      SET LOCAL session_replication_role=replica;
      UPDATE public.demurrage_rates SET active=false;
      UPDATE public.customer_demurrage_agreements SET active=false WHERE customer_id=${customer};
      UPDATE public.bls SET free_time_override=NULL WHERE id='INFO134-A';
      UPDATE public.bl_containers SET type='40GP' WHERE id=${unit};
      INSERT INTO public.demurrage_rates(id,container_type,free_days,p1_day_from,p1_day_to,p1_usd,p2_day_from,p2_usd,valid_from,active)
        VALUES(9234002,'40HC',15,16,30,25,31,50,CURRENT_DATE-30,true);
      SET LOCAL session_replication_role=origin;
      SELECT public._portal_list_operation_bls_without_transshipment_core(${customer});
    `)
    expect(result.find(bl => bl.bl_id === 'INFO134-A')!.containers.find(container => container.id === unit)!.free_time_days).toBe(15)
  })

  it('operation free time uses agreement, then BL override, and is null without any source', () => {
    const read = () => call<Array<{bl_id: string; containers: Array<{id: number; free_time_days: number | null}>}>>(portal, 'SELECT public.portal_list_operation_bls();').find(b => b.bl_id === 'INFO134-A')!.containers
    expect(read().find(c => c.id === unit)?.free_time_days).toBe(31)
    sql("UPDATE public.bls SET free_time_override=42 WHERE id='INFO134-A'")
    expect(read().find(c => c.id === unit)?.free_time_days).toBe(42)
    sql(`UPDATE public.bls SET free_time_override=NULL WHERE id='INFO134-A'; UPDATE public.customer_demurrage_agreements SET active=false WHERE customer_id=${customer};`)
    expect(read().find(c => c.id === unit)?.free_time_days).toBe(7)
    expect(read().find(c => c.id === noRate)?.free_time_days).toBeNull()
  })
})

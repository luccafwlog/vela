// Revisão final da PR 929 (migration 213): importação de B/L de container, de
// carga solta (Manifesto BB e B/L avulso PDF/DOCX) e Programação por planilha.
// Cada caso nasceu de uma reprodução em SQL da revisão e falha sem a 213:
//
// 1. B/L de container com Troca de Consignatário sem aceite gravava o
//    consignatário, o CNPJ, a razão social e o e-mail do arquivo.
// 2. Carga solta com CNPJ de consignatário não cadastrado trocava o Consignee
//    em silêncio, sem Troca de Consignatário.
// 4. Reimportação de carga solta com um item zerava o que o documento não traz.
// 5. B/L de container que muda de POD guardava a exceção de terminal do POD
//    antigo.
// 6. Carga solta que muda de POD desvinculava o Manifesto Mercante sem o
//    Histórico legível do gatilho da 207.
// 7. Dois arquivos de Programação com as mesmas Viagens em ordens diferentes
//    se travavam mutuamente (deadlock).
//
// Os casos 1 a 6 rodam numa transação desfeita no fim (fixture própria, nada
// fica gravado); a gravação concorrente do caso 7 precisa de dados gravados e
// limpa o que criou. As RPCs rodam como `authenticated`, com os payloads de
// `confirmBlFreightImport` (blFreightImport.ts) e `importBreakbulkManifest`
// (breakbulkImport.ts).
//
// Namespace exclusivo: ids 99213xxx, CNPJ syntheticCnpj(213001..213009),
// B/Ls 'R213-*', portos BRR3P/BRR3Q, usuário ...0213001 e ...0213002.
import { spawn } from 'node:child_process'
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000213001'
const alfa = { id: 99213001, cnpj: syntheticCnpj(213001), name: 'R213 ALFA LTDA', email: 'r213-alfa@example.test' }
const beta = { id: 99213002, cnpj: syntheticCnpj(213002), name: 'R213 BETA SA', email: 'r213-beta@example.test' }
const unregistered = { cnpj: syntheticCnpj(213009), name: 'R213 GAMA COMERCIO SA', email: 'r213-gama@example.test' }
const voyageId = 99213021
const portP = { id: 99213031, code: 'BRR3P' }
const portQ = { id: 99213032, code: 'BRR3Q' }
const depotId = '00000000-0000-0000-0000-0000002130d1'
const manifestoId = '00000000-0000-0000-0000-0000002130a1'

const fixture = `
  INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'r213@example.test');
  INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${actorId}', 'R213 Operador', 'administrativo', true);
  INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
    (${alfa.id}, '${alfa.cnpj}', '${alfa.name}'),
    (${beta.id}, '${beta.cnpj}', '${beta.name}');
  INSERT INTO public.carriers (id, name) VALUES (99213010, 'R213 Carrier');
  INSERT INTO public.vessels (id, name, carrier_id) VALUES (99213011, 'R213 NAVIO', 99213010);
  INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, 99213011, 'R213A', 'active');
  INSERT INTO public.ports (id, name, locode) VALUES (${portP.id}, 'R213 Porto P', '${portP.code}'), (${portQ.id}, 'R213 Porto Q', '${portQ.code}');
  INSERT INTO public.depots (id, code, name, tipo, port_id) VALUES ('${depotId}', 'R213T', 'R213 Terminal P', 'terminal_portuario', ${portP.id});
  SET LOCAL request.jwt.claim.sub = '${actorId}';
  SET LOCAL request.jwt.claim.role = 'authenticated';
`

/**
 * Roda o cenário numa transação desfeita no fim. As linhas `chave|json` que o
 * cenário seleciona voltam num mapa; o resto da saída é ignorado.
 */
function scenario(sql: string): Record<string, unknown> {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-f', '-'], {
    input: `BEGIN;\n${fixture}\n${sql}\nROLLBACK;\n`,
    encoding: 'utf8',
  })
  if (run.status !== 0) throw new Error(run.stderr.split('\n').filter((line) => /ERROR|CONTEXT|DETAIL/.test(line)).join('\n'))
  const output = run.stdout
  const result: Record<string, unknown> = {}
  for (const line of output.split('\n')) {
    const match = /^([a-z_]+)\|(.*)$/.exec(line.trim())
    if (match) result[match[1]] = JSON.parse(match[2])
  }
  return result
}

const json = (value: unknown) => `$json$${JSON.stringify(value)}$json$::jsonb`

/** Chamada como o operador; a leitura seguinte volta ao dono. */
const asOperator = (sql: string) => `SET LOCAL ROLE authenticated;\n${sql}\nRESET ROLE;`

/** Libera o limite de importações por minuto (lote do próprio ator). */
const releaseRateLimit = `UPDATE public.import_batches SET uploaded_at = uploaded_at - interval '10 minutes' WHERE uploaded_by = '${actorId}';`

const blRow = (blId: string) => `
  SELECT 'bl|' || row_to_json(t)::text FROM (
    SELECT id, consignee, consignee_block, customer_id, manifest_customer_cnpj_cpf, manifest_customer_name,
           manifest_customer_email, customer_reconciliation_status, billing_hold_reason, pod, terminal_id, pod_port_id, manifesto_mercante_id
    FROM public.bls WHERE id = '${blId}'
  ) AS t;`

// ---------------------------------------------------------------- container

function containerLine(blId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: blId,
    voyage_id: voyageId,
    pol: 'CNSHA',
    pod: portP.code,
    consignee: alfa.name,
    consignee_block: `${alfa.name}\nCNPJ ${alfa.cnpj}`,
    customer_id: alfa.id,
    manifest_customer_cnpj_cpf: alfa.cnpj,
    manifest_customer_name: alfa.name,
    manifest_customer_email: alfa.email,
    customer_reconciliation_status: 'matched_document',
    containers: [{ container_number: 'MSCU1234565', type: '40HC', gross_weight_kg: 1000 }],
    ...overrides,
  }
}

/** Reimportação: mesmo contrato de `confirmBlFreightImport` (com Viagem, pelo wrapper de lote). */
function importContainer(lines: unknown[], key = 'import') {
  return asOperator(`
    SELECT '${key}|' || (public.import_bl_freight_with_metadata(
      ${json(lines)}, '${actorId}'::uuid,
      '{"filename":"r213.xlsx","voyage_id":${voyageId},"cargo_mode":"container"}'::jsonb
    )->'result')::text;
    DISCARD TEMP;`)
}

/** Sem o wrapper de lote: sem cálculo de taxas, o B/L fica sem financeiro. */
function importContainerWithoutCharges(lines: unknown[], key = 'import') {
  return asOperator(`
    SELECT '${key}|' || public.import_bl_freight_transactional(${json(lines)}, '${actorId}'::uuid)::text;
    DISCARD TEMP;`)
}

const betaFile = {
  consignee: beta.name,
  consignee_block: `${beta.name}\nCNPJ ${beta.cnpj}`,
  customer_id: beta.id,
  manifest_customer_cnpj_cpf: beta.cnpj,
  manifest_customer_name: beta.name,
  manifest_customer_email: beta.email,
  override_billing: true,
  remove_containers: [],
}

const unregisteredFile = {
  consignee: unregistered.name,
  consignee_block: `${unregistered.name}\nCNPJ ${unregistered.cnpj}`,
  customer_id: null,
  manifest_customer_cnpj_cpf: unregistered.cnpj,
  manifest_customer_name: unregistered.name,
  manifest_customer_email: unregistered.email,
  customer_reconciliation_status: 'missing_customer',
  customer_reconciliation_notes: 'Cliente nao encontrado na base cadastral.',
  billing_hold_reason: 'Aguardando reconciliacao de cliente antes do faturamento.',
  override_billing: true,
  remove_containers: [],
}

const keptAlfa = {
  consignee: alfa.name,
  consignee_block: `${alfa.name}\nCNPJ ${alfa.cnpj}`,
  customer_id: alfa.id,
  manifest_customer_cnpj_cpf: alfa.cnpj,
  manifest_customer_name: alfa.name,
  manifest_customer_email: alfa.email,
}

// ---------------------------------------------------------------- carga solta

function breakbulkLine(blId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: blId,
    voyage_id: voyageId,
    bb_machine_qty: 1,
    bb_packages_qty: 2,
    bb_packages_total: 2,
    bb_weight_ton: 5,
    shipper: 'R213 SHIPPER',
    consignee: alfa.name,
    notify_party: 'R213 NOTIFY',
    customer_id: alfa.id,
    manifest_customer_cnpj_cpf: alfa.cnpj,
    manifest_customer_name: alfa.name,
    manifest_customer_email: null,
    customer_reconciliation_status: 'matched_document',
    pol: 'CNSHA',
    pod: portP.code,
    cargo_description: 'EXCAVATOR R213',
    ncm_codes: [],
    bb_cbm: 12.5,
    review_status: 'ok',
    financial_status: 'pending',
    ...overrides,
  }
}

const breakbulkItem = (blId: string, overrides: Record<string, unknown> = {}) => ({
  bl_id: blId,
  item_description: 'EXCAVATOR R213',
  package_qty: 2,
  package_unit: 'UNITS',
  gross_weight_kg: 5000,
  cbm: 12.5,
  marks: 'R213/BRVIX',
  ...overrides,
})

function importBreakbulk(lines: unknown[], items: unknown[], key = 'import') {
  return `${releaseRateLimit}
  ${asOperator(`
    SELECT '${key}|' || (public.import_breakbulk_manifest_transactional(
      'r213.pdf', ${voyageId}, '${actorId}'::uuid, ${lines.length}, ${json(lines)}, ${json(items)}, '[]'::jsonb
    ) - 'invoice_reissues')::text;
    DISCARD TEMP;`)}`
}

const unregisteredBreakbulk = {
  consignee: unregistered.name,
  customer_id: null,
  manifest_customer_cnpj_cpf: unregistered.cnpj,
  manifest_customer_name: unregistered.name,
  customer_reconciliation_status: 'missing_customer',
  customer_reconciliation_notes: 'Cliente nao encontrado na base cadastral.',
  billing_hold_reason: 'Aguardando reconciliacao de cliente antes do faturamento.',
  review_status: 'pending_review',
}

describeLocal('Importação de B/L: revisão final da PR 929 (migration 213)', () => {
  describe('Troca de Consignatário no B/L de container', () => {
    it('sem aceite, o consignatário, o CNPJ, a razão social e o e-mail gravados ficam, e a troca volta no resultado', () => {
      const out = scenario(`
        ${importContainer([containerLine('R213-C1')], 'first')}
        ${importContainer([containerLine('R213-C1', { ...betaFile, relink_customer: false })])}
        ${blRow('R213-C1')}`)

      expect(out.bl).toMatchObject(keptAlfa)
      expect(out.import).toMatchObject({
        customer_relinks: [],
        customer_changes_ignored: [{ bl_id: 'R213-C1', customer_id: alfa.id, file_customer_id: beta.id, file_document: beta.cnpj }],
      })
    })

    it('com aceite, o B/L passa ao Cliente novo com o consignatário e o CNPJ do arquivo', () => {
      const out = scenario(`
        ${importContainer([containerLine('R213-C2')], 'first')}
        ${importContainer([containerLine('R213-C2', { ...betaFile, relink_customer: true })])}
        ${blRow('R213-C2')}`)

      expect(out.bl).toMatchObject({
        consignee: beta.name,
        consignee_block: betaFile.consignee_block,
        customer_id: beta.id,
        manifest_customer_cnpj_cpf: beta.cnpj,
        manifest_customer_name: beta.name,
        manifest_customer_email: beta.email,
      })
      expect(out.import).toMatchObject({ customer_changes_ignored: [], customer_relinks: [{ applied: true }] })
    })

    it('CNPJ de consignatário não cadastrado sem aceite também não troca o consignatário', () => {
      const out = scenario(`
        ${importContainerWithoutCharges([containerLine('R213-C3')], 'first')}
        ${importContainerWithoutCharges([containerLine('R213-C3', { ...unregisteredFile, relink_customer: false })])}
        ${blRow('R213-C3')}`)

      expect(out.bl).toMatchObject({ ...keptAlfa, customer_reconciliation_status: 'matched_document', billing_hold_reason: null })
      expect(out.import).toMatchObject({
        customer_changes_ignored: [{ bl_id: 'R213-C3', customer_id: alfa.id, file_customer_id: null, file_document: unregistered.cnpj }],
      })
    })

    it('com aceite e com financeiro, a troca é recusada e o consignatário gravado fica', () => {
      const out = scenario(`
        ${importContainer([containerLine('R213-C8')], 'first')}
        ${importContainer([containerLine('R213-C8', { ...unregisteredFile, relink_customer: true })])}
        ${blRow('R213-C8')}`)

      expect(out.bl).toMatchObject(keptAlfa)
      expect(out.import).toMatchObject({
        customer_changes_ignored: [],
        customer_relinks: [{ applied: false, blockers: ['Cadastre o Cliente de destino antes de trocar B/L faturado'] }],
      })
    })

    it('com aceite e sem financeiro, o B/L volta para a Reconciliação de Cliente com o consignatário do arquivo', () => {
      const out = scenario(`
        ${importContainerWithoutCharges([containerLine('R213-C4')], 'first')}
        ${importContainerWithoutCharges([containerLine('R213-C4', { ...unregisteredFile, relink_customer: true })])}
        ${blRow('R213-C4')}`)

      expect(out.bl).toMatchObject({
        consignee: unregistered.name,
        customer_id: null,
        customer_reconciliation_status: 'missing_customer',
        manifest_customer_cnpj_cpf: unregistered.cnpj,
        manifest_customer_name: unregistered.name,
      })
      expect(out.import).toMatchObject({ customer_changes_ignored: [], customer_relinks: [{ applied: true }] })
    })
  })

  describe('POD corrigido no B/L de container', () => {
    const withOverride = (blId: string) => `
      ${importContainer([containerLine(blId)], 'first')}
      ${asOperator(`SELECT public.set_bl_terminal_override('${blId}', '${depotId}', ${portP.id}, 'Exceção R213', '${actorId}'::uuid) IS NOT NULL;`)}`

    it('limpa a exceção de terminal do POD anterior, como na carga solta', () => {
      const out = scenario(`
        ${withOverride('R213-C5')}
        ${importContainer([containerLine('R213-C5', { pod: portQ.code, override_billing: true, remove_containers: [] })])}
        ${blRow('R213-C5')}
        SELECT 'audit|' || count(*)::text FROM public.audit_logs WHERE entity_id = 'R213-C5' AND field_name = 'terminal_id' AND new_value IS NULL;`)

      expect(out.bl).toMatchObject({ pod: portQ.code, terminal_id: null, pod_port_id: null })
      expect(out.audit).toBe(1)
    })

    it('B/L faturado com a confirmação de faturamento também limpa a exceção', () => {
      const out = scenario(`
        ${withOverride('R213-C6')}
        INSERT INTO public.charge_calculations (bl_id) VALUES ('R213-C6');
        ${importContainer([containerLine('R213-C6', { pod: portQ.code, override_billing: true, billing_impact: true, remove_containers: [] })])}
        ${blRow('R213-C6')}`)

      expect(out.bl).toMatchObject({ pod: portQ.code, terminal_id: null, pod_port_id: null })
    })

    it('o mesmo POD em outra grafia não mexe na exceção', () => {
      const out = scenario(`
        ${withOverride('R213-C7')}
        ${importContainer([containerLine('R213-C7', { pod: ` ${portP.code.toLowerCase()} `, override_billing: true, remove_containers: [] })])}
        ${blRow('R213-C7')}`)

      expect(out.bl).toMatchObject({ terminal_id: depotId, pod_port_id: portP.id })
    })
  })

  describe('Troca de Consignatário na carga solta', () => {
    it('CNPJ de consignatário não cadastrado sem aceite mantém o consignatário e volta no resultado', () => {
      const out = scenario(`
        ${importBreakbulk([breakbulkLine('R213-B1')], [], 'first')}
        ${importBreakbulk([breakbulkLine('R213-B1', unregisteredBreakbulk)], [])}
        ${blRow('R213-B1')}`)

      expect(out.bl).toMatchObject({
        consignee: alfa.name,
        customer_id: alfa.id,
        manifest_customer_cnpj_cpf: alfa.cnpj,
        manifest_customer_name: alfa.name,
        customer_reconciliation_status: 'matched_document',
      })
      expect(out.import).toMatchObject({
        unchanged_bl_ids: ['R213-B1'],
        customer_changes_ignored: [{ bl_id: 'R213-B1', customer_id: alfa.id, file_customer_id: null, file_document: unregistered.cnpj }],
      })
    })

    it('com aceite, o B/L volta para a Reconciliação de Cliente com o consignatário do arquivo', () => {
      const out = scenario(`
        ${importBreakbulk([breakbulkLine('R213-B2')], [], 'first')}
        ${importBreakbulk([breakbulkLine('R213-B2', { ...unregisteredBreakbulk, relink_customer: true })], [])}
        ${blRow('R213-B2')}`)

      expect(out.bl).toMatchObject({
        consignee: unregistered.name,
        customer_id: null,
        manifest_customer_cnpj_cpf: unregistered.cnpj,
        manifest_customer_name: unregistered.name,
        customer_reconciliation_status: 'missing_customer',
      })
      expect(out.import).toMatchObject({ customer_changes_ignored: [], customer_relinks: [{ bl_id: 'R213-B2', applied: true }] })
    })

    it('CNPJ igual ao do Cliente vinculado não é troca', () => {
      const out = scenario(`
        ${importBreakbulk([breakbulkLine('R213-B3', { manifest_customer_cnpj_cpf: null })], [], 'first')}
        ${importBreakbulk([breakbulkLine('R213-B3', { customer_id: null, consignee: 'R213 ALFA (grafia do armador)' })], [])}
        ${blRow('R213-B3')}`)

      expect(out.import).toMatchObject({ customer_changes_ignored: [] })
      expect(out.bl).toMatchObject({ customer_id: alfa.id, consignee: 'R213 ALFA (grafia do armador)' })
    })
  })

  describe('Item de carga solta reimportado de documento sem o valor', () => {
    const itemRow = (blId: string) => `
      SELECT 'item|' || row_to_json(t)::text FROM (
        SELECT item_description, package_qty::float8 AS package_qty, package_unit, gross_weight_kg::float8 AS gross_weight_kg,
               cbm::float8 AS cbm, marks
        FROM public.bl_breakbulk_items WHERE bl_id = '${blId}'
      ) AS t;
      SELECT 'bb|' || row_to_json(t)::text FROM (SELECT bb_cbm::float8 AS bb_cbm FROM public.bls WHERE id = '${blId}') AS t;`

    it('o valor que o documento não traz fica o gravado; o que ele traz é corrigido', () => {
      const out = scenario(`
        ${importBreakbulk([breakbulkLine('R213-B4')], [breakbulkItem('R213-B4')], 'first')}
        ${importBreakbulk(
          [breakbulkLine('R213-B4', { bb_cbm: null, bb_weight_ton: 6 })],
          [breakbulkItem('R213-B4', { item_description: '', package_qty: null, package_unit: null, gross_weight_kg: 6000, cbm: null, marks: null })],
        )}
        ${itemRow('R213-B4')}`)

      expect(out.item).toEqual({
        item_description: 'EXCAVATOR R213',
        package_qty: 2,
        package_unit: 'UNITS',
        gross_weight_kg: 6000,
        cbm: 12.5,
        marks: 'R213/BRVIX',
      })
      expect(out.bb).toEqual({ bb_cbm: 12.5 })
      expect(out.import).toMatchObject({ updated_bl_ids: ['R213-B4'] })
    })

    it('documento igual, sem os valores ausentes, não marca o B/L como corrigido', () => {
      const out = scenario(`
        ${importBreakbulk([breakbulkLine('R213-B5')], [breakbulkItem('R213-B5')], 'first')}
        ${importBreakbulk([breakbulkLine('R213-B5', { bb_cbm: null })], [breakbulkItem('R213-B5', { cbm: null, marks: null })])}
        ${itemRow('R213-B5')}`)

      expect(out.item).toMatchObject({ cbm: 12.5, marks: 'R213/BRVIX' })
      expect(out.import).toMatchObject({ unchanged_bl_ids: ['R213-B5'], updated_bl_ids: [] })
    })
  })

  it('carga solta que muda de POD desvincula o Manifesto Mercante pelo gatilho, com o Histórico legível', () => {
    const out = scenario(`
      ${importBreakbulk([breakbulkLine('R213-B6')], [], 'first')}
      INSERT INTO public.manifestos_mercante (id, voyage_id, pol, pod, numero, natureza, created_at, updated_at)
      VALUES ('${manifestoId}', ${voyageId}, 'CNSHA', '${portP.code}', '2132132132131', 'carga', now(), now());
      SET LOCAL session_replication_role = replica;
      UPDATE public.bls SET manifesto_mercante_id = '${manifestoId}' WHERE id = 'R213-B6';
      SET LOCAL session_replication_role = origin;
      ${importBreakbulk([breakbulkLine('R213-B6', { pod: portQ.code })], [])}
      ${blRow('R213-B6')}
      SELECT 'history|' || COALESCE(jsonb_agg(jsonb_build_object('field', field_name, 'old', old_value, 'new', new_value, 'why', justification)), '[]')::text
      FROM public.audit_logs WHERE entity_id = 'R213-B6' AND field_name IN ('manifesto_mercante', 'manifesto_mercante_id');`)

    expect(out.bl).toMatchObject({ pod: portQ.code, manifesto_mercante_id: null })
    expect(out.history).toEqual([{
      field: 'manifesto_mercante',
      old: '2132132132131',
      new: null,
      why: 'Desvínculo automático: o POL, o POD ou a Viagem do B/L mudou.',
    }])
  })
})

// ---------------------------------------------------------------- programação

const scheduleUser = '00000000-0000-0000-0000-000000213002'
const scheduleCarrier = 'R213 SCHEDULE CARRIER'
const voyageX = 99213041
const voyageY = 99213042

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function runAsync(sql: string): Promise<{ code: number | null; stderr: string }> {
  const child = spawn('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })
  return new Promise((resolve) => child.on('close', (code) => resolve({ code, stderr })))
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Espera a sessão do arquivo `tag` ficar parada numa trava de linha. */
async function waitForLockWait(tag: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const waiting = psql(`SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%${tag}%' AND pid <> pg_backend_pid();`)
    if (waiting === '1') return
    await sleep(100)
  }
  throw new Error(`A sessão ${tag} não chegou a esperar a trava.`)
}

function cleanupSchedule() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE changed_by = '${scheduleUser}'
      OR (entity_type IN ('voyage_pod_schedule', 'voyage_pol_schedule') AND split_part(entity_id, '::', 1) IN ('${voyageX}', '${voyageY}'))
      OR (entity_type = 'voyages' AND entity_id IN ('${voyageX}', '${voyageY}'));
    DELETE FROM public.audit_logs WHERE entity_type = 'voyages' AND entity_id IN (
      SELECT v.id::text FROM public.voyages v JOIN public.vessels s ON s.id = v.vessel_id WHERE s.name = 'R217 NAVIO NOVO');
    DELETE FROM public.voyages WHERE vessel_id IN (SELECT id FROM public.vessels WHERE name = 'R217 NAVIO NOVO');
    DELETE FROM public.vessels WHERE name = 'R217 NAVIO NOVO';
    DELETE FROM public.voyages WHERE id IN (${voyageX}, ${voyageY});
    DELETE FROM public.vessels WHERE id = 99213043;
    DELETE FROM public.carriers WHERE id = 99213044;
    DELETE FROM public.user_profiles WHERE id = '${scheduleUser}';
    DELETE FROM auth.users WHERE id = '${scheduleUser}';
    SET session_replication_role = origin;
  `)
}

describeLocal('Programação por planilha: Viagens já cadastradas (migration 213)', () => {
  beforeAll(() => {
    cleanupSchedule()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${scheduleUser}', 'r213-schedule@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${scheduleUser}', 'R213 Programação', 'administrativo', true);
      INSERT INTO public.carriers (id, name) VALUES (99213044, '${scheduleCarrier}');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (99213043, 'R213 SCHEDULE NAVIO', 99213044);
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status, show_on_portal) VALUES
        (${voyageX}, 99213043, 'R213X', 'active', true),
        (${voyageY}, 99213043, 'R213Y', 'active', true);
    `)
  })

  afterAll(cleanupSchedule)

  it('dois arquivos com as mesmas Viagens em ordens diferentes não se travam mutuamente', async () => {
    const row = (id: number, number: string, eta: string) => ({
      voyage_id: id, vessel_name: 'R213 SCHEDULE NAVIO', vessel_imo: '', voyage_number: number,
      changes: [{ entity_type: 'voyage_pod_schedule', port: 'BRSSA', field_name: 'eta', old_value: null, new_value: eta, justification: 'R213' }],
    })
    const x = row(voyageX, 'R213X', '2026-12-01')
    const y = row(voyageY, 'R213Y', '2026-12-02')
    const sheet = (tag: string, rows: unknown[]) =>
      `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${scheduleUser}';
       SELECT /* ${tag} */ public.apply_schedule_sheet_atomic('${JSON.stringify(rows)}'::jsonb, '${scheduleCarrier}', '');`

    // Outra sessão segura a Viagem X. O arquivo [X, Y] espera por ela sem
    // travar nada; o [Y, X] chega depois. Na ordem do arquivo, o segundo
    // travava Y e esperava X; liberada X, o primeiro a pegava e esperava Y.
    const holder = runAsync(`BEGIN; SELECT 1 FROM public.voyages WHERE id = ${voyageX} FOR UPDATE; SELECT pg_sleep(1.5); COMMIT;`)
    await sleep(300)
    const ordered = runAsync(sheet('r213_ordered', [x, y]))
    await waitForLockWait('r213_ordered')
    const reversed = runAsync(sheet('r213_reversed', [y, x]))
    await waitForLockWait('r213_reversed')

    const [held, first, second] = await Promise.all([holder, ordered, reversed])
    expect(held.code).toBe(0)
    expect(first).toEqual({ code: 0, stderr: '' })
    expect(second).toEqual({ code: 0, stderr: '' })
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE changed_by = '${scheduleUser}' AND entity_type = 'voyage_pod_schedule';`)).toBe('4')
  })

  it('dois arquivos com o mesmo navio novo em viagens diferentes criam um cadastro só do navio (217)', async () => {
    const row = (number: string) => ({ vessel_name: 'R217 NAVIO NOVO', vessel_imo: '9217001', voyage_number: number, changes: [] })
    const sheet = (tag: string, number: string, hold: boolean) =>
      `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated'; SET LOCAL request.jwt.claim.sub = '${scheduleUser}';
       SELECT /* ${tag} */ public.apply_schedule_sheet_atomic('${JSON.stringify([row(number)])}'::jsonb, '${scheduleCarrier}', '');
       ${hold ? 'SELECT pg_sleep(1.5);' : ''} COMMIT;`

    // O primeiro arquivo cria o navio e segura a transação; o segundo, com
    // outra viagem do mesmo navio, espera em vez de criar outro cadastro.
    const first = runAsync(sheet('r217_first', 'R217A', true))
    await sleep(500)
    const second = runAsync(sheet('r217_second', 'R217B', false))
    await waitForLockWait('r217_second')

    expect(await Promise.all([first, second])).toEqual([{ code: 0, stderr: '' }, { code: 0, stderr: '' }])
    expect(psql(`SELECT count(*) FROM public.vessels WHERE name = 'R217 NAVIO NOVO';`)).toBe('1')
    expect(psql(`SELECT count(*) FROM public.voyages v JOIN public.vessels s ON s.id = v.vessel_id WHERE s.name = 'R217 NAVIO NOVO';`)).toBe('2')
  })
})

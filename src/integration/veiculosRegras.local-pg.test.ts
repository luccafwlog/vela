// Etapa 11 do plano de correção das importações (migration 184; ADR 0078,
// itens 8 e 23). A importação de veículos confere no servidor B/L, chassi em
// outra Viagem e local de desova; sem fatura viva recalcula na hora e B/L
// isento anula o Recebível; Mover para outro B/L e Excluir valem para qualquer
// usuário, com motivo, mesmo com CE.
//
// Namespace exclusivo: ids 99231xxx, B/Ls 'A231-*', usuário ...0000002310NN.
import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const userId = '00000000-0000-0000-0000-000000231001'
const carrierId = 99231001
const vesselId = 99231002
const voyageId = 99231003
const otherVoyageId = 99231004
const customerId = 99231005
const blA = 'A231-BLA'
const blB = 'A231-BLB'
const blOther = 'A231-OUT'
const blCancelled = 'A231-CAN'
const cA = 99231011
const cB = 99231012
const cOther = 99231013
const cCancelled = 99231014
const bls = [blA, blB, blOther, blCancelled]

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function asUser(sql: string): { stdout: string; stderr: string } {
  const run = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${userId}'; ${sql}`],
  { encoding: 'utf8' })
  return { stdout: run.stdout.trim(), stderr: run.stderr }
}

const list = bls.map((id) => `'${id}'`).join(', ')

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.import_effect_attempts WHERE effect_id IN (SELECT id FROM public.import_pending_effects WHERE entity_id IN (${list}));
    DELETE FROM public.import_pending_effects WHERE entity_id IN (${list});
    DELETE FROM public.bl_receivables WHERE bl_id IN (${list});
    DELETE FROM public.billing_run_logs WHERE bl_id IN (${list});
    DELETE FROM public.charge_calculations WHERE bl_id IN (${list});
    DELETE FROM public.vehicles WHERE bl_id IN (${list});
    DELETE FROM public.bl_containers WHERE bl_id IN (${list});
    DELETE FROM public.bls WHERE id IN (${list});
    DELETE FROM public.audit_logs WHERE entity_id IN (${list}) OR changed_by = '${userId}';
    DELETE FROM public.voyages WHERE id IN (${voyageId}, ${otherVoyageId});
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.portal_email_attempts WHERE account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id IN (SELECT id FROM public.customers WHERE id = ${customerId}));
    DELETE FROM public.portal_provisioning_events WHERE customer_id IN (SELECT id FROM public.customers WHERE id = ${customerId}) OR account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id IN (SELECT id FROM public.customers WHERE id = ${customerId}));
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (SELECT id FROM public.customers WHERE id = ${customerId});
    DELETE FROM public.customers WHERE id = ${customerId};
    DELETE FROM public.user_profiles WHERE id = '${userId}';
    DELETE FROM auth.users WHERE id = '${userId}';
    SET session_replication_role = origin;
  `)
}

function row(chassis: string, bl: string, container: number, voyage = voyageId, unpacking: string | null = null, confirmed = false) {
  return { voyage_id: voyage, container_id: container, bl_id: bl, chassis, brand: 'BYD', model: 'DOLPHIN', weight_kg: 1500, cbm: 12, unpacking_location: unpacking, unpacking_confirmed: confirmed }
}

function importRows(rows: unknown[]) {
  return asUser(`SELECT public.import_vehicle_rows_transactional('${JSON.stringify(rows)}'::jsonb);`)
}

describeLocal('Veículos: regras da importação e ações da página (migration 184)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${userId}', 'a231-equip@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${userId}', 'A231 Equipamentos', 'equipamentos', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customerId}, '99231005000192', 'A231 CLIENTE');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'A231 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'A231 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        (${voyageId}, ${vesselId}, 'A231', 'active'), (${otherVoyageId}, ${vesselId}, 'A231B', 'active');
      INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, movement_to, financial_status, charge_status) VALUES
        ('${blA}', ${voyageId}, ${customerId}, 'A231O', 'A231P', 'container', 'CY', 'pending', 'not_calculated'),
        ('${blB}', ${voyageId}, ${customerId}, 'A231O', 'A231P', 'container', 'LCL', 'pending', 'not_calculated'),
        ('${blOther}', ${otherVoyageId}, ${customerId}, 'A231O', 'A231P', 'container', 'CY', 'pending', 'not_calculated'),
        ('${blCancelled}', ${otherVoyageId}, ${customerId}, 'A231O', 'A231P', 'container', 'CY', 'pending', 'not_calculated');
      INSERT INTO public.bl_containers (id, bl_id, container_number, type, unpacking_location) VALUES
        (${cA}, '${blA}', 'ADCU2310001', '40HC', 'TVV'),
        (${cB}, '${blB}', 'ADCU2310002', '40HC', NULL),
        (${cOther}, '${blOther}', 'ADCU2310003', '40HC', NULL),
        (${cCancelled}, '${blCancelled}', 'ADCU2310004', '40HC', NULL);
      INSERT INTO public.vehicles (voyage_id, container_id, bl_id, chassis, brand, model, weight_kg, cbm) VALUES
        (${otherVoyageId}, ${cOther}, '${blOther}', 'A231CHASSIATIVO', 'BYD', 'X', 1500, 12),
        (${otherVoyageId}, ${cCancelled}, '${blCancelled}', 'A231CHASSICANC', 'BYD', 'X', 1500, 12);
      SET session_replication_role = replica;
      UPDATE public.bls SET cancelled_at = now() WHERE id = '${blCancelled}';
      UPDATE public.bls SET ce_mercante = '992310000000001' WHERE id = '${blA}';
    `)
  })

  afterAll(cleanup)

  it('chassi em outra Viagem ativa recusa o lote; em B/L cancelado entra', () => {
    const refused = importRows([row('A231CHASSIATIVO', blA, cA)])
    expect(refused.stderr).toMatch(/já cadastrado na Viagem A231B/)
    const accepted = importRows([row('A231CHASSICANC', blA, cA)])
    expect(accepted.stderr).toBe('')
    expect(psql(`SELECT count(*) FROM public.vehicles WHERE bl_id = '${blA}';`)).toBe('1')
  })

  it('B/L de outra Viagem (o "parecido") recusa; local de desova só preenche vazio ou troca com confirmação', () => {
    expect(importRows([row('A231V0', blOther, cOther)]).stderr).toMatch(/não encontrado na Viagem/)

    expect(importRows([row('A231V1', blA, cA, voyageId, 'CFS')]).stderr).toBe('')
    expect(psql(`SELECT unpacking_location FROM public.bl_containers WHERE id = ${cA};`)).toBe('TVV')
    expect(importRows([row('A231V2', blA, cA, voyageId, 'CFS', true)]).stderr).toBe('')
    expect(psql(`SELECT unpacking_location FROM public.bl_containers WHERE id = ${cA};`)).toBe('CFS')

    const conflict = importRows([row('A231V3', blB, cB, voyageId, 'TVV'), row('A231V4', blB, cB, voyageId, 'CFS')])
    expect(conflict.stderr).toMatch(/Local de desova diferente para o container ADCU2310002/)
  })

  it('veículo em B/L LCL sem fatura: recalcula na hora e anula o Recebível aberto', () => {
    psql(`
      SET session_replication_role = replica;
      INSERT INTO public.bl_receivables (bl_id, customer_id, source, original_amount_brl, balance_brl, status)
      VALUES ('${blB}', ${customerId}, 'local_charges', 500, 500, 'open');
    `)
    expect(importRows([row('A231V5', blB, cB)]).stderr).toBe('')
    expect(psql(`SELECT status || ':' || balance_brl FROM public.bl_receivables WHERE bl_id = '${blB}';`)).toBe('void:0.00')
    expect(psql(`SELECT count(*) FROM public.import_pending_effects WHERE entity_id = '${blB}' AND effect_kind = 'vehicle_followup';`)).toBe('1')
  })

  it('qualquer usuário move e exclui com motivo, mesmo com CE no B/L', () => {
    const vehicleId = psql(`SELECT id FROM public.vehicles WHERE chassis = 'A231V1';`)
    expect(asUser(`SELECT public.move_vehicles_to_bl(ARRAY[${vehicleId}]::bigint[], '${blB}', '');`).stderr).toMatch(/Informe o motivo/)
    const moved = asUser(`SELECT public.move_vehicles_to_bl(ARRAY[${vehicleId}]::bigint[], '${blB}', 'Chassi no B/L errado (A231)');`)
    expect(moved.stderr).toBe('')
    expect(JSON.parse(moved.stdout)).toMatchObject({ moved: 1, target_bl_id: blB, container_id: cB })
    expect(psql(`SELECT bl_id || ':' || container_id FROM public.vehicles WHERE id = ${vehicleId};`)).toBe(`${blB}:${cB}`)
    expect(psql(`SELECT justification FROM public.audit_logs WHERE entity_type = 'vehicles' AND entity_id = '${vehicleId}' AND field_name = 'bl_id';`))
      .toBe('Chassi no B/L errado (A231)')

    const withCe = psql(`SELECT id FROM public.vehicles WHERE chassis = 'A231V2';`)
    const deleted = asUser(`SELECT public.delete_vehicles_with_reason(ARRAY[${withCe}]::bigint[], 'Veículo não embarcou (A231)');`)
    expect(deleted.stderr).toBe('')
    expect(JSON.parse(deleted.stdout)).toEqual({ deleted_ids: [Number(withCe)] })
    expect(psql(`SELECT count(*) FROM public.vehicles WHERE id = ${withCe};`)).toBe('0')
  })
})

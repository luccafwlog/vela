import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// Lote 4 do plano docs/plans/2026-10-21-frente-das-importacoes.md (migration
// 394; ADR 0095, decisões 7, 18 e 25): exclusão encerra os efeitos e apaga os
// vazios da Viagem; espera de negócio não é bloqueio; iniciador desativado
// roda como a conta de sistema; produtor direto substitui o pendente; excluir
// ou mover veículo com o recálculo falhando é recusado (B3, 379/381); a saúde
// da fila vê a lease vencida. F-10 (exclusão do irmão faturado, corrigida pela 357) ganha
// aqui o cenário da revisão.

const w = financeWorld(9394)
const WORKER = 'w394'
const otherVoyage = 99_000_000 + 9394 * 100 + 90
const extraTable = 99_000_000 + 9394 * 100 + 30

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  try {
    return w.psql(`SELECT to_regproc('public._discard_import_effects_of_deleted') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}, 'migration 394 aplicada')

type Effect = { id: number; status: string; last_error_code: string | null; result: Record<string, unknown> | null }

function effects(entity: string): Effect[] {
  return JSON.parse(w.psql(`SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'status', status,
    'last_error_code', last_error_code, 'result', result) ORDER BY id), '[]') FROM public.import_pending_effects WHERE entity_id = '${entity}'`))
}

function enqueue(entity: string, kind = 'local_billing', actor = w.actors.administrativo): number {
  return Number(w.psql(`INSERT INTO public.import_pending_effects (source_action_id, effect_kind, entity_id, created_by)
    VALUES (gen_random_uuid(), '${kind}', '${entity}', '${actor}') RETURNING id`))
}

/** O runner: pega e processa os efeitos do namespace que já podem rodar. */
function runEffects() {
  return w.psql(`SET import_effects.entity_prefix = '${w.prefix}%';
    SELECT count(*) FROM (SELECT public.process_import_effect(c.id, '${WORKER}') FROM public.claim_import_effects('${WORKER}', 50, 300) AS c) AS x`)
}

function activeBlockedAlerts(effectId: number): number {
  return Number(w.psql(`SELECT count(*) FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'import_effect_blocked' AND i.status = 'active' AND a.entity_type = 'import_effect' AND a.entity_id = '${effectId}'`))
}

function blockedAlertItems(effectId: number): number {
  return Number(w.psql(`SELECT count(*) FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'import_effect_blocked' AND a.entity_type = 'import_effect' AND a.entity_id = '${effectId}'`))
}

function block(effectId: number, entity: string) {
  w.psql(`UPDATE public.import_pending_effects SET status = 'blocked', last_error_code = 'teste_394' WHERE id = ${effectId};
    SELECT public._record_import_effect_blocked_alert(${effectId}, 'local_billing', '${entity}', 'teste_394', 'falha de teste');`)
}

function cleanupExtra() {
  w.psql(`SET session_replication_role = replica;
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT i.id FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE a.entity_type = 'import_effect' AND a.entity_id IN (SELECT id::text FROM public.import_pending_effects WHERE entity_id LIKE '${w.prefix}%' OR entity_id = '${otherVoyage}'));
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM public.alerts WHERE entity_type = 'import_effect'
      AND entity_id IN (SELECT id::text FROM public.import_pending_effects WHERE entity_id LIKE '${w.prefix}%' OR entity_id = '${otherVoyage}'));
    DELETE FROM public.alerts WHERE entity_type = 'import_effect'
      AND entity_id IN (SELECT id::text FROM public.import_pending_effects WHERE entity_id LIKE '${w.prefix}%' OR entity_id = '${otherVoyage}');
    DELETE FROM public.import_effect_attempts WHERE effect_id IN (SELECT id FROM public.import_pending_effects WHERE entity_id LIKE '${w.prefix}%' OR entity_id = '${otherVoyage}');
    DELETE FROM public.import_pending_effects WHERE entity_id = '${otherVoyage}';
    DELETE FROM public.vazios_importacao_containers WHERE manifest_id IN (SELECT id FROM public.vazios_importacao_manifests WHERE description LIKE 'FF9394%');
    DELETE FROM public.vazios_importacao_manifests WHERE description LIKE 'FF9394%';
    DELETE FROM public.vazios_bookings WHERE manifest_id IN (SELECT id FROM public.vazios_manifests WHERE description LIKE 'FF9394%');
    DELETE FROM public.vazios_manifests WHERE description LIKE 'FF9394%';
    DELETE FROM public.bl_containers WHERE bl_id IN (SELECT id FROM public.bls WHERE voyage_id = ${otherVoyage});
    DELETE FROM public.bls WHERE voyage_id = ${otherVoyage};
    DELETE FROM public.voyages WHERE id = ${otherVoyage};
    DELETE FROM public.bl_charge_table_links WHERE charge_table_id = ${extraTable};
    DELETE FROM public.pricing_rule_versions WHERE charge_table_id = ${extraTable};
    DELETE FROM public.charge_table_items WHERE charge_table_id = ${extraTable};
    DELETE FROM public.charge_tables WHERE id = ${extraTable};
    DROP TRIGGER IF EXISTS ff9394_fail ON public.charge_calculations;
    DROP FUNCTION IF EXISTS public.ff9394_fail();
    SET session_replication_role = origin;`)
}

describeLocal('394 — exclusão e efeitos de importação', () => {
  beforeAll(() => {
    cleanupExtra()
    w.setup()
    w.table(500)
  })
  afterAll(() => {
    cleanupExtra()
    w.cleanup()
  })

  it('excluir o B/L descarta os efeitos pendentes e bloqueados sem abrir alerta e fecha o alerta do bloqueado', () => {
    const bl = w.createBl('DEL')
    const pending = enqueue(bl, 'local_billing')
    const blocked = enqueue(bl, 'demurrage_billing')
    block(blocked, bl)
    expect(activeBlockedAlerts(blocked)).toBe(1)

    w.asOk('administrativo', `SELECT public.delete_records('bl', ARRAY['${bl}']::text[], false, 'Excluído no teste 394')`)

    const after = effects(bl)
    expect(after.map((e) => [e.status, e.last_error_code])).toEqual([['superseded', 'record_deleted'], ['superseded', 'record_deleted']])
    expect(after[0].result).toMatchObject({ reason: 'descartado: registro excluído', deleted_kind: 'bl' })
    // Antes: o runner levava o efeito órfão a blocked/effect_domain_missing com alerta crítico.
    runEffects()
    expect(effects(bl).every((e) => e.status === 'superseded')).toBe(true)
    expect(blockedAlertItems(pending)).toBe(0)
    expect(activeBlockedAlerts(blocked)).toBe(0)
  })

  it('excluir a Viagem descarta os efeitos dela e dos B/Ls, apaga os vazios de importação e o diálogo conta os vazios', () => {
    w.psql(`INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${otherVoyage}, ${99_000_000 + 9394 * 100 + 4}, 'FF9394V', 'active');
      INSERT INTO public.bls (id, voyage_id, pod, cargo_mode, financial_status, charge_status, customer_reconciliation_status)
        VALUES ('${w.prefix}VBL', ${otherVoyage}, '${w.pod}', 'container', 'pending', 'not_calculated', 'missing_customer');
      WITH m AS (INSERT INTO public.vazios_importacao_manifests (description, voyage_id, total_containers)
        VALUES ('FF9394 vazios', ${otherVoyage}, 2) RETURNING id)
      INSERT INTO public.vazios_importacao_containers (manifest_id, container_number, container_type)
        SELECT m.id, n, '22G1' FROM m, unnest(ARRAY['FFVZ9394001', 'FFVZ9394002']) AS n;
      INSERT INTO public.vazios_manifests (description, voyage_id, total_bookings) VALUES ('FF9394 embarque', ${otherVoyage}, 0);`)
    const blEffect = enqueue(`${w.prefix}VBL`, 'local_billing')
    const voyageEffect = enqueue(String(otherVoyage), 'physical_flags')

    const preview = w.json<{ items: Array<{ table: string; label: string; count: number; action: string }> }>('administrativo',
      `SELECT public.voyage_delete_preview(${otherVoyage})`)
    expect(preview.items).toContainEqual({ table: 'vazios_importacao_containers', action: 'delete', label: 'vazio(s) de importação', count: 2 })

    w.asOk('administrativo', `SELECT public.delete_records('voyage', ARRAY['${otherVoyage}']::text[], false, 'Excluída no teste 394')`)

    expect(w.psql(`SELECT count(*) FROM public.voyages WHERE id = ${otherVoyage}`)).toBe('0')
    expect(w.psql(`SELECT status || ':' || last_error_code FROM public.import_pending_effects WHERE id IN (${blEffect}, ${voyageEffect}) ORDER BY id`))
      .toBe('superseded:record_deleted\nsuperseded:record_deleted')
    // Antes: os manifestos ficavam sem Viagem (órfãos), com os containers.
    expect(w.psql(`SELECT count(*) FROM public.vazios_importacao_manifests WHERE description = 'FF9394 vazios'`)).toBe('0')
    expect(w.psql(`SELECT count(*) FROM public.vazios_importacao_containers WHERE container_number LIKE 'FFVZ9394%'`)).toBe('0')
    expect(w.psql(`SELECT count(*) FROM public.vazios_manifests WHERE description = 'FF9394 embarque'`)).toBe('0')
  })

  it('CE em B/L sem tabela de cobrança espera sem alerta crítico e conclui sozinho quando a tabela é cadastrada', () => {
    const otherPod = 'BRZZ9'
    const bl = w.createBl('SEMTAB')
    w.psql(`UPDATE public.bls SET pod = '${otherPod}' WHERE id = '${bl}'`)
    w.issueByCe(bl, '939400000000001')
    const [effect] = effects(bl).filter((e) => e.status === 'pending')
    expect(effect).toBeDefined()
    runEffects()
    const waiting = effects(bl).find((e) => e.id === effect.id)!
    // Antes: blocked com o alerta crítico import_effect_blocked.
    expect([waiting.status, waiting.last_error_code]).toEqual(['retry_wait', 'awaiting_charge_table'])
    expect(blockedAlertItems(effect.id)).toBe(0)
    expect(w.psql(`SELECT attempts || ':' || (next_attempt_at > now() + interval '50 minutes') FROM public.import_pending_effects WHERE id = ${effect.id}`)).toBe('0:true')

    // A tabela cadastrada antecipa a próxima tentativa, que fatura.
    w.psql(`INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
        VALUES (${extraTable}, 'Tabela FF9394 X', '${otherPod}', CURRENT_DATE - 30, true, 'container');
      INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, category, cargo_profile, currency, applies_to_soc)
        VALUES (${99_000_000 + 9394 * 100 + 31}, ${extraTable}, 'Taxa FF9394 X', 'container', 300, 300, 'container_distinct_voyage', 'base', 'any', 'BRL', true);`)
    runEffects()
    expect(effects(bl).find((e) => e.id === effect.id)!.status).toBe('succeeded')
    expect(w.liveInvoice(bl)).toBeGreaterThan(0)
  })

  it('CE em B/L em Revisão espera sem alerta e conclui sozinho quando a Revisão é concluída', () => {
    const bl = w.createBl('REV')
    w.calculate(bl)
    w.psql(`UPDATE public.bls SET customer_reconciliation_status = 'matched_name', review_status = 'pending_review' WHERE id = '${bl}'`)
    w.issueByCe(bl, '939400000000002')
    const [effect] = effects(bl).filter((e) => e.status === 'pending')
    expect(effect).toBeDefined()
    runEffects()
    const waiting = effects(bl).find((e) => e.id === effect.id)!
    // Antes: "concluído" sem fatura (INF-07) ou bloqueado com alerta crítico (F-13).
    expect([waiting.status, waiting.last_error_code]).toEqual(['retry_wait', 'awaiting_review'])
    expect(blockedAlertItems(effect.id)).toBe(0)

    w.psql(`UPDATE public.bls SET customer_reconciliation_status = 'reconciled', review_status = 'ok' WHERE id = '${bl}'`)
    runEffects()
    expect(effects(bl).find((e) => e.id === effect.id)!.status).toBe('succeeded')
    expect(w.liveInvoice(bl)).toBeGreaterThan(0)
  })

  it('efeito de usuário desativado roda como a conta de sistema e registra quem iniciou', () => {
    const bl = w.createBl('DESAT')
    w.calculate(bl)
    w.psql(`UPDATE public.bls SET ce_mercante = NULL WHERE id = '${bl}'`)
    const effect = enqueue(bl, 'provisional_charges', w.actors.operacoes)
    w.psql(`UPDATE public.user_profiles SET active = false WHERE id = '${w.actors.operacoes}'`)
    try {
      runEffects()
      const [done] = effects(bl).filter((e) => e.id === effect)
      // Antes: blocked/authorization_invalid.
      expect(done.status).toBe('succeeded')
      expect(done.result).toMatchObject({ initiator_id: w.actors.operacoes, executed_as_system: true })
      expect(done.result?.executed_as).toBe(w.psql(`SELECT public._import_effect_system_actor()`))
    } finally {
      w.psql(`UPDATE public.user_profiles SET active = true WHERE id = '${w.actors.operacoes}'`)
    }
  })

  it('o alerta do efeito bloqueado diz o B/L e o motivo', () => {
    const bl = w.createBl('ALR')
    const effect = enqueue(bl, 'local_billing')
    block(effect, bl)
    const message = w.psql(`SELECT i.message FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'import_effect_blocked' AND a.entity_id = '${effect}'`)
    expect(message).toBe(`O faturamento pelo CE do B/L ${bl} está bloqueado: falha de teste`)
  })

  it('produtor que insere direto substitui o efeito pendente do mesmo tipo', () => {
    const bl = w.createBl('INF14')
    const first = enqueue(bl, 'vehicle_followup')
    const second = enqueue(bl, 'vehicle_followup')
    const [a, b] = effects(bl)
    expect([a.id, a.status, b.id, b.status]).toEqual([first, 'superseded', second, 'pending'])
  })

  it('F-34: excluir ou mover veículo com o recálculo falhando é recusado (B3), sem contagem antiga e sem efeito', () => {
    const bl = w.createBl('VEIC')
    const target = w.createBl('VEID')
    w.calculate(bl)
    w.psql(`INSERT INTO public.vehicles (bl_id, chassis, voyage_id, container_id, brand, model, weight_kg, cbm)
      SELECT '${bl}', 'FF9394CHASSI0001', ${w.voyageId}, c.id, 'MARCA', 'MODELO', 1500, 10 FROM public.bl_containers c WHERE c.bl_id = '${bl}'`)
    const vehicle = w.psql(`SELECT id FROM public.vehicles WHERE bl_id = '${bl}'`)
    w.psql(`CREATE FUNCTION public.ff9394_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF (CASE WHEN TG_OP = 'DELETE' THEN OLD.bl_id ELSE NEW.bl_id END) = '${bl}' THEN RAISE EXCEPTION 'falha simulada'; END IF;
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END $$;
      CREATE TRIGGER ff9394_fail BEFORE INSERT OR DELETE ON public.charge_calculations FOR EACH ROW EXECUTE FUNCTION public.ff9394_fail();`)
    try {
      const removed = w.as('operacoes', `SELECT public.delete_vehicles_with_reason(ARRAY[${vehicle}]::bigint[], 'Excluído no teste 394')`)
      expect(removed.stderr).toMatch(/Taxas Locais do B\/L .* não calculadas: falha simulada/)
      const moved = w.as('operacoes', `SELECT public.move_vehicles_to_bl(ARRAY[${vehicle}]::bigint[], '${target}', 'Movido no teste 394', NULL)`)
      expect(moved.stderr).toMatch(/Taxas Locais do B\/L .* não calculadas: falha simulada/)
    } finally {
      w.psql(`DROP TRIGGER IF EXISTS ff9394_fail ON public.charge_calculations; DROP FUNCTION IF EXISTS public.ff9394_fail();`)
    }
    // O veículo continua no B/L de origem: a taxa não fica com a contagem antiga.
    expect(w.psql(`SELECT bl_id FROM public.vehicles WHERE id = ${vehicle}`)).toBe(bl)
    expect(effects(bl).length).toBe(0)
  })

  it('a saúde da fila conta o efeito em execução com lease vencida e o atraso dele', () => {
    const bl = w.createBl('LEASE')
    const effect = enqueue(bl, 'vehicle_followup')
    w.psql(`UPDATE public.import_pending_effects SET status = 'running', attempts = 1, leased_by = 'morto',
      lease_until = now() - interval '2 hours', next_attempt_at = now() + interval '1 day' WHERE id = ${effect}`)
    const health = JSON.parse(w.psql(`SELECT public.import_effects_queue_health()`)) as Record<string, number>
    // Antes: sem running_expired e sem atraso (só pending/retry_wait contavam).
    expect(health.running_expired).toBeGreaterThanOrEqual(1)
    expect(health.oldest_due_minutes).toBeGreaterThanOrEqual(119)
    w.psql(`UPDATE public.import_pending_effects SET status = 'superseded', lease_until = NULL, leased_by = NULL WHERE id = ${effect}`)
  })

  it('F-10: excluir o irmão sem CE de container compartilhado faturado reemite a fatura do vizinho com o container inteiro', () => {
    const shared = w.container()
    const z1 = w.createBl('Z1', { container: shared })
    const z2 = w.createBl('Z2', { container: shared })
    w.calculate(z1)
    w.calculate(z2)
    const invoice = w.issueByCe(z1, '939400000000010')
    expect(w.invoice(invoice).total).toBe(250)

    w.asOk('administrativo', `SELECT public.delete_records('bl', ARRAY['${z2}']::text[], false, 'Excluído no teste 394')`)
    const successor = w.successorOf(invoice)
    expect(w.invoice(invoice).status).toBe('cancelled')
    expect(w.invoice(successor!).total).toBe(500)
  })
})

import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// Lote 8 do plano docs/plans/2026-10-21-frente-das-importacoes.md (migration
// 404; ADR 0095, decisão 24; F-23, F-24 e F-46):
// - o Histórico do B/L (`bl_timeline`) mostra container que entra e sai (com a
//   origem e o histórico depois da remoção), lacre, peso, SOC/COC, desova,
//   veículos e a troca de Cliente com razão social e CNPJ, nunca o id;
// - a ficha do Cliente (`customer_audit_timeline`) mostra o que a Base de
//   Clientes mudou, com origem, quem e quando;
// - o Nº de Manifesto do lote grava `import_batch` (não colide com o lote);
// - ninguém grava direto em `audit_logs`; a tela grava por
//   `record_audit_entries`, com o autor do JWT.

const w = financeWorld(9402)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  if (process.env.LOCAL_PG_REPRO === '1') return true
  try {
    return w.psql(`SELECT count(*) FROM pg_proc WHERE proname = 'bl_timeline'`) === '1'
  } catch {
    return false
  }
}, 'Histórico do B/L aplicado')

type TimelineRow = { family: string; entity_type: string; field_name: string; old_value: string | null; new_value: string | null; justification: string | null; changed_by: string | null }

function cleanupExtra() {
  // As linhas do gatilho levam o ator do teste e saem no cleanup do mundo.
  w.psql(`SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE entity_id LIKE '${w.prefix}%';
    DELETE FROM public.vehicles WHERE bl_id LIKE '${w.prefix}%';
    DELETE FROM public.audit_logs WHERE entity_type IN ('import_batch', 'import_batches', 'voyage') AND entity_id = '${w.voyageId}';
    DELETE FROM public.import_batches WHERE voyage_id = ${w.voyageId};
    DELETE FROM public.manifestos_mercante WHERE voyage_id = ${w.voyageId};
    SET session_replication_role = origin;`)
}

describeLocal('404 — Histórico: importação visível no B/L e no Cliente; trilha sem INSERT direto', () => {
  beforeAll(() => {
    cleanupExtra()
    w.setup()
  })
  afterAll(() => {
    cleanupExtra()
    w.cleanup()
  })

  function timeline(blId: string): TimelineRow[] {
    return w.json<TimelineRow[]>('operacoes', `SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM public.bl_timeline('${blId}', 500, 0) t`)
  }
  function find(rows: TimelineRow[], field: string) {
    return rows.filter((row) => row.field_name === field)
  }

  it('container que entra e sai, lacre, peso, SOC/COC, desova e veículo aparecem, com origem e depois da remoção', () => {
    const first = w.container()
    const second = w.container()
    const id = w.createBl('H1', { container: first })
    const context = `SELECT set_config('vela.import_context', 'Importação de B/L · Viagem FF9402', true)`

    w.psql(`BEGIN; ${context};
      INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${id}', '${second}', '22G1');
      COMMIT;`)
    w.psql(`BEGIN; ${context};
      UPDATE public.bl_containers SET seal_number = 'LACRE-1', gross_weight_kg = 12000 WHERE bl_id = '${id}' AND container_number = '${second}';
      COMMIT;`)
    w.psql(`BEGIN; SELECT set_config('vela.import_context', 'Importação de Baplie · Viagem FF9402', true);
      UPDATE public.bl_containers SET ownership = 'SOC', ownership_source = 'baplie' WHERE bl_id = '${id}' AND container_number = '${first}';
      COMMIT;`)
    w.psql(`UPDATE public.bl_containers SET unpacking_location = 'Armazém 3' WHERE bl_id = '${id}' AND container_number = '${first}'`)
    const containerId = w.psql(`SELECT id FROM public.bl_containers WHERE bl_id = '${id}' AND container_number = '${first}'`)
    w.psql(`BEGIN; SELECT set_config('vela.import_context', 'Importação de Veículos · Viagem FF9402', true);
      INSERT INTO public.vehicles (voyage_id, bl_id, container_id, chassis, brand, model, weight_kg, cbm)
      VALUES (${w.voyageId}, '${id}', ${containerId}, '9BWZZZ377VT004251', 'VW', 'Gol', 1200, 10);
      COMMIT;`)
    w.psql(`DELETE FROM public.vehicles WHERE bl_id = '${id}'`)
    w.psql(`BEGIN; ${context};
      DELETE FROM public.bl_containers WHERE bl_id = '${id}' AND container_number = '${second}';
      COMMIT;`)

    const rows = timeline(id)
    const entered = find(rows, `criado|${second}`)
    expect(entered).toHaveLength(1)
    expect(entered[0]).toMatchObject({ family: 'container', entity_type: 'bl_container' })
    expect(entered[0].justification).toContain('Importação de B/L')
    expect(find(rows, `excluido|${second}`)).toHaveLength(1)
    // O histórico do container removido fica.
    expect(find(rows, `seal_number|${second}`)[0]).toMatchObject({ new_value: 'LACRE-1' })
    expect(find(rows, `gross_weight_kg|${second}`)[0].new_value).toMatch(/^12000/)
    const soc = find(rows, `ownership|${first}`)[0]
    expect(soc).toMatchObject({ new_value: 'SOC' })
    expect(soc.justification).toContain('Baplie')
    expect(find(rows, `unpacking_location|${first}`)[0]).toMatchObject({ new_value: 'Armazém 3' })
    // O container que nasceu com o B/L não vira "entrou" (B/L criado basta).
    expect(find(rows, `criado|${first}`)).toHaveLength(0)

    const vehicleIn = find(rows, 'criado|9BWZZZ377VT004251')
    expect(vehicleIn).toHaveLength(1)
    expect(vehicleIn[0]).toMatchObject({ family: 'veiculo', entity_type: 'vehicle' })
    expect(vehicleIn[0].justification).toContain('Importação de Veículos')
    expect(find(rows, 'excluido|9BWZZZ377VT004251')).toHaveLength(1)
  })

  it('troca de Cliente e consignatário aparecem com razão social e CNPJ, sem id', () => {
    const id = w.createBl('H2')
    const cnpj = w.psql(`SELECT cnpj_cpf FROM public.customers WHERE id = ${w.otherCustomerId}`)
    w.psql(`BEGIN; SELECT set_config('vela.import_context', 'Importação de B/L · Viagem FF9402', true);
      UPDATE public.bls SET customer_id = ${w.otherCustomerId}, consignee = 'NOVO CONSIGNATARIO LTDA' WHERE id = '${id}';
      COMMIT;`)

    const rows = timeline(id)
    const customer = find(rows, 'customer_id')
    expect(customer).toHaveLength(1)
    expect(customer[0].old_value).toBe(`Cliente FF9402-0 · CNPJ ${w.psql(`SELECT cnpj_cpf FROM public.customers WHERE id = ${w.customerId}`)}`)
    expect(customer[0].new_value).toBe(`Cliente FF9402-1 · CNPJ ${cnpj}`)
    expect(find(rows, 'consignee')[0]).toMatchObject({ entity_type: 'bl', new_value: 'NOVO CONSIGNATARIO LTDA' })
    // Campo interno do gatilho (updated_at) não entra.
    expect(find(rows, 'updated_at')).toHaveLength(0)
  })

  it('terminal aparece pelo nome, não pelo uuid', () => {
    const depot = w.psql(`INSERT INTO public.depots (code, name) VALUES ('FF9402T', 'Terminal FF9402') RETURNING id`)
    expect(w.psql(`SELECT public._bl_timeline_value('terminal_id', '${depot}')`)).toBe('Terminal FF9402')
    expect(w.psql(`SELECT public._bl_timeline_value('terminal_id', gen_random_uuid()::text)`)).toBe('Terminal excluído')
    expect(w.psql(`SELECT public._bl_timeline_value('manifesto_mercante_id', gen_random_uuid()::text)`)).toBe('Manifesto excluído')
    w.psql(`DELETE FROM public.depots WHERE id = '${depot}'`)
  })

  it('a Base de Clientes aparece na ficha do Cliente com origem, quem e quando', () => {
    const cnpj = w.psql(`SELECT cnpj_cpf FROM public.customers WHERE id = ${w.customerId}`)
    const result = w.json<{ ok: boolean }>('administrativo', `SELECT public.apply_customer_base_batch_atomic($json$${JSON.stringify([{
      cnpj, name: 'Cliente FF9402-0', address: 'Rua Nova, 100', city: 'Itajaí', state: 'SC', zip: '88300-000',
      emails: ['financeiro-ff9402-0@example.test', 'operacao-ff9402@example.test'],
    }])}$json$::jsonb, '${w.actors.administrativo}'::uuid)`)
    expect(result.ok).toBe(true)

    const rows = w.json<Array<{ subject: string; field_name: string; old_value: string | null; new_value: string | null; changed_by: string; justification: string }>>(
      'operacoes', `SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM public.customer_audit_timeline(${w.customerId}) t`)
    const address = rows.find((row) => row.field_name === 'address')
    expect(address).toMatchObject({ subject: 'cliente', new_value: 'Rua Nova, 100', changed_by: w.actors.administrativo })
    expect(address?.justification).toContain('Importação de Base de Clientes')
    const email = rows.find((row) => row.field_name === 'contact_added')
    expect(email).toMatchObject({ subject: 'contato', new_value: 'operacao-ff9402@example.test', changed_by: w.actors.administrativo })
  })

  it('Nº de Manifesto do lote grava import_batch e não colide com o gatilho do lote', () => {
    const numero = '1226501860578'
    w.psql(`INSERT INTO public.manifestos_mercante (voyage_id, pol, pod, numero, natureza) VALUES (${w.voyageId}, 'CNSHA', '${w.pod}', '${numero}', 'carga')`)
    const batch = w.psql(`INSERT INTO public.import_batches (voyage_id, filename, cargo_mode) VALUES (${w.voyageId}, 'h.xlsx', 'container') RETURNING id`)
    w.asOk('operacoes', `SELECT public.set_import_batch_ce_master(${batch}, '${numero}', '${w.actors.operacoes}')`)
    expect(w.psql(`SELECT string_agg(entity_type || ':' || entity_id, ',' ORDER BY entity_type) FROM public.audit_logs
      WHERE field_name = 'ce_master' AND new_value = '${numero}' AND entity_type IN ('import_batch', 'import_batches')`))
      .toBe(`import_batch:${w.voyageId},import_batches:${batch}`)
  })

  it('INSERT direto em audit_logs é recusado; a tela grava pela RPC com o autor do JWT', () => {
    const forged = w.as('operacoes', `INSERT INTO public.audit_logs (entity_type, entity_id, field_name, new_value, changed_by, justification)
      VALUES ('bl', '${w.bl('H2')}', 'ce_mercante', '999', '${w.actors.operacoes}', 'Importação de CE Mercante')`)
    expect(forged.status).not.toBe(0)
    expect(forged.stderr).toMatch(/permission denied|row-level security/)

    const wrongSubject = w.as('operacoes', `SELECT public.record_audit_entries('[{"entity_type":"bl","entity_id":"${w.bl('H2')}","field_name":"ce_mercante","new_value":"999"}]'::jsonb)`)
    expect(wrongSubject.status).not.toBe(0)
    expect(wrongSubject.stderr).toContain('não aceito')

    const userByOperator = w.as('operacoes', `SELECT public.record_audit_entries('[{"entity_type":"user_profile","entity_id":"x","field_name":"password","new_value":"x"}]'::jsonb)`)
    expect(userByOperator.status).not.toBe(0)

    w.asOk('operacoes', `SELECT public.record_audit_entries('[{"entity_type":"voyage_pol_schedule","entity_id":"${w.voyageId}::CNSHA","field_name":"etd","new_value":"2026-11-01","changed_by":"${w.actors.administrativo}","justification":"Atualizacao manual de ETD por POL"}]'::jsonb)`)
    expect(w.psql(`SELECT changed_by || '|' || actor_role FROM public.audit_logs
      WHERE entity_type = 'voyage_pol_schedule' AND entity_id = '${w.voyageId}::CNSHA' AND field_name = 'etd' ORDER BY id DESC LIMIT 1`))
      .toBe(`${w.actors.operacoes}|operacoes`)

    // Edição do cadastro do Cliente (RPC) segue gravando o Histórico.
    w.asOk('operacoes', `SELECT public.update_customer_with_audit(${w.otherCustomerId}, '{"city":"Navegantes"}'::jsonb, '${w.actors.operacoes}', 'Mudou de cidade')`)
    expect(w.psql(`SELECT count(*) FROM public.audit_logs WHERE entity_type = 'customer' AND entity_id = '${w.otherCustomerId}' AND field_name = 'city'`)).toBe('1')
  })
})

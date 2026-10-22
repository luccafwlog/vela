import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// Lote 10 do plano docs/plans/2026-10-21-frente-das-importacoes.md
// (migrations 405 e 406; ADR 0095, decisões 3 e 26; F-50).
//   - Hash: toda importação por arquivo que grava lote guarda nome, hash, quem
//     e quando; o mesmo arquivo de novo grava outro lote (só a prévia avisa) e
//     `import_file_previous_upload` devolve a gravação anterior.
//   - Desova: um local por container físico. Gravar o local numa linha de
//     `bl_containers` (como a tela Veículos, UPDATE direto) ou pela planilha de
//     Veículos passa o valor às linhas do mesmo container nos outros B/Ls
//     ativos da Viagem; B/L novo que compartilha o container herda o local.

const w = financeWorld(9410)
const HASH_A = 'a'.repeat(64)
const HASH_B = '0123456789abcdef'.repeat(4)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  if (process.env.LOCAL_PG_REPRO === '1') return true
  try {
    return w.psql(`SELECT count(*) FROM pg_proc WHERE proname = 'import_bl_freight_file_atomic'`) === '1'
  } catch {
    return false
  }
}, 'importação de B/L aplicada')

function cleanupExtra() {
  w.psql(`SET session_replication_role = replica;
    DELETE FROM public.import_errors WHERE batch_id IN (SELECT id FROM public.import_batches WHERE voyage_id = ${w.voyageId});
    UPDATE public.bls SET batch_id = NULL WHERE voyage_id = ${w.voyageId};
    DELETE FROM public.import_batches WHERE voyage_id = ${w.voyageId};
    DELETE FROM public.vazios_bookings WHERE manifest_id IN (SELECT id FROM public.vazios_manifests WHERE voyage_id = ${w.voyageId});
    DELETE FROM public.vazios_manifests WHERE voyage_id = ${w.voyageId};
    DELETE FROM public.vazios_export_operations WHERE voyage_id = ${w.voyageId};
    DELETE FROM public.depots WHERE code = 'FF9410DEP';
    DELETE FROM public.manifestos_mercante WHERE voyage_id = ${w.voyageId};
    DELETE FROM public.voyage_route_ce_master WHERE voyage_id = ${w.voyageId};
    DELETE FROM public.vazios_importacao_containers WHERE manifest_id IN (SELECT id FROM public.vazios_importacao_manifests WHERE voyage_id = ${w.voyageId});
    DELETE FROM public.vazios_importacao_manifests WHERE voyage_id = ${w.voyageId};
    DELETE FROM public.granite_bls WHERE manifest_id IN (SELECT id FROM public.granite_manifests WHERE voyage_id = ${w.voyageId});
    DELETE FROM public.granite_manifests WHERE voyage_id = ${w.voyageId};
    DELETE FROM public.audit_logs WHERE entity_type = 'bl_containers' AND entity_id IN (
      SELECT id::text FROM public.bl_containers WHERE bl_id LIKE '${w.prefix}%');
    SET session_replication_role = origin;`)
}

describeLocal('405/406 — hash do arquivo importado e desova por container físico', () => {
  let cnpj = ''
  let previousRoe = ''

  beforeAll(() => {
    cleanupExtra()
    w.setup()
    previousRoe = w.psql(`SELECT coalesce(roe::text, '') || '|' || coalesce(effective_date::text, '') FROM public.exchange_rate_reference WHERE id = 1`)
    w.psql(`INSERT INTO public.exchange_rate_reference (id, roe, effective_date) VALUES (1, 5, CURRENT_DATE)
      ON CONFLICT (id) DO UPDATE SET roe = EXCLUDED.roe, effective_date = EXCLUDED.effective_date`)
    w.table(1000)
    cnpj = w.psql(`SELECT cnpj_cpf FROM public.customers WHERE id = ${w.customerId}`)
  })
  afterAll(() => {
    if (previousRoe) {
      const [roe, date] = previousRoe.split('|')
      w.psql(`UPDATE public.exchange_rate_reference SET roe = ${roe}, effective_date = '${date}' WHERE id = 1`)
    }
    cleanupExtra()
    w.cleanup()
  })

  function line(id: string, container: string) {
    return {
      id, voyage_id: w.voyageId, pod: w.pod, cargo_mode: 'container',
      customer_id: w.customerId, customer_reconciliation_status: 'matched_document',
      manifest_customer_cnpj_cpf: cnpj, manifest_customer_name: 'Cliente FF9410-0',
      billing_impact: false, override_billing: false,
      containers: [{ container_number: container, type: '22G1', gross_weight_kg: 12000, cbm: 30 }],
      total_weight_kg: 12000, total_cbm: 30,
    }
  }
  function importBlFile(lines: unknown[], batch: Record<string, unknown>) {
    return w.as('administrativo', `SELECT public.import_bl_freight_file_atomic($json$${JSON.stringify(lines)}$json$::jsonb,
      '${w.actors.administrativo}'::uuid, $json$${JSON.stringify(batch)}$json$::jsonb)`)
  }
  function previous(kind: string, hash: string): string {
    return w.asOk('operacoes', `SELECT coalesce(uploaded_by_name, '') || '|' || coalesce(filename, '') FROM public.import_file_previous_upload('${kind}', ${w.voyageId}, '${hash}')`)
  }

  it('arquivo de B/L: grava nome, hash, quem e quando; o mesmo arquivo de novo entra e a consulta aponta a gravação anterior', () => {
    const id = w.bl('HASH1')
    const container = w.container()
    const batch = { filename: 'bl-hash.pdf', voyage_id: w.voyageId, cargo_mode: 'container', file_hash: HASH_A }
    expect(previous('arquivo_bl', HASH_A)).toBe('')

    const first = importBlFile([line(id, container)], batch)
    expect(first.status, first.stderr).toBe(0)
    expect(w.psql(`SELECT filename || '|' || file_hash || '|' || uploaded_by || '|' || (uploaded_at IS NOT NULL)
      FROM public.import_batches WHERE voyage_id = ${w.voyageId} ORDER BY id DESC LIMIT 1`))
      .toBe(`bl-hash.pdf|${HASH_A}|${w.actors.administrativo}|true`)
    expect(previous('arquivo_bl', HASH_A)).toBe(`FF9410 administrativo|bl-hash.pdf`)
    // Outro tipo de importação não vê o lote do arquivo de B/L.
    expect(previous('manifesto_bb', HASH_A)).toBe('')

    // Reenvio: só avisa, nunca recusa (antes, o índice único recusava com 23505).
    const again = importBlFile([line(id, container)], batch)
    expect(again.status, again.stderr).toBe(0)
    expect(w.psql(`SELECT count(*) FROM public.import_batches WHERE voyage_id = ${w.voyageId} AND file_hash = '${HASH_A}'`)).toBe('2')
  })

  it('hash fora do formato SHA-256 é recusado no servidor e na consulta', () => {
    const refused = importBlFile([line(w.bl('HASH2'), w.container())], { filename: 'x.pdf', voyage_id: w.voyageId, cargo_mode: 'container', file_hash: 'abc' })
    expect(refused.status).not.toBe(0)
    expect(refused.stderr).toMatch(/Assinatura do arquivo inválida/)
    expect(w.as('operacoes', `SELECT * FROM public.import_file_previous_upload('arquivo_bl', ${w.voyageId}, 'abc')`).stderr).toMatch(/Assinatura do arquivo inválida/)
    expect(w.psql(`SELECT count(*) FROM public.bls WHERE id = '${w.bl('HASH2')}'`)).toBe('0')
  })

  it('Vazios de exportação, Vazios de importação, Granito e Manifesto BB gravam nome e hash no lote', () => {
    const actor = w.actors.operacoes
    w.psql(`INSERT INTO public.depots (code, name, tipo) VALUES ('FF9410DEP', 'Depot FF9410', 'depot')`)
    const bookings = [{ container_number: 'FFVZ9410001', container_type: '40HC', local_code: 'FF9410DEP', condition: 'vazio', hand_in_date: '2026-10-01', hand_out_date: '2026-10-05' }]
    w.asOk('operacoes', `SELECT public.import_vazios_bookings_transactional(${w.voyageId}, 'BRSSZ', '${actor}'::uuid, '${JSON.stringify(bookings)}'::jsonb, 'vazios.xlsx', '${HASH_B}')`)
    expect(w.psql(`SELECT filename || '|' || file_hash || '|' || imported_by FROM public.vazios_manifests WHERE voyage_id = ${w.voyageId}`))
      .toBe(`vazios.xlsx|${HASH_B}|${actor}`)
    expect(previous('vazios_exportacao', HASH_B)).toBe('FF9410 operacoes|vazios.xlsx')

    const containers = [{ container_number: 'FFVI9410001', container_type: '40HC', tare_kg: 3800, pol: 'CNSHA', pod: 'BRVIX' }]
    const manifestos = [{ pol: 'CNSHA', pod: 'BRVIX', numero: '1226V94100001' }]
    w.asOk('operacoes', `SELECT public.import_vazios_importacao_transactional(${w.voyageId}, 'Planilha', '${actor}'::uuid,
      '${JSON.stringify(containers)}'::jsonb, '${JSON.stringify(manifestos)}'::jsonb, 'vazios-imp.xlsx', '${HASH_B}')`)
    expect(w.psql(`SELECT filename || '|' || file_hash FROM public.vazios_importacao_manifests WHERE voyage_id = ${w.voyageId}`))
      .toBe(`vazios-imp.xlsx|${HASH_B}`)
    expect(previous('vazios_importacao', HASH_B)).toBe('FF9410 operacoes|vazios-imp.xlsx')

    w.asOk('operacoes', `SELECT public.import_granite_manifest_transactional(${w.voyageId}, 'FF9410', 'BRVIX', 'CNXMN', 1, 1000, '${actor}'::uuid,
      '${JSON.stringify([{ bl_number: 'FF9410-GR1', client_id: null, sequence: 1, real_weight_kg: 1000, blocks_qty: 2, vessel_voyage: 'FF9410', loading_port: 'BRVIX', discharge_port: 'CNXMN' }])}'::jsonb, NULL, 'granito.xlsx', '${HASH_B}')`)
    expect(w.psql(`SELECT filename || '|' || file_hash FROM public.granite_manifests WHERE voyage_id = ${w.voyageId}`))
      .toBe(`granito.xlsx|${HASH_B}`)
    expect(previous('granito', HASH_B)).toBe('FF9410 operacoes|granito.xlsx')
    // Reimportação do mesmo B/L atualiza o manifesto: o recibo passa a ser o da última.
    w.asOk('operacoes', `SELECT public.import_granite_manifest_transactional(${w.voyageId}, 'FF9410', 'BRVIX', 'CNXMN', 1, 1200, '${actor}'::uuid,
      '${JSON.stringify([{ bl_number: 'FF9410-GR1', client_id: null, sequence: 1, real_weight_kg: 1200, blocks_qty: 2, vessel_voyage: 'FF9410', loading_port: 'BRVIX', discharge_port: 'CNXMN' }])}'::jsonb, NULL, 'granito-2.xlsx', '${HASH_A}')`)
    expect(w.psql(`SELECT string_agg(filename || '|' || file_hash, ',') FROM public.granite_manifests WHERE voyage_id = ${w.voyageId}`))
      .toBe(`granito-2.xlsx|${HASH_A}`)
    expect(previous('granito', HASH_A)).toBe('FF9410 operacoes|granito-2.xlsx')

    w.asOk('operacoes', `SELECT public.import_breakbulk_manifest_transactional('bb.xlsx', ${w.voyageId}, '${actor}'::uuid, 0, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '${HASH_B}')`)
    expect(w.psql(`SELECT filename || '|' || file_hash FROM public.import_batches WHERE voyage_id = ${w.voyageId} AND cargo_mode = 'carga_solta'`))
      .toBe(`bb.xlsx|${HASH_B}`)
    expect(previous('manifesto_bb', HASH_B)).toBe('FF9410 operacoes|bb.xlsx')

    // O corpo antigo não fica exposto à API: a gravação passa pelo envelope.
    expect(w.as('operacoes', `SELECT public.import_vazios_bookings_transactional_core_405(${w.voyageId}, 'BRSSZ', '${actor}'::uuid, '[]'::jsonb)`).stderr)
      .toMatch(/permission denied/)
  })

  it('desova: gravar o local num B/L grava no container físico inteiro; apagar também; B/L cancelado fica', () => {
    const shared = w.container()
    const a = w.createBl('DES-A', { container: shared })
    const b = w.createBl('DES-B', { container: shared })
    const cancelled = w.createBl('DES-C', { container: shared })
    w.cancelBl(cancelled)
    const idA = w.psql(`SELECT id FROM public.bl_containers WHERE bl_id = '${a}'`)
    const idB = w.psql(`SELECT id FROM public.bl_containers WHERE bl_id = '${b}'`)
    const location = (bl: string) => w.psql(`SELECT coalesce(unpacking_location, '') FROM public.bl_containers WHERE bl_id = '${bl}'`)

    // Como a tela Veículos: UPDATE da coluna liberada ao operador.
    w.asOk('operacoes', `UPDATE public.bl_containers SET unpacking_location = 'TVV' WHERE id = ${idA}`)
    expect(location(b)).toBe('TVV')
    expect(location(cancelled)).toBe('')
    expect(w.psql(`SELECT count(*) FROM public.audit_logs WHERE entity_type = 'bl_containers' AND entity_id = '${idB}' AND field_name = 'unpacking_location'`)).toBe('1')

    w.asOk('operacoes', `UPDATE public.bl_containers SET unpacking_location = NULL WHERE id = ${idB}`)
    expect(location(a)).toBe('')

    // B/L novo que compartilha o container herda o local gravado.
    w.asOk('operacoes', `UPDATE public.bl_containers SET unpacking_location = 'CFS' WHERE id = ${idA}`)
    const late = w.createBl('DES-D', { container: shared })
    expect(location(late)).toBe('CFS')
  })

  it('desova: container com dois locais não é herdado nem sobrescrito por B/L novo', () => {
    const shared = w.container()
    const a = w.createBl('DIV-A', { container: shared })
    const b = w.createBl('DIV-B', { container: shared })
    const location = (bl: string) => w.psql(`SELECT coalesce(unpacking_location, '') FROM public.bl_containers WHERE bl_id = '${bl}'`)
    // Locais divergentes de antes da 406, gravados sem os gatilhos.
    w.psql(`SET session_replication_role = replica;
      UPDATE public.bl_containers SET unpacking_location = 'Z' WHERE bl_id = '${a}';
      UPDATE public.bl_containers SET unpacking_location = 'Q' WHERE bl_id = '${b}';
      SET session_replication_role = origin;`)
    const late = w.createBl('DIV-C', { container: shared })
    expect(location(late)).toBe('')
    expect(location(a)).toBe('Z')
    expect(location(b)).toBe('Q')

    const idA = w.psql(`SELECT id FROM public.bl_containers WHERE bl_id = '${a}'`)
    w.asOk('operacoes', `UPDATE public.bl_containers SET unpacking_location = 'TVV' WHERE id = ${idA}`)
    expect(location(b)).toBe('TVV')
    expect(location(late)).toBe('TVV')
  })

  it('desova: a planilha de Veículos grava o local do container nos dois B/Ls', () => {
    const shared = w.container()
    const a = w.createBl('VEI-A', { container: shared })
    const b = w.createBl('VEI-B', { container: shared })
    const idA = w.psql(`SELECT id FROM public.bl_containers WHERE bl_id = '${a}'`)
    const rows = [{ voyage_id: w.voyageId, container_id: Number(idA), bl_id: a, chassis: 'FF9410VEI1', brand: 'BYD', model: 'DOLPHIN', weight_kg: 1500, cbm: 12, unpacking_location: 'Pátio 3', unpacking_confirmed: false }]
    w.asOk('operacoes', `SELECT public.import_vehicle_rows_transactional($json$${JSON.stringify(rows)}$json$::jsonb)`)
    expect(w.psql(`SELECT string_agg(coalesce(unpacking_location, ''), ',' ORDER BY bl_id) FROM public.bl_containers WHERE bl_id IN ('${a}', '${b}')`))
      .toBe('Pátio 3,Pátio 3')
  })
})

import { spawn } from 'node:child_process'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { databaseUrl, financeWorld } from './frenteFinanceira'

// Lote 5 do plano docs/plans/2026-10-21-frente-das-importacoes.md (migration
// 396; ADR 0095, decisões 19 e 20; F-49, F-53, F-17/F-18): remover o CE ou
// cancelar o B/L tira o B/L do Manifesto Mercante e reativar o recoloca; B/L
// com CE que muda de rota abre "CE fora do Manifesto da rota"; o espelho por
// rota só muda pela RPC; o lote não guarda Nº recusado; "Informar" e planilha
// ao mesmo tempo não dão 23505; a sobrecarga de 5 argumentos não é ambígua; a
// planilha de CE (modo diferido da tela) recusa a falha de cálculo no formato
// da ADR 0094, B3.

const w = financeWorld(9396)
const POL = 'FF9396POL'
const NEW_POD = 'FF9396NEW'
const USD_POD = 'FF9396USD'

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  if (process.env.LOCAL_PG_REPRO === '1') return true
  try {
    return w.psql(`SELECT to_regproc('public.manifesto_follows_ce_and_cancel') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}, 'migration 396 aplicada')

let nextCe = 1
const ce = () => `9396${String(nextCe++).padStart(11, '0')}`
let nextNumero = 1
const numero = () => `FF9396M${String(nextNumero++).padStart(6, '0')}`

type ApplyResult = { ok: boolean; errors?: Array<{ bl_id?: string; message: string }> }

function apply(rows: Array<{ bl_id: string; ce: string }>, manifesto: string): ApplyResult {
  const payload = JSON.stringify(rows.map((r, i) => ({ row: i + 2, ...r })))
  // Modo diferido (p_defer_billing = true), como a tela grava.
  return w.json<ApplyResult>('administrativo', `RESET ROLE; SELECT public.apply_ce_mercante_rows_atomic('${payload}'::jsonb,
    '${w.actors.administrativo}'::uuid, 'bls', '${manifesto}', ${w.voyageId}, false, NULL, true)`)
}

/** B/L com POL e POD, CE e Manifesto gravados pela planilha. */
function linkedBl(name: string): { id: string; ce: string; numero: string } {
  const id = w.createBl(name)
  w.psql(`UPDATE public.bls SET pol = '${POL}' WHERE id = '${id}'`)
  const row = { id, ce: ce(), numero: numero() }
  const result = apply([{ bl_id: id, ce: row.ce }], row.numero)
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
  expect(manifestoOf(id)).toBe(row.numero)
  return row
}

function manifestoOf(id: string): string {
  return w.psql(`SELECT coalesce(m.numero, 'null') FROM public.bls b LEFT JOIN public.manifestos_mercante m ON m.id = b.manifesto_mercante_id WHERE b.id = '${id}'`)
}

function lastManifestoHistory(id: string): string {
  return w.psql(`SELECT coalesce(old_value, '') || '>' || coalesce(new_value, '') || '|' || justification FROM public.audit_logs
    WHERE entity_type = 'bl' AND entity_id = '${id}' AND field_name = 'manifesto_mercante' ORDER BY id DESC LIMIT 1`)
}

function alert(id: string): string {
  return w.psql(`SELECT coalesce((SELECT i.status || '|' || i.severity || '|' || i.department || '|' || i.message
    FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'ce_fora_do_manifesto_da_rota' AND a.entity_type = 'bl' AND a.entity_id = '${id}'
    ORDER BY i.id DESC LIMIT 1), 'none')`)
}

function runAsync(sql: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `BEGIN;
    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claim.role = 'authenticated';
    SET LOCAL request.jwt.claim.sub = '${w.actors.administrativo}';
    ${sql}; COMMIT;`], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += String(chunk) })
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })
  return new Promise((resolve) => child.on('close', (code) => resolve({ code, stdout, stderr })))
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function cleanupExtra() {
  w.psql(`SET session_replication_role = replica;
    DO $$ BEGIN IF to_regclass('public.bl_manifesto_mercante_parking') IS NOT NULL THEN
      DELETE FROM public.bl_manifesto_mercante_parking WHERE bl_id LIKE 'FF9396-%'; END IF; END $$;
    UPDATE public.bls SET manifesto_mercante_id = NULL WHERE id LIKE '${w.prefix}%';
    DELETE FROM public.import_batches WHERE voyage_id = ${w.voyageId};
    DELETE FROM public.voyage_route_ce_master WHERE voyage_id = ${w.voyageId};
    DELETE FROM public.manifestos_mercante WHERE voyage_id = ${w.voyageId};
    DELETE FROM public.bl_charge_table_links WHERE charge_table_id IN (SELECT id FROM public.charge_tables WHERE pod = '${USD_POD}');
    DELETE FROM public.pricing_rule_versions WHERE charge_table_id IN (SELECT id FROM public.charge_tables WHERE pod = '${USD_POD}');
    DELETE FROM public.charge_table_items WHERE charge_table_id IN (SELECT id FROM public.charge_tables WHERE pod = '${USD_POD}');
    DELETE FROM public.charge_tables WHERE pod = '${USD_POD}';
    SET session_replication_role = origin;`)
}

describeLocal('396 — CE e Manifesto Mercante', () => {
  beforeAll(() => {
    cleanupExtra()
    w.setup()
    w.table(500)
  })
  afterAll(() => {
    cleanupExtra()
    w.cleanup()
  })

  it('decisão 19: remover o CE tira o B/L do Manifesto, com Histórico; a planilha recoloca', () => {
    const bl = linkedBl('RMCE')
    w.asOk('operacoes', `RESET ROLE; SELECT public.remove_bl_ce_mercante('${bl.id}', 'CE emitido errado', '${bl.ce}')`)
    expect(manifestoOf(bl.id)).toBe('null')
    expect(lastManifestoHistory(bl.id)).toBe(`${bl.numero}>|Saiu do Manifesto Mercante: CE Mercante removido.`)

    expect(apply([{ bl_id: bl.id, ce: bl.ce }], bl.numero)).toMatchObject({ ok: true })
    expect(manifestoOf(bl.id)).toBe(bl.numero)
  })

  it('decisão 19: cancelar tira do Manifesto; reativar recoloca, com Histórico', () => {
    const bl = linkedBl('CANC')
    expect(w.cancelBl(bl.id, 'Reemitido')).toMatchObject({ cancelled: true })
    expect(manifestoOf(bl.id)).toBe('null')
    expect(lastManifestoHistory(bl.id)).toBe(`${bl.numero}>|Saiu do Manifesto Mercante: B/L cancelado. · Reemitido`)

    w.asOk('administrativo', `RESET ROLE; SELECT public.reactivate_bl('${bl.id}', 'Cancelado por engano')`)
    expect(manifestoOf(bl.id)).toBe(bl.numero)
    expect(lastManifestoHistory(bl.id)).toBe(`>${bl.numero}|Voltou ao Manifesto Mercante: B/L reativado.`)
    expect(w.psql(`SELECT count(*) FROM public.bl_manifesto_mercante_parking WHERE bl_id = '${bl.id}'`)).toBe('0')
  })

  it('decisão 20: B/L com CE que muda de POD abre o alerta, que fecha quando o B/L entra no Manifesto da rota nova', () => {
    const bl = linkedBl('ROTA')
    w.psql(`UPDATE public.bls SET pod = '${NEW_POD}' WHERE id = '${bl.id}'`)
    expect(manifestoOf(bl.id)).toBe('null')
    const opened = alert(bl.id).split('|')
    expect(opened.slice(0, 3)).toEqual(['active', 'normal', 'documentacao'])
    expect(opened[3]).toContain(`CE fora do Manifesto da rota: o B/L ${bl.id}`)
    expect(opened[3]).toContain(bl.numero)

    const target = numero()
    w.asOk('operacoes', `RESET ROLE; SELECT public.move_bls_to_manifesto_mercante(ARRAY['${bl.id}'], '${target}', 'Manifesto da rota nova')`)
    expect(manifestoOf(bl.id)).toBe(target)
    expect(alert(bl.id).split('|')[0]).toBe('resolved')
  })

  it('decisão 20: o alerta fecha quando o CE é trocado; B/L sem CE que muda de rota não abre', () => {
    const bl = linkedBl('ROTACE')
    w.psql(`UPDATE public.bls SET pod = '${NEW_POD}' WHERE id = '${bl.id}'`)
    expect(alert(bl.id).split('|')[0]).toBe('active')
    w.asOk('operacoes', `RESET ROLE; SELECT public.correct_bl_ce_mercante('${bl.id}', '${ce()}', 'CE novo da rota', '${bl.ce}')`)
    expect(alert(bl.id).split('|')[0]).toBe('resolved')

    const plain = w.createBl('SEMCE')
    w.psql(`UPDATE public.bls SET pol = '${POL}', pod = '${NEW_POD}' WHERE id = '${plain}'`)
    expect(alert(plain)).toBe('none')
  })

  it('F-49: o espelho por rota não aceita escrita direta; o lote não guarda Nº que a rota recusou', () => {
    const informed = numero()
    w.asOk('operacoes', `RESET ROLE; SELECT public.set_voyage_route_ce_master(${w.voyageId}, '${POL}', 'FF9396ESP', '${informed}', '${w.actors.operacoes}'::uuid, 'container')`)
    const direct = w.as('operacoes', `UPDATE public.voyage_route_ce_master SET ce_master = NULL WHERE voyage_id = ${w.voyageId}`)
    expect(direct.status).not.toBe(0)
    expect(direct.stderr).toMatch(/permission denied/)
    expect(w.psql(`SELECT ce_master FROM public.voyage_route_ce_master WHERE voyage_id = ${w.voyageId} AND pod = 'FF9396ESP'`)).toBe(informed)

    const batch = w.psql(`INSERT INTO public.import_batches (voyage_id, filename, ce_master) VALUES (${w.voyageId}, 'ff9396.xlsx', '${informed}') RETURNING id`)
    const refused = w.as('operacoes', `RESET ROLE; SELECT public.set_import_batch_ce_master(${batch}, 'ZZ9396X000001', '${w.actors.operacoes}'::uuid)`)
    expect(refused.stderr).toMatch(/não está cadastrado em uma rota desta Viagem/)
    const cleared = w.as('operacoes', `RESET ROLE; SELECT public.set_import_batch_ce_master(${batch}, NULL, '${w.actors.operacoes}'::uuid)`)
    expect(cleared.stderr).toMatch(/continua cadastrado na rota/)
    expect(w.psql(`SELECT ce_master FROM public.import_batches WHERE id = ${batch}`)).toBe(informed)
  })

  it('F-53: a chamada de 5 argumentos não é ambígua (uma assinatura só)', () => {
    expect(w.psql(`SELECT count(*) FROM pg_proc WHERE proname = 'set_voyage_route_ce_master'`)).toBe('1')
    const result = w.as('operacoes', `RESET ROLE; SELECT public.set_voyage_route_ce_master(${w.voyageId}, '${POL}', 'FF9396CIN', '${numero()}', '${w.actors.operacoes}'::uuid)`)
    expect(result.stderr).not.toMatch(/is not unique/)
    expect(result.status, result.stderr).toBe(0)
  })

  it('F-49: "Informar" e a planilha de CE ao mesmo tempo com o mesmo Nº não dão 23505', async () => {
    const id = w.createBl('CONC')
    // Rota própria: sem Manifesto anterior no espelho.
    w.psql(`UPDATE public.bls SET pol = '${POL}', pod = 'FF9396CON' WHERE id = '${id}'`)
    const shared = numero()
    const payload = JSON.stringify([{ row: 2, bl_id: id, ce: ce() }])
    const planilha = runAsync(`SELECT public.apply_ce_mercante_rows_atomic('${payload}'::jsonb, '${w.actors.administrativo}'::uuid, 'bls',
      '${shared}', ${w.voyageId}, false, NULL, true); SELECT pg_sleep(2)`)
    await sleep(600)
    const informar = runAsync(`SELECT public.set_voyage_route_ce_master(${w.voyageId}, '${POL}', 'FF9396CON', '${shared}', '${w.actors.administrativo}'::uuid, 'container')`)
    const [a, b] = await Promise.all([planilha, informar])
    expect(a.code, a.stderr).toBe(0)
    expect(a.stdout).toContain('"ok": true')
    expect(b.stderr).not.toMatch(/23505|duplicate key/)
    expect(b.code, b.stderr).toBe(0)
    expect(w.psql(`SELECT count(*) FROM public.manifestos_mercante WHERE numero = '${shared}'`)).toBe('1')
    expect(manifestoOf(id)).toBe(shared)
  }, 30000)

  it('ADR 0094 B3 / F-17: falha de cálculo na planilha de CE (modo diferido) recusa a planilha inteira com o B/L e o que falta', () => {
    const saved = w.psql(`SELECT coalesce(roe::text, '') || '|' || coalesce(effective_date::text, '') FROM public.exchange_rate_reference WHERE id = 1`)
    const [usdTable, usdItem] = w.table(0)
    try {
      w.psql(`UPDATE public.charge_tables SET pod = '${USD_POD}' WHERE id = ${usdTable};
        SET session_replication_role = replica; DELETE FROM public.exchange_rate_reference WHERE id = 1; SET session_replication_role = origin;
        UPDATE public.charge_table_items SET currency = 'USD', unit_value_usd = 100, unit_value_brl = NULL, value_brl = 0 WHERE id = ${usdItem}`)
      const ok = w.createBl('USDOK')
      const usd = w.createBl('USD')
      w.psql(`UPDATE public.bls SET pol = '${POL}', pod = '${USD_POD}' WHERE id IN ('${ok}', '${usd}')`)
      const result = apply([{ bl_id: ok, ce: ce() }, { bl_id: usd, ce: ce() }], numero())
      expect(result.ok).toBe(false)
      const messages = (result.errors ?? []).map((e) => e.message)
      expect(messages.length).toBeGreaterThan(0)
      for (const message of messages) {
        expect(message).toMatch(/^Taxas Locais do B\/L FF9396-USD(OK)? não calculadas: Cambio \(ROE\) nao configurado.*Nada foi gravado: corrija e grave de novo\.$/)
      }
      // Tudo ou nada: nenhum CE gravado, nenhum vínculo.
      expect(w.psql(`SELECT count(*) FROM public.bls WHERE id IN ('${ok}', '${usd}') AND (ce_mercante IS NOT NULL OR manifesto_mercante_id IS NOT NULL)`)).toBe('0')
    } finally {
      if (saved) {
        const [roe, date] = saved.split('|')
        w.psql(`INSERT INTO public.exchange_rate_reference (id, roe, effective_date) VALUES (1, ${roe}, '${date}') ON CONFLICT (id) DO NOTHING`)
      }
    }
  })

  it('F-18: a gravação da planilha de CE declara statement_timeout de 60 s', () => {
    expect(w.psql(`SELECT array_to_string(proconfig, ',') FROM pg_proc WHERE oid = 'public.apply_ce_mercante_rows_atomic(jsonb,uuid,text,text,bigint,boolean,text,boolean)'::regprocedure`))
      .toContain('statement_timeout=60s')
  })
})

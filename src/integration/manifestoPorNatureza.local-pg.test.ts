import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// Migration 592 (decisão do dono de 2026-11-05): todo Manifesto Mercante de
// carga é só de contêiner ou só de carga solta, mesmo na mesma rota. O B/L
// misto vai no de carga solta. A planilha de CE, o Mover e o Informar recusam
// a natureza trocada; a natureza do B/L que muda tira o B/L do Manifesto.

const w = financeWorld(9592)
const POL = 'FF9592POL'

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  if (process.env.LOCAL_PG_REPRO === '1') return true
  try {
    return w.psql(`SELECT to_regproc('public.guard_bl_manifesto_cargo_mode') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}, 'migration 592 aplicada')

let nextCe = 1
const ce = () => `9592${String(nextCe++).padStart(11, '0')}`
let nextNumero = 1
const numero = () => `FF9592M${String(nextNumero++).padStart(6, '0')}`

type ApplyResult = { ok: boolean; errors?: Array<{ message: string }> }

function apply(rows: Array<{ bl_id: string; ce: string }>, manifesto: string): ApplyResult {
  const payload = JSON.stringify(rows.map((r, i) => ({ row: i + 2, ...r })))
  return w.json<ApplyResult>('administrativo', `RESET ROLE; SELECT public.apply_ce_mercante_rows_atomic('${payload}'::jsonb,
    '${w.actors.administrativo}'::uuid, 'bls', '${manifesto}', ${w.voyageId}, false, NULL, true)`)
}

/** B/L de contêiner, de carga solta (sem contêiner) ou misto na rota POL → POD do mundo. */
function blOf(name: string, kind: 'container' | 'carga_solta' | 'misto'): string {
  const id = w.createBl(name)
  if (kind === 'carga_solta') w.psql(`DELETE FROM public.bl_containers WHERE bl_id = '${id}'`)
  w.psql(`UPDATE public.bls SET pol = '${POL}'${kind === 'container' ? '' : ', bb_weight_ton = 5'} WHERE id = '${id}'`)
  expect(w.psql(`SELECT cargo_mode FROM public.bls WHERE id = '${id}'`)).toBe(kind)
  return id
}

function manifestoOf(id: string): string {
  return w.psql(`SELECT coalesce(m.numero || ':' || m.cargo_mode, 'null') FROM public.bls b LEFT JOIN public.manifestos_mercante m ON m.id = b.manifesto_mercante_id WHERE b.id = '${id}'`)
}

function cleanupExtra() {
  w.psql(`SET session_replication_role = replica;
    DELETE FROM public.bl_manifesto_mercante_parking WHERE bl_id LIKE '${w.prefix}%';
    UPDATE public.bls SET manifesto_mercante_id = NULL WHERE id LIKE '${w.prefix}%';
    DELETE FROM public.voyage_route_ce_master WHERE voyage_id = ${w.voyageId};
    DELETE FROM public.manifestos_mercante WHERE voyage_id = ${w.voyageId};
    SET session_replication_role = origin;`)
}

describeLocal('592 — Manifesto Mercante por natureza', () => {
  beforeAll(() => {
    cleanupExtra()
    w.setup()
    w.table(500)
  })
  afterAll(() => {
    cleanupExtra()
    w.cleanup()
  })

  it('a planilha de CE grava o Manifesto com a natureza dos B/Ls; o misto vai no de carga solta', () => {
    const cntr = blOf('PC1', 'container')
    const bb = blOf('PB1', 'carga_solta')
    const misto = blOf('PM1', 'misto')
    const cntrNumero = numero()
    const bbNumero = numero()

    expect(apply([{ bl_id: cntr, ce: ce() }], cntrNumero)).toMatchObject({ ok: true })
    expect(apply([{ bl_id: bb, ce: ce() }, { bl_id: misto, ce: ce() }], bbNumero)).toMatchObject({ ok: true })

    expect(manifestoOf(cntr)).toBe(`${cntrNumero}:container`)
    expect(manifestoOf(bb)).toBe(`${bbNumero}:carga_solta`)
    expect(manifestoOf(misto)).toBe(`${bbNumero}:carga_solta`)
    // O espelho por rota guarda um número por natureza.
    expect(w.psql(`SELECT string_agg(cargo_mode || '=' || ce_master, ',' ORDER BY cargo_mode) FROM public.voyage_route_ce_master WHERE voyage_id = ${w.voyageId}`))
      .toBe(`carga_solta=${bbNumero},container=${cntrNumero}`)
  })

  it('a planilha com as duas naturezas e o número da outra natureza são recusados inteiros', () => {
    const cntr = blOf('PC2', 'container')
    const bb = blOf('PB2', 'carga_solta')
    const mixed = apply([{ bl_id: cntr, ce: ce() }, { bl_id: bb, ce: ce() }], numero())
    expect(mixed.ok).toBe(false)
    expect(JSON.stringify(mixed.errors)).toContain('A planilha tem B/Ls de contêiner e de carga solta')
    expect(manifestoOf(cntr)).toBe('null')

    const cntrNumero = w.psql(`SELECT numero FROM public.manifestos_mercante WHERE voyage_id = ${w.voyageId} AND cargo_mode = 'container' LIMIT 1`)
    const wrong = apply([{ bl_id: bb, ce: ce() }], cntrNumero)
    expect(wrong.ok).toBe(false)
    expect(JSON.stringify(wrong.errors)).toContain(`O Manifesto Mercante ${cntrNumero} é de contêiner e os B/Ls da planilha são de carga solta`)
    expect(manifestoOf(bb)).toBe('null')
  })

  it('Mover recusa a seleção com as duas naturezas e o Manifesto da outra natureza', () => {
    const cntr = blOf('PC3', 'container')
    const bb = blOf('PB3', 'carga_solta')
    const cntrNumero = numero()
    const bbNumero = numero()
    expect(apply([{ bl_id: cntr, ce: ce() }], cntrNumero)).toMatchObject({ ok: true })
    expect(apply([{ bl_id: bb, ce: ce() }], bbNumero)).toMatchObject({ ok: true })

    const both = w.as('operacoes', `RESET ROLE; SELECT public.move_bls_to_manifesto_mercante(ARRAY['${cntr}', '${bb}'], '${numero()}', 'Juntar')`)
    expect(both.stderr).toContain('são de contêiner e de carga solta')

    const wrong = w.as('operacoes', `RESET ROLE; SELECT public.move_bls_to_manifesto_mercante(ARRAY['${bb}'], '${cntrNumero}', 'Trocar')`)
    expect(wrong.stderr).toContain(`O Manifesto Mercante ${cntrNumero} é de contêiner (não de carga solta)`)
    expect(manifestoOf(bb)).toBe(`${bbNumero}:carga_solta`)
  })

  it('Informar grava o número na natureza da linha e recusa o número da outra natureza', () => {
    const pod = 'FF9592INF'
    const bbNumero = numero()
    w.asOk('operacoes', `RESET ROLE; SELECT public.set_voyage_route_ce_master(${w.voyageId}, '${POL}', '${pod}', '${bbNumero}', '${w.actors.operacoes}'::uuid, 'carga_solta')`)
    expect(w.psql(`SELECT natureza || ':' || cargo_mode FROM public.manifestos_mercante WHERE numero = '${bbNumero}'`)).toBe('carga:carga_solta')

    const wrong = w.as('operacoes', `RESET ROLE; SELECT public.set_voyage_route_ce_master(${w.voyageId}, '${POL}', '${pod}', '${bbNumero}', '${w.actors.operacoes}'::uuid, 'container')`)
    expect(wrong.stderr).toContain(`O Manifesto Mercante ${bbNumero} é de carga solta (não de contêiner)`)

    const invalid = w.as('operacoes', `RESET ROLE; SELECT public.set_voyage_route_ce_master(${w.voyageId}, '${POL}', '${pod}', '${numero()}', '${w.actors.operacoes}'::uuid, 'carga')`)
    expect(invalid.stderr).toContain('Natureza da linha inválida')
  })

  it('o B/L de contêiner que vira misto sai do Manifesto de contêiner, com Histórico e o alerta', () => {
    const cntr = blOf('PC4', 'container')
    const cntrNumero = numero()
    expect(apply([{ bl_id: cntr, ce: ce() }], cntrNumero)).toMatchObject({ ok: true })

    w.psql(`UPDATE public.bls SET bb_weight_ton = 3 WHERE id = '${cntr}'`)
    expect(w.psql(`SELECT cargo_mode FROM public.bls WHERE id = '${cntr}'`)).toBe('misto')
    expect(manifestoOf(cntr)).toBe('null')
    expect(w.psql(`SELECT old_value || '|' || justification FROM public.audit_logs
      WHERE entity_type = 'bl' AND entity_id = '${cntr}' AND field_name = 'manifesto_mercante' ORDER BY id DESC LIMIT 1`))
      .toBe(`${cntrNumero}|Desvínculo automático: o B/L passou a ser de carga solta e o Manifesto Mercante é de contêiner.`)
    expect(w.psql(`SELECT i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'ce_fora_do_manifesto_da_rota' AND a.entity_type = 'bl' AND a.entity_id = '${cntr}' ORDER BY i.id DESC LIMIT 1`))
      .toBe('active')
  })

  it('a reativação não devolve o B/L a um Manifesto que deixou de ser da natureza dele', () => {
    const cntr = blOf('PC5', 'container')
    const cntrNumero = numero()
    expect(apply([{ bl_id: cntr, ce: ce() }], cntrNumero)).toMatchObject({ ok: true })
    expect(w.cancelBl(cntr, 'Reemitido')).toMatchObject({ cancelled: true })
    // O Manifesto guardado passa a ser de carga solta enquanto o B/L está cancelado.
    w.psql(`UPDATE public.manifestos_mercante SET cargo_mode = 'carga_solta' WHERE numero = '${cntrNumero}'`)
    w.asOk('administrativo', `RESET ROLE; SELECT public.reactivate_bl('${cntr}', 'Cancelado por engano')`)
    expect(manifestoOf(cntr)).toBe('null')
  })
})

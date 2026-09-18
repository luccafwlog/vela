import { execFileSync } from 'node:child_process'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'

/**
 * Contraprovas da migration 064 (achados A3, A4 e A8 da auditoria de
 * 2026-09-18, `docs/archive/audits/2026-09-18-auditoria-unificacao-bls-eixos-1-4.md`).
 *
 * O comportamento sob teste é de TRIGGER e de RPC: não dá para exercê-lo por
 * leitura de SQL nem por teste de unidade. A auditoria apontou justamente que os
 * `*Migration.test.ts` aferem o texto da migration, e que o comportamento real
 * dos triggers de modalidade só é interrogado aqui — num arquivo que a suíte
 * padrão pula.
 */
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

/** Marcador da 064: sem a coluna, o arquivo se ignora em vez de mentir na causa. */
function cbmSemanticsPresent(): boolean {
  if (!enabled) return false
  try {
    const present = execFileSync(
      'psql',
      ['-X', '-At', '-q', '-d', databaseUrl, '-c',
        "SELECT to_regclass('public.bls') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bls' AND column_name='bb_cbm')"],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
    return present === 't'
  } catch {
    return false
  }
}

const describeLocal = cbmSemanticsPresent() ? describe : describe.skip

const carrierId = 6406401
const vesselId = 6406402
const voyageId = 6406403
const customerId = 6406404

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.charge_calculations WHERE bl_id LIKE 'CBM064-%';
    DELETE FROM public.bl_breakbulk_items WHERE bl_id LIKE 'CBM064-%';
    DELETE FROM public.bl_containers WHERE bl_id LIKE 'CBM064-%';
    DELETE FROM public.bls WHERE id LIKE 'CBM064-%';
    DELETE FROM public.customer_portal_accounts WHERE customer_id = ${customerId};
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.customers WHERE id = ${customerId};
    SET session_replication_role = origin;
  `)
}

describeLocal('064 — cubagem com dono único e sinal de carga solta completo', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'CBM064 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'CBM064 Vessel', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status)
        VALUES (${voyageId}, ${vesselId}, 'CBM064', 'active');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${customerId}, 'CBM064 Customer', '11222333000181');
    `)
  })

  afterAll(cleanup)

  it('A8 — B/L de carga solta declarado só com máquinas e cubagem não vira contêiner num UPDATE', () => {
    psql(`
      INSERT INTO public.bls (id, voyage_id, customer_id, cargo_mode, bb_machine_qty, bb_cbm)
        VALUES ('CBM064-MAQ', ${voyageId}, ${customerId}, 'carga_solta', 3, 40);
    `)
    expect(psql(`SELECT cargo_mode FROM public.bls WHERE id = 'CBM064-MAQ'`)).toBe('carga_solta')

    // Antes da 064 o sinal era só itens/peso/volumes: este UPDATE saía do ramo
    // que preserva a modalidade declarada e reclassificava o B/L em silêncio.
    psql(`UPDATE public.bls SET bb_packages_qty = NULL WHERE id = 'CBM064-MAQ'`)
    expect(psql(`SELECT cargo_mode FROM public.bls WHERE id = 'CBM064-MAQ'`)).toBe('carga_solta')
  })

  it('A8 — B/L sem nenhum sinal de carga solta continua virando contêiner', () => {
    psql(`
      INSERT INTO public.bls (id, voyage_id, customer_id, cargo_mode)
        VALUES ('CBM064-VAZIO', ${voyageId}, ${customerId}, 'carga_solta');
      UPDATE public.bls SET bb_packages_qty = NULL WHERE id = 'CBM064-VAZIO';
    `)
    expect(psql(`SELECT cargo_mode FROM public.bls WHERE id = 'CBM064-VAZIO'`)).toBe('container')
  })

  it('A4 — cubagem de contêiner e de carga solta ocupam colunas disjuntas no B/L misto', () => {
    psql(`
      INSERT INTO public.bls (id, voyage_id, customer_id, cargo_mode, total_cbm, bb_cbm, bb_weight_ton)
        VALUES ('CBM064-MISTO', ${voyageId}, ${customerId}, 'carga_solta', 67, 45, 12);
      INSERT INTO public.bl_containers (bl_id, container_number, type, cbm)
        VALUES ('CBM064-MISTO', 'CBMU0640001', '40HC', 67);
    `)

    expect(psql(`SELECT cargo_mode FROM public.bls WHERE id = 'CBM064-MISTO'`)).toBe('misto')
    // As duas colunas guardam números diferentes e somam a cubagem do documento:
    // antes, um único total_cbm era sobrescrito por quem importasse por último.
    const [containerCbm, breakbulkCbm] = psql(`
      SELECT total_cbm || '|' || bb_cbm FROM public.bls WHERE id = 'CBM064-MISTO'
    `).split('|')
    expect(Number(containerCbm)).toBe(67)
    expect(Number(breakbulkCbm)).toBe(45)
  })

  it('A4 — o resumo operacional soma as duas cubagens e expõe a de carga solta em separado', () => {
    // Restrito ao B/L misto: o resumo agrega a viagem inteira, e os outros
    // casos deste arquivo também têm cubagem.
    const summary = JSON.parse(psql(
      `SELECT public.operational_list_bl_summary('CBM064-MISTO', ${voyageId})`,
    ))

    // totalCbm = contêiner + carga solta; breakbulkCbm = só carga solta.
    expect(Number(summary.totalBls)).toBe(1)
    expect(Number(summary.totalCbm)).toBe(112)
    expect(Number(summary.breakbulkCbm)).toBe(45)
  })

  it('A8 — máquinas e cubagem também disparam a reavaliação da modalidade', () => {
    psql(`
      INSERT INTO public.bls (id, voyage_id, customer_id, cargo_mode)
        VALUES ('CBM064-SOBE', ${voyageId}, ${customerId}, 'container');
      UPDATE public.bls SET bb_machine_qty = 2 WHERE id = 'CBM064-SOBE';
    `)
    // O trigger precisa observar bb_machine_qty na cláusula UPDATE OF, senão o
    // sinal novo nunca seria reavaliado quando só essa coluna mudasse.
    expect(psql(`SELECT cargo_mode FROM public.bls WHERE id = 'CBM064-SOBE'`)).toBe('carga_solta')
  })
})

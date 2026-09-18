import { execFileSync } from 'node:child_process'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'

/**
 * Contraprovas da auditoria da PR 698 (docs/archive/audits/2026-09-18-auditoria-pr698-carga-mista.md).
 *
 * Cada teste aqui FALHA contra o head atual da PR 698 e passa depois da
 * correção descrita no achado correspondente. Eles cobrem o eixo que a suíte
 * existente não cobre: o que acontece com um B/L já faturado quando o conteúdo
 * muda sem cruzar a fronteira de modalidade, e qual peso o motor de taxas usa
 * quando `bb_weight_ton` ainda não foi preenchido em um B/L misto.
 */
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

/**
 * As contraprovas exigem o schema da PR 698 (migrations 053-061). Rodar contra
 * uma base anterior produziria "function does not exist" ou violação de CHECK,
 * que não é o defeito sob teste. Sem o schema, o arquivo se ignora em vez de
 * mentir sobre a causa.
 *
 * O marcador é `resolve_bl_local_charge_table_ids`, criado pela 056 e
 * inexistente antes dela. NÃO use `resolve_bl_local_charge_items`: essa já
 * existe desde a 002, com a mesma assinatura (text, text), e daria falso
 * positivo em qualquer base anterior à PR 698.
 */
function pr698SchemaPresent(): boolean {
  if (!enabled) return false
  try {
    const present = execFileSync(
      'psql',
      ['-X', '-At', '-q', '-d', databaseUrl, '-c',
        "SELECT to_regprocedure('public.resolve_bl_local_charge_table_ids(text,date)') IS NOT NULL"],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
    return present === 't'
  } catch {
    return false
  }
}

const describeLocal = pr698SchemaPresent() ? describe : describe.skip

const portId = 6989801
const carrierId = 6989802
const vesselId = 6989803
const voyageId = 6989804
const customerId = 6989805
const cntrTableId = 6989811
const bbTableId = 6989812

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.charge_calculations WHERE bl_id LIKE 'AUDIT698-%';
    DELETE FROM public.bl_breakbulk_items WHERE bl_id LIKE 'AUDIT698-%';
    DELETE FROM public.bl_containers WHERE bl_id LIKE 'AUDIT698-%';
    DELETE FROM public.bls WHERE id LIKE 'AUDIT698-%';
    DELETE FROM public.charge_table_items WHERE charge_table_id IN (${cntrTableId}, ${bbTableId});
    DELETE FROM public.charge_tables WHERE id IN (${cntrTableId}, ${bbTableId});
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.customers WHERE id = ${customerId};
    DELETE FROM public.ports WHERE id = ${portId};
    SET session_replication_role = origin;
  `)
}

describeLocal('PR 698 — contraprovas da auditoria', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO public.ports (id, name, locode, country) VALUES (${portId}, 'Audit Port', 'BRSSZ', 'BR');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Audit Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Audit Vessel', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status)
        VALUES (${voyageId}, ${vesselId}, 'AUDIT698', 'active');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${customerId}, 'Audit Customer', '11444777000161');
    `)
  })

  afterAll(cleanup)

  it('P0 — a taxa por tonelada de carga solta nao pode ser cobrada sobre o peso dos conteineres', () => {
    // Um B/L misto cujo peso solto ainda nao foi informado no cabecalho
    // (`bb_weight_ton IS NULL`) e um estado normal: a pendencia "Peso BB
    // ausente" existe justamente para ele. Nesse estado o motor tem de recusar
    // o calculo, nao substituir o peso solto pelo peso conteinerizado.
    psql(`
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode) VALUES
        (${cntrTableId}, 'Audit CNTR', 'BRSSZ', '2020-01-01', true, 'container'),
        (${bbTableId}, 'Audit BB', 'BRSSZ', '2020-01-01', true, 'carga_solta');
      INSERT INTO public.charge_table_items
        (charge_table_id, name, applies_to, value_brl, currency, application_basis, unit_value_brl, active, cargo_profile, sort_order)
      VALUES
        (${cntrTableId}, 'THD', 'container', 800, 'BRL', 'container_distinct_voyage', 800, true, 'standard', 20),
        (${bbTableId}, 'HANDLING POR TONELADA', 'bl', 50, 'BRL', 'weight_ton', 50, true, 'any', 30);

      INSERT INTO public.bls (id, voyage_id, customer_id, pod, cargo_mode, total_weight_kg)
        VALUES ('AUDIT698-WEIGHT', ${voyageId}, ${customerId}, 'BRSSZ', 'container', 1000000);
      INSERT INTO public.bl_containers (bl_id, container_number, type)
        SELECT 'AUDIT698-WEIGHT', 'AUDU7' || lpad(g::text, 6, '0'), '40HC' FROM generate_series(1, 40) g;
      INSERT INTO public.bl_breakbulk_items (bl_id, item_description, gross_weight_kg)
        VALUES ('AUDIT698-WEIGHT', 'Maquina solta de 3 toneladas', 3000);
    `)

    expect(psql(`SELECT cargo_mode FROM public.bls WHERE id = 'AUDIT698-WEIGHT'`)).toBe('misto')
    expect(psql(`SELECT COALESCE(bb_weight_ton::text, 'NULL') FROM public.bls WHERE id = 'AUDIT698-WEIGHT'`)).toBe('NULL')

    const perTon = psql(`
      SELECT quantity::text || '|' || COALESCE(total_value_brl::text, '0') || '|' || status
      FROM public.resolve_bl_local_charge_items('AUDIT698-WEIGHT', 'BRSSZ')
      WHERE charge_item_id = (SELECT id FROM public.charge_table_items WHERE charge_table_id = ${bbTableId} AND application_basis = 'weight_ton')
    `)
    const [quantity, totalBrl, status] = perTon.split('|')

    // 40 conteineres x 25 t = 1.000 t conteinerizadas; a carga solta sao 3 t.
    // O motor nao pode faturar 1.000 t de handling de carga solta.
    expect(Number(quantity)).not.toBe(1000)
    expect(Number(totalBrl)).not.toBe(50000)
    // Sem peso solto declarado, a linha tem de ir para revisao manual.
    expect(status).toBe('review_required')
  })

  it('P1 — remover conteudo de um B/L faturado sem mudar a modalidade tem de sinalizar refaturamento', () => {
    psql(`
      INSERT INTO public.bls (id, voyage_id, customer_id, pod, cargo_mode, total_weight_kg)
        VALUES ('AUDIT698-LOCKED', ${voyageId}, ${customerId}, 'BRSSZ', 'container', 75000);
      INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES
        ('AUDIT698-LOCKED', 'AUDU8000001', '40HC'),
        ('AUDIT698-LOCKED', 'AUDU8000002', '40HC'),
        ('AUDIT698-LOCKED', 'AUDU8000003', '40HC');
      INSERT INTO public.bl_breakbulk_items (bl_id, item_description, gross_weight_kg)
        VALUES ('AUDIT698-LOCKED', 'Bobina A', 10000), ('AUDIT698-LOCKED', 'Bobina B', 10000);
      UPDATE public.bls SET bb_weight_ton = 20, bb_packages_qty = 2 WHERE id = 'AUDIT698-LOCKED';
      SET session_replication_role = replica;
      UPDATE public.bls
        SET financial_status = 'invoiced', review_status = 'ok',
            billing_hold_reason = NULL, charge_status = 'ready_for_billing'
        WHERE id = 'AUDIT698-LOCKED';
      SET session_replication_role = origin;
    `)

    // A modalidade continua 'misto': sobram 1 conteiner e 1 item solto.
    psql(`DELETE FROM public.bl_containers WHERE bl_id = 'AUDIT698-LOCKED' AND container_number <> 'AUDU8000001'`)
    psql(`DELETE FROM public.bl_breakbulk_items WHERE bl_id = 'AUDIT698-LOCKED' AND item_description = 'Bobina B'`)

    expect(psql(`SELECT cargo_mode FROM public.bls WHERE id = 'AUDIT698-LOCKED'`)).toBe('misto')

    // Dois tercos dos conteineres e metade da carga solta sairam de um B/L ja
    // faturado. Alguma coisa tem de exigir estorno/refaturamento.
    const state = psql(`
      SELECT review_status || '|' || COALESCE(billing_hold_reason, '')
      FROM public.bls WHERE id = 'AUDIT698-LOCKED'
    `)
    const [reviewStatus, hold] = state.split('|')
    expect({ reviewStatus, hold }).not.toEqual({ reviewStatus: 'ok', hold: '' })
  })

  it('P1 — acrescentar conteudo a um B/L faturado sem mudar a modalidade tem de abrir billing hold', () => {
    psql(`
      INSERT INTO public.bls (id, voyage_id, customer_id, pod, cargo_mode, total_weight_kg)
        VALUES ('AUDIT698-ADD', ${voyageId}, ${customerId}, 'BRSSZ', 'container', 25000);
      INSERT INTO public.bl_containers (bl_id, container_number, type)
        VALUES ('AUDIT698-ADD', 'AUDU9000001', '40HC');
      SET session_replication_role = replica;
      UPDATE public.bls
        SET financial_status = 'invoiced', review_status = 'ok',
            billing_hold_reason = NULL, charge_status = 'ready_for_billing'
        WHERE id = 'AUDIT698-ADD';
      SET session_replication_role = origin;
    `)

    // 20 conteineres novos em um B/L faturado por 1. A modalidade nao muda.
    psql(`
      INSERT INTO public.bl_containers (bl_id, container_number, type)
      SELECT 'AUDIT698-ADD', 'AUDU91' || lpad(g::text, 5, '0'), '40HC' FROM generate_series(1, 20) g
    `)

    expect(psql(`SELECT count(*)::text FROM public.bl_containers WHERE bl_id = 'AUDIT698-ADD'`)).toBe('21')
    expect(psql(`SELECT COALESCE(billing_hold_reason, '') FROM public.bls WHERE id = 'AUDIT698-ADD'`)).not.toBe('')
  })

  it('P1 — a taxa documental do B/L misto nao pode sumir quando so a tabela de carga solta a define', () => {
    psql(`
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode) VALUES
        (${cntrTableId}, 'Audit CNTR', 'BRSSZ', '2020-01-01', true, 'container'),
        (${bbTableId}, 'Audit BB', 'BRSSZ', '2020-01-01', true, 'carga_solta')
      ON CONFLICT (id) DO NOTHING;
      DELETE FROM public.charge_table_items WHERE charge_table_id IN (${cntrTableId}, ${bbTableId});
      INSERT INTO public.charge_table_items
        (charge_table_id, name, applies_to, value_brl, currency, application_basis, unit_value_brl, active, cargo_profile, sort_order)
      VALUES
        (${cntrTableId}, 'THD', 'container', 800, 'BRL', 'container_distinct_voyage', 800, true, 'standard', 20),
        (${bbTableId}, 'DOC FEE', 'bl', 450, 'BRL', 'bl', 450, true, 'any', 10);

      INSERT INTO public.bls (id, voyage_id, customer_id, pod, cargo_mode, total_weight_kg)
        VALUES ('AUDIT698-DOC', ${voyageId}, ${customerId}, 'BRSSZ', 'container', 25000);
      INSERT INTO public.bl_containers (bl_id, container_number, type)
        VALUES ('AUDIT698-DOC', 'AUDUA000001', '40HC');
      INSERT INTO public.bl_breakbulk_items (bl_id, item_description, gross_weight_kg)
        VALUES ('AUDIT698-DOC', 'Peca solta', 2000);
      UPDATE public.bls SET bb_weight_ton = 2 WHERE id = 'AUDIT698-DOC';
    `)

    expect(psql(`SELECT cargo_mode FROM public.bls WHERE id = 'AUDIT698-DOC'`)).toBe('misto')

    // A supressao de itens de base 'bl' da tabela de carga solta protege contra
    // bitributacao quando as DUAS tabelas trazem a taxa. Quando so a de carga
    // solta traz, suprimir sem substituto apaga a receita em silencio.
    const docLines = psql(`
      SELECT count(*)::text FROM public.resolve_bl_local_charge_items('AUDIT698-DOC', 'BRSSZ')
      WHERE status = 'calculated' AND COALESCE(total_value_brl, 0) = 450
    `)
    expect(docLines).not.toBe('0')
  })
})

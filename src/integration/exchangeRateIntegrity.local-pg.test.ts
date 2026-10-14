import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000018001'
const quoteDate = '2026-09-05'
const ptaxAlertType = 'demurrage_ptax_recalc_failed'
const ptaxAlertEntityType = 'exchange_rate_reference'
const ptaxAlertEntityId = 'global'

function localPsql(sql: string): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`,
  ], { encoding: 'utf8' }).trim()
}

function authenticatedPsql(sql: string): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated'; SET LOCAL request.jwt.claim.sub = '${actorId}'; ${sql} COMMIT;`,
  ], { encoding: 'utf8' }).trim()
}

function cleanupPtaxAlert() {
  localPsql(`
    SET session_replication_role = replica;
    DELETE FROM public.alert_item_dismissals
     WHERE alert_item_id IN (
       SELECT i.id FROM public.alert_items i
       JOIN public.alerts a ON a.id = i.alert_id
       WHERE i.item_type = '${ptaxAlertType}'
         AND a.entity_type = '${ptaxAlertEntityType}'
         AND a.entity_id = '${ptaxAlertEntityId}'
     );
    DELETE FROM public.alert_item_events
     WHERE alert_item_id IN (
       SELECT i.id FROM public.alert_items i
       JOIN public.alerts a ON a.id = i.alert_id
       WHERE i.item_type = '${ptaxAlertType}'
         AND a.entity_type = '${ptaxAlertEntityType}'
         AND a.entity_id = '${ptaxAlertEntityId}'
     );
    DELETE FROM public.alert_items
     WHERE alert_id IN (
       SELECT id FROM public.alerts
       WHERE entity_type = '${ptaxAlertEntityType}' AND entity_id = '${ptaxAlertEntityId}'
     );
    DELETE FROM public.alerts
     WHERE entity_type = '${ptaxAlertEntityType}' AND entity_id = '${ptaxAlertEntityId}';
    SET session_replication_role = origin;
  `)
}

describeLocal('S09 — procedencia e integridade de ROE/PTAX', () => {
  beforeAll(() => {
    cleanupPtaxAlert()
    localPsql(`
      SET session_replication_role = replica;
      DELETE FROM public.exchange_rate_reference_history
       WHERE effective_date >= '2026-09-05';
      DELETE FROM public.exchange_rate_reference;
      DELETE FROM auth.users WHERE id = '${actorId}';
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 's09-exchange@example.test');
      SET session_replication_role = origin;
    `)
  })

  afterAll(() => {
    cleanupPtaxAlert()
    localPsql(`
      SET session_replication_role = replica;
      DELETE FROM public.exchange_rate_reference_history
       WHERE effective_date >= '2026-09-05';
      DELETE FROM public.exchange_rate_reference;
      DELETE FROM auth.users WHERE id = '${actorId}';
      SET session_replication_role = origin;
    `)
  })

  it('persiste a cotacao BCB com identidade idempotente e mesma ROE canonica', () => {
    const first = JSON.parse(localPsql(`
      SELECT public.save_exchange_rate_reference_v2(
        5.1234, 5.4564, '${quoteDate}', 'bcb_live', '${quoteDate}'
      );
    `)) as { source: string; ptax: number; roe: number }
    expect(first).toMatchObject({ source: 'bcb_live', ptax: 5.1234, roe: 5.4564 })

    const repeat = JSON.parse(localPsql(`
      SELECT public.save_exchange_rate_reference_v2(
        5.1234, 5.4564, '${quoteDate}', 'bcb_live', '${quoteDate}'
      );
    `)) as { source: string }
    expect(repeat.source).toBe('bcb_live')
    expect(localPsql(`SELECT count(*) FROM public.exchange_rate_reference_history WHERE source = 'bcb_live' AND effective_date = '${quoteDate}';`)).toBe('1')
    expect(localPsql(`SELECT source || ':' || ptax::text || ':' || roe::text FROM public.exchange_rate_reference WHERE id = 1;`)).toBe('bcb_live:5.1234:5.4564')
  })

  // B24 (ADR 0014; migration 264): o markup mora num ponto só; a PTAX sozinha basta para gravar a referência.
  it('B24 — markup num ponto só no banco; a referência calcula o ROE da PTAX', () => {
    expect(localPsql(`SELECT string_agg(proname, ',' ORDER BY proname) FROM pg_proc
      WHERE prosrc ~ '1\\.065' AND pronamespace = 'public'::regnamespace;`)).toBe('_demurrage_roe_markup')
    const saved = JSON.parse(localPsql(`SELECT public.save_exchange_rate_reference_v2(5.1234, NULL::numeric, '${quoteDate}', 'bcb_live', '${quoteDate}');`)) as { roe: number }
    expect(saved.roe).toBe(5.4564)
    expect(localPsql(`SELECT public._demurrage_ptax_from_roe(5.4564)::text;`)).toBe('5.1234')
  })

  it('rejeita PTAX ausente ou ROE divergente em origem automatica', () => {
    expect(() => localPsql(`SELECT public.save_exchange_rate_reference_v2(NULL::numeric, 5.4564, '${quoteDate}', 'bcb_live', '${quoteDate}');`)).toThrow()
    expect(() => localPsql(`SELECT public.save_exchange_rate_reference_v2(5.1234, 5.4, '${quoteDate}', 'cached', '${quoteDate}');`)).toThrow()
  })

  it('aceita manual sem PTAX e impede escrita direta do navegador', () => {
    const result = JSON.parse(localPsql(`
      SELECT public.save_exchange_rate_reference_v2(
        NULL::numeric, 5.5000, '2026-09-06', 'manual', '2026-09-06'
      );
    `)) as { source: string; ptax: number | null }
    expect(result).toMatchObject({ source: 'manual', ptax: null })
    expect(() => authenticatedPsql(`UPDATE public.exchange_rate_reference SET roe = 9 WHERE id = 1;`)).toThrow()
    expect(() => authenticatedPsql(`INSERT INTO public.exchange_rate_reference_history(source, roe, effective_date) VALUES ('manual', 5.5, '2026-09-07');`)).toThrow()
    // A14 (migration 236): a gravação pela RPC também saiu da API; só o job do
    // BCB (service_role) e o Informar PTAX, como dono, gravam.
    expect(() => authenticatedPsql(`SELECT public.save_exchange_rate_reference_v2(NULL::numeric, 9.0, '2026-09-07', 'manual', '2026-09-07');`)).toThrow(/permission denied/)
    expect(() => authenticatedPsql(`SELECT public.save_exchange_rate_reference(5.0, 5.325, '2026-09-07');`)).toThrow(/permission denied/)
  })

  it('mantém a falha da PTAX na fila até uma execução completa recuperar o job', () => {
    const opened = JSON.parse(localPsql(`
      SELECT public.upsert_alert_item(
        '${ptaxAlertType}', '${ptaxAlertEntityType}', '${ptaxAlertEntityId}',
        'A atualização automática da PTAX da Demurrage falhou; o último valor válido foi preservado.',
        'recalc-demurrage-ptax',
        '{"error_code":"ptax_unavailable"}'::jsonb,
        '/demurrage'
      );
    `)) as { item_id: number }
    expect(opened.item_id).toBeGreaterThan(0)
    expect(localPsql(`SELECT count(*) FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id WHERE i.item_type = '${ptaxAlertType}' AND a.entity_type = '${ptaxAlertEntityType}' AND a.entity_id = '${ptaxAlertEntityId}' AND i.status = 'active';`)).toBe('1')

    localPsql(`SELECT public.resolve_alert_item('${ptaxAlertType}', '${ptaxAlertEntityType}', '${ptaxAlertEntityId}', 'recalc-demurrage-ptax', '{"quote_date":"${quoteDate}"}'::jsonb);`)
    expect(localPsql(`SELECT status FROM public.alert_items WHERE id = ${opened.item_id};`)).toBe('resolved')
  })
})

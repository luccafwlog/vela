import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 502 (conferência do Manual do Operador, capítulo 7):
//   1. A justificativa que a ficha do B/L, a Revisão e Trocar/Desvincular
//      Cliente pedem chega ao Histórico. Antes, `save_bl_review` descartava as
//      linhas do navegador e o gatilho `audit_bls` gravava cada campo com a
//      justificativa nula.
//   2. Corrigir o POD tira a exceção de terminal de outro porto, como já
//      faziam o COD e a reimportação.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ACTOR = '50200000-0000-4000-8000-000000000001'
const CARRIER_ID = 99502001
const VESSEL_ID = 99502002
const VOYAGE_ID = 99502003
const PORT_P = { id: 99502011, code: 'BRV2P' }
const PORT_Q = { id: 99502012, code: 'BRV2Q' }
const TERMINAL_P = '00000000-0000-0000-0000-0000005020d1'
const BL_REASON = 'BL502MOTIVO'
const BL_POD = 'BL502POD'
const BL_SAME_PORT = 'BL502MESMO'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function asActor(sql: string): { ok: boolean; out: string; error: string } {
  const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '${ACTOR}';
     SET LOCAL request.jwt.claim.role = 'authenticated';
     ${sql}
     COMMIT;`], { encoding: 'utf8' })
  return { ok: result.status === 0, out: (result.stdout ?? '').trim(), error: (result.stderr ?? '').trim() }
}

function saveReview(blId: string, payload: Record<string, unknown>, auditRows: unknown[]) {
  return asActor(`SELECT public.save_bl_review('${blId}', (SELECT updated_at FROM public.bls WHERE id = '${blId}'),
    '${JSON.stringify(payload)}'::jsonb, '${JSON.stringify(auditRows)}'::jsonb, '${ACTOR}') IS NOT NULL;
    SELECT 'contexto=' || COALESCE(current_setting('vela.import_context', true), '');`)
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.customer_reconciliation_queue WHERE bl_id IN (SELECT id FROM public.bls WHERE voyage_id = ${VOYAGE_ID});
    DELETE FROM public.audit_logs WHERE entity_id IN ('${BL_REASON}', '${BL_POD}', '${BL_SAME_PORT}') OR changed_by = '${ACTOR}';
    DELETE FROM public.alert_items WHERE metadata->>'bl_id' IN ('${BL_REASON}', '${BL_POD}', '${BL_SAME_PORT}');
    DELETE FROM public.bls WHERE voyage_id = ${VOYAGE_ID};
    DELETE FROM public.depots WHERE id = '${TERMINAL_P}';
    DELETE FROM public.ports WHERE id IN (${PORT_P.id}, ${PORT_Q.id});
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.user_profiles WHERE id = '${ACTOR}';
    DELETE FROM auth.users WHERE id = '${ACTOR}';
    SET session_replication_role = origin;
  `)
}

function migration502Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_pod_change_clears_terminal_override'
      AND tgrelid = 'public.bls'::regclass;`) === '1'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration502Applied, 'migration502Applied (justificativa no Histórico e terminal que segue o POD)')

describeLocal('502 — ficha do B/L: justificativa no Histórico e exceção de terminal que segue o POD', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${ACTOR}', 'doc-502@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${ACTOR}', 'Documentação 502', 'documentacao', true);
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Carrier 502');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Vessel 502', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'V502');
      INSERT INTO public.ports (id, name, locode) VALUES (${PORT_P.id}, '502 Porto P', '${PORT_P.code}'), (${PORT_Q.id}, '502 Porto Q', '${PORT_Q.code}');
      INSERT INTO public.depots (id, code, name, tipo, port_id) VALUES ('${TERMINAL_P}', 'T502P', '502 Terminal P', 'terminal_portuario', ${PORT_P.id});
      INSERT INTO public.bls (id, voyage_id, pol, pod, shipper) VALUES
        ('${BL_REASON}', ${VOYAGE_ID}, 'CNSHA', '${PORT_P.code}', 'Embarcador antigo'),
        ('${BL_POD}', ${VOYAGE_ID}, 'CNSHA', '${PORT_P.code}', 'Embarcador'),
        ('${BL_SAME_PORT}', ${VOYAGE_ID}, 'CNSHA', '${PORT_P.code}', 'Embarcador');
    `)
    for (const blId of [BL_POD, BL_SAME_PORT]) {
      const override = asActor(`SELECT public.set_bl_terminal_override('${blId}', '${TERMINAL_P}', ${PORT_P.id}, 'Descarga no terminal P', '${ACTOR}') IS NOT NULL;`)
      expect(override.error).toBe('')
    }
  })
  afterAll(cleanup)

  it('a justificativa da ficha vai ao Histórico de cada campo e não vaza para o resto da transação', () => {
    const saved = saveReview(BL_REASON, { shipper: 'Embarcador novo' }, [{
      entity_type: 'bl', entity_id: BL_REASON, field_name: 'shipper',
      old_value: 'forjado', new_value: 'forjado', justification: 'Embarcador conforme o B/L original',
    }])
    expect(saved.error).toBe('')
    // O contexto volta a vazio depois da RPC: outra escrita na mesma transação
    // não herda o motivo.
    expect(saved.out).toContain('contexto=')
    expect(saved.out).not.toContain('Embarcador conforme')

    // O valor vem do gatilho (antes e depois reais), o motivo vem da tela.
    expect(psql(`SELECT old_value || ' → ' || new_value || ' | ' || COALESCE(justification, '<nula>')
      FROM public.audit_logs WHERE entity_type = 'bls' AND entity_id = '${BL_REASON}' AND field_name = 'shipper';`))
      .toBe('Embarcador antigo → Embarcador novo | Embarcador conforme o B/L original')
    // As linhas do navegador continuam descartadas: nada de "forjado".
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_id = '${BL_REASON}'
      AND (old_value = 'forjado' OR new_value = 'forjado');`)).toBe('0')
    // A mudança de situação da Revisão leva o mesmo motivo, não "Revisao manual".
    expect(psql(`SELECT string_agg(DISTINCT justification, ',') FROM public.audit_logs
      WHERE entity_type = 'bl' AND entity_id = '${BL_REASON}' AND field_name = 'review_status';`))
      .toBe('Embarcador conforme o B/L original')
    // O Histórico do B/L mostra o motivo.
    expect(asActor(`SELECT justification FROM public.bl_timeline('${BL_REASON}') WHERE field_name = 'shipper';`).out)
      .toBe('Embarcador conforme o B/L original')
  })

  it('sem justificativa nas linhas, grava como antes (justificativa nula)', () => {
    expect(saveReview(BL_REASON, { shipper: 'Embarcador sem motivo' }, []).error).toBe('')
    expect(psql(`SELECT COALESCE(justification, '<nula>') FROM public.audit_logs
      WHERE entity_type = 'bls' AND entity_id = '${BL_REASON}' AND field_name = 'shipper'
      ORDER BY id DESC LIMIT 1;`)).toBe('<nula>')
  })

  it('corrigir o POD para outro porto tira a exceção de terminal e explica no Histórico', () => {
    expect(psql(`SELECT terminal_id || '|' || pod_port_id FROM public.bls WHERE id = '${BL_POD}';`))
      .toBe(`${TERMINAL_P}|${PORT_P.id}`)
    const saved = saveReview(BL_POD, { pod: PORT_Q.code }, [{
      entity_type: 'bl', entity_id: BL_POD, field_name: 'pod', justification: 'POD corrigido conforme o B/L',
    }])
    expect(saved.error).toBe('')
    expect(psql(`SELECT pod || '|' || COALESCE(terminal_id::text, '-') || '|' || COALESCE(pod_port_id::text, '-')
      FROM public.bls WHERE id = '${BL_POD}';`)).toBe(`${PORT_Q.code}|-|-`)
    expect(asActor(`SELECT old_value || ' → ' || COALESCE(new_value, '-') || ' | ' || justification
      FROM public.bl_timeline('${BL_POD}') WHERE field_name = 'terminal_id';`).out)
      .toBe(`502 Terminal P → - | Exceção de terminal removida: o POD do B/L mudou de ${PORT_P.code} para ${PORT_Q.code}.`)
    // O gatilho não duplica a remoção com o motivo da edição (as linhas com
    // valor novo são as da exceção registrada no preparo).
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_type = 'bls' AND entity_id = '${BL_POD}'
      AND field_name IN ('terminal_id', 'pod_port_id') AND new_value IS NULL;`)).toBe('0')
  })

  it('o mesmo porto escrito de outro jeito mantém a exceção', () => {
    expect(saveReview(BL_SAME_PORT, { pod: ` ${PORT_P.code.toLowerCase()} ` }, [{
      entity_type: 'bl', entity_id: BL_SAME_PORT, field_name: 'pod', justification: 'POD com espaço',
    }]).error).toBe('')
    expect(psql(`SELECT terminal_id || '|' || pod_port_id FROM public.bls WHERE id = '${BL_SAME_PORT}';`))
      .toBe(`${TERMINAL_P}|${PORT_P.id}`)
  })
})

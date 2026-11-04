// Migration 583 (decisões do dono de 2026-11-04, ADR 0121; revisão do vínculo
// de terminal): "Escala sem terminal" no D-5 e no ATA, ETB cobrado por
// terminal depois do ATA, NOB sem terminal no alerta, ATB não anterior ao ATA e
// a leitura `escala_frentes_sem_terminal`. Cada cenário roda numa transação
// desfeita no fim; `SET CONSTRAINTS ALL IMMEDIATE` dispara os gatilhos adiados
// como o fim da transação de verdade faria.
//
// Namespace exclusivo: Viagem 49900001, Clientes 49900001-3, usuário 49900000-...-0001.
import { spawnPsql } from './localPsql'
import { describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const USER = '49900000-0000-4000-8000-000000000001'
const T1 = '49900000-0000-4000-8000-0000000000d1'
const T2 = '49900000-0000-4000-8000-0000000000d2'
const VOYAGE = 49900001
const SCALE = `${VOYAGE}::BRVIX`

const FIXTURES = `
  SET LOCAL session_replication_role = replica;
  INSERT INTO auth.users(id, email) VALUES ('${USER}', 'r583-ops@test.local');
  INSERT INTO public.user_profiles(id, full_name, role, active) VALUES ('${USER}', 'R583 Operações', 'operacoes', true);
  INSERT INTO public.carriers(id, name) VALUES (${VOYAGE}, 'R583');
  INSERT INTO public.vessels(id, carrier_id, name) VALUES (${VOYAGE}, ${VOYAGE}, 'R583 VESSEL');
  INSERT INTO public.voyages(id, vessel_id, voyage_number, status) VALUES (${VOYAGE}, ${VOYAGE}, '583A', 'active');
  INSERT INTO public.depots(id, code, name, tipo, port_id)
    SELECT x.id::uuid, x.code, x.code, 'terminal_portuario', p.id
    FROM (VALUES ('${T1}', 'T583'), ('${T2}', 'U583')) AS x(id, code)
    CROSS JOIN (SELECT id FROM public.ports WHERE locode = 'BRVIX' LIMIT 1) AS p;
  INSERT INTO public.customers(id, name, cnpj_cpf) VALUES
    (49900001, 'CLI CHEIA', '49900001000101'), (49900002, 'CLI SOLTA', '49900001000102'), (49900003, 'CLI MISTO', '49900001000103');
  INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode, ce_mercante, customer_id) VALUES
    ('R583-BL1', ${VOYAGE}, 'CNSHA', 'BRVIX', 'container', '583000000000001', 49900001),
    ('R583-BL2', ${VOYAGE}, 'CNSHA', 'BRVIX', 'carga_solta', '583000000000002', 49900002);
  SET LOCAL session_replication_role = origin;
`

const asUser = `RESET ROLE; SELECT set_config('request.jwt.claims', '{"sub":"${USER}","role":"authenticated"}', true) IS NOT NULL; SET LOCAL ROLE authenticated;`
// Como a rodada de 15 minutos (`run_alert_detectors`).
const asDetector = `RESET ROLE;
  SELECT set_config('request.jwt.claim.sub', '${USER}', true) IS NOT NULL;
  SELECT set_config('request.jwt.claim.role', 'service_role', true) IS NOT NULL;
  SELECT set_config('request.jwt.claims', '{"sub":"${USER}","role":"service_role"}', true) IS NOT NULL;
  SELECT set_config('alerts.detector_runner', 'on', true) IS NOT NULL;`
// O fim de cada transação de verdade: dispara os gatilhos adiados e volta ao adiado.
const commit = 'SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;'
// O dia de Brasília, como o alerta conta (à noite, o dia em UTC já é o seguinte).
const TODAY = `(now() AT TIME ZONE 'America/Sao_Paulo')::date`

const eta = (days: number) => `INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_at)
  VALUES ('voyage_pod_schedule', '${SCALE}', 'eta', NULL, (${TODAY} + ${days})::text || 'T10:00', now() - interval '5 days');`
const at = (days: number, time: string) => `(${TODAY} + ${days})::text || 'T${time}:00-03:00'`
const front = (modalidade: string, terminal: string | null) =>
  `{"sentido":"importacao","modalidade":"${modalidade}","terminal_id":${terminal ? `"${terminal}"` : 'null'},"source":"operational_data"}`
const IMPORT_ONLY = (ata?: string) => `('{"tem_exportacao":false,"granito":false,"vazios":false,"has_empty":false,"discharge_ports":[],"linked":false,"schedule":{"tem_importacao":true${ata ? `,"ata":"' || ${ata} || '"` : ''}}}')::jsonb`
const save = (revision: string, fronts: string[], terminals: string, ata?: string, justification = 'NULL') =>
  `SELECT public.save_voyage_escala_terminal_state_v2(${VOYAGE}, 'BRVIX', ${revision}, '[${fronts.join(',')}]', (${terminals})::jsonb, ${IMPORT_ONLY(ata)}, ${justification}) IS NOT NULL;`
const currentRevision = `(SELECT COALESCE(max(revision), 0) FROM public.voyage_escala_terminal_state WHERE voyage_id = ${VOYAGE})`

/** Linha de cada item da Viagem: `>tipo|entidade|status|mensagem|eventos`. */
const report = `RESET ROLE;
  SELECT '>' || i.item_type || '|' || a.entity_id || '|' || i.status || '|' || i.message || '|'
    || (SELECT string_agg(e.event_type, ',' ORDER BY e.id) FROM public.alert_item_events e WHERE e.alert_item_id = i.id)
  FROM public.alerts a JOIN public.alert_items i ON i.alert_id = a.id
  WHERE a.entity_id LIKE '${VOYAGE}::%'
    AND i.item_type IN ('voyage_escala_terminal_missing', 'voyage_schedule_date_pending', 'voyage_terminal_date_pending', 'comunicado_nob_pendente')
  ORDER BY 1;`

function scenario(sql: string): { lines: string[]; stderr: string } {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `BEGIN; ${FIXTURES} ${sql} ROLLBACK;`],
    { encoding: 'utf8' })
  return { lines: run.stdout.split('\n').filter((line) => line.startsWith('>')), stderr: run.stderr }
}

function item(lines: string[], type: string, entity: string) {
  const line = lines.find((candidate) => candidate.startsWith(`>${type}|${entity}|`))
  if (!line) return null
  const [, , status, message, events] = line.slice(1).split('|')
  return { status, message, events }
}

describeLocal('583 — o terminal da escala é cobrado antes da chegada', () => {
  it('Escala sem terminal abre no D-5 do ETA com as frentes derivadas, e não antes', () => {
    const before = scenario(`${eta(6)} ${asDetector} SELECT public.reconcile_voyage_operation_alerts(${VOYAGE}); ${report}`)
    expect(before.stderr).toBe('')
    expect(item(before.lines, 'voyage_escala_terminal_missing', SCALE)).toBeNull()

    const d5 = scenario(`${eta(5)} ${asDetector} SELECT public.reconcile_voyage_operation_alerts(${VOYAGE}); ${report}`)
    expect(d5.stderr).toBe('')
    const opened = item(d5.lines, 'voyage_escala_terminal_missing', SCALE)
    expect(opened?.status).toBe('active')
    expect(opened?.message).toMatch(/^ETA em \d{2}\/\d{2}\/\d{4}\. Frentes sem terminal: carga cheia, carga solta\. Escolha o terminal em Editar escala/)
  })

  it('ATA confirmado em Chegadas e Saídas com frente em TBC: o alerta muda de marco; gravar o terminal o fecha', () => {
    const { lines, stderr } = scenario(`
      ${eta(-1)}
      ${asDetector} SELECT public.reconcile_voyage_operation_alerts(${VOYAGE});
      ${asUser}
      ${save('0', [front('carga_cheia', T1), front('carga_solta', null)], `'[{"terminal_id":"${T1}","terminal_etb":"' || ${at(1, '08:00')} || '"},{"terminal_id":null}]'`)}
      ${commit}
      SELECT public.confirm_schedule_effective_date(${VOYAGE}, 'BRVIX', 'pod', (${TODAY} - 1)::text || 'T12:00') IS NOT NULL;
      ${commit}
      ${report}
    `)
    expect(stderr).toBe('')
    const missing = item(lines, 'voyage_escala_terminal_missing', SCALE)
    expect(missing?.status).toBe('active')
    expect(missing?.message).toMatch(/^ATA registrada\. Frente sem terminal: carga solta\./)
    // D-5 → ATA: nova ocorrência (novo "opened"), sem fechar no meio.
    expect(missing?.events?.split(',').filter((event) => event === 'opened')).toHaveLength(2)
    expect(missing?.events).not.toContain('resolved')

    const fixed = scenario(`
      ${eta(-1)}
      ${asUser}
      ${save('0', [front('carga_cheia', T1), front('carga_solta', null)], `'[{"terminal_id":"${T1}","terminal_etb":"' || ${at(1, '08:00')} || '"},{"terminal_id":null}]'`)}
      ${commit}
      SELECT public.confirm_schedule_effective_date(${VOYAGE}, 'BRVIX', 'pod', (${TODAY} - 1)::text || 'T12:00') IS NOT NULL;
      ${commit}
      ${save(currentRevision, [front('carga_cheia', T1), front('carga_solta', T1)], `'[{"terminal_id":"${T1}","terminal_etb":"' || ${at(1, '08:00')} || '"}]'`)}
      ${commit}
      ${report}
    `)
    expect(fixed.stderr).toBe('')
    expect(item(fixed.lines, 'voyage_escala_terminal_missing', SCALE)?.status).toBe('resolved')
  })

  it('depois do ATA, cada terminal sem ETB é cobrado; a gravação não abre e fecha alerta no meio', () => {
    const { lines, stderr } = scenario(`
      ${eta(-1)}
      ${asUser}
      ${save('0', [front('carga_cheia', T1), front('carga_solta', T2)],
        `'[{"terminal_id":"${T1}","terminal_etb":"' || ${at(1, '08:00')} || '"},{"terminal_id":"${T2}"}]'`, `(${TODAY} - 1)::text || 'T12:00'`)}
      ${commit}
      ${report}
    `)
    expect(stderr).toBe('')
    expect(item(lines, 'voyage_terminal_date_pending', `${SCALE}::U583`))
      .toEqual({ status: 'active', message: 'Terminal U583: ATA registrada; falta o ETB.', events: 'opened' })
    // O T583 tem ETB: nada abriu, nem por um instante.
    expect(item(lines, 'voyage_terminal_date_pending', `${SCALE}::T583`)).toBeNull()
    expect(item(lines, 'voyage_schedule_date_pending', SCALE)).toBeNull()
    expect(item(lines, 'voyage_escala_terminal_missing', SCALE)).toBeNull()
  })

  it('com o ATB, o ETB que faltava não é mais cobrado pela escala', () => {
    const { lines, stderr } = scenario(`
      ${eta(-3)}
      ${asUser}
      ${save('0', [front('carga_cheia', T1), front('carga_solta', T1)],
        `'[{"terminal_id":"${T1}","terminal_atb":"' || ${at(-2, '08:00')} || '"}]'`, `(${TODAY} - 3)::text || 'T12:00'`)}
      ${commit}
      ${report}
    `)
    expect(stderr).toBe('')
    expect(item(lines, 'voyage_schedule_date_pending', SCALE)).toBeNull()
    expect(item(lines, 'voyage_terminal_date_pending', `${SCALE}::T583`)?.message).toBe('Terminal T583: ATB registrada; falta o ETD.')
  })

  it('NOB sem terminal: lista quem ficou fora, explica o B/L misto e fecha com a exceção de terminal', () => {
    const misto = `SET LOCAL session_replication_role = replica;
      INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode, ce_mercante, customer_id)
        VALUES ('R583-BL3', ${VOYAGE}, 'CNSHA', 'BRVIX', 'misto', '583000000000003', 49900003);
      SET LOCAL session_replication_role = origin;`
    const berthed = `'[{"terminal_id":"${T1}","terminal_etb":"' || ${at(-1, '08:00')} || '","terminal_atb":"' || ${at(-1, '09:00')} || '"},{"terminal_id":null}]'`
    const { lines, stderr } = scenario(`
      ${misto} ${eta(-2)}
      ${asUser}
      ${save('0', [front('carga_cheia', T1), front('carga_solta', null)], berthed)}
      ${commit}
      ${report}
    `)
    expect(stderr).toBe('')
    const nob = item(lines, 'comunicado_nob_pendente', SCALE)
    expect(nob?.status).toBe('active')
    expect(nob?.message).toMatch(/^NOB sem terminal na escala BRVIX \(ATB T583 \d{2}\/\d{2}\/\d{4} 09:00\)\. Sem terminal: CLI MISTO, CLI SOLTA\./)

    const later = scenario(`
      ${misto} ${eta(-2)}
      ${asUser}
      ${save('0', [front('carga_cheia', T1), front('carga_solta', null)], berthed)}
      ${commit}
      ${save(currentRevision, [front('carga_cheia', T1), front('carga_solta', T2)],
        `'[{"terminal_id":"${T1}","terminal_etb":"' || ${at(-1, '08:00')} || '","terminal_atb":"' || ${at(-1, '09:00')} || '"},{"terminal_id":"${T2}"}]'`)}
      ${commit}
      ${report}
      -- A rodada de Comunicados e o fechamento na hora (353) não fecham o item: ele não é alvo da régua.
      ${asDetector}
      SELECT public.detect_customer_communication_alerts() IS NOT NULL;
      SELECT public.resolve_customer_communication_pending_alerts(${VOYAGE}, 'BRVIX', NULL, 'teste_583') IS NOT NULL;
      RESET ROLE;
      SELECT '>apos-rodada|' || i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
        WHERE i.item_type = 'comunicado_nob_pendente' AND a.entity_id = '${SCALE}';
      SET LOCAL session_replication_role = replica;
      UPDATE public.bls SET terminal_id = '${T1}', pod_port_id = (SELECT id FROM public.ports WHERE locode = 'BRVIX' LIMIT 1)
        WHERE id = 'R583-BL3';
      SET LOCAL session_replication_role = origin;
      ${asDetector}
      SELECT public.detect_customer_communication_alerts() IS NOT NULL;
      RESET ROLE;
      SELECT '>apos-excecao|' || i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
        WHERE i.item_type = 'comunicado_nob_pendente' AND a.entity_id = '${SCALE}';
    `)
    expect(later.stderr).toBe('')
    // A carga solta ganhou terminal (sem ATB ainda: espera o NOB dele); o misto
    // tem as duas frentes em terminais diferentes.
    expect(item(later.lines, 'comunicado_nob_pendente', SCALE)?.message)
      .toMatch(/B\/L misto com carga cheia e carga solta em terminais diferentes: CLI MISTO\. Defina a exceção de terminal do B\/L\.$/)
    expect(later.lines).toContain('>apos-rodada|active')
    expect(later.lines).toContain('>apos-excecao|resolved')
  })

  it('ATB anterior ao ATA é recusado na gravação e na confirmação da chegada; corrigir os dois juntos passa', () => {
    const refusal = /ATB anterior ao ATA da escala: o navio atraca depois de chegar ao porto\. Corrija o ATA ou o ATB do terminal T583\./
    const fronts = [front('carga_cheia', T1), front('carga_solta', T1)]
    const atb = (days: number, time: string) => `'[{"terminal_id":"${T1}","terminal_etb":"' || ${at(-3, '08:00')} || '","terminal_atb":"' || ${at(days, time)} || '"}]'`

    const onSave = scenario(`${eta(-3)} ${asUser} ${save('0', fronts, atb(-3, '09:00'), `(${TODAY} - 3)::text || 'T12:00'`)} ${commit}`)
    expect(onSave.stderr).toMatch(refusal)

    const onConfirm = scenario(`${eta(-3)} ${asUser} ${save('0', fronts, atb(-2, '09:00'))} ${commit}
      SELECT public.confirm_schedule_effective_date(${VOYAGE}, 'BRVIX', 'pod', (${TODAY} - 1)::text || 'T12:00') IS NOT NULL; ${commit}`)
    expect(onConfirm.stderr).toMatch(refusal)

    const corrected = scenario(`${eta(-3)} ${asUser}
      SELECT public.confirm_schedule_effective_date(${VOYAGE}, 'BRVIX', 'pod', (${TODAY} - 1)::text || 'T12:00') IS NOT NULL; ${commit}
      ${save('0', fronts, atb(-2, '09:00'), `(${TODAY} - 3)::text || 'T07:00'`, `'ATA corrigido'`)} ${commit}
      SELECT '>gravou';`)
    expect(corrected.stderr).toBe('')
    expect(corrected.lines).toEqual(['>gravou'])
  })

  it('escala_frentes_sem_terminal lista só a escala com frente sem terminal, e só para usuário interno', () => {
    const { lines, stderr } = scenario(`
      ${eta(20)}
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value)
        VALUES ('voyage_pod_schedule', '${VOYAGE}::BRSSZ', 'eta', NULL, (${TODAY} + 25)::text);
      ${asUser}
      SELECT '>' || voyage_id || '|' || port || '|' || array_to_string(fronts, ',')
        FROM public.escala_frentes_sem_terminal(ARRAY[${VOYAGE}]::bigint[]);
    `)
    expect(stderr).toBe('')
    expect(lines).toEqual([`>${VOYAGE}|BRVIX|importacao:carga_cheia,importacao:carga_solta`])

    const anon = scenario(`RESET ROLE; SET LOCAL ROLE anon; SELECT public.escala_frentes_sem_terminal(ARRAY[${VOYAGE}]::bigint[]);`)
    expect(anon.stderr).toMatch(/permission denied for function escala_frentes_sem_terminal/)
  })
})

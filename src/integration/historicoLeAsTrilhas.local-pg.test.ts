import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 561 (decisão do dono de 2026-11-01): o Histórico de ações lê, na
// hora, as trilhas próprias de Desbloqueio de CE, contas do Portal,
// Comunicados e disputas de Demurrage, sem gravar o mesmo fato em dobro.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADMIN_ID = '56156100-0000-4000-8000-000000000001'
const OPERATOR_ID = '56156100-0000-4000-8000-000000000002'
const PORTAL_LOGIN = '56156100-0000-4000-8000-000000000003'
const ZERO_ACTOR = '00000000-0000-0000-0000-000000000000'
const ACCOUNT_ID = 99561041
const CE_SYSTEM_EVENT_ID = 99561024
const PORTAL_CLIENT_EVENT_ID = 99561025
const PORTAL_SYSTEM_EVENT_ID = 99561026
const CUSTOMER_ID = 99561011
const REQUEST_ID = '56156100-0000-4000-8000-0000000000c1'
const CE_EVENT_ID = 99561021
const PORTAL_EVENT_ID = 99561022
const COMMUNICATION_ID = 99561023
const INVOICE_ID = 99561031
const DISPUTE_ID = 99561032
const MESSAGE_ID = 99561033
const ATTACHMENT_ID = 99561034
const DAY = '2031-06-12'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-F', '|', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function asAdmin(sql: string, userId = ADMIN_ID): { output: string; error: string } {
  const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-F', '|', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '${userId}';
     SET LOCAL request.jwt.claim.role = 'authenticated'; ${sql}; COMMIT;`], { encoding: 'utf8' })
  return { output: (result.stdout ?? '').trim(), error: (result.stderr ?? '').trim() }
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.demurrage_dispute_attachments WHERE id = ${ATTACHMENT_ID};
    DELETE FROM public.demurrage_dispute_messages WHERE id = ${MESSAGE_ID};
    DELETE FROM public.demurrage_disputes WHERE id = ${DISPUTE_ID};
    DELETE FROM public.demurrage_invoices WHERE id = ${INVOICE_ID};
    DELETE FROM public.customer_communications WHERE id = ${COMMUNICATION_ID};
    DELETE FROM public.portal_provisioning_events WHERE id IN (${PORTAL_EVENT_ID}, ${PORTAL_CLIENT_EVENT_ID}, ${PORTAL_SYSTEM_EVENT_ID});
    DELETE FROM public.customer_portal_accounts WHERE id = ${ACCOUNT_ID};
    DELETE FROM public.ce_unlock_events WHERE id IN (${CE_EVENT_ID}, ${CE_SYSTEM_EVENT_ID});
    DELETE FROM public.ce_unlock_requests WHERE id = '${REQUEST_ID}';
    DELETE FROM public.audit_logs WHERE changed_at::date = '${DAY}';
    DELETE FROM public.customers WHERE id = ${CUSTOMER_ID};
    DELETE FROM public.user_profiles WHERE id IN ('${ADMIN_ID}', '${OPERATOR_ID}');
    DELETE FROM auth.users WHERE id IN ('${ADMIN_ID}', '${OPERATOR_ID}', '${PORTAL_LOGIN}');
    SET session_replication_role = origin;
  `)
}

function migration561Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_proc WHERE proname = '_audit_trail_label';`) === '1'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration561Applied, 'migration561Applied (Histórico de ações lê as trilhas)')

describeLocal('561 — Histórico de ações lê as trilhas próprias', () => {
  beforeAll(() => {
    cleanup()
    const at = (hour: string) => `'${DAY} ${hour.includes(':') ? hour : `${hour}:00`}:00-03'`
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${ADMIN_ID}', 'admin-561@example.test'),
        ('${OPERATOR_ID}', 'operacoes-561@example.test'), ('${PORTAL_LOGIN}', 'cliente-561@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${ADMIN_ID}', 'Alice 561', 'administrativo', true),
        ('${OPERATOR_ID}', 'Otto 561', 'operacoes', true);
      SET session_replication_role = replica;
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER_ID}, 'CLIENTE 561 LTDA', '${syntheticCnpj(561011)}');
      INSERT INTO public.ce_unlock_requests (id, customer_id, source, created_by) VALUES ('${REQUEST_ID}', ${CUSTOMER_ID}, 'request', '${ADMIN_ID}');
      INSERT INTO public.ce_unlock_events (id, customer_id, request_id, bl_id, action, reason, actor_id, created_at) OVERRIDING SYSTEM VALUE VALUES (${CE_EVENT_ID}, ${CUSTOMER_ID}, '${REQUEST_ID}', 'BL561', 'submit', 'Cliente precisa retirar hoje', '${ADMIN_ID}', ${at('09')});
      -- Rotina do Desbloqueio: ator zerado.
      INSERT INTO public.ce_unlock_events (id, customer_id, request_id, bl_id, action, reason, actor_id, created_at) OVERRIDING SYSTEM VALUE
        VALUES (${CE_SYSTEM_EVENT_ID}, ${CUSTOMER_ID}, '${REQUEST_ID}', 'BL561', 'reopen', NULL, '${ZERO_ACTOR}', ${at('08')});
      INSERT INTO public.customer_portal_accounts (id, customer_id, auth_user_id, active) OVERRIDING SYSTEM VALUE
        VALUES (${ACCOUNT_ID}, ${CUSTOMER_ID}, '${PORTAL_LOGIN}', true);
      -- Decisão e situação mudam juntas: duas linhas.
      INSERT INTO public.portal_provisioning_events (id, customer_id, account_id, previous_decision, new_decision, previous_situation, new_situation, actor_type, actor_id, reason, created_at) OVERRIDING SYSTEM VALUE
        VALUES (${PORTAL_EVENT_ID}, ${CUSTOMER_ID}, ${ACCOUNT_ID}, 'aguardando_analise', 'aprovado_para_provisionar', 'sem_conta', 'convite_pendente', 'administrativo', '${ADMIN_ID}', 'Conferido o contrato', ${at('10')});
      -- O Cliente ativa pelo Portal; a Edge Function grava sem autor.
      INSERT INTO public.portal_provisioning_events (id, customer_id, account_id, previous_decision, new_decision, previous_situation, new_situation, actor_type, actor_id, reason, created_at) OVERRIDING SYSTEM VALUE
        VALUES (${PORTAL_CLIENT_EVENT_ID}, ${CUSTOMER_ID}, ${ACCOUNT_ID}, 'aprovado_para_provisionar', 'aprovado_para_provisionar', 'convite_pendente', 'ativo', 'cliente', NULL, 'Ativação concluída pelo cliente', ${at('10:30')});
      -- Sem mudança de decisão nem de situação; o texto do Sistema cita o número interno.
      INSERT INTO public.portal_provisioning_events (id, customer_id, account_id, previous_decision, new_decision, previous_situation, new_situation, actor_type, actor_id, reason, created_at) OVERRIDING SYSTEM VALUE
        VALUES (${PORTAL_SYSTEM_EVENT_ID}, ${CUSTOMER_ID}, ${ACCOUNT_ID}, 'aprovado_para_provisionar', 'aprovado_para_provisionar', 'ativo', 'ativo', 'sistema', NULL, 'Supressão liberada para o Cliente #${CUSTOMER_ID}.', ${at('10:45')});
      INSERT INTO public.customer_communications (id, customer_id, kind, nature, status, vessel_name, voyage_number, anchor_port, created_by, created_at) OVERRIDING SYSTEM VALUE VALUES (${COMMUNICATION_ID}, ${CUSTOMER_ID}, 'aviso_chegada_noa', 'operacional', 'enviado', 'Santos 561', 'V561', 'BRSSZ', NULL, ${at('11')});
      INSERT INTO public.demurrage_invoices (id, doc_number, bl_id, customer_id) OVERRIDING SYSTEM VALUE VALUES (${INVOICE_ID}, 'DEM-561', 'BL561', ${CUSTOMER_ID});
      INSERT INTO public.demurrage_disputes (id, demurrage_invoice_id, customer_id, opened_by) OVERRIDING SYSTEM VALUE VALUES (${DISPUTE_ID}, ${INVOICE_ID}, ${CUSTOMER_ID}, 'cliente');
      INSERT INTO public.demurrage_dispute_messages (id, dispute_id, author_type, author_id, body, next_responder, created_at) OVERRIDING SYSTEM VALUE VALUES (${MESSAGE_ID}, ${DISPUTE_ID}, 'sistema', NULL, 'Disputa aberta pelo Cliente', 'equipamentos', ${at('12')});
      INSERT INTO public.demurrage_dispute_attachments (id, message_id, dispute_id, customer_id, storage_path, file_name, mime_type, size_bytes, uploaded_by, created_at) OVERRIDING SYSTEM VALUE VALUES (${ATTACHMENT_ID}, ${MESSAGE_ID}, ${DISPUTE_ID}, ${CUSTOMER_ID}, 'x/comprovante.pdf', 'comprovante.pdf', 'application/pdf', 10, '${ADMIN_ID}', ${at('13')});
      SET session_replication_role = origin;
    `)
  })
  afterAll(cleanup)

  it('cada trilha vem com a origem, a ação, o autor e o registro pelo nome', () => {
    const result = asAdmin(`SELECT source, action, actor_kind, coalesce(actor_name, '-'), field_name, coalesce(old_value, '-'), coalesce(new_value, '-'),
        coalesce(justification, '-'), coalesce(entity_label, '-')
      FROM public.admin_action_history(p_date_from => '${DAY}', p_date_to => '${DAY}')`)
    expect(result.error).toBe('')
    expect(result.output.split('\n')).toEqual([
      'anexo|criou|equipe|Alice 561|dispute_attachment|-|comprovante.pdf|-|Invoice DEM-561 · CLIENTE 561 LTDA',
      'disputa|criou|sistema|-|dispute_message|-|Disputa aberta pelo Cliente|-|Invoice DEM-561 · CLIENTE 561 LTDA',
      'comunicado|criou|sistema|-|comunicado|aviso_chegada_noa|-|enviado|-|Santos 561 / V561 · BRSSZ · CLIENTE 561 LTDA',
      // Sem mudança: uma linha, com o motivo do Sistema sem o número interno.
      'portal_evento|alterou|sistema|-|portal_event|-|-|Supressão liberada para o Cliente.|CLIENTE 561 LTDA',
      // O Cliente pelo Portal, sem autor gravado, vem pelo login da conta.
      'portal_situacao|alterou|portal|Cliente pelo Portal: CLIENTE 561 LTDA|portal_situation|convite_pendente|ativo|Ativação concluída pelo cliente|CLIENTE 561 LTDA',
      // Decisão e situação mudaram juntas: duas linhas.
      'portal|alterou|equipe|Alice 561|portal_decision|aguardando_analise|aprovado_para_provisionar|Conferido o contrato|CLIENTE 561 LTDA',
      'portal_situacao|alterou|equipe|Alice 561|portal_situation|sem_conta|convite_pendente|Conferido o contrato|CLIENTE 561 LTDA',
      'ce_unlock|alterou|equipe|Alice 561|ce_unlock|submit|-|BL561|Cliente precisa retirar hoje|B/L BL561 · CLIENTE 561 LTDA',
      // Rotina do Desbloqueio (ator zerado) é o Sistema.
      'ce_unlock|alterou|sistema|-|ce_unlock|reopen|-|BL561|-|B/L BL561 · CLIENTE 561 LTDA',
    ])
  })

  it('filtros de assunto, ação e autor valem para as trilhas e o total conta todas', () => {
    const subject = asAdmin(`SELECT string_agg(source, ',') FROM public.admin_action_history(p_entity_types => ARRAY['ce_unlock_request'], p_date_from => '${DAY}', p_date_to => '${DAY}')`)
    expect(subject.output).toBe('ce_unlock,ce_unlock')
    const created = asAdmin(`SELECT string_agg(source, ',') FROM public.admin_action_history(p_action => 'criou', p_date_from => '${DAY}', p_date_to => '${DAY}')`)
    expect(created.output).toBe('anexo,disputa,comunicado')
    const system = asAdmin(`SELECT string_agg(source, ',') FROM public.admin_action_history(p_actor => 'sistema', p_date_from => '${DAY}', p_date_to => '${DAY}')`)
    expect(system.output).toBe('disputa,comunicado,portal_evento,ce_unlock')
    const portal = asAdmin(`SELECT string_agg(source, ',') FROM public.admin_action_history(p_actor => 'portal', p_date_from => '${DAY}', p_date_to => '${DAY}')`)
    expect(portal.output).toBe('portal_situacao')
    const total = asAdmin(`SELECT DISTINCT total_count FROM public.admin_action_history(p_date_from => '${DAY}', p_date_to => '${DAY}', p_limit => 2)`)
    expect(total.output).toBe('9')
  })

  it('a RPC refeita continua só do Administrativo', () => {
    expect(asAdmin(`SELECT count(*) FROM public.admin_action_history()`, OPERATOR_ID).error).toMatch(/Somente o Administrativo/)
  })
})

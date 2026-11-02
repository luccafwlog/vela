-- 561: Histórico de ações lê também as trilhas próprias de cada assunto.
--
-- Decisão do dono de 2026-11-01 (pendência do diagnóstico
-- docs/archive/audits/historico-de-acoes-2026-11-01.md): Desbloqueio de CE,
-- contas do Portal, Comunicados enviados e disputas de Demurrage já têm trilha
-- própria; a aba Admin › Histórico de ações passa a lê-las junto, sem gravar o
-- mesmo fato em dois lugares. Cada trilha continua sendo a fonte.
--
-- Mudança (só leitura; não grava nem reescreve linhas):
--   1. Índices por data nas trilhas (`created_at DESC`), para a página do
--      Histórico ler a mais recente de cada uma sem ordenar a tabela inteira.
--   2. `_audit_trail_label(assunto, chave, valor)`: o nome do registro de uma
--      linha de trilha (B/L e Cliente do pedido de Desbloqueio, Cliente da
--      conta do Portal, navio/viagem e Cliente do Comunicado, Invoice e
--      Cliente da disputa).
--   3. `admin_action_history` refeita (DROP + CREATE: o retorno ganha a coluna
--      `source`, que diz de qual trilha veio a linha; o par `source`/`id` é a
--      chave). A ação vem de cada trilha: rascunho de Desbloqueio, conta do
--      Portal criada, Comunicado, mensagem e anexo de disputa são "criou";
--      cancelamento de Desbloqueio é "excluiu"; o resto, "alterou". Ator do
--      sistema nas trilhas (inclusive o ator zerado das rotinas do Desbloqueio)
--      fica sem autor ("Sistema"), como em `audit_logs`; o Cliente que age pelo
--      Portal sem autor gravado é o login da conta. Na conta do Portal, decisão
--      e situação que mudam juntas viram duas linhas, e o evento sem mudança
--      das duas, uma linha com o motivo. Mensagem de disputa entra com até
--      500 caracteres ("…" quando cortada).
--
-- ponytail: a página junta seis fontes por UNION ALL e ordena pela data; com
-- os índices por data o planejador lê só o começo de cada uma, mas a contagem
-- (até 10.001) percorre as seis. Se pesar, o upgrade é uma tabela de eventos
-- única alimentada pelas trilhas.
--
-- Rollback: DROP FUNCTION public.admin_action_history(text[], text, text, date,
-- date, integer, integer) e recriar a da 558 (com os grants); DROP FUNCTION
-- public._audit_trail_label(text, text, text, bigint); DROP INDEX dos índices abaixo.

-- 1 -------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ce_unlock_events_created_at ON public.ce_unlock_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_provisioning_events_created_at ON public.portal_provisioning_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_communications_created_at ON public.customer_communications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_demurrage_dispute_messages_created_at ON public.demurrage_dispute_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_demurrage_dispute_attachments_created_at ON public.demurrage_dispute_attachments (created_at DESC);

-- 2 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._audit_trail_label(p_entity_type text, p_entity_id text, p_value text, p_customer_id bigint DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_text text;
BEGIN
  IF p_entity_type = 'ce_unlock_request' THEN
    -- Evento sem pedido (planilha gerada para a ZPT): o Cliente do evento.
    IF NULLIF(p_entity_id, '') IS NOT NULL THEN
      SELECT c.name INTO v_text
        FROM public.ce_unlock_requests r JOIN public.customers c ON c.id = r.customer_id
       WHERE r.id = p_entity_id::uuid;
    END IF;
    v_text := COALESCE(v_text, public._audit_value_label('customer_id', p_customer_id::text));
    RETURN NULLIF(concat_ws(' · ', 'B/L ' || NULLIF(btrim(p_value), ''), v_text), '');
  ELSIF p_entity_type = 'portal_account' THEN
    RETURN public._audit_value_label('customer_id', p_entity_id);
  ELSIF p_entity_type = 'customer_communication' THEN
    SELECT NULLIF(concat_ws(' · ',
             NULLIF(concat_ws(' / ', NULLIF(btrim(cc.vessel_name), ''), NULLIF(btrim(cc.voyage_number), '')), ''),
             NULLIF(btrim(cc.anchor_port), ''), c.name), '')
      INTO v_text
      FROM public.customer_communications cc LEFT JOIN public.customers c ON c.id = cc.customer_id
     WHERE cc.id = p_entity_id::bigint;
    RETURN v_text;
  ELSIF p_entity_type = 'demurrage_dispute' THEN
    SELECT NULLIF(concat_ws(' · ', 'Invoice ' || NULLIF(btrim(di.doc_number), ''), c.name), '')
      INTO v_text
      FROM public.demurrage_disputes d
      LEFT JOIN public.demurrage_invoices di ON di.id = d.demurrage_invoice_id
      LEFT JOIN public.customers c ON c.id = d.customer_id
     WHERE d.id = p_entity_id::bigint;
    RETURN v_text;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._audit_trail_label(text, text, text, bigint) FROM PUBLIC, anon, authenticated;

-- 3 -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_action_history(text[], text, text, date, date, integer, integer);

CREATE FUNCTION public.admin_action_history(
  p_entity_types text[] DEFAULT NULL,
  p_actor text DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  source text,
  id bigint,
  changed_at timestamp with time zone,
  entity_type text,
  field_name text,
  old_value text,
  new_value text,
  justification text,
  action text,
  actor_kind text,
  actor_name text,
  actor_email text,
  actor_department text,
  entity_label text,
  old_label text,
  new_label text,
  value_labels jsonb,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor text := NULLIF(btrim(COALESCE(p_actor, '')), '');
  v_action text := NULLIF(btrim(COALESCE(p_action, '')), '');
  v_actor_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo consulta o Histórico de ações.' USING ERRCODE = '42501';
  END IF;
  IF v_action IS NOT NULL AND v_action NOT IN ('criou', 'alterou', 'excluiu') THEN
    RAISE EXCEPTION 'Ação desconhecida no filtro: %.', v_action USING ERRCODE = '22023';
  END IF;
  IF v_actor IS NOT NULL AND v_actor NOT IN ('sistema', 'portal') THEN
    IF v_actor !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Autor desconhecido no filtro.' USING ERRCODE = '22023';
    END IF;
    v_actor_id := v_actor::uuid;
  END IF;

  -- Filtro uma vez só, inline na página e na contagem (NOT MATERIALIZED): a
  -- página usa o índice de `changed_at`, e a contagem para em 10.001.
  RETURN QUERY
  WITH events AS NOT MATERIALIZED (
    -- Histórico de ações (audit_logs) e, desde a 561, as trilhas próprias de
    -- cada assunto, lidas aqui sem gravar em dobro (decisão do dono de
    -- 2026-11-01): Desbloqueio de CE, contas do Portal, Comunicados enviados e
    -- mensagens e anexos das disputas de Demurrage.
    SELECT 'audit'::text AS source, a.id, a.changed_at, a.entity_type, a.entity_id, a.field_name,
           a.old_value, a.new_value, a.justification, a.changed_by, a.actor_department,
           public._audit_action_kind(a.field_name, a.new_value) AS action_kind, NULL::bigint AS customer_id
    FROM public.audit_logs a
    UNION ALL
    -- Rotinas do Desbloqueio gravam o ator zerado: é o Sistema.
    SELECT 'ce_unlock', e.id, e.created_at, 'ce_unlock_request', e.request_id::text, 'ce_unlock|' || e.action,
           NULL, e.bl_id, NULLIF(btrim(e.reason), ''),
           NULLIF(e.actor_id, '00000000-0000-0000-0000-000000000000'::uuid), NULL,
           CASE WHEN e.action = 'draft' THEN 'criou' WHEN e.action = 'cancel' THEN 'excluiu' ELSE 'alterou' END,
           e.customer_id
    FROM public.ce_unlock_events e
    UNION ALL
    -- Conta do Portal: uma linha por mudança (decisão e situação podem mudar
    -- juntas); evento sem mudança das duas (troca de e-mail, liberação de
    -- supressão, troca de CNPJ) vira uma linha só com o motivo. O Cliente que
    -- age pelo Portal sem autor gravado (Edge Function com service_role) é o
    -- login da conta. "Cliente #<id>" no texto do Sistema sai do motivo.
    SELECT CASE k.kind WHEN 'decision' THEN 'portal' WHEN 'situation' THEN 'portal_situacao' ELSE 'portal_evento' END,
           pe.id, pe.created_at, 'portal_account', pe.customer_id::text, 'portal_' || k.kind,
           CASE k.kind WHEN 'decision' THEN pe.previous_decision WHEN 'situation' THEN pe.previous_situation END,
           CASE k.kind WHEN 'decision' THEN pe.new_decision WHEN 'situation' THEN pe.new_situation END,
           NULLIF(btrim(regexp_replace(COALESCE(pe.reason, ''), 'Cliente #[0-9]+', 'Cliente', 'g')), ''),
           CASE WHEN pe.actor_type = 'sistema' THEN NULL
                WHEN pe.actor_type = 'cliente' THEN COALESCE(pe.actor_id, acct.auth_user_id)
                ELSE pe.actor_id END,
           CASE WHEN pe.actor_type IN ('documentacao', 'administrativo') THEN pe.actor_type END,
           CASE WHEN pe.previous_decision IS NULL AND pe.previous_situation IS NULL THEN 'criou' ELSE 'alterou' END,
           pe.customer_id
    FROM public.portal_provisioning_events pe
    LEFT JOIN LATERAL (
      SELECT cpa.auth_user_id FROM public.customer_portal_accounts cpa
       WHERE (pe.account_id IS NOT NULL AND cpa.id = pe.account_id)
          OR (pe.account_id IS NULL AND cpa.customer_id = pe.customer_id)
       ORDER BY cpa.id LIMIT 1
    ) acct ON pe.actor_type = 'cliente' AND pe.actor_id IS NULL
    CROSS JOIN LATERAL (
      SELECT 'decision'::text AS kind WHERE pe.new_decision IS DISTINCT FROM pe.previous_decision
      UNION ALL
      SELECT 'situation' WHERE pe.new_situation IS DISTINCT FROM pe.previous_situation
      UNION ALL
      SELECT 'event' WHERE pe.new_decision IS NOT DISTINCT FROM pe.previous_decision
                       AND pe.new_situation IS NOT DISTINCT FROM pe.previous_situation
    ) k
    UNION ALL
    SELECT 'comunicado', c.id, c.created_at, 'customer_communication', c.id::text, 'comunicado|' || c.kind,
           NULL, c.status, NULL, c.created_by, NULL, 'criou', c.customer_id
    FROM public.customer_communications c
    UNION ALL
    SELECT 'disputa', m.id, m.created_at, 'demurrage_dispute', m.dispute_id::text, 'dispute_message',
           NULL, CASE WHEN char_length(m.body) > 500 THEN left(m.body, 499) || '…' ELSE m.body END, NULL,
           CASE WHEN m.author_type = 'sistema' THEN NULL ELSE m.author_id END,
           CASE WHEN m.author_type IN ('equipamentos', 'administrativo') THEN m.author_type END,
           'criou', NULL
    FROM public.demurrage_dispute_messages m
    UNION ALL
    SELECT 'anexo', t.id, t.created_at, 'demurrage_dispute', t.dispute_id::text, 'dispute_attachment',
           NULL, t.file_name, NULL, t.uploaded_by, NULL, 'criou', t.customer_id
    FROM public.demurrage_dispute_attachments t
  ),
  filtered AS NOT MATERIALIZED (
    SELECT ev.*
    FROM events ev
    WHERE (p_entity_types IS NULL OR cardinality(p_entity_types) = 0 OR ev.entity_type = ANY (p_entity_types))
      AND (v_actor IS NULL
        OR (v_actor = 'sistema' AND ev.changed_by IS NULL)
        OR (v_actor = 'portal' AND ev.changed_by IN (SELECT cpa.auth_user_id FROM public.customer_portal_accounts cpa WHERE cpa.auth_user_id IS NOT NULL))
        OR (v_actor_id IS NOT NULL AND ev.changed_by = v_actor_id))
      AND (p_date_from IS NULL OR ev.changed_at >= (p_date_from::timestamp AT TIME ZONE 'America/Sao_Paulo'))
      AND (p_date_to IS NULL OR ev.changed_at < ((p_date_to + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'))
      AND (v_action IS NULL OR ev.action_kind = v_action)
  ),
  total AS (
    SELECT count(*) AS n FROM (SELECT 1 FROM filtered LIMIT 10001) capped
  ),
  page AS (
    SELECT f.*
    FROM filtered f
    ORDER BY f.changed_at DESC, f.source, f.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT
    p.source,
    p.id,
    p.changed_at,
    p.entity_type,
    p.field_name,
    p.old_value,
    p.new_value,
    p.justification,
    p.action_kind,
    CASE
      WHEN p.changed_by IS NULL THEN 'sistema'
      WHEN up.id IS NOT NULL THEN 'equipe'
      WHEN portal.customer_name IS NOT NULL THEN 'portal'
      ELSE 'desconhecido'
    END,
    COALESCE(up.full_name, portal.customer_name),
    au.email::text,
    COALESCE(p.actor_department, up.role),
    CASE WHEN p.source = 'audit' THEN public._audit_entity_label(p.entity_type, p.entity_id)
         ELSE public._audit_trail_label(p.entity_type, p.entity_id, p.new_value, p.customer_id) END,
    CASE WHEN p.source = 'audit' THEN public._audit_value_label(p.field_name, p.old_value) END,
    CASE WHEN p.source = 'audit' THEN public._audit_value_label(p.field_name, p.new_value) END,
    -- Registro inteiro em JSON (só criação/exclusão): nome de cada chave de cadastro.
    CASE WHEN p.source = 'audit' AND p.action_kind IN ('criou', 'excluiu') THEN
      (SELECT jsonb_object_agg(kv.key, kv.label)
         FROM (SELECT e.key, public._audit_value_label(e.key, e.value) AS label
                 FROM jsonb_each_text(public._audit_try_jsonb(COALESCE(p.new_value, p.old_value))) e) kv
        WHERE kv.label IS NOT NULL)
    END,
    (SELECT t.n FROM total t)
  FROM page p
  LEFT JOIN public.user_profiles up ON up.id = p.changed_by
  LEFT JOIN auth.users au ON au.id = p.changed_by
  LEFT JOIN LATERAL (
    SELECT 'Cliente pelo Portal: ' || c.name AS customer_name
      FROM public.customer_portal_accounts cpa
      JOIN public.customers c ON c.id = cpa.customer_id
     WHERE cpa.auth_user_id = p.changed_by
     LIMIT 1
  ) portal ON up.id IS NULL
  ORDER BY p.changed_at DESC, p.source, p.id DESC;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_action_history(text[], text, text, date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_action_history(text[], text, text, date, date, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.admin_action_history(text[], text, text, date, date, integer, integer) IS
  'Histórico de ações da Administração (558, 561): audit_logs e as trilhas próprias (Desbloqueio de CE, Portal, Comunicados, disputas), com autor, ação, registro e valores pelo nome; só o Administrativo.';

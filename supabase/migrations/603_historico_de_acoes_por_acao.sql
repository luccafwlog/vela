-- 603: Histórico de ações com uma linha por ação, busca e sem a linha repetida.
--
-- Decisão do dono de 2026-11-06 (docs/archive/plans/2026-11-06-administracao-revisada.md,
-- etapa 2; diagnóstico em docs/archive/audits/administracao-2026-11-06.md): 21.000
-- linhas de `audit_logs` eram 729 ações. Uma ação é o conjunto de linhas gravadas
-- na mesma transação pela mesma pessoa: `changed_at` é o `now()` da transação, então
-- o par (`changed_at`, `changed_by`) a identifica. As trilhas próprias (Desbloqueio
-- de CE, Portal, Comunicados, disputas) já são uma linha por ação.
--
-- Mudança (só leitura; não grava nem reescreve linhas):
--   1. `_admin_history_events`: as linhas de `audit_logs` e das trilhas (a união da
--      561), com a chave da ação (`action_key`), a família do registro (`bl` e `bls`
--      contam como o mesmo B/L) e sem a linha do gatilho que repete, no mesmo
--      instante, o mesmo campo da linha gravada pela função (`bl`/`bls`,
--      `invoice`/`invoices`, `voyage`/`voyages`, `customer`/`customers`) — a mesma
--      regra que o `bl_timeline` já usa no Histórico do B/L. Filtros de autor e
--      período aplicados em cada fonte; busca por B/L, CE, container, navio, viagem
--      ou Cliente (nome ou CNPJ), pelo registro, pelo B/L da linha e pelo texto.
--   2. `admin_action_history_actions`: uma linha por ação, com autor, motivo, número
--      de linhas e de registros, o resumo por família e tipo de ação (`groups`) e a
--      linha que a representa já com os nomes; a contagem é de ações, até 10.001.
--   3. `admin_action_history` refeita (DROP + CREATE): ganha `p_search` e
--      `p_action_key` (todas as linhas de uma ação, para a linha aberta e a planilha)
--      e o limite por chamada sobe para 1.000; deixa de repetir a linha do gatilho.
--
-- ponytail: as funções leem as fontes inteiras dentro do período filtrado e agrupam
-- em memória; a tela abre em 30 dias. Se `audit_logs` crescer a ponto de pesar sem
-- período, o upgrade é uma tabela de ações gravada junto com as linhas.
--
-- Rollback: DROP FUNCTION public.admin_action_history_actions(text[], text, text,
-- date, date, text, integer, integer); DROP FUNCTION public.admin_action_history(text[],
-- text, text, date, date, integer, integer, text, text); recriar a
-- `admin_action_history` da 561 com os grants; DROP FUNCTION
-- public._admin_history_events(text[], text, text, date, date, text, text).

-- 1 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._admin_history_events(
  p_entity_types text[] DEFAULT NULL,
  p_actor text DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_action_key text DEFAULT NULL
)
RETURNS TABLE(
  source text,
  id bigint,
  changed_at timestamp with time zone,
  entity_type text,
  entity_id text,
  field_name text,
  old_value text,
  new_value text,
  justification text,
  changed_by uuid,
  actor_department text,
  action_kind text,
  customer_id bigint,
  action_key text,
  family text,
  line_matches boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_actor text := NULLIF(btrim(COALESCE(p_actor, '')), '');
  v_action text := NULLIF(btrim(COALESCE(p_action, '')), '');
  v_key text := NULLIF(btrim(COALESCE(p_action_key, '')), '');
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_like text;
  v_actor_id uuid;
  v_from timestamptz := CASE WHEN p_date_from IS NULL THEN NULL ELSE p_date_from::timestamp AT TIME ZONE 'America/Sao_Paulo' END;
  v_to timestamptz := CASE WHEN p_date_to IS NULL THEN NULL ELSE (p_date_to + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo' END;
  v_bl_ids text[] := ARRAY[]::text[];
  v_container_ids text[] := ARRAY[]::text[];
  v_customer_ids text[] := ARRAY[]::text[];
  v_voyage_ids text[] := ARRAY[]::text[];
  v_key_source text;
  v_key_at timestamptz;
  v_key_by uuid;
  v_key_id bigint;
BEGIN
  IF v_action IS NOT NULL AND v_action NOT IN ('criou', 'alterou', 'excluiu') THEN
    RAISE EXCEPTION 'Ação desconhecida no filtro: %.', v_action USING ERRCODE = '22023';
  END IF;
  IF v_actor IS NOT NULL AND v_actor NOT IN ('sistema', 'portal') THEN
    IF v_actor !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Autor desconhecido no filtro.' USING ERRCODE = '22023';
    END IF;
    v_actor_id := v_actor::uuid;
  END IF;

  -- Uma ação pela chave: as linhas dela, sem os demais filtros.
  IF v_key IS NOT NULL THEN
    v_key_source := split_part(v_key, '|', 1);
    IF v_key_source = 'audit' THEN
      BEGIN
        v_key_at := split_part(v_key, '|', 2)::timestamptz;
        v_key_by := NULLIF(split_part(v_key, '|', 3), 'sistema')::uuid;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Ação desconhecida.' USING ERRCODE = '22023';
      END;
    ELSE
      BEGIN
        v_key_id := split_part(v_key, '|', 2)::bigint;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Ação desconhecida.' USING ERRCODE = '22023';
      END;
    END IF;
    v_actor := NULL; v_actor_id := NULL; v_action := NULL; v_search := NULL;
    v_from := NULL; v_to := NULL;
  END IF;

  IF v_search IS NOT NULL THEN
    v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    SELECT COALESCE(array_agg(b.id::text), ARRAY[]::text[]) INTO v_bl_ids
      FROM public.bls b
     WHERE b.id ILIKE v_like OR b.ce_mercante ILIKE v_like;
    SELECT COALESCE(array_agg(c.id::text), ARRAY[]::text[]),
           v_bl_ids || COALESCE(array_agg(DISTINCT c.bl_id::text), ARRAY[]::text[])
      INTO v_container_ids, v_bl_ids
      FROM public.bl_containers c
     WHERE replace(c.container_number, ' ', '') ILIKE replace(v_like, ' ', '');
    SELECT COALESCE(array_agg(c.id::text), ARRAY[]::text[]) INTO v_customer_ids
      FROM public.customers c
     WHERE c.name ILIKE v_like
        OR (length(regexp_replace(v_search, '\D', '', 'g')) >= 8 AND regexp_replace(COALESCE(c.cnpj_cpf, ''), '\D', '', 'g') LIKE '%' || regexp_replace(v_search, '\D', '', 'g') || '%');
    SELECT COALESCE(array_agg(v.id::text), ARRAY[]::text[]) INTO v_voyage_ids
      FROM public.voyages v
      LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
     WHERE v.voyage_number ILIKE v_like OR vs.name ILIKE v_like
        OR concat_ws(' ', vs.name, v.voyage_number) ILIKE v_like;
  END IF;

  RETURN QUERY
  WITH raw AS (
    SELECT 'audit'::text AS source, a.id, a.changed_at, a.entity_type, a.entity_id, a.field_name,
           a.old_value, a.new_value, a.justification, a.changed_by, a.actor_department,
           public._audit_action_kind(a.field_name, a.new_value) AS action_kind, NULL::bigint AS customer_id,
           a.bl_id::text AS bl_id
    FROM public.audit_logs a
    WHERE (v_from IS NULL OR a.changed_at >= v_from)
      AND (v_to IS NULL OR a.changed_at < v_to)
      AND (v_key IS NULL OR (v_key_source = 'audit' AND a.changed_at = v_key_at AND a.changed_by IS NOT DISTINCT FROM v_key_by))
      -- A linha do gatilho que repete a linha gravada pela função (mesmo campo,
      -- mesmo instante) sai: fica a que tem o motivo de quem fez.
      AND NOT (a.entity_type IN ('bls', 'invoices', 'voyages', 'customers') AND EXISTS (
        SELECT 1 FROM public.audit_logs s
         WHERE s.entity_type = CASE a.entity_type WHEN 'bls' THEN 'bl' WHEN 'invoices' THEN 'invoice'
                                                  WHEN 'voyages' THEN 'voyage' ELSE 'customer' END
           AND s.entity_id = a.entity_id
           AND s.changed_at = a.changed_at
           AND split_part(s.field_name, '|', 1) = a.field_name))
    UNION ALL
    SELECT 'ce_unlock', e.id, e.created_at, 'ce_unlock_request', e.request_id::text, 'ce_unlock|' || e.action,
           NULL, e.bl_id, NULLIF(btrim(e.reason), ''),
           NULLIF(e.actor_id, '00000000-0000-0000-0000-000000000000'::uuid), NULL,
           CASE WHEN e.action = 'draft' THEN 'criou' WHEN e.action = 'cancel' THEN 'excluiu' ELSE 'alterou' END,
           e.customer_id, NULL
    FROM public.ce_unlock_events e
    WHERE (v_from IS NULL OR e.created_at >= v_from) AND (v_to IS NULL OR e.created_at < v_to)
      AND (v_key IS NULL OR (v_key_source = 'ce_unlock' AND e.id = v_key_id))
    UNION ALL
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
           pe.customer_id, NULL
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
    WHERE (v_from IS NULL OR pe.created_at >= v_from) AND (v_to IS NULL OR pe.created_at < v_to)
      AND (v_key IS NULL OR (v_key_source = 'portal' AND pe.id = v_key_id))
    UNION ALL
    SELECT 'comunicado', c.id, c.created_at, 'customer_communication', c.id::text, 'comunicado|' || c.kind,
           NULL, c.status, NULL, c.created_by, NULL, 'criou', c.customer_id, NULL
    FROM public.customer_communications c
    WHERE (v_from IS NULL OR c.created_at >= v_from) AND (v_to IS NULL OR c.created_at < v_to)
      AND (v_key IS NULL OR (v_key_source = 'comunicado' AND c.id = v_key_id))
    UNION ALL
    SELECT 'disputa', m.id, m.created_at, 'demurrage_dispute', m.dispute_id::text, 'dispute_message',
           NULL, CASE WHEN char_length(m.body) > 500 THEN left(m.body, 499) || '…' ELSE m.body END, NULL,
           CASE WHEN m.author_type = 'sistema' THEN NULL ELSE m.author_id END,
           CASE WHEN m.author_type IN ('equipamentos', 'administrativo') THEN m.author_type END,
           'criou', NULL, NULL
    FROM public.demurrage_dispute_messages m
    WHERE (v_from IS NULL OR m.created_at >= v_from) AND (v_to IS NULL OR m.created_at < v_to)
      AND (v_key IS NULL OR (v_key_source = 'disputa' AND m.id = v_key_id))
    UNION ALL
    SELECT 'anexo', t.id, t.created_at, 'demurrage_dispute', t.dispute_id::text, 'dispute_attachment',
           NULL, t.file_name, NULL, t.uploaded_by, NULL, 'criou', t.customer_id, NULL
    FROM public.demurrage_dispute_attachments t
    WHERE (v_from IS NULL OR t.created_at >= v_from) AND (v_to IS NULL OR t.created_at < v_to)
      AND (v_key IS NULL OR (v_key_source = 'anexo' AND t.id = v_key_id))
  ),
  keyed AS (
    SELECT r.*,
      -- As linhas de decisão, situação e evento da conta do Portal são o mesmo evento.
      CASE WHEN r.source = 'audit'
           THEN 'audit|' || to_char(r.changed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || COALESCE(r.changed_by::text, 'sistema')
           WHEN r.source LIKE 'portal%' THEN 'portal|' || r.id
           ELSE r.source || '|' || r.id END AS action_key,
      CASE r.entity_type WHEN 'bl' THEN 'bls' WHEN 'invoice' THEN 'invoices' WHEN 'voyage' THEN 'voyages'
                         WHEN 'customer' THEN 'customers' WHEN 'bl_container' THEN 'bl_containers'
                         WHEN 'container' THEN 'bl_containers' ELSE r.entity_type END AS family
    FROM raw r
    WHERE v_actor IS NULL
       OR (v_actor = 'sistema' AND r.changed_by IS NULL)
       OR (v_actor = 'portal' AND r.changed_by IN (SELECT cpa.auth_user_id FROM public.customer_portal_accounts cpa WHERE cpa.auth_user_id IS NOT NULL))
       OR (v_actor_id IS NOT NULL AND r.changed_by = v_actor_id)
  )
  SELECT k.source, k.id, k.changed_at, k.entity_type, k.entity_id, k.field_name, k.old_value, k.new_value,
         k.justification, k.changed_by, k.actor_department, k.action_kind, k.customer_id, k.action_key, k.family,
         (
           (p_entity_types IS NULL OR cardinality(p_entity_types) = 0 OR k.entity_type = ANY (p_entity_types))
           AND (v_action IS NULL OR k.action_kind = v_action)
           AND (v_search IS NULL
             OR (k.family = 'bls' AND k.entity_id = ANY (v_bl_ids))
             OR k.bl_id = ANY (v_bl_ids)
             OR (k.family = 'bl_containers' AND k.entity_id = ANY (v_container_ids))
             OR (k.family = 'customers' AND k.entity_id = ANY (v_customer_ids))
             OR (k.entity_type = 'portal_account' AND k.entity_id = ANY (v_customer_ids))
             OR k.customer_id::text = ANY (v_customer_ids)
             OR (k.family = 'voyages' AND k.entity_id = ANY (v_voyage_ids))
             OR (k.entity_type LIKE 'voyage\_%' AND split_part(k.entity_id, '::', 1) = ANY (v_voyage_ids))
             OR k.justification ILIKE v_like
             OR k.new_value ILIKE v_like
             OR k.old_value ILIKE v_like)
         ) AS line_matches
  FROM keyed k;
END;
$function$;
REVOKE ALL ON FUNCTION public._admin_history_events(text[], text, text, date, date, text, text) FROM PUBLIC, anon, authenticated;

-- 2 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_action_history_actions(
  p_entity_types text[] DEFAULT NULL,
  p_actor text DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  action_key text,
  source text,
  changed_at timestamp with time zone,
  action text,
  actor_kind text,
  actor_name text,
  actor_email text,
  actor_department text,
  justification text,
  line_count integer,
  entity_count integer,
  groups jsonb,
  entity_type text,
  field_name text,
  old_value text,
  new_value text,
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
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo consulta o Histórico de ações.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH ev AS MATERIALIZED (
    SELECT * FROM public._admin_history_events(p_entity_types, p_actor, p_action, p_date_from, p_date_to, p_search, NULL)
  ),
  matched AS (
    SELECT DISTINCT e.action_key FROM ev e WHERE e.line_matches
  ),
  total AS (
    SELECT count(*) AS n FROM (SELECT 1 FROM matched LIMIT 10001) capped
  ),
  heads AS (
    SELECT e.action_key, max(e.changed_at) AS changed_at
      FROM ev e JOIN matched m ON m.action_key = e.action_key
     GROUP BY e.action_key
  ),
  page AS (
    SELECT h.* FROM heads h
    ORDER BY h.changed_at DESC, h.action_key DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ),
  lines AS (
    SELECT e.* FROM ev e JOIN page p ON p.action_key = e.action_key
  ),
  -- Por registro: criado ou excluído vence "alterado" na mesma ação.
  per_entity AS (
    SELECT l.action_key, l.family, l.entity_id,
           CASE WHEN bool_or(l.action_kind = 'criou') THEN 'criou'
                WHEN bool_or(l.action_kind = 'excluiu') THEN 'excluiu' ELSE 'alterou' END AS kind,
           array_agg(DISTINCT split_part(COALESCE(l.field_name, ''), '|', 1)) AS fields
      FROM lines l GROUP BY l.action_key, l.family, l.entity_id
  ),
  group_base AS (
    SELECT pe.action_key, pe.family, pe.kind, count(*)::integer AS entities
      FROM per_entity pe GROUP BY pe.action_key, pe.family, pe.kind
  ),
  group_fields AS (
    SELECT pe.action_key, pe.family, pe.kind,
           (array_agg(DISTINCT f.field ORDER BY f.field))[1:8] AS fields
      FROM per_entity pe CROSS JOIN LATERAL unnest(pe.fields) AS f(field)
     WHERE f.field <> ''
     GROUP BY pe.action_key, pe.family, pe.kind
  ),
  grouped AS (
    SELECT b.action_key,
           jsonb_agg(jsonb_build_object('entity_type', b.family, 'kind', b.kind, 'entities', b.entities,
                                        'fields', COALESCE(to_jsonb(gf.fields), '[]'::jsonb))
                     ORDER BY b.entities DESC, b.family) AS groups,
           sum(b.entities)::integer AS entity_count
      FROM group_base b
      LEFT JOIN group_fields gf ON gf.action_key = b.action_key AND gf.family = b.family AND gf.kind = b.kind
     GROUP BY b.action_key
  ),
  summary AS (
    SELECT l.action_key,
           count(*)::integer AS line_count,
           -- A ação "criou" quando cria algum registro; "excluiu" quando só exclui.
           CASE WHEN bool_or(l.action_kind = 'criou') THEN 'criou'
                WHEN bool_and(l.action_kind = 'excluiu') THEN 'excluiu' ELSE 'alterou' END AS action,
           (array_agg(l.justification ORDER BY l.id) FILTER (WHERE NULLIF(btrim(l.justification), '') IS NOT NULL))[1] AS justification,
           (array_agg(l.actor_department ORDER BY l.id) FILTER (WHERE l.actor_department IS NOT NULL))[1] AS actor_department,
           (array_agg(l.changed_by))[1] AS changed_by,
           (array_agg(l.source ORDER BY l.id))[1] AS source,
           -- A linha que representa a ação: a primeira criação, ou a primeira linha.
           (array_agg(l.id ORDER BY (l.action_kind = 'criou') DESC, l.id))[1] AS head_id,
           (array_agg(l.source ORDER BY (l.action_kind = 'criou') DESC, l.id))[1] AS head_source
      FROM lines l GROUP BY l.action_key
  )
  SELECT
    p.action_key,
    s.source,
    p.changed_at,
    s.action,
    CASE
      WHEN s.changed_by IS NULL THEN 'sistema'
      WHEN up.id IS NOT NULL THEN 'equipe'
      WHEN portal.customer_name IS NOT NULL THEN 'portal'
      ELSE 'desconhecido'
    END,
    COALESCE(up.full_name, portal.customer_name),
    au.email::text,
    COALESCE(s.actor_department, up.role),
    s.justification,
    s.line_count,
    g.entity_count,
    g.groups,
    h.entity_type,
    h.field_name,
    h.old_value,
    h.new_value,
    CASE WHEN h.source = 'audit' THEN public._audit_entity_label(h.entity_type, h.entity_id)
         ELSE public._audit_trail_label(h.entity_type, h.entity_id, h.new_value, h.customer_id) END,
    CASE WHEN h.source = 'audit' THEN public._audit_value_label(h.field_name, h.old_value) END,
    CASE WHEN h.source = 'audit' THEN public._audit_value_label(h.field_name, h.new_value) END,
    CASE WHEN h.source = 'audit' AND h.action_kind IN ('criou', 'excluiu') THEN
      (SELECT jsonb_object_agg(kv.key, kv.label)
         FROM (SELECT e.key, public._audit_value_label(e.key, e.value) AS label
                 FROM jsonb_each_text(public._audit_try_jsonb(COALESCE(h.new_value, h.old_value))) e) kv
        WHERE kv.label IS NOT NULL)
    END,
    (SELECT t.n FROM total t)
  FROM page p
  JOIN summary s ON s.action_key = p.action_key
  JOIN grouped g ON g.action_key = p.action_key
  JOIN lines h ON h.action_key = p.action_key AND h.id = s.head_id AND h.source = s.head_source
  LEFT JOIN public.user_profiles up ON up.id = s.changed_by
  LEFT JOIN auth.users au ON au.id = s.changed_by
  LEFT JOIN LATERAL (
    SELECT 'Cliente pelo Portal: ' || c.name AS customer_name
      FROM public.customer_portal_accounts cpa
      JOIN public.customers c ON c.id = cpa.customer_id
     WHERE cpa.auth_user_id = s.changed_by
     LIMIT 1
  ) portal ON up.id IS NULL
  ORDER BY p.changed_at DESC, p.action_key DESC;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_action_history_actions(text[], text, text, date, date, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_action_history_actions(text[], text, text, date, date, text, integer, integer) TO authenticated;
COMMENT ON FUNCTION public.admin_action_history_actions(text[], text, text, date, date, text, integer, integer) IS
  'Histórico de ações por ação (603): uma linha por transação de quem fez, com o resumo por registro e a linha que a representa pelo nome; só o Administrativo.';

-- 3 -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_action_history(text[], text, text, date, date, integer, integer);

CREATE FUNCTION public.admin_action_history(
  p_entity_types text[] DEFAULT NULL,
  p_actor text DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL,
  p_action_key text DEFAULT NULL
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
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo consulta o Histórico de ações.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH filtered AS MATERIALIZED (
    SELECT ev.* FROM public._admin_history_events(p_entity_types, p_actor, p_action, p_date_from, p_date_to, p_search, p_action_key) ev
    WHERE p_action_key IS NOT NULL OR ev.line_matches
  ),
  total AS (
    SELECT count(*) AS n FROM (SELECT 1 FROM filtered LIMIT 10001) capped
  ),
  page AS (
    SELECT f.* FROM filtered f
    ORDER BY f.changed_at DESC, f.source, f.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 1000)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT
    p.source, p.id, p.changed_at, p.entity_type, p.field_name, p.old_value, p.new_value, p.justification,
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
REVOKE ALL ON FUNCTION public.admin_action_history(text[], text, text, date, date, integer, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_action_history(text[], text, text, date, date, integer, integer, text, text) TO authenticated;
COMMENT ON FUNCTION public.admin_action_history(text[], text, text, date, date, integer, integer, text, text) IS
  'Histórico de ações linha a linha (558, 561, 603): audit_logs sem a linha do gatilho repetida e as trilhas próprias, pelo nome; uma ação inteira por p_action_key; só o Administrativo.';

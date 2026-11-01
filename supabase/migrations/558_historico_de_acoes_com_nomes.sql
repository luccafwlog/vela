-- 558: Histórico de ações (Administração) lido com nomes, não com números.
--
-- Diagnóstico: docs/archive/audits/2026-11-01-historico-de-acoes.md.
--
-- Problema: a aba Histórico de ações lia `audit_logs` direto pela API e só o
-- nome do autor vinha à parte (`get_user_display_names`, 475). O registro que
-- mudou aparecia pelo identificador gravado, encurtado ("37", "12::BRSSZ",
-- "9f1c…"), e os campos que apontam para outro cadastro (Navio, Cliente,
-- Viagem, Terminal, Armador...) mostravam o número interno em De e Para, tanto
-- na edição de um campo quanto no registro inteiro gravado na criação e na
-- exclusão. O autor era só o nome: sem e-mail, sem distinguir o Cliente pelo
-- Portal de uma pessoa sem cadastro. Não havia filtro por tipo de ação.
--
-- Mudança (só leitura; não grava nem reescreve linhas):
--   1. `_audit_voyage_label(viagem)`: "Navio / Nº", a identidade da Viagem na
--      tela (`voyageDisplayName`); Viagem apagada vira "Viagem excluída".
--   2. `_audit_value_label(campo, valor)`: o nome do cadastro para os campos
--      que guardam a chave de outro (Cliente, Viagem, Navio, Armador, Porto,
--      Terminal/Local, Tabela, Item, Fatura, container, Manifesto, pessoa).
--      Campo que não é chave devolve NULL (a tela formata o valor).
--   3. `_audit_row_label(tabela, registro)`: o nome de um registro (atual ou o
--      JSON gravado na criação/exclusão) com o contexto que o identifica
--      (Viagem, porto, Cliente, B/L, Fatura).
--   4. `_audit_entity_label(assunto, id)`: o nome do registro de uma linha do
--      Histórico, pelo registro atual ou, se ele já foi apagado, pelo JSON da
--      criação/exclusão. As chaves "viagem::PORTO" (agenda, ADR) viram
--      "Navio / Nº · PORTO". Sem nome conhecido, NULL: a tela mostra só o
--      assunto, nunca o número.
--   5. RPC `admin_action_history`: a página do Histórico de ações com autor
--      (Equipe, Cliente pelo Portal ou Sistema; nome, e-mail e setor gravado),
--      ação (criou, alterou, excluiu), registro com nome, De e Para com nome
--      quando o campo é chave de cadastro, nomes das chaves do registro JSON e
--      o total da busca. Filtros: assuntos, autor (pessoa, `sistema` ou
--      `portal`), ação e dias de Brasília. Só o Administrativo (a aba é dele e
--      o e-mail do autor é dado do cadastro de usuários).
--
-- ponytail: os nomes são resolvidos por linha da página (50 linhas, algumas
-- consultas por chave primária cada). Se a página crescer ou ficar lenta, o
-- upgrade é gravar o nome do registro na própria linha de `audit_logs`.
--
-- Rollback: DROP FUNCTION public.admin_action_history(text[], text, text, date,
-- date, integer, integer), public._audit_entity_label(text, text),
-- public._audit_row_label(text, jsonb), public._audit_value_label(text, text),
-- public._audit_voyage_label(text).

-- 1 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._audit_voyage_label(p_voyage_id text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_text text;
BEGIN
  IF p_voyage_id IS NULL OR btrim(p_voyage_id) !~ '^[0-9]{1,18}$' THEN
    RETURN NULL;
  END IF;
  SELECT NULLIF(concat_ws(' / ', NULLIF(btrim(vs.name), ''), NULLIF(btrim(v.voyage_number), '')), '')
    INTO v_text
    FROM public.voyages v LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
   WHERE v.id = btrim(p_voyage_id)::bigint;
  RETURN COALESCE(v_text, 'Viagem excluída');
END;
$function$;
REVOKE ALL ON FUNCTION public._audit_voyage_label(text) FROM PUBLIC, anon, authenticated;

-- 2 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._audit_value_label(p_field text, p_value text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_field text := split_part(COALESCE(p_field, ''), '|', 1);
  v_value text := btrim(COALESCE(p_value, ''));
  v_text text;
  v_is_uuid boolean;
  v_is_int boolean;
BEGIN
  IF v_value = '' OR v_value = 'null' THEN
    RETURN NULL;
  END IF;
  v_is_uuid := v_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_is_int := v_value ~ '^[0-9]{1,18}$';

  IF v_field IN ('customer_id', 'suggested_customer_id', 'client_id') AND v_is_int THEN
    SELECT c.name INTO v_text FROM public.customers c WHERE c.id = v_value::bigint;
    RETURN COALESCE(v_text, 'Cliente excluído');
  ELSIF v_field IN ('voyage_id', 'original_voyage_id', 'target_voyage_id') THEN
    RETURN public._audit_voyage_label(v_value);
  ELSIF v_field = 'vessel_id' AND v_is_int THEN
    SELECT vs.name INTO v_text FROM public.vessels vs WHERE vs.id = v_value::bigint;
    RETURN COALESCE(v_text, 'Navio excluído');
  ELSIF v_field = 'carrier_id' AND v_is_int THEN
    SELECT c.name INTO v_text FROM public.carriers c WHERE c.id = v_value::bigint;
    RETURN COALESCE(v_text, 'Armador excluído');
  ELSIF v_field IN ('pol_id', 'pod_id', 'port_id', 'pod_port_id', 'terminal_port_id') AND v_is_int THEN
    SELECT concat_ws(' · ', p.name, p.locode) INTO v_text FROM public.ports p WHERE p.id = v_value::bigint;
    RETURN COALESCE(v_text, 'Porto excluído');
  ELSIF v_field IN ('terminal_id', 'depot_id', 'local_id', 'route_destino_id') AND v_is_uuid THEN
    SELECT d.name INTO v_text FROM public.depots d WHERE d.id = v_value::uuid;
    RETURN COALESCE(v_text, 'Local excluído');
  ELSIF v_field = 'manifesto_mercante_id' AND v_is_uuid THEN
    SELECT m.numero INTO v_text FROM public.manifestos_mercante m WHERE m.id = v_value::uuid;
    RETURN COALESCE('Manifesto ' || v_text, 'Manifesto excluído');
  ELSIF v_field = 'charge_table_id' AND v_is_int THEN
    SELECT t.name INTO v_text FROM public.charge_tables t WHERE t.id = v_value::bigint;
    RETURN COALESCE(v_text, 'Tabela excluída');
  ELSIF v_field = 'charge_item_id' AND v_is_int THEN
    SELECT i.name INTO v_text FROM public.charge_table_items i WHERE i.id = v_value::bigint;
    RETURN COALESCE(v_text, 'Item excluído');
  ELSIF v_field = 'invoice_id' AND v_is_int THEN
    SELECT COALESCE('Fatura ' || NULLIF(btrim(i.invoice_number), ''), 'Fatura do B/L ' || i.bl_id) INTO v_text
      FROM public.invoices i WHERE i.id = v_value::bigint;
    RETURN COALESCE(v_text, 'Fatura excluída');
  ELSIF v_field = 'container_id' AND v_is_int THEN
    RETURN public._bl_timeline_value('container_id', v_value);
  ELSIF v_field = 'bl_id' AND v_is_uuid THEN
    SELECT 'B/L ' || g.bl_number INTO v_text FROM public.granite_bls g WHERE g.id = v_value::uuid;
    RETURN COALESCE(v_text, 'B/L excluído');
  ELSIF v_field = 'bl_id' THEN
    RETURN 'B/L ' || v_value;
  ELSIF v_field IN ('created_by', 'updated_by', 'closed_by', 'cancelled_by', 'deactivated_by',
                    'granted_by', 'revoked_by', 'registered_by', 'omitted_by', 'reverted_by',
                    'uploaded_by', 'imported_by', 'issued_by', 'settled_by', 'reviewed_by')
        AND v_is_uuid THEN
    SELECT up.full_name INTO v_text FROM public.user_profiles up WHERE up.id = v_value::uuid;
    RETURN COALESCE(v_text, 'Pessoa sem cadastro interno');
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._audit_value_label(text, text) FROM PUBLIC, anon, authenticated;

-- 3 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._audit_row_label(p_table text, p_row jsonb)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_main text;
  v_port text;
  v_voyage text;
  v_customer text;
  v_bl text;
  v_invoice text;
BEGIN
  IF p_row IS NULL OR jsonb_typeof(p_row) <> 'object' THEN
    RETURN NULL;
  END IF;

  v_main := CASE p_table
    WHEN 'voyages' THEN public._audit_voyage_label(p_row ->> 'id')
    WHEN 'bls' THEN 'B/L ' || (p_row ->> 'id')
    WHEN 'granite_bls' THEN 'B/L ' || (p_row ->> 'bl_number')
    WHEN 'user_profiles' THEN p_row ->> 'full_name'
    WHEN 'invoices' THEN COALESCE('Fatura ' || NULLIF(p_row ->> 'invoice_number', ''), 'Fatura')
    WHEN 'demurrage_invoices' THEN COALESCE('Invoice ' || NULLIF(p_row ->> 'doc_number', ''), 'Invoice de Demurrage')
    WHEN 'manifestos_mercante' THEN 'Manifesto ' || (p_row ->> 'numero')
    WHEN 'customer_contacts' THEN COALESCE(NULLIF(p_row ->> 'email', ''), p_row ->> 'name')
    WHEN 'vehicles' THEN 'Chassi ' || (p_row ->> 'chassis')
    WHEN 'ports' THEN concat_ws(' · ', p_row ->> 'name', p_row ->> 'locode')
    WHEN 'container_types' THEN concat_ws(' · ', p_row ->> 'code', p_row ->> 'description')
    WHEN 'demurrage_rates' THEN concat_ws(' · ', p_row ->> 'container_type',
      'desde ' || to_char((p_row ->> 'valid_from')::date, 'DD/MM/YYYY'))
    WHEN 'vessel_schedules' THEN concat_ws(' / ', p_row ->> 'vessel_name', p_row ->> 'voyage')
    WHEN 'ended_vessels' THEN concat_ws(' / ', p_row ->> 'vessel_name', p_row ->> 'voyage')
    WHEN 'exchange_rate_reference' THEN 'Câmbio de ' || to_char((p_row ->> 'effective_date')::date, 'DD/MM/YYYY')
    WHEN 'import_batches' THEN p_row ->> 'filename'
    WHEN 'voyage_route_ce_master' THEN concat_ws(' ', 'CE Master', p_row ->> 'ce_master')
    WHEN 'payments' THEN 'Pagamento'
    WHEN 'ledger_settlements' THEN 'Baixa'
    WHEN 'invoice_refunds' THEN 'Restituição'
    WHEN 'demurrage_refunds' THEN 'Restituição'
    WHEN 'cod_adjustments' THEN 'Ajuste de COD'
    ELSE NULL
  END;
  v_main := COALESCE(NULLIF(btrim(v_main), ''),
    NULLIF(btrim(p_row ->> 'name'), ''),
    NULLIF(btrim(p_row ->> 'container_number'), ''),
    NULLIF(btrim(p_row ->> 'description'), ''),
    NULLIF(btrim(p_row ->> 'item_description'), ''),
    NULLIF(btrim(p_row ->> 'code'), ''),
    NULLIF(btrim(p_row ->> 'filename'), ''));

  -- Contexto que identifica o registro na operação.
  IF p_table <> 'voyages' AND p_row ? 'voyage_id' THEN
    v_voyage := public._audit_voyage_label(p_row ->> 'voyage_id');
  END IF;
  v_port := COALESCE(
    CASE WHEN p_table = 'voyage_route_ce_master' THEN concat_ws(' → ', p_row ->> 'pol', p_row ->> 'pod') END,
    NULLIF(p_row ->> 'port', ''), NULLIF(p_row ->> 'embark_port', ''),
    NULLIF(p_row ->> 'omitted_pod', ''),
    CASE WHEN p_table = 'voyage_export_schedules' THEN NULLIF(p_row ->> 'pol', '') END);
  IF p_table NOT IN ('customers') AND p_row ? 'customer_id' THEN
    v_customer := public._audit_value_label('customer_id', p_row ->> 'customer_id');
  END IF;
  IF p_table NOT IN ('bls', 'invoices', 'demurrage_invoices') AND NULLIF(p_row ->> 'bl_id', '') IS NOT NULL THEN
    v_bl := public._audit_value_label('bl_id', p_row ->> 'bl_id');
  END IF;
  IF p_table NOT IN ('invoices') AND NULLIF(p_row ->> 'invoice_id', '') IS NOT NULL THEN
    v_invoice := public._audit_value_label('invoice_id', p_row ->> 'invoice_id');
  END IF;

  RETURN NULLIF(concat_ws(' · ', v_main, v_voyage, v_port, v_bl, v_invoice, v_customer), '');
END;
$function$;
REVOKE ALL ON FUNCTION public._audit_row_label(text, jsonb) FROM PUBLIC, anon, authenticated;

-- 4 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._audit_entity_label(p_entity_type text, p_entity_id text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id text := btrim(COALESCE(p_entity_id, ''));
  v_table text;
  v_key_type text;
  v_row jsonb;
  v_label text;
BEGIN
  IF v_id = '' THEN
    RETURN NULL;
  END IF;

  -- Chave "viagem::PORTO" das linhas semânticas (agenda de POL/POD, ADR).
  IF v_id ~ '^[0-9]{1,18}::' THEN
    RETURN NULLIF(concat_ws(' · ', public._audit_voyage_label(split_part(v_id, '::', 1)),
                            NULLIF(btrim(split_part(v_id, '::', 2)), '')), '');
  END IF;

  -- A linha do lote de importação semântica (`import_batch`, 404) usa o id da Viagem.
  IF p_entity_type IN ('voyage', 'import_batch') THEN
    RETURN public._audit_voyage_label(v_id);
  END IF;
  IF p_entity_type = 'app_settings' THEN
    RETURN 'Configuração do sistema';
  END IF;

  v_table := CASE p_entity_type
    WHEN 'bl' THEN 'bls'
    WHEN 'customer' THEN 'customers'
    WHEN 'invoice' THEN 'invoices'
    WHEN 'bl_container' THEN 'bl_containers'
    WHEN 'container' THEN 'bl_containers'
    WHEN 'charge_calculation' THEN 'charge_calculations'
    WHEN 'demurrage_invoice' THEN 'demurrage_invoices'
    WHEN 'invoice_refund' THEN 'invoice_refunds'
    WHEN 'demurrage_refund' THEN 'demurrage_refunds'
    WHEN 'cod_adjustment' THEN 'cod_adjustments'
    WHEN 'alert_item' THEN 'alert_items'
    WHEN 'user_profile' THEN 'user_profiles'
    WHEN 'agency_departure_report' THEN 'agency_departure_reports'
    WHEN 'vazios_export_operation' THEN 'vazios_export_operations'
    WHEN 'vehicle' THEN 'vehicles'
    ELSE p_entity_type
  END;

  -- Registro atual, pela chave primária `id` (com o tipo da coluna, para usar o índice).
  SELECT format_type(att.atttypid, att.atttypmod) INTO v_key_type
    FROM pg_catalog.pg_attribute att
    JOIN pg_catalog.pg_class cls ON cls.oid = att.attrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid = cls.relnamespace
   WHERE ns.nspname = 'public' AND cls.relname = v_table AND cls.relkind = 'r'
     AND att.attname = 'id' AND NOT att.attisdropped;
  IF v_key_type IS NOT NULL THEN
    BEGIN
      EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id = $1::%s', v_table, v_key_type)
        INTO v_row USING v_id;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_datetime_format THEN
      v_row := NULL;
    END;
  END IF;

  -- Registro apagado: o JSON gravado na criação ou na exclusão.
  IF v_row IS NULL THEN
    SELECT CASE WHEN left(btrim(COALESCE(a.old_value, a.new_value)), 1) = '{'
                THEN COALESCE(a.old_value, a.new_value)::jsonb END
      INTO v_row
      FROM public.audit_logs a
     WHERE a.entity_type IN (p_entity_type, v_table) AND a.entity_id = v_id
       AND a.field_name IN ('criado', 'excluido')
     ORDER BY a.changed_at DESC, a.id DESC
     LIMIT 1;
  END IF;

  v_label := public._audit_row_label(v_table, v_row);
  IF v_label IS NULL AND p_entity_type IN ('bl', 'bls') THEN
    v_label := 'B/L ' || v_id;
  END IF;
  RETURN v_label;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._audit_entity_label(text, text) FROM PUBLIC, anon, authenticated;

-- 5 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_action_history(
  p_entity_types text[] DEFAULT NULL,
  p_actor text DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
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

  RETURN QUERY
  WITH page AS (
    SELECT a.*,
      CASE
        WHEN a.field_name IN ('criado', 'created', 'bl_created', 'insert') THEN 'criou'
        WHEN a.field_name IN ('excluido', 'excluído', 'deleted', 'delete') THEN 'excluiu'
        ELSE 'alterou'
      END AS action_kind,
      count(*) OVER () AS total
    FROM public.audit_logs a
    WHERE (p_entity_types IS NULL OR cardinality(p_entity_types) = 0 OR a.entity_type = ANY (p_entity_types))
      AND (v_actor IS NULL
        OR (v_actor = 'sistema' AND a.changed_by IS NULL)
        OR (v_actor = 'portal' AND a.changed_by IN (SELECT cpa.auth_user_id FROM public.customer_portal_accounts cpa WHERE cpa.auth_user_id IS NOT NULL))
        OR (v_actor_id IS NOT NULL AND a.changed_by = v_actor_id))
      AND (p_date_from IS NULL OR a.changed_at >= (p_date_from::timestamp AT TIME ZONE 'America/Sao_Paulo'))
      AND (p_date_to IS NULL OR a.changed_at < ((p_date_to + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'))
      AND (v_action IS NULL OR v_action = CASE
        WHEN a.field_name IN ('criado', 'created', 'bl_created', 'insert') THEN 'criou'
        WHEN a.field_name IN ('excluido', 'excluído', 'deleted', 'delete') THEN 'excluiu'
        ELSE 'alterou'
      END)
    ORDER BY a.changed_at DESC, a.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT
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
    public._audit_entity_label(p.entity_type, p.entity_id),
    public._audit_value_label(p.field_name, p.old_value),
    public._audit_value_label(p.field_name, p.new_value),
    -- Registro inteiro em JSON (criação/exclusão): nome de cada chave de cadastro.
    (SELECT jsonb_object_agg(kv.key, public._audit_value_label(kv.key, kv.value))
       FROM jsonb_each_text(CASE WHEN left(btrim(COALESCE(p.new_value, p.old_value, '')), 1) = '{'
                                 THEN COALESCE(p.new_value, p.old_value)::jsonb END) kv
      WHERE public._audit_value_label(kv.key, kv.value) IS NOT NULL),
    p.total
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
  ORDER BY p.changed_at DESC, p.id DESC;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_action_history(text[], text, text, date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_action_history(text[], text, text, date, date, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.admin_action_history(text[], text, text, date, date, integer, integer) IS
  'Histórico de ações da Administração (558): autor, ação, registro e valores pelo nome; só o Administrativo.';

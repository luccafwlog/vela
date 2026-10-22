-- 402: Histórico — o que a importação muda aparece no B/L e no Cliente; a
-- trilha deixa de aceitar INSERT direto (Lote 8 do plano
-- docs/plans/2026-10-21-frente-das-importacoes.md; ADR 0095, decisão 24;
-- achados F-23, F-24 e F-46 da revisão
-- docs/archive/audits/2026-10-21-revisao-importacoes.md).
--
-- Data status: esta migration reescreve linhas existentes de `audit_logs`
-- (preenche a coluna nova `bl_id` e troca `import_batches` por `import_batch`
-- nas linhas semânticas do Nº de Manifesto do lote). Depende da afirmação
-- "Data status" do AGENTS.md (o banco de produção só tem dados de teste). As
-- linhas reescritas não perdem valor: `bl_id` é derivado do próprio rastro e
-- a troca de `entity_type` só separa a linha da Viagem da linha do lote.
--
-- Problemas:
--   F-23  `bl_timeline` (133) não lia o gatilho de `bls` (grava `bls`, não
--         `bl`), nem `vehicles`, e lia só 6 campos de `bl_containers` dos
--         containers que ainda estão no B/L: container que entra ou sai,
--         lacre, peso, SOC/COC, veículos e desova não apareciam, e o
--         histórico do container removido sumia com ele; Cliente aparecia
--         como "id → id".
--   F-24  "Grava X, lê Y": o gatilho de `customers` grava `customers`, a
--         ficha do Cliente lia só `customer` (nada da Base de Clientes
--         aparecia); "Informar Nº" grava `voyage`, que a reconciliação de
--         alertas pela trilha ignorava; o Nº de Manifesto do lote gravava
--         `import_batches` com o id da Viagem, colidindo na linha do tempo da
--         Viagem com o gatilho de `import_batches` (id do lote).
--   F-46  Qualquer usuário ativo inseria em `audit_logs` no próprio nome
--         (Histórico forjável).
--
-- Mudança:
--   1. `audit_logs.bl_id`: o B/L de cada linha do gatilho em `bl_containers` e
--      `vehicles`, gravado por `audit_row_changes` (redefinida; o resto do
--      corpo é o mesmo). Índices para ler o rastro do B/L e as mudanças de
--      B/L (`bl_id` antigo). Linhas antigas preenchidas pelo próprio rastro
--      (JSON de criado/excluído) ou pelo registro atual.
--   2. `audit_bl_containers` passa a registrar também a entrada (INSERT).
--   3. `bl_timeline` redefinida: lê as linhas semânticas `bl`, o gatilho de
--      `bls` (campos de negócio, sem repetir a linha semântica do mesmo
--      instante), o rastro de `bl_containers` e `vehicles` pelo `bl_id`
--      gravado (fica depois da remoção), e devolve Cliente com razão social e
--      CNPJ, terminal, Manifesto, Viagem e container pelo nome, nunca o id.
--      Família nova `veiculo`.
--   4. `customer_audit_timeline(cliente)`: cadastro do Cliente (`customer` e
--      o gatilho `customers`, sem repetir o mesmo instante) e os e-mails que a
--      Base de Clientes incluiu ou mudou (`customer_contacts`), com quem,
--      quando e a origem.
--   5. `reconcile_voyage_operation_alerts_on_audit` aceita `voyage` (Informar
--      Nº e as demais portas que gravam `voyage` reconciliam na hora).
--   6. `set_import_batch_ce_master` grava `import_batch` (semântico, id da
--      Viagem); linhas antigas trocadas.
--   7. F-46: REVOKE INSERT de `audit_logs` para `authenticated` e `anon`, sem
--      política de INSERT. Só gatilhos e funções SECURITY DEFINER gravam. A
--      tela e a Edge Function `admin-users` gravam pela RPC
--      `record_audit_entries`, que aceita só os assuntos que já gravavam
--      direto (agenda de POL/POD, Viagem, evento operacional, usuário pelo
--      Administrativo), com o autor do JWT. `update_customer_with_audit`
--      (INVOKER) passa a SECURITY DEFINER.
--
-- Rollback: GRANT INSERT ON public.audit_logs TO authenticated e recriar a
-- política `audit_logs_insert_self_global` (002); reaplicar `bl_timeline` da
-- 133, `audit_row_changes` da 189, `reconcile_voyage_operation_alerts_on_audit`
-- da 341 e `set_import_batch_ce_master` da 396; recriar `audit_bl_containers`
-- sem INSERT; DROP de `record_audit_entries`, `customer_audit_timeline`,
-- `_audit_json_field`, `_bl_timeline_value` e da coluna `audit_logs.bl_id`.

-- 1 -------------------------------------------------------------------------
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS bl_id text;

COMMENT ON COLUMN public.audit_logs.bl_id IS
  'B/L da linha do gatilho em bl_containers e vehicles (402): o Histórico do B/L lê o rastro por aqui, inclusive depois da remoção.';

CREATE INDEX IF NOT EXISTS idx_audit_logs_bl_id
  ON public.audit_logs (bl_id, changed_at DESC) WHERE bl_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_bl_move
  ON public.audit_logs (old_value)
  WHERE field_name = 'bl_id' AND entity_type IN ('bl_containers', 'vehicles');

-- Lê um campo do JSON gravado pelo gatilho; texto que não é JSON devolve NULL.
CREATE OR REPLACE FUNCTION public._audit_json_field(p_value text, p_key text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_value IS NULL OR left(btrim(p_value), 1) <> '{' THEN
    RETURN NULL;
  END IF;
  RETURN p_value::jsonb ->> p_key;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._audit_json_field(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.audit_row_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old JSONB := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  v_new JSONB := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE '{}'::jsonb END;
  v_key_parts TEXT[] := string_to_array(COALESCE(TG_ARGV[0], 'id'), ',');
  v_entity_id TEXT;
  v_field RECORD;
  v_skip text[] := string_to_array(NULLIF(current_setting('vela.audit_skip', true), ''), ',');
  v_token text;
  v_context text := NULLIF(btrim(current_setting('vela.import_context', true)), '');
  -- 402: o B/L da linha, para o Histórico do B/L ler o rastro de containers e
  -- veículos mesmo depois da remoção.
  v_bl_id text := CASE WHEN TG_TABLE_NAME IN ('bl_containers', 'vehicles')
                       THEN COALESCE(v_new ->> 'bl_id', v_old ->> 'bl_id') END;
BEGIN
  SELECT string_agg(COALESCE(v_new ->> k, v_old ->> k), '/')
    INTO v_entity_id
    FROM unnest(v_key_parts) AS k;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by, justification, bl_id)
    VALUES (TG_TABLE_NAME, v_entity_id, 'criado', v_new::TEXT, auth.uid(), v_context, v_bl_id);
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, changed_by, justification, bl_id)
    VALUES (TG_TABLE_NAME, v_entity_id, 'excluido', v_old::TEXT, auth.uid(),
            COALESCE(NULLIF(btrim(current_setting('vela.delete_reason', true)), ''), v_context), v_bl_id);
  ELSE
    FOR v_field IN
      SELECT key, value AS old_value, v_new ->> key AS new_value
      FROM jsonb_each_text(v_old)
      WHERE v_old ->> key IS DISTINCT FROM v_new ->> key
    LOOP
      v_token := TG_TABLE_NAME || '/' || v_entity_id || '/' || v_field.key;
      IF v_skip IS NOT NULL AND v_token = ANY(v_skip) THEN
        v_skip := array_remove(v_skip, v_token);
        PERFORM set_config('vela.audit_skip', COALESCE(array_to_string(v_skip, ','), ''), true);
        CONTINUE;
      END IF;
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification, bl_id)
      VALUES (TG_TABLE_NAME, v_entity_id, v_field.key, v_field.old_value, v_field.new_value, auth.uid(), v_context, v_bl_id);
    END LOOP;
    FOR v_field IN
      SELECT key, value AS new_value
      FROM jsonb_each_text(v_new)
      WHERE NOT (v_old ? key)
    LOOP
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by, justification, bl_id)
      VALUES (TG_TABLE_NAME, v_entity_id, v_field.key, v_field.new_value, auth.uid(), v_context, v_bl_id);
    END LOOP;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $function$;

-- Linhas antigas: o B/L vem do JSON do criado/excluído ou do registro atual.
UPDATE public.audit_logs a
SET bl_id = public._audit_json_field(COALESCE(a.new_value, a.old_value), 'bl_id')
WHERE a.entity_type IN ('bl_containers', 'vehicles')
  AND a.field_name IN ('criado', 'excluido')
  AND a.bl_id IS NULL;

UPDATE public.audit_logs a
SET bl_id = COALESCE(
  CASE WHEN a.field_name = 'bl_id' THEN a.new_value END,
  (SELECT c.bl_id FROM public.bl_containers c WHERE c.id::text = a.entity_id),
  (SELECT x.bl_id FROM public.audit_logs x
    WHERE x.entity_type = 'bl_containers' AND x.entity_id = a.entity_id
      AND x.field_name IN ('criado', 'excluido') AND x.bl_id IS NOT NULL
    ORDER BY x.changed_at DESC, x.id DESC LIMIT 1))
WHERE a.entity_type = 'bl_containers'
  AND a.field_name NOT IN ('criado', 'excluido')
  AND a.bl_id IS NULL;

UPDATE public.audit_logs a
SET bl_id = COALESCE(
  CASE WHEN a.field_name = 'bl_id' THEN a.new_value END,
  (SELECT v.bl_id FROM public.vehicles v WHERE v.id::text = a.entity_id),
  (SELECT x.bl_id FROM public.audit_logs x
    WHERE x.entity_type = 'vehicles' AND x.entity_id = a.entity_id
      AND x.field_name IN ('criado', 'excluido') AND x.bl_id IS NOT NULL
    ORDER BY x.changed_at DESC, x.id DESC LIMIT 1))
WHERE a.entity_type = 'vehicles'
  AND a.field_name NOT IN ('criado', 'excluido')
  AND a.bl_id IS NULL;

-- 2 -------------------------------------------------------------------------
DROP TRIGGER IF EXISTS audit_bl_containers ON public.bl_containers;
CREATE TRIGGER audit_bl_containers
  AFTER INSERT OR UPDATE OR DELETE ON public.bl_containers
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_changes('id');

-- 3 -------------------------------------------------------------------------
-- Valor do Histórico na língua da operação: Cliente com razão social e CNPJ,
-- terminal, Manifesto, Viagem e container pelo nome, nunca o id.
CREATE OR REPLACE FUNCTION public._bl_timeline_value(p_field text, p_value text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_text text;
BEGIN
  IF p_value IS NULL OR btrim(p_value) !~ '^[0-9]+$' THEN
    RETURN p_value;
  END IF;
  IF p_field IN ('customer_id', 'suggested_customer_id') THEN
    SELECT concat_ws(' · ', c.name, CASE WHEN c.cnpj_cpf IS NOT NULL THEN 'CNPJ ' || c.cnpj_cpf END)
      INTO v_text FROM public.customers c WHERE c.id = btrim(p_value)::bigint;
    RETURN COALESCE(v_text, 'Cliente excluído');
  ELSIF p_field = 'terminal_id' THEN
    SELECT d.name INTO v_text FROM public.depots d WHERE d.id = btrim(p_value)::bigint;
    RETURN COALESCE(v_text, 'Terminal excluído');
  ELSIF p_field = 'manifesto_mercante_id' THEN
    SELECT m.numero INTO v_text FROM public.manifestos_mercante m WHERE m.id = btrim(p_value)::bigint;
    RETURN COALESCE(v_text, 'Manifesto excluído');
  ELSIF p_field = 'voyage_id' THEN
    SELECT btrim(concat_ws(' ', vs.name, v.voyage_number)) INTO v_text
    FROM public.voyages v LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    WHERE v.id = btrim(p_value)::bigint;
    RETURN COALESCE(v_text, 'Viagem excluída');
  ELSIF p_field = 'container_id' THEN
    SELECT c.container_number INTO v_text FROM public.bl_containers c WHERE c.id = btrim(p_value)::bigint;
    IF v_text IS NULL THEN
      SELECT public._audit_json_field(COALESCE(x.new_value, x.old_value), 'container_number') INTO v_text
      FROM public.audit_logs x
      WHERE x.entity_type = 'bl_containers' AND x.entity_id = btrim(p_value)
        AND x.field_name IN ('criado', 'excluido')
      ORDER BY x.changed_at DESC, x.id DESC LIMIT 1;
    END IF;
    RETURN COALESCE(v_text, 'container excluído');
  END IF;
  RETURN p_value;
END;
$function$;
REVOKE ALL ON FUNCTION public._bl_timeline_value(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bl_timeline(p_bl_id text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id bigint, family text, entity_type text, field_name text, old_value text, new_value text, changed_by uuid, changed_at timestamp with time zone, justification text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH bl_row AS (
    SELECT b.id, b.created_at FROM public.bls b WHERE b.id = p_bl_id
  ),
  -- Rastro de containers e veículos do B/L pelo `bl_id` gravado (402), mais as
  -- linhas em que o container ou veículo saiu deste B/L para outro.
  trail AS (
    SELECT a.* FROM public.audit_logs a
    WHERE a.bl_id = p_bl_id AND a.entity_type IN ('bl_containers', 'vehicles')
    UNION
    SELECT a.* FROM public.audit_logs a
    WHERE a.field_name = 'bl_id' AND a.entity_type IN ('bl_containers', 'vehicles')
      AND a.old_value = p_bl_id
  ),
  member_containers AS (
    SELECT c.id::text AS id FROM public.bl_containers c WHERE c.bl_id = p_bl_id
    UNION
    SELECT t.entity_id FROM trail t WHERE t.entity_type = 'bl_containers'
  ),
  -- Número do container (e chassi do veículo): o registro atual ou o JSON do
  -- rastro, para o container que já saiu.
  names AS (
    SELECT DISTINCT ON (k.entity_type, k.id) k.entity_type, k.id, k.label
    FROM (
      SELECT 'bl_containers'::text AS entity_type, c.id::text AS id, c.container_number AS label, 0 AS prio, NULL::timestamptz AS at
      FROM public.bl_containers c WHERE c.id::text IN (SELECT id FROM member_containers)
      UNION ALL
      SELECT 'vehicles', v.id::text, v.chassis, 0, NULL
      FROM public.vehicles v WHERE v.id::text IN (SELECT t.entity_id FROM trail t WHERE t.entity_type = 'vehicles')
      UNION ALL
      SELECT t.entity_type, t.entity_id,
             public._audit_json_field(COALESCE(t.new_value, t.old_value),
               CASE WHEN t.entity_type = 'vehicles' THEN 'chassis' ELSE 'container_number' END),
             1, t.changed_at
      FROM trail t WHERE t.field_name IN ('criado', 'excluido')
    ) k
    WHERE k.label IS NOT NULL
    ORDER BY k.entity_type, k.id, k.prio, k.at DESC NULLS LAST
  ),
  events AS (
    -- Linhas semânticas do B/L (RPCs e importações).
    SELECT
      a.id,
      CASE
        WHEN a.entity_type = 'invoice' THEN 'fatura'
        WHEN a.entity_type = 'charge_calculation' THEN 'taxas'
        WHEN a.entity_type = 'bl_container' THEN 'container'
        WHEN a.entity_type = 'system_event' THEN 'sistema'
        WHEN a.entity_type = 'bl' AND a.field_name = 'charge_status' THEN 'taxas'
        WHEN a.entity_type = 'bl' AND a.field_name IN ('financial_status', 'billing_hold_reason', 'last_billing_run_id') THEN 'fatura'
        WHEN a.entity_type = 'bl' AND a.field_name IN ('container_ownership', 'container_profile', 'container_dates', 'container_dates_import') THEN 'container'
        ELSE 'edicao'
      END AS family,
      a.entity_type,
      CASE
        WHEN a.entity_type = 'bl_container' AND n.label IS NOT NULL AND position('|' IN a.field_name) = 0
          THEN a.field_name || '|' || n.label
        ELSE a.field_name
      END AS field_name,
      a.old_value,
      a.new_value,
      a.changed_by,
      a.changed_at,
      a.justification
    FROM public.audit_logs a
    LEFT JOIN names n ON n.entity_type = 'bl_containers' AND a.entity_type = 'bl_container' AND n.id = a.entity_id
    WHERE (
           (a.entity_type = 'bl' AND a.entity_id = p_bl_id
            AND a.changed_at IS DISTINCT FROM (SELECT created_at FROM bl_row))
        OR (a.entity_type = 'bl_container' AND a.entity_id IN (SELECT id FROM member_containers))
        OR (a.entity_type = 'charge_calculation' AND a.entity_id IN (
              SELECT cc.id::text FROM public.charge_calculations cc WHERE cc.bl_id = p_bl_id))
        OR (a.entity_type = 'invoice' AND a.entity_id IN (
              SELECT ib.invoice_id::text FROM public.invoice_bls ib WHERE ib.bl_id = p_bl_id))
        OR (a.entity_type = 'system_event' AND a.entity_id = p_bl_id)
      )
    UNION ALL
    -- Gatilho de `bls`: campos que a operação lê, sem repetir a linha
    -- semântica do mesmo campo no mesmo instante.
    SELECT a.id, 'edicao', 'bl', a.field_name, a.old_value, a.new_value, a.changed_by, a.changed_at, a.justification
    FROM public.audit_logs a
    WHERE a.entity_type = 'bls' AND a.entity_id = p_bl_id
      AND a.changed_at IS DISTINCT FROM (SELECT created_at FROM bl_row)
      AND a.field_name IN (
        'shipper', 'shipper_block', 'consignee', 'consignee_block', 'consignee_address', 'consignee_phone',
        'notify_party', 'notify_cnpj_cpf', 'notify_block', 'notify2_block',
        'customer_id', 'manifest_customer_cnpj_cpf', 'manifest_customer_name', 'manifest_customer_email',
        'voyage_id', 'pol', 'pod', 'place_of_delivery', 'place_of_receipt', 'movement_from', 'movement_to',
        'terminal_id', 'manifesto_mercante_id', 'cargo_description', 'ncm_codes',
        'total_weight_kg', 'total_cbm', 'total_packages', 'packages_unit',
        'bb_machine_qty', 'bb_packages_qty', 'bb_packages_total', 'bb_weight_ton', 'bb_cbm',
        'incoterm', 'payment_type', 'ce_mercante', 'bl_emission_date', 'issue_place', 'laden_on_board',
        'container_load_type', 'free_time_override', 'notes')
      AND NOT EXISTS (
        SELECT 1 FROM public.audit_logs s
        WHERE s.entity_type = 'bl' AND s.entity_id = a.entity_id
          AND s.field_name = a.field_name AND s.changed_at = a.changed_at)
    UNION ALL
    -- Rastro de `bl_containers` e `vehicles` do B/L.
    SELECT
      t.id,
      CASE WHEN t.entity_type = 'vehicles' THEN 'veiculo' ELSE 'container' END,
      CASE WHEN t.entity_type = 'vehicles' THEN 'vehicle' ELSE 'bl_container' END,
      t.field_name || '|' || COALESCE(n.label, ''),
      CASE WHEN t.field_name IN ('criado', 'excluido') THEN NULL ELSE t.old_value END,
      CASE WHEN t.field_name IN ('criado', 'excluido') THEN NULL ELSE t.new_value END,
      t.changed_by,
      t.changed_at,
      t.justification
    FROM trail t
    LEFT JOIN names n ON n.entity_type = t.entity_type AND n.id = t.entity_id
    WHERE (
            (t.entity_type = 'bl_containers' AND t.field_name IN (
              'criado', 'excluido', 'bl_id', 'container_number', 'seal_number', 'type',
              'gross_weight_kg', 'tare_weight_kg', 'cbm', 'is_oog', 'is_imo', 'imo_class', 'un_number',
              'discharge_date', 'return_date', 'unpacking_location', 'ownership'))
         OR (t.entity_type = 'vehicles' AND t.field_name IN (
              'criado', 'excluido', 'bl_id', 'chassis', 'brand', 'model', 'weight_kg', 'cbm', 'container_id'))
          )
      -- A transação que cria o B/L vira um só "B/L criado" (133).
      AND NOT (t.field_name = 'criado' AND t.changed_at IS NOT DISTINCT FROM (SELECT created_at FROM bl_row))
      -- Mesma mudança já registrada com motivo pela RPC (079).
      AND NOT EXISTS (
        SELECT 1 FROM public.audit_logs s
        WHERE s.entity_type = 'bl_container' AND s.entity_id = t.entity_id
          AND s.field_name = t.field_name AND s.changed_at = t.changed_at)
      AND NOT (t.field_name = 'ownership' AND EXISTS (
        SELECT 1 FROM public.audit_logs s
        WHERE s.entity_type = 'bl' AND s.entity_id = p_bl_id
          AND s.field_name = 'container_ownership' AND s.changed_at = t.changed_at))
      AND NOT (t.field_name = 'type' AND EXISTS (
        SELECT 1 FROM public.audit_logs s
        WHERE s.entity_type = 'bl' AND s.entity_id = p_bl_id
          AND s.field_name = 'container_profile' AND s.changed_at = t.changed_at))
    UNION ALL
    -- id 0 não colide: audit_logs.id é identity a partir de 1.
    SELECT 0::bigint, 'sistema', 'system_event', 'bl_created', NULL, 'B/L criado', NULL::uuid, r.created_at, NULL
    FROM bl_row r
    WHERE r.created_at IS NOT NULL
  )
  SELECT
    e.id,
    e.family,
    e.entity_type,
    e.field_name,
    public._bl_timeline_value(split_part(e.field_name, '|', 1), e.old_value),
    public._bl_timeline_value(split_part(e.field_name, '|', 1), e.new_value),
    e.changed_by,
    e.changed_at,
    e.justification
  FROM events e
  WHERE public.is_active_read_user()
  ORDER BY e.changed_at DESC, e.id DESC
  LIMIT GREATEST(COALESCE(p_limit, 50), 0)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$function$;

REVOKE ALL ON FUNCTION public.bl_timeline(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bl_timeline(text, integer, integer) TO authenticated;

-- 4 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_audit_timeline(p_customer_id bigint, p_limit integer DEFAULT 100)
RETURNS TABLE(id bigint, subject text, field_name text, old_value text, new_value text, changed_by uuid, changed_at timestamp with time zone, justification text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH contacts AS (
    SELECT cc.id::text AS id FROM public.customer_contacts cc WHERE cc.customer_id = p_customer_id
    UNION
    SELECT a.entity_id FROM public.audit_logs a
    WHERE a.entity_type = 'customer_contacts' AND a.field_name IN ('criado', 'excluido')
      AND public._audit_json_field(COALESCE(a.new_value, a.old_value), 'customer_id') = p_customer_id::text
  ),
  events AS (
    -- Linhas semânticas do Cliente (edição com justificativa, desativação).
    SELECT a.id, 'cliente'::text AS subject, a.field_name, a.old_value, a.new_value, a.changed_by, a.changed_at, a.justification
    FROM public.audit_logs a
    WHERE a.entity_type = 'customer' AND a.entity_id = p_customer_id::text
    UNION ALL
    -- Gatilho de `customers` (Base de Clientes e outras portas), sem repetir a
    -- linha semântica do mesmo campo no mesmo instante.
    SELECT a.id, 'cliente', a.field_name, a.old_value, a.new_value, a.changed_by, a.changed_at, a.justification
    FROM public.audit_logs a
    WHERE a.entity_type = 'customers' AND a.entity_id = p_customer_id::text
      AND a.field_name IN ('name', 'trade_name', 'address', 'city', 'state', 'zip', 'notes', 'cnpj_cpf')
      AND NOT EXISTS (
        SELECT 1 FROM public.audit_logs s
        WHERE s.entity_type = 'customer' AND s.entity_id = a.entity_id
          AND s.field_name = a.field_name AND s.changed_at = a.changed_at)
    UNION ALL
    -- E-mails que a Base de Clientes incluiu, mudou ou tirou (as outras
    -- portas já aparecem pelos eventos de contato).
    SELECT a.id, 'contato',
      CASE a.field_name WHEN 'criado' THEN 'contact_added' WHEN 'excluido' THEN 'contact_removed' ELSE 'contact_email' END,
      CASE WHEN a.field_name = 'excluido' THEN public._audit_json_field(a.old_value, 'email')
           WHEN a.field_name = 'criado' THEN NULL ELSE a.old_value END,
      CASE WHEN a.field_name = 'criado' THEN public._audit_json_field(a.new_value, 'email')
           WHEN a.field_name = 'excluido' THEN NULL ELSE a.new_value END,
      a.changed_by, a.changed_at, a.justification
    FROM public.audit_logs a
    WHERE a.entity_type = 'customer_contacts'
      AND a.entity_id IN (SELECT id FROM contacts)
      AND a.field_name IN ('criado', 'excluido', 'email')
      AND a.justification LIKE 'Importação de Base de Clientes%'
  )
  SELECT e.*
  FROM events e
  WHERE public.is_active_read_user()
  ORDER BY e.changed_at DESC, e.id DESC
  LIMIT GREATEST(COALESCE(p_limit, 100), 0);
$function$;

REVOKE ALL ON FUNCTION public.customer_audit_timeline(bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_audit_timeline(bigint, integer) TO authenticated;

-- 5 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_voyage_operation_alerts_on_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_voyage_id BIGINT;
  v_port TEXT;
BEGIN
  IF NEW.entity_type = 'bl' AND NEW.field_name = 'ce_mercante' THEN
    -- CE gravado ou removido (porta única `_set_bl_ce_mercante`, 230): o
    -- "CE Mercante ausente" da viagem fecha ou reabre agora (341).
    -- ponytail: uma reconciliação da viagem por B/L; a importação de CE em
    -- lote repete a mesma conta N vezes. Agrupar no fim do lote é o upgrade.
    SELECT b.voyage_id INTO v_voyage_id FROM public.bls b WHERE b.id = NEW.entity_id;
    IF v_voyage_id IS NOT NULL THEN
      PERFORM public.reconcile_voyage_ce_mercante_missing_alerts(v_voyage_id, 'voyage_operation_trigger');
    END IF;
    RETURN NEW;
  END IF;
  -- 402 (F-24): `voyage` (Informar Nº, omissão, Baplie) reconcilia como
  -- `voyages` (gatilho da tabela).
  IF NEW.entity_type NOT IN ('voyage_pod_schedule', 'voyage_pol_schedule', 'voyages', 'voyage') THEN
    RETURN NEW;
  END IF;
  v_voyage_id := NULLIF(split_part(NEW.entity_id, '::', 1), '')::BIGINT;
  -- A exclusão da viagem grava o audit depois do DELETE: viagem que não existe
  -- mais não tem alerta a reconciliar (341).
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = v_voyage_id) THEN
    RETURN NEW;
  END IF;
  IF NEW.entity_type IN ('voyages', 'voyage') THEN
    PERFORM public.reconcile_voyage_operation_alerts(v_voyage_id, 'voyage_operation_trigger');
  ELSE
    v_port := NULLIF(upper(btrim(split_part(NEW.entity_id, '::', 2))), '');
    IF v_port IS NOT NULL THEN
      PERFORM public.reconcile_voyage_schedule_date_alerts(v_voyage_id, v_port, 'voyage_operation_trigger');
    END IF;
    -- ETA, exclusão ou omissão da escala mudam o primeiro ETA brasileiro, que
    -- decide o prazo D-7/D-5 dos alertas de nível viagem (341).
    IF NEW.entity_type = 'voyage_pod_schedule' THEN
      PERFORM public.reconcile_voyage_bl_expected_alerts(v_voyage_id, 'voyage_operation_trigger');
      PERFORM public.reconcile_voyage_baplie_missing_alerts(v_voyage_id, 'voyage_operation_trigger');
      PERFORM public.reconcile_voyage_ce_mercante_missing_alerts(v_voyage_id, 'voyage_operation_trigger');
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Reconciliação de alertas de viagem ignorada para audit_logs.id=%: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

-- 6 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_import_batch_ce_master(p_batch_id bigint, p_ce_master text, p_changed_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_batch public.import_batches%ROWTYPE;
  v_normalized text := public.canonical_manifesto_numero(p_ce_master);
  v_old_value text;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para editar CE Master.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_batch FROM public.import_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote de importacao % nao encontrado', p_batch_id
      USING ERRCODE = 'P0002';
  END IF;

  v_old_value := NULLIF(btrim(COALESCE(v_batch.ce_master, '')), '');
  IF v_old_value IS NOT DISTINCT FROM v_normalized THEN
    RETURN;
  END IF;

  -- 396 (F-49): o lote guarda só o Nº que a rota aceitou.
  IF v_normalized IS NOT NULL THEN
    IF v_normalized !~ '^[A-Z0-9]{13}$' THEN
      RAISE EXCEPTION 'Nº de Manifesto Mercante inválido: "%". O número tem 13 caracteres, letras ou dígitos (ex.: 1226501860578).', p_ce_master
        USING ERRCODE = 'P0012';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.manifestos_mercante m
                   WHERE m.numero = v_normalized AND m.voyage_id = v_batch.voyage_id) THEN
      RAISE EXCEPTION 'O Nº de Manifesto Mercante % não está cadastrado em uma rota desta Viagem: informe-o na rota antes.', v_normalized
        USING ERRCODE = '22023';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.manifestos_mercante m
                WHERE m.numero = public.canonical_manifesto_numero(v_old_value) AND m.voyage_id = v_batch.voyage_id) THEN
    RAISE EXCEPTION 'O Nº de Manifesto Mercante % continua cadastrado na rota: tire o número da rota antes.', v_old_value
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.import_batches SET ce_master = v_normalized WHERE id = p_batch_id;

  -- 402 (F-24): `import_batch` (singular) é a linha semântica com o id da
  -- Viagem; `import_batches` fica só para o gatilho, com o id do lote.
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('import_batch', COALESCE(v_batch.voyage_id::text, p_batch_id::text), 'ce_master',
    v_old_value, v_normalized, p_changed_by, 'Atualizacao manual de CE Master');
END;
$function$;

UPDATE public.audit_logs
SET entity_type = 'import_batch'
WHERE entity_type = 'import_batches'
  AND field_name = 'ce_master'
  AND justification = 'Atualizacao manual de CE Master';

-- 7 -------------------------------------------------------------------------
-- Única porta de escrita da tela na trilha: assuntos que a tela já gravava,
-- com o autor do JWT (a linha não aceita outro nome nem outra hora).
CREATE OR REPLACE FUNCTION public.record_audit_entries(p_entries jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_entry jsonb;
  v_type text;
  v_field text;
  v_count integer := 0;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para registrar no Histórico.' USING ERRCODE = '42501';
  END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'Registros do Histórico inválidos.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_entries) > 100 THEN
    RAISE EXCEPTION 'Registros demais para o Histórico de uma vez.' USING ERRCODE = '22023';
  END IF;

  FOR v_entry IN SELECT e FROM jsonb_array_elements(p_entries) AS t(e) LOOP
    v_type := v_entry ->> 'entity_type';
    v_field := v_entry ->> 'field_name';
    IF NULLIF(btrim(COALESCE(v_entry ->> 'entity_id', '')), '') IS NULL THEN
      RAISE EXCEPTION 'Registro do Histórico sem identificação.' USING ERRCODE = '22023';
    END IF;
    IF NOT (
         (v_type IN ('voyage_pod_schedule', 'voyage_pol_schedule') AND v_field IN (
            'etd', 'eta', 'etb', 'ata', 'atb', 'atd', 'rtw', 'ces', 'linked',
            'escala_number', 'deleted', 'omitted', 'tem_importacao'))
      OR (v_type = 'voyages' AND v_field IN (
            'created', 'vessel_id', 'voyage_number', 'status',
            'indicated_first_brazilian_port', 'indicated_first_brazilian_eta'))
      OR (v_type = 'system_event' AND v_field IN (
            'manifest_import_rate_limited', 'manifest_import_duplicate_hash',
            'bl_review_concurrent_conflict', 'invoice_create_conflict',
            'invoice_payment_invalid', 'invoice_cancel_blocked',
            'customer_finance_communication_failed', 'granite_reimport_already_invoiced'))
      OR (v_type = 'user_profile' AND v_field IN ('created', 'email', 'password', 'role', 'active', 'full_name')
          AND public.is_admin())
    ) THEN
      RAISE EXCEPTION 'Registro do Histórico não aceito: % / %.', v_type, v_field USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value,
      changed_by, changed_at, justification, actor_role, actor_department)
    VALUES (
      v_type, btrim(v_entry ->> 'entity_id'), v_field, v_entry ->> 'old_value', v_entry ->> 'new_value',
      v_actor,
      -- Mesma hora do INSERT direto (audit_logs_force_actor): o status de B/Ls
      -- e CEs usa a hora do relógio para ordenar gravações da mesma transação.
      CASE WHEN v_type = 'voyage_pod_schedule' AND v_field IN ('ces', 'export_ces') THEN clock_timestamp() ELSE now() END,
      NULLIF(v_entry ->> 'justification', ''),
      public.current_actor_role(), public.current_actor_role());
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_audit_entries(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_audit_entries(jsonb) TO authenticated;

ALTER FUNCTION public.update_customer_with_audit(bigint, jsonb, uuid, text) SECURITY DEFINER;

DROP POLICY IF EXISTS audit_logs_insert_self_global ON public.audit_logs;
REVOKE INSERT ON TABLE public.audit_logs FROM authenticated, anon;

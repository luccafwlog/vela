-- 060: follow-up da revisão Claude Code da PR 698
--
-- Esta migration corrige os achados que permaneceram após a primeira rodada
-- de endurecimento. O foco é preservar uma única fonte de verdade para NOB,
-- permitir adições de carga após faturamento sem rebaixamento silencioso,
-- manter o cargo_mode declarado quando ainda não há sinal físico e reduzir
-- recalculações redundantes durante imports em lote.

-- ---------------------------------------------------------------------------
-- 1. Filtro de modalidade: função SQL inlinable e contrato único
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bl_cargo_mode_matches_filter(
  p_cargo_mode text,
  p_filter text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE lower(btrim(COALESCE(p_filter, '')))
    WHEN '' THEN true
    WHEN 'container' THEN lower(btrim(COALESCE(p_cargo_mode, ''))) IN ('container', 'misto')
    WHEN 'carga_solta' THEN lower(btrim(COALESCE(p_cargo_mode, ''))) IN ('carga_solta', 'misto')
    WHEN 'misto' THEN lower(btrim(COALESCE(p_cargo_mode, ''))) = 'misto'
    ELSE lower(btrim(COALESCE(p_cargo_mode, ''))) = lower(btrim(COALESCE(p_filter, '')))
  END;
$function$;

REVOKE ALL ON FUNCTION public.bl_cargo_mode_matches_filter(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bl_cargo_mode_matches_filter(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bl_operation_front_modalidade(p_cargo_mode text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE lower(btrim(COALESCE(p_cargo_mode, '')))
    WHEN 'carga_solta' THEN 'carga_solta'
    WHEN 'misto' THEN NULL
    WHEN 'veiculo' THEN 'veiculo'
    WHEN 'veiculos' THEN 'veiculo'
    ELSE 'carga_cheia'
  END;
$function$;

REVOKE ALL ON FUNCTION public.bl_operation_front_modalidade(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bl_operation_front_modalidade(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Cargo mode: lock do pai, distinção entre adição e remoção e triggers
--    por statement com transition tables
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._recalculate_bl_cargo_mode(
  p_bl_id text,
  p_transition text DEFAULT NULL::text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_has_cntr boolean;
  v_has_bb boolean;
  v_new_mode text;
  v_curr_mode text;
  v_financial_status text;
  v_old_rank integer;
  v_new_rank integer;
  v_locked boolean;
  v_locked_addition boolean;
  v_replacement boolean := COALESCE(current_setting('vela.breakbulk_import_replacement', true), 'off') = 'on';
BEGIN
  IF p_bl_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(cargo_mode, 'container'), COALESCE(financial_status, 'pending')
    INTO v_curr_mode, v_financial_status
  FROM public.bls
  WHERE id = p_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.bl_containers WHERE bl_id = p_bl_id
  ) INTO v_has_cntr;

  SELECT EXISTS (
    SELECT 1 FROM public.bl_breakbulk_items WHERE bl_id = p_bl_id
  ) OR EXISTS (
    SELECT 1 FROM public.bls
    WHERE id = p_bl_id
      AND (COALESCE(bb_weight_ton, 0) > 0 OR COALESCE(bb_packages_qty, 0) > 0)
  ) INTO v_has_bb;

  v_new_mode := CASE
    WHEN v_has_cntr AND v_has_bb THEN 'misto'
    WHEN v_has_bb THEN 'carga_solta'
    ELSE 'container'
  END;

  IF v_curr_mode IS NOT DISTINCT FROM v_new_mode THEN
    RETURN;
  END IF;

  v_old_rank := CASE v_curr_mode
    WHEN 'misto' THEN 2
    WHEN 'carga_solta' THEN 1
    ELSE 0
  END;
  v_new_rank := CASE v_new_mode
    WHEN 'misto' THEN 2
    WHEN 'carga_solta' THEN 1
    ELSE 0
  END;
  v_locked := v_financial_status IN ('invoiced', 'paid');

  -- Remover conteúdo de um B/L faturado é uma perda material e precisa de
  -- estorno/refaturamento. Adicionar conteúdo é permitido, mas reabre revisão
  -- e billing hold. O importador usa o GUC transacional abaixo para atravessar
  -- a remoção intermediária da substituição atômica, após o preflight validar
  -- que o resultado final não remove carga BB faturada.
  IF v_locked AND v_old_rank > v_new_rank AND NOT v_replacement THEN
    RAISE EXCEPTION
      'B/L % ja foi faturado (status financeiro=%); remover conteudo exige estorno/refaturamento (transicao=%).',
      p_bl_id, v_financial_status, COALESCE(p_transition, 'recalculo')
      USING ERRCODE = 'P0003';
  END IF;

  v_locked_addition := v_locked AND v_new_rank > v_old_rank;

  UPDATE public.bls
  SET cargo_mode = v_new_mode,
      charge_status = 'not_calculated',
      review_status = CASE WHEN v_locked_addition THEN 'pending_review' ELSE review_status END,
      billing_hold_reason = CASE
        WHEN v_locked_addition THEN 'Carga adicionada após faturamento; revisar e refaturar.'
        ELSE billing_hold_reason
      END,
      updated_at = now()
  WHERE id = p_bl_id;

  IF v_new_mode <> 'container' OR v_has_cntr THEN
    DELETE FROM public.charge_calculations
    WHERE bl_id = p_bl_id
      AND source = 'auto'
      AND calculation_key IN ('review:no_container', 'review:no_containers');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bl_receivables
    WHERE bl_id = p_bl_id AND source = 'local_charges'
  ) THEN
    PERFORM public.sync_local_charge_receivable(p_bl_id);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_bl_cargo_mode(p_bl_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._recalculate_bl_cargo_mode(p_bl_id, 'explicit');
END;
$function$;

-- Esta é uma API interna usada pelos triggers e pelas migrations. O recálculo
-- não deve ser exposto como RPC anônima/autenticada: ele altera modalidade,
-- faturamento e recebíveis em uma única operação.
REVOKE ALL ON FUNCTION public.recalculate_bl_cargo_mode(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_bl_cargo_mode(text) TO service_role;
REVOKE ALL ON FUNCTION public._recalculate_bl_cargo_mode(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_sync_bl_cargo_mode_statement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
  v_sql text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_sql := format(
      'SELECT DISTINCT bl_id FROM (SELECT bl_id FROM %I UNION ALL SELECT bl_id FROM %I) ids WHERE bl_id IS NOT NULL',
      TG_ARGV[0], TG_ARGV[1]
    );
  ELSE
    v_sql := format('SELECT DISTINCT bl_id FROM %I WHERE bl_id IS NOT NULL', TG_ARGV[0]);
  END IF;

  FOR v_row IN EXECUTE v_sql LOOP
    PERFORM public._recalculate_bl_cargo_mode(v_row.bl_id, lower(TG_OP));
  END LOOP;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_sync_bl_cargo_mode_statement() FROM PUBLIC, anon, authenticated;

-- ponytail: uma recalculação por B/L distinto dentro de cada statement resolve
-- o custo explosivo dos imports em lote. Se no futuro uma transação precisar
-- combinar vários statements sobre os mesmos pais, a evolução natural é uma
-- fila transacional/deferred queue; o contrato da função já permite esse swap.
DROP TRIGGER IF EXISTS trg_bl_containers_cargo_mode ON public.bl_containers;
DROP TRIGGER IF EXISTS trg_bl_breakbulk_cargo_mode ON public.bl_breakbulk_items;
DROP TRIGGER IF EXISTS trg_bl_containers_cargo_mode_insert_stmt ON public.bl_containers;
DROP TRIGGER IF EXISTS trg_bl_containers_cargo_mode_update_stmt ON public.bl_containers;
DROP TRIGGER IF EXISTS trg_bl_containers_cargo_mode_delete_stmt ON public.bl_containers;
DROP TRIGGER IF EXISTS trg_bl_breakbulk_cargo_mode_insert_stmt ON public.bl_breakbulk_items;
DROP TRIGGER IF EXISTS trg_bl_breakbulk_cargo_mode_update_stmt ON public.bl_breakbulk_items;
DROP TRIGGER IF EXISTS trg_bl_breakbulk_cargo_mode_delete_stmt ON public.bl_breakbulk_items;

CREATE TRIGGER trg_bl_containers_cargo_mode_insert_stmt
AFTER INSERT ON public.bl_containers
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_sync_bl_cargo_mode_statement('new_rows');

CREATE TRIGGER trg_bl_containers_cargo_mode_update_stmt
AFTER UPDATE ON public.bl_containers
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_sync_bl_cargo_mode_statement('new_rows', 'old_rows');

CREATE TRIGGER trg_bl_containers_cargo_mode_delete_stmt
AFTER DELETE ON public.bl_containers
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_sync_bl_cargo_mode_statement('old_rows');

CREATE TRIGGER trg_bl_breakbulk_cargo_mode_insert_stmt
AFTER INSERT ON public.bl_breakbulk_items
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_sync_bl_cargo_mode_statement('new_rows');

CREATE TRIGGER trg_bl_breakbulk_cargo_mode_update_stmt
AFTER UPDATE ON public.bl_breakbulk_items
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_sync_bl_cargo_mode_statement('new_rows', 'old_rows');

CREATE TRIGGER trg_bl_breakbulk_cargo_mode_delete_stmt
AFTER DELETE ON public.bl_breakbulk_items
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_sync_bl_cargo_mode_statement('old_rows');

CREATE OR REPLACE FUNCTION public.trg_sync_bl_weight_cargo_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_has_cntr boolean;
  v_has_bb boolean;
  v_new_mode text;
  v_old_mode text := COALESCE(OLD.cargo_mode, 'container');
  v_financial_status text := COALESCE(OLD.financial_status, NEW.financial_status, 'pending');
  v_old_rank integer;
  v_new_rank integer;
  v_replacement boolean := COALESCE(current_setting('vela.breakbulk_import_replacement', true), 'off') = 'on';
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.bl_containers WHERE bl_id = NEW.id
  ) INTO v_has_cntr;

  SELECT EXISTS (
    SELECT 1 FROM public.bl_breakbulk_items WHERE bl_id = NEW.id
  ) OR (COALESCE(NEW.bb_weight_ton, 0) > 0 OR COALESCE(NEW.bb_packages_qty, 0) > 0)
  INTO v_has_bb;

  -- Um INSERT sem sinal físico ainda é um contrato explícito do importador ou
  -- da API. Os triggers de filhos passam a ser a autoridade assim que houver
  -- conteúdo observável; não transforme carga_solta declarada sem filhos em
  -- container por antecipação.
  IF TG_OP = 'INSERT' AND NOT v_has_cntr AND NOT v_has_bb THEN
    NEW.cargo_mode := COALESCE(NULLIF(btrim(NEW.cargo_mode), ''), 'container');
    NEW.charge_status := COALESCE(NEW.charge_status, 'not_calculated');
    RETURN NEW;
  END IF;

  v_new_mode := CASE
    WHEN v_has_cntr AND v_has_bb THEN 'misto'
    WHEN v_has_bb THEN 'carga_solta'
    ELSE 'container'
  END;
  v_old_rank := CASE v_old_mode WHEN 'misto' THEN 2 WHEN 'carga_solta' THEN 1 ELSE 0 END;
  v_new_rank := CASE v_new_mode WHEN 'misto' THEN 2 WHEN 'carga_solta' THEN 1 ELSE 0 END;

  IF TG_OP = 'UPDATE'
     AND v_financial_status IN ('invoiced', 'paid')
     AND v_old_rank > v_new_rank
     AND NOT v_replacement THEN
    RAISE EXCEPTION
      'B/L % ja foi faturado (status financeiro=%); remover conteudo exige estorno/refaturamento.',
      NEW.id, v_financial_status
      USING ERRCODE = 'P0003';
  END IF;

  IF TG_OP = 'UPDATE' AND v_financial_status IN ('invoiced', 'paid')
     AND COALESCE(NEW.financial_status, 'pending') = 'pending' THEN
    NEW.financial_status := OLD.financial_status;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.cargo_mode IS DISTINCT FROM v_new_mode THEN
    NEW.charge_status := 'not_calculated';
  ELSE
    NEW.charge_status := COALESCE(NEW.charge_status, 'not_calculated');
  END IF;
  IF TG_OP = 'UPDATE' AND v_financial_status IN ('invoiced', 'paid') AND v_new_rank > v_old_rank THEN
    NEW.review_status := 'pending_review';
    NEW.billing_hold_reason := 'Carga adicionada após faturamento; revisar e refaturar.';
  END IF;
  NEW.cargo_mode := v_new_mode;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_sync_bl_weight_cargo_mode() FROM PUBLIC, anon, authenticated;
-- A implementação row-level de 059 não é mais ligada a triggers, mas o
-- símbolo permanece no catálogo para não quebrar histórico de replay.
REVOKE ALL ON FUNCTION public.trg_sync_bl_cargo_mode() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_bl_terminal_override() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bl_weight_cargo_mode ON public.bls;
CREATE TRIGGER trg_bl_weight_cargo_mode
BEFORE INSERT OR UPDATE OF cargo_mode, bb_weight_ton, bb_packages_qty ON public.bls
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_bl_weight_cargo_mode();

-- ---------------------------------------------------------------------------
-- 3. Importação de carga solta: preflight final e preservação do faturamento
-- ---------------------------------------------------------------------------

DO $function$
BEGIN
  IF to_regprocedure('public.import_breakbulk_manifest_transactional(text,bigint,uuid,integer,jsonb,jsonb,jsonb)') IS NOT NULL
     AND to_regprocedure('public.import_breakbulk_manifest_transactional_031(text,bigint,uuid,integer,jsonb,jsonb,jsonb)') IS NULL THEN
    ALTER FUNCTION public.import_breakbulk_manifest_transactional(text,bigint,uuid,integer,jsonb,jsonb,jsonb)
      RENAME TO import_breakbulk_manifest_transactional_031;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_breakbulk_manifest_transactional(
  p_filename text,
  p_voyage_id bigint,
  p_uploaded_by uuid,
  p_total_bls integer,
  p_bls jsonb,
  p_items jsonb,
  p_errors jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
  v_bl_id text;
  v_bl_ids text[];
  v_existing_bb boolean;
  v_incoming_bb boolean;
  v_preserved_bls jsonb;
  v_batch_id bigint;
  v_action_id uuid := gen_random_uuid();
  v_previous_replacement text := current_setting('vela.breakbulk_import_replacement', true);
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Credenciais invalidas para importar carga solta.'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(source.row->>'id'), ARRAY[]::text[])
    INTO v_bl_ids
  FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS source(row);

  FOR v_row IN
    SELECT b.id, b.financial_status, b.bb_weight_ton, b.bb_packages_qty,
      source.row AS incoming
    FROM public.bls AS b
    JOIN jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS source(row)
      ON b.id = source.row->>'id'
    FOR UPDATE OF b
  LOOP
    v_existing_bb := COALESCE(v_row.bb_weight_ton, 0) > 0
      OR COALESCE(v_row.bb_packages_qty, 0) > 0
      OR EXISTS (SELECT 1 FROM public.bl_breakbulk_items WHERE bl_id = v_row.id);
    v_incoming_bb := COALESCE(NULLIF(v_row.incoming->>'bb_weight_ton', '')::numeric, 0) > 0
      OR COALESCE(NULLIF(v_row.incoming->>'bb_packages_qty', '')::numeric, 0) > 0
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS item(row)
        WHERE item.row->>'bl_id' = v_row.id
      );

    IF v_row.financial_status IN ('invoiced', 'paid') AND v_existing_bb AND NOT v_incoming_bb THEN
      RAISE EXCEPTION
        'B/L % ja foi faturado (status financeiro=%); a importacao removeria carga solta. Estorne/refature antes de substituir o manifesto.',
        v_row.id, v_row.financial_status
        USING ERRCODE = 'P0003';
    END IF;
  END LOOP;

  -- O import legado recebe o status financeiro atual de B/Ls faturados. Isso
  -- impede que um payload antigo com financial_status=pending faça downgrade
  -- enquanto a carga nova é adicionada e marcada para revisão.
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN b.financial_status IN ('invoiced', 'paid')
        THEN source.row || jsonb_build_object('financial_status', b.financial_status)
      ELSE source.row
    END
  ), '[]'::jsonb)
  INTO v_preserved_bls
  FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS source(row)
  LEFT JOIN public.bls AS b ON b.id = source.row->>'id';

  PERFORM set_config('vela.breakbulk_import_replacement', 'on', true);
  -- Cria o lote sem chamar o consumidor legado de contêineres: esse consumidor
  -- interpreta p_containers=[] como substituição e apagaria CNTR já existente.
  v_batch_id := public.import_manifest_transactional_legacy_165(
    p_filename,
    p_voyage_id,
    p_uploaded_by,
    'carga_solta',
    NULL,
    p_total_bls,
    0,
    '[]'::jsonb,
    '[]'::jsonb,
    COALESCE(p_errors, '[]'::jsonb)
  );

  -- Reproduz o upsert comercial da importação sem tocar na tabela de filhos
  -- CNTR; os triggers de cargo_mode observam os filhos atuais e o peso BB
  -- recebido no mesmo statement.
  INSERT INTO public.bls (
    id, voyage_id, batch_id, cargo_mode, shipper, consignee, cargo_description,
    customer_id, pol, pod, total_weight_kg, total_cbm, review_status,
    financial_status, notes, manifest_customer_cnpj_cpf, manifest_customer_name,
    manifest_customer_email, customer_reconciliation_status,
    customer_reconciliation_notes, billing_hold_reason, ce_mercante, notify_party,
    bb_machine_qty, bb_packages_qty, bb_packages_total, bb_weight_ton, ncm_codes
  )
  SELECT
    source.row->>'id',
    p_voyage_id,
    v_batch_id,
    'carga_solta',
    source.row->>'shipper',
    source.row->>'consignee',
    source.row->>'cargo_description',
    NULLIF(source.row->>'customer_id', '')::bigint,
    source.row->>'pol',
    source.row->>'pod',
    NULLIF(source.row->>'total_weight_kg', '')::numeric,
    NULLIF(source.row->>'total_cbm', '')::numeric,
    COALESCE(NULLIF(source.row->>'review_status', ''), 'ok'),
    COALESCE(NULLIF(source.row->>'financial_status', ''), 'pending'),
    source.row->>'notes',
    public.normalize_document_text(source.row->>'manifest_customer_cnpj_cpf'),
    COALESCE(NULLIF(source.row->>'manifest_customer_name', ''), source.row->>'consignee'),
    NULLIF(source.row->>'manifest_customer_email', ''),
    COALESCE(NULLIF(source.row->>'customer_reconciliation_status', ''), 'missing_customer'),
    NULLIF(source.row->>'customer_reconciliation_notes', ''),
    NULLIF(source.row->>'billing_hold_reason', ''),
    NULLIF(source.row->>'ce_mercante', ''),
    NULLIF(source.row->>'notify_party', ''),
    NULLIF(source.row->>'bb_machine_qty', '')::numeric,
    NULLIF(source.row->>'bb_packages_qty', '')::numeric,
    NULLIF(source.row->>'bb_packages_total', '')::numeric,
    NULLIF(source.row->>'bb_weight_ton', '')::numeric,
    COALESCE(public.normalize_ncm_codes(source.row->'ncm_codes'), '{}'::text[])
  FROM jsonb_array_elements(v_preserved_bls) AS source(row)
  ON CONFLICT (id) DO UPDATE SET
    voyage_id = EXCLUDED.voyage_id,
    batch_id = EXCLUDED.batch_id,
    cargo_mode = EXCLUDED.cargo_mode,
    customer_id = EXCLUDED.customer_id,
    review_status = EXCLUDED.review_status,
    financial_status = EXCLUDED.financial_status,
    notes = EXCLUDED.notes,
    manifest_customer_cnpj_cpf = EXCLUDED.manifest_customer_cnpj_cpf,
    manifest_customer_name = EXCLUDED.manifest_customer_name,
    manifest_customer_email = EXCLUDED.manifest_customer_email,
    customer_reconciliation_status = EXCLUDED.customer_reconciliation_status,
    customer_reconciliation_notes = EXCLUDED.customer_reconciliation_notes,
    billing_hold_reason = EXCLUDED.billing_hold_reason,
    ce_mercante = EXCLUDED.ce_mercante,
    notify_party = EXCLUDED.notify_party,
    bb_machine_qty = EXCLUDED.bb_machine_qty,
    bb_packages_qty = EXCLUDED.bb_packages_qty,
    bb_packages_total = EXCLUDED.bb_packages_total,
    bb_weight_ton = EXCLUDED.bb_weight_ton,
    ncm_codes = CASE WHEN cardinality(EXCLUDED.ncm_codes) > 0 THEN EXCLUDED.ncm_codes ELSE public.bls.ncm_codes END;

  UPDATE public.bls AS target
  SET
    ce_mercante = CASE
      WHEN source.row ? 'ce_mercante' THEN NULLIF(source.row->>'ce_mercante', '')
      ELSE target.ce_mercante
    END,
    notify_party = NULLIF(source.row->>'notify_party', ''),
    bb_machine_qty = NULLIF(source.row->>'bb_machine_qty', '')::numeric,
    bb_packages_qty = NULLIF(source.row->>'bb_packages_qty', '')::numeric,
    bb_packages_total = NULLIF(source.row->>'bb_packages_total', '')::numeric,
    bb_weight_ton = NULLIF(source.row->>'bb_weight_ton', '')::numeric,
    ncm_codes = CASE
      WHEN cardinality(public.normalize_ncm_codes(source.row->'ncm_codes')) > 0
        THEN public.normalize_ncm_codes(source.row->'ncm_codes')
      ELSE target.ncm_codes
    END
  FROM jsonb_array_elements(v_preserved_bls) AS source(row)
  WHERE target.id = source.row->>'id';

  DELETE FROM public.bl_breakbulk_items
  WHERE bl_id = ANY(v_bl_ids);

  INSERT INTO public.bl_breakbulk_items (
    bl_id, item_description, package_qty, package_unit,
    gross_weight_kg, cbm, marks
  )
  SELECT
    source.row->>'bl_id',
    source.row->>'item_description',
    COALESCE(NULLIF(source.row->>'package_qty', '')::numeric, 0),
    NULLIF(source.row->>'package_unit', ''),
    COALESCE(NULLIF(source.row->>'gross_weight_kg', '')::numeric, 0),
    COALESCE(NULLIF(source.row->>'cbm', '')::numeric, 0),
    NULLIF(source.row->>'marks', '')
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS source(row);

  IF cardinality(v_bl_ids) > 0 THEN
    PERFORM public.apply_bl_review_gate_after_import(v_bl_ids, p_uploaded_by);
    FOREACH v_bl_id IN ARRAY v_bl_ids LOOP
      INSERT INTO public.import_pending_effects(
        source_action_id, effect_kind, entity_id, created_by, source_snapshot
      ) VALUES (
        v_action_id, 'local_billing', v_bl_id, p_uploaded_by,
        jsonb_build_object('filename', p_filename, 'voyage_id', p_voyage_id, 'cargo_mode', 'carga_solta')
      )
      ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
    END LOOP;
  END IF;

  PERFORM set_config('vela.breakbulk_import_replacement', COALESCE(v_previous_replacement, 'off'), true);
  RETURN jsonb_build_object('batch_id', v_batch_id, 'breakbulk_bl_ids', to_jsonb(v_bl_ids));
END;
$function$;

REVOKE ALL ON FUNCTION public.import_breakbulk_manifest_transactional(text,bigint,uuid,integer,jsonb,jsonb,jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.import_breakbulk_manifest_transactional(text,bigint,uuid,integer,jsonb,jsonb,jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Terminal: uma FK composta, COD limpando a exceção e GUC restaurado
-- ---------------------------------------------------------------------------

ALTER TABLE public.bls DROP CONSTRAINT IF EXISTS bls_terminal_id_fkey;
ALTER TABLE public.bls DROP CONSTRAINT IF EXISTS bls_terminal_pod_port_fk;
ALTER TABLE public.bls
  ADD CONSTRAINT bls_terminal_pod_port_fk
  FOREIGN KEY (terminal_id, pod_port_id)
  REFERENCES public.depots(id, port_id)
  ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.set_bl_terminal_override(
  p_bl_id text,
  p_terminal_id uuid,
  p_pod_port_id bigint,
  p_justification text,
  p_changed_by uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.bls%ROWTYPE;
  v_terminal record;
  v_actor uuid := COALESCE(p_changed_by, auth.uid());
  v_old jsonb;
  v_new jsonb;
  v_previous_override text := current_setting('vela.bl_terminal_override', true);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário interno ativo é obrigatório.' USING ERRCODE = '42501';
  END IF;
  IF p_changed_by IS NOT NULL AND p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'O autor da exceção deve ser o usuário autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(COALESCE(p_justification, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A justificativa da exceção de terminal é obrigatória.' USING ERRCODE = '22023';
  END IF;
  IF (p_terminal_id IS NULL) IS DISTINCT FROM (p_pod_port_id IS NULL) THEN
    RAISE EXCEPTION 'Terminal e porto devem ser informados juntos.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_bl
  FROM public.bls
  WHERE id = upper(btrim(p_bl_id))
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF p_terminal_id IS NOT NULL THEN
    SELECT d.id, d.port_id, d.code, d.name, p.locode
      INTO v_terminal
    FROM public.depots AS d
    JOIN public.ports AS p ON p.id = d.port_id
    WHERE d.id = p_terminal_id
      AND d.port_id = p_pod_port_id
      AND d.tipo = 'terminal_portuario'
      AND d.active
      AND public.normalize_port_code(p.locode) = public.normalize_port_code(v_bl.pod);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Terminal inválido para o POD do B/L.' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_old := jsonb_build_object('terminal_id', v_bl.terminal_id, 'pod_port_id', v_bl.pod_port_id);
  v_new := jsonb_build_object('terminal_id', p_terminal_id, 'pod_port_id', p_pod_port_id);
  PERFORM set_config('vela.bl_terminal_override', 'on', true);
  UPDATE public.bls
  SET terminal_id = p_terminal_id,
      pod_port_id = p_pod_port_id,
      updated_at = now()
  WHERE id = v_bl.id;
  PERFORM set_config('vela.bl_terminal_override', COALESCE(v_previous_override, 'off'), true);

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, changed_at, justification
  ) VALUES (
    'bl', v_bl.id, 'terminal_override', v_old::text, v_new::text,
    v_actor, now(), btrim(p_justification)
  );

  RETURN jsonb_build_object(
    'bl_id', v_bl.id,
    'terminal_id', p_terminal_id,
    'pod_port_id', p_pod_port_id,
    'justification', btrim(p_justification),
    'changed_by', v_actor
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_bl_terminal_override(text, uuid, bigint, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bl_terminal_override(text, uuid, bigint, text, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. COD: alterar destino também remove a exceção terminal anterior
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_bl_cod(
  p_bl_id text,
  p_omission_id bigint,
  p_justification text,
  p_changed_by uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_discharge text;
  v_omitted text;
  v_old_pod text;
  v_customer bigint;
  v_old_terminal uuid;
  v_old_pod_port_id bigint;
  v_justification text := NULLIF(btrim(COALESCE(p_justification, '')), '');
  v_previous_override text := current_setting('vela.bl_terminal_override', true);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_justification IS NULL THEN
    RAISE EXCEPTION 'Marcar COD exige justificativa.' USING ERRCODE = '22023';
  END IF;

  SELECT o.discharge_pod, o.omitted_pod INTO v_discharge, v_omitted
  FROM public.bl_transshipments AS t
  JOIN public.voyage_omissions AS o ON o.id = t.omission_id
  WHERE t.bl_id = p_bl_id AND t.omission_id = p_omission_id
  FOR UPDATE OF o;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transbordo do B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  SELECT pod, customer_id, terminal_id, pod_port_id
    INTO v_old_pod, v_customer, v_old_terminal, v_old_pod_port_id
  FROM public.bls
  WHERE id = p_bl_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.bl_transshipments
  SET disposition = 'cod', updated_at = now()
  WHERE bl_id = p_bl_id AND omission_id = p_omission_id;

  -- A exceção terminal é específica do POD anterior. COD deve limpar os dois
  -- campos como uma operação atômica; deixar a dupla antiga seria herdar um
  -- terminal incompatível no destino novo.
  PERFORM set_config('vela.bl_terminal_override', 'on', true);
  UPDATE public.bls
  SET pod = v_discharge,
      manifesto_mercante_id = NULL,
      terminal_id = NULL,
      pod_port_id = NULL,
      updated_at = now()
  WHERE id = p_bl_id;
  PERFORM set_config('vela.bl_terminal_override', COALESCE(v_previous_override, 'off'), true);

  IF to_regprocedure('public.apply_cod_financial_effect(text,bigint,text)') IS NOT NULL THEN
    PERFORM public.apply_cod_financial_effect(p_bl_id, p_omission_id, v_old_pod);
  END IF;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bls', p_bl_id, 'pod', v_old_pod, v_discharge, p_changed_by,
    'COD apos omissao da escala de ' || v_omitted || ': ' || v_justification);

  IF v_old_terminal IS NOT NULL OR v_old_pod_port_id IS NOT NULL THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES (
      'bls', p_bl_id, 'terminal_override',
      jsonb_build_object('terminal_id', v_old_terminal, 'pod_port_id', v_old_pod_port_id)::text,
      jsonb_build_object('terminal_id', NULL, 'pod_port_id', NULL)::text,
      p_changed_by,
      'Excecao de terminal limpa por COD: ' || v_justification
    );
  END IF;

  IF v_customer IS NOT NULL THEN
    INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
    VALUES (v_customer, p_bl_id, 'transshipment', 'Destino alterado (COD)',
      'A pedido, o destino final do B/L ' || p_bl_id || ' foi alterado para ' || v_discharge ||
        ' (COD), apos a omissao da escala de ' || v_omitted || '.', NULL);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_bl_cod(text, bigint, text, uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_bl_cod(text, bigint, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Taxa manual: sincronizar recebível local já materializado
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_sync_manual_local_charge_receivable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text := COALESCE(NEW.bl_id, OLD.bl_id);
  v_source text := COALESCE(NEW.source, OLD.source);
BEGIN
  IF v_source = 'manual'
     AND v_bl_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.bl_receivables
       WHERE bl_id = v_bl_id AND source = 'local_charges'
     ) THEN
    PERFORM public.sync_local_charge_receivable(v_bl_id);
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_sync_manual_local_charge_receivable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_manual_local_charge_receivable ON public.charge_calculations;
CREATE TRIGGER trg_sync_manual_local_charge_receivable
AFTER INSERT OR UPDATE OR DELETE ON public.charge_calculations
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_manual_local_charge_receivable();

-- ---------------------------------------------------------------------------
-- 7. Alertas e resumo: filtros de dados ativos e peso aditivo
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reconcile_customer_bl_review_alerts(
  p_customer_id bigint,
  p_consignee text,
  p_source text DEFAULT 'bl_review_gate'::text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_source text := COALESCE(NULLIF(btrim(p_source), ''), 'bl_review_gate');
  v_customer_name text;
  v_customer_label text;
  v_entity_id text;
  v_consignee_key text;
  v_has_email boolean := false;
  v_portal_ready boolean := false;
  v_total_pending integer := 0;
  v_bb_pending integer := 0;
  v_msg text;
BEGIN
  IF p_customer_id IS NOT NULL THEN
    SELECT name INTO v_customer_name FROM public.customers WHERE id = p_customer_id;
    v_customer_label := COALESCE(v_customer_name, 'Cliente #' || p_customer_id::text);
    v_entity_id := p_customer_id::text;

    SELECT EXISTS (
      SELECT 1 FROM public.customer_contacts AS c
      WHERE c.customer_id = p_customer_id
        AND c.deactivated_at IS NULL
        AND NULLIF(btrim(c.email), '') IS NOT NULL
    ) INTO v_has_email;
    v_portal_ready := public.customer_portal_access_ready(p_customer_id);

    SELECT count(*), count(*) FILTER (
      WHERE cargo_mode IN ('carga_solta', 'misto')
        AND (bb_weight_ton IS NULL OR bb_weight_ton <= 0)
    ) INTO v_total_pending, v_bb_pending
    FROM public.bls
    WHERE customer_id = p_customer_id AND review_status = 'pending_review';

    IF v_total_pending > 0 AND NOT v_has_email THEN
      v_msg := 'Cliente ' || v_customer_label || ': ' || v_total_pending ||
        CASE WHEN v_total_pending = 1 THEN ' B/L pendente de revisão (sem e-mail cadastrado)'
             ELSE ' B/Ls pendentes de revisão (sem e-mail cadastrado)' END;
      PERFORM public.upsert_alert_item(
        'review_customer_email_missing', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('customer_id', p_customer_id, 'pending_count', v_total_pending), '/revisao'
      );
    ELSE
      PERFORM public.resolve_alert_item('review_customer_email_missing', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;

    IF v_total_pending > 0 AND NOT v_portal_ready THEN
      v_msg := 'Cliente ' || v_customer_label || ': ' || v_total_pending ||
        CASE WHEN v_total_pending = 1 THEN ' B/L pendente (Conta de Portal não provisionada)'
             ELSE ' B/Ls pendentes (Conta de Portal não provisionada)' END;
      PERFORM public.upsert_alert_item(
        'review_portal_not_ready', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('customer_id', p_customer_id, 'pending_count', v_total_pending),
        '/clientes/portal?cliente=' || p_customer_id::text
      );
    ELSE
      PERFORM public.resolve_alert_item('review_portal_not_ready', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;

    IF v_bb_pending > 0 THEN
      v_msg := 'Cliente ' || v_customer_label || ': ' || v_bb_pending ||
        CASE WHEN v_bb_pending = 1 THEN ' B/L pendente de revisão (peso BB ausente)'
             ELSE ' B/Ls pendentes de revisão (peso BB ausente)' END;
      PERFORM public.upsert_alert_item(
        'review_breakbulk_weight_missing', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('customer_id', p_customer_id, 'pending_count', v_bb_pending), '/revisao'
      );
    ELSE
      PERFORM public.resolve_alert_item('review_breakbulk_weight_missing', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;
    PERFORM public.resolve_alert_item('review_customer_unlinked', 'customer', v_entity_id, v_source, '{}'::jsonb);
  ELSE
    v_consignee_key := COALESCE(NULLIF(btrim(p_consignee), ''), 'sem_cliente');
    v_entity_id := v_consignee_key;

    SELECT count(*), count(*) FILTER (
      WHERE cargo_mode IN ('carga_solta', 'misto')
        AND (bb_weight_ton IS NULL OR bb_weight_ton <= 0)
    ) INTO v_total_pending, v_bb_pending
    FROM public.bls
    WHERE customer_id IS NULL
      AND review_status = 'pending_review'
      AND COALESCE(NULLIF(btrim(consignee), ''), 'sem_cliente') = v_consignee_key;

    IF v_total_pending > 0 THEN
      v_msg := 'Cliente ' || v_consignee_key || ': ' || v_total_pending ||
        CASE WHEN v_total_pending = 1 THEN ' B/L pendente de vínculo com cliente'
             ELSE ' B/Ls pendentes de vínculo com cliente' END;
      PERFORM public.upsert_alert_item(
        'review_customer_unlinked', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('consignee', v_consignee_key, 'pending_count', v_total_pending), '/revisao'
      );
    ELSE
      PERFORM public.resolve_alert_item('review_customer_unlinked', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;

    IF v_bb_pending > 0 THEN
      v_msg := 'Cliente ' || v_consignee_key || ': ' || v_bb_pending ||
        CASE WHEN v_bb_pending = 1 THEN ' B/L pendente de revisão (peso BB ausente)'
             ELSE ' B/Ls pendentes de revisão (peso BB ausente)' END;
      PERFORM public.upsert_alert_item(
        'review_breakbulk_weight_missing', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('consignee', v_consignee_key, 'pending_count', v_bb_pending), '/revisao'
      );
    ELSE
      PERFORM public.resolve_alert_item('review_breakbulk_weight_missing', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;
    PERFORM public.resolve_alert_item('review_customer_email_missing', 'customer', v_entity_id, v_source, '{}'::jsonb);
    PERFORM public.resolve_alert_item('review_portal_not_ready', 'customer', v_entity_id, v_source, '{}'::jsonb);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.operational_list_bl_summary(
  p_search text DEFAULT NULL::text,
  p_voyage_id bigint DEFAULT NULL::bigint,
  p_cargo_mode text DEFAULT NULL::text,
  p_pol text DEFAULT NULL::text,
  p_pod text DEFAULT NULL::text,
  p_review_status text DEFAULT NULL::text,
  p_financial_status text DEFAULT NULL::text,
  p_charge_status text DEFAULT NULL::text,
  p_cargo_profile text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
WITH filtered AS (
  SELECT b.*
  FROM public.bls b
  LEFT JOIN public.customers c ON c.id = b.customer_id
  WHERE (p_voyage_id IS NULL OR b.voyage_id = p_voyage_id)
    AND public.bl_cargo_mode_matches_filter(b.cargo_mode, p_cargo_mode)
    AND (NULLIF(btrim(coalesce(p_pol, '')), '') IS NULL OR b.pol ILIKE '%' || btrim(p_pol) || '%')
    AND (NULLIF(btrim(coalesce(p_pod, '')), '') IS NULL OR b.pod ILIKE '%' || btrim(p_pod) || '%')
    AND (NULLIF(btrim(coalesce(p_review_status, '')), '') IS NULL OR b.review_status = p_review_status)
    AND (NULLIF(btrim(coalesce(p_financial_status, '')), '') IS NULL OR b.financial_status = p_financial_status)
    AND (NULLIF(btrim(coalesce(p_charge_status, '')), '') IS NULL OR lower(btrim(coalesce(b.charge_status, ''))) = lower(btrim(p_charge_status)))
    AND (NULLIF(btrim(coalesce(p_search, '')), '') IS NULL OR b.id ILIKE '%' || btrim(p_search) || '%' OR b.consignee ILIKE '%' || btrim(p_search) || '%' OR c.name ILIKE '%' || btrim(p_search) || '%' OR c.cnpj_cpf ILIKE '%' || btrim(p_search) || '%')
    AND (
      NULLIF(btrim(coalesce(p_cargo_profile, '')), '') IS NULL
      OR (p_cargo_profile = 'standard' AND NOT EXISTS (SELECT 1 FROM public.bl_containers bc WHERE bc.bl_id = b.id AND (coalesce(bc.is_imo, false) OR coalesce(bc.is_oog, false))))
      OR (p_cargo_profile = 'imo' AND EXISTS (SELECT 1 FROM public.bl_containers bc WHERE bc.bl_id = b.id AND coalesce(bc.is_imo, false)))
      OR (p_cargo_profile = 'oog' AND EXISTS (SELECT 1 FROM public.bl_containers bc WHERE bc.bl_id = b.id AND coalesce(bc.is_oog, false)))
    )
)
SELECT jsonb_build_object(
  'totalBls', count(*)::integer,
  'totalDistinctContainers', (SELECT count(DISTINCT upper(btrim(bc.container_number))) FROM public.bl_containers bc JOIN filtered f ON f.id = bc.bl_id WHERE nullif(btrim(bc.container_number), '') IS NOT NULL),
  'pendingReview', count(*) FILTER (WHERE review_status = 'pending_review')::integer,
  'pendingFinancial', count(*) FILTER (WHERE financial_status = 'pending')::integer,
  'chargePending', count(*) FILTER (WHERE lower(btrim(coalesce(charge_status, ''))) IN ('review_required', 'not_calculated'))::integer,
  'chargeReady', count(*) FILTER (WHERE lower(btrim(coalesce(charge_status, ''))) = 'ready_for_billing')::integer,
  'chargeExempt', count(*) FILTER (WHERE lower(btrim(coalesce(charge_status, ''))) = 'exempt')::integer,
  'totalMachines', coalesce(sum(bb_machine_qty), 0),
  'totalPackages', coalesce(sum(coalesce(bb_packages_total, bb_packages_qty)), 0),
  -- Somar os dois componentes evita perder o peso de contêiner em B/L misto.
  'totalWeightTon', coalesce(sum(coalesce(total_weight_kg, 0) / 1000 + coalesce(bb_weight_ton, 0)), 0),
  'totalCbm', coalesce(sum(total_cbm), 0)
)
FROM filtered;
$function$;

REVOKE ALL ON FUNCTION public.operational_list_bl_summary(text, bigint, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operational_list_bl_summary(text, bigint, text, text, text, text, text, text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Comunicações automáticas: uma única produtora, com NOB composto antes
--    da claim e POD normalizado
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.evaluate_and_dispatch_automatic_communications(
  p_as_of timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_schedule record;
  v_customer_bl record;
  v_candidates jsonb := '[]'::jsonb;
  v_as_of timestamptz := coalesce(p_as_of, now());
  v_kind text;
  v_milestone timestamptz;
  v_key text;
  v_voyage_id bigint;
  v_vessel_name text;
  v_voyage_number text;
  v_port text;
  v_atracacao record;
  v_nob_suppressed boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  -- NOA/NOR: somente D-5 até antes do ETA; NOR a partir do ATA no dia do marco.
  FOR v_schedule IN
    WITH entities AS (
      SELECT DISTINCT entity_id
      FROM public.audit_logs
      WHERE entity_type = 'voyage_pod_schedule'
        AND entity_id ~ '^[0-9]+::[^:]+$'
    ), latest AS (
      SELECT e.entity_id,
        public.customer_communication_safe_timestamptz((SELECT a.new_value FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = e.entity_id AND a.field_name = 'eta' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1)) AS eta,
        public.customer_communication_safe_timestamptz((SELECT a.new_value FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = e.entity_id AND a.field_name = 'ata' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1)) AS ata,
        COALESCE((SELECT lower(a.new_value) = 'true' FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = e.entity_id AND a.field_name = 'deleted' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1), false) AS deleted,
        COALESCE((SELECT lower(a.new_value) = 'true' FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = e.entity_id AND a.field_name = 'omitted' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1), false) AS omitted
      FROM entities e
    )
    SELECT v.id AS voyage_id, v.voyage_number, vs.name AS vessel_name,
      split_part(l.entity_id, '::', 2) AS port, l.eta, l.ata
    FROM latest l
    JOIN public.voyages v ON v.id = split_part(l.entity_id, '::', 1)::bigint
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    WHERE NOT l.deleted AND NOT l.omitted
      AND ((l.ata IS NULL AND l.eta IS NOT NULL
            AND v_as_of >= l.eta - interval '5 days' AND v_as_of < l.eta)
        OR (l.ata IS NOT NULL AND l.ata BETWEEN v_as_of - interval '30 days' AND v_as_of))
  LOOP
    v_voyage_id := v_schedule.voyage_id;
    v_vessel_name := v_schedule.vessel_name;
    v_voyage_number := v_schedule.voyage_number;
    v_port := v_schedule.port;
    v_kind := CASE WHEN v_schedule.ata IS NOT NULL THEN 'aviso_prontidao_nor' ELSE 'aviso_chegada_noa' END;
    v_milestone := CASE WHEN v_kind = 'aviso_prontidao_nor' THEN v_schedule.ata ELSE v_schedule.eta END;

    FOR v_customer_bl IN
      SELECT b.customer_id, array_agg(DISTINCT b.id ORDER BY b.id) AS bl_ids,
        c.name AS customer_name, c.cnpj_cpf,
        array_agg(DISTINCT NULLIF(btrim(cc.email), '') ORDER BY NULLIF(btrim(cc.email), ''))
          FILTER (WHERE NULLIF(btrim(cc.email), '') IS NOT NULL
            AND NULLIF(btrim(cc.email), '') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') AS emails
      FROM public.bls b
      JOIN public.customers c ON c.id = b.customer_id
      LEFT JOIN public.customer_contacts cc ON cc.customer_id = b.customer_id
      JOIN public.customer_contact_box_links ccb ON ccb.contact_id = cc.id
      WHERE b.voyage_id = v_voyage_id
        AND public.normalize_port_code(b.pod) = public.normalize_port_code(v_port)
        AND b.customer_id IS NOT NULL
        AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
        AND cc.deactivated_at IS NULL
        AND ccb.box_code = 'documentacao_operacao'
        AND NULLIF(btrim(cc.email), '') IS NOT NULL
        AND NULLIF(btrim(cc.email), '') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_contact_preferences cp
          WHERE cp.contact_id = cc.id AND cp.nature = 'avisos_operacionais' AND cp.enabled = false
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.portal_suppressed_emails pse
          WHERE lower(btrim(pse.email)) = lower(btrim(cc.email)) AND pse.reason = 'bounce_permanente'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_communication_suppressions ccs
          WHERE lower(btrim(ccs.email)) = lower(btrim(cc.email))
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_communications sent
          WHERE sent.customer_id = b.customer_id
            AND sent.kind = v_kind
            AND sent.nature = 'avisos_operacionais'
            AND sent.status IN ('enviado', 'simulado')
            AND sent.anchor_voyage_id = v_voyage_id
            AND public.normalize_port_code(sent.anchor_port) = public.normalize_port_code(v_port)
        )
      GROUP BY b.customer_id, c.name, c.cnpj_cpf
    LOOP
      v_key := v_kind || ':' || v_customer_bl.customer_id || ':' || v_voyage_id || ':' || upper(btrim(v_port));
      INSERT INTO public.customer_communication_automation_claims (claim_key)
      VALUES (v_key)
      ON CONFLICT (claim_key) DO UPDATE
        SET claimed_at = now(), released_at = NULL
        WHERE customer_communication_automation_claims.released_at IS NOT NULL
           OR customer_communication_automation_claims.claimed_at < v_as_of - interval '30 minutes';
      IF FOUND THEN
        v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
          'claim_key', v_key, 'kind', v_kind, 'nature', 'avisos_operacionais',
          'customer_id', v_customer_bl.customer_id, 'customer_name', v_customer_bl.customer_name,
          'customer_cnpj', v_customer_bl.cnpj_cpf, 'voyage_id', v_voyage_id,
          'vessel_name', v_vessel_name, 'voyage_number', v_voyage_number,
          'port', upper(btrim(v_port)), 'milestone_at', v_milestone,
          'bl_ids', to_jsonb(v_customer_bl.bl_ids), 'emails', to_jsonb(v_customer_bl.emails)
        ));
      END IF;
    END LOOP;
  END LOOP;

  -- CE Mercante: produtor server-side durável, independente da tela de B/L.
  FOR v_customer_bl IN
    SELECT b.voyage_id, b.customer_id, c.name AS customer_name, c.cnpj_cpf,
      v.voyage_number, vs.name AS vessel_name, min(b.pod) AS port,
      v.eta AS milestone_at, array_agg(DISTINCT b.id ORDER BY b.id) AS bl_ids,
      array_agg(DISTINCT NULLIF(btrim(cc.email), '') ORDER BY NULLIF(btrim(cc.email), '')) AS emails
    FROM public.bls b
    JOIN public.customers c ON c.id = b.customer_id
    JOIN public.voyages v ON v.id = b.voyage_id
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    JOIN public.customer_contacts cc ON cc.customer_id = b.customer_id
    JOIN public.customer_contact_box_links ccb ON ccb.contact_id = cc.id
    WHERE b.customer_id IS NOT NULL
      AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
      AND cc.deactivated_at IS NULL
      AND ccb.box_code IN ('documentacao_operacao', 'financeiro')
      AND NULLIF(btrim(cc.email), '') IS NOT NULL
      AND NULLIF(btrim(cc.email), '') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      AND NOT EXISTS (SELECT 1 FROM public.customer_contact_preferences cp WHERE cp.contact_id = cc.id AND cp.nature = 'documentacao' AND cp.enabled = false)
      AND NOT EXISTS (SELECT 1 FROM public.portal_suppressed_emails pse WHERE lower(btrim(pse.email)) = lower(btrim(cc.email)) AND pse.reason = 'bounce_permanente')
      AND NOT EXISTS (SELECT 1 FROM public.customer_communication_suppressions ccs WHERE lower(btrim(ccs.email)) = lower(btrim(cc.email)))
      AND (public.customer_local_charges_communication_readiness(b.voyage_id, b.customer_id)->>'ready')::boolean
      AND NOT EXISTS (
        SELECT 1 FROM public.customer_communications sent
        WHERE sent.customer_id = b.customer_id AND sent.kind = 'ce_mercante_taxas'
          AND sent.nature = 'documentacao' AND sent.status IN ('enviado', 'simulado')
          AND sent.anchor_voyage_id = b.voyage_id AND sent.attempt_discriminator = 0
      )
    GROUP BY b.voyage_id, b.customer_id, c.name, c.cnpj_cpf, v.voyage_number, vs.name, v.eta
  LOOP
    v_key := 'ce_mercante_taxas:' || v_customer_bl.customer_id || ':' || v_customer_bl.voyage_id;
    INSERT INTO public.customer_communication_automation_claims (claim_key)
      VALUES (v_key)
      ON CONFLICT (claim_key) DO UPDATE
        SET claimed_at = now(), released_at = NULL
        WHERE customer_communication_automation_claims.released_at IS NOT NULL
           OR customer_communication_automation_claims.claimed_at < v_as_of - interval '30 minutes';
    IF FOUND THEN
      v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
        'claim_key', v_key, 'kind', 'ce_mercante_taxas', 'nature', 'documentacao',
        'customer_id', v_customer_bl.customer_id, 'customer_name', v_customer_bl.customer_name,
        'customer_cnpj', v_customer_bl.cnpj_cpf, 'voyage_id', v_customer_bl.voyage_id,
        'vessel_name', v_customer_bl.vessel_name, 'voyage_number', v_customer_bl.voyage_number,
        'port', COALESCE(v_customer_bl.port, '—'), 'milestone_at', v_customer_bl.milestone_at,
        'bl_ids', to_jsonb(v_customer_bl.bl_ids), 'emails', to_jsonb(v_customer_bl.emails)
      ));
    END IF;
  END LOOP;

  -- NOB: o agrupamento já contém todos os B/Ls elegíveis do cliente para a
  -- atracação. A claim só é criada depois da composição, evitando que um B/L
  -- puro consuma a claim antes que o B/L misto entre no mesmo envio.
  FOR v_atracacao IN
    SELECT ts.id AS state_id, ts.voyage_id, upper(btrim(ts.port)) AS port,
      ts.terminal_id, ts.terminal_atb,
      public.voyage_terminal_code(ts.terminal_id) AS terminal_code,
      v.voyage_number, vs.name AS vessel_name
    FROM public.voyage_escala_terminal_state ts
    JOIN public.voyages v ON v.id = ts.voyage_id
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    WHERE ts.terminal_id IS NOT NULL
      AND ts.terminal_atb IS NOT NULL
      AND ts.terminal_atb <= v_as_of
      AND ts.terminal_atb >= v_as_of - interval '30 days'
      AND public.voyage_terminal_code(ts.terminal_id) IS NOT NULL
  LOOP
    SELECT COALESCE((
      SELECT lower(btrim(a.new_value)) = 'true'
      FROM public.audit_logs a
      WHERE a.entity_type = 'voyage_pod_schedule'
        AND a.entity_id = v_atracacao.voyage_id || '::' || v_atracacao.port
        AND a.field_name = 'deleted'
      ORDER BY a.changed_at DESC, a.id DESC LIMIT 1
    ), false) INTO v_nob_suppressed;
    v_nob_suppressed := v_nob_suppressed OR COALESCE((
      SELECT lower(btrim(a.new_value)) = 'true'
      FROM public.audit_logs a
      WHERE a.entity_type = 'voyage_pod_schedule'
        AND a.entity_id = v_atracacao.voyage_id || '::' || v_atracacao.port
        AND a.field_name = 'omitted'
      ORDER BY a.changed_at DESC, a.id DESC LIMIT 1
    ), false);
    CONTINUE WHEN v_nob_suppressed;

    FOR v_customer_bl IN
      SELECT b.customer_id,
        array_agg(DISTINCT b.id ORDER BY b.id) AS bl_ids,
        c.name AS customer_name,
        c.cnpj_cpf,
        array_agg(DISTINCT NULLIF(btrim(cc.email), '') ORDER BY NULLIF(btrim(cc.email), ''))
          FILTER (WHERE NULLIF(btrim(cc.email), '') IS NOT NULL
            AND NULLIF(btrim(cc.email), '') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') AS emails
      FROM public.bls b
      JOIN public.customers c ON c.id = b.customer_id
      LEFT JOIN public.customer_contacts cc ON cc.customer_id = b.customer_id
      JOIN public.customer_contact_box_links ccb ON ccb.contact_id = cc.id
      WHERE b.voyage_id = v_atracacao.voyage_id
        AND public.normalize_port_code(b.pod) = public.normalize_port_code(v_atracacao.port)
        AND b.customer_id IS NOT NULL
        AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
        AND cc.deactivated_at IS NULL
        AND ccb.box_code = 'documentacao_operacao'
        AND NULLIF(btrim(cc.email), '') IS NOT NULL
        AND NULLIF(btrim(cc.email), '') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        AND public.resolve_bl_terminal_id(b.id) = v_atracacao.terminal_id
        AND (
          -- A exceção auditada já identifica o terminal escolhido. Ela não
          -- pode ser invalidada pela ausência de uma frente nesse terminal;
          -- sem exceção, a frente continua obrigatória.
          b.terminal_id IS NOT NULL
          OR (
            b.cargo_mode = 'misto'
            AND EXISTS (
              SELECT 1 FROM public.voyage_escala_operation_fronts f
              WHERE f.voyage_id = b.voyage_id
                AND public.normalize_port_code(f.port) = public.normalize_port_code(v_atracacao.port)
                AND f.terminal_id = v_atracacao.terminal_id
                AND f.sentido = 'importacao' AND f.modalidade = 'carga_cheia'
            )
            AND EXISTS (
              SELECT 1 FROM public.voyage_escala_operation_fronts f
              WHERE f.voyage_id = b.voyage_id
                AND public.normalize_port_code(f.port) = public.normalize_port_code(v_atracacao.port)
                AND f.terminal_id = v_atracacao.terminal_id
                AND f.sentido = 'importacao' AND f.modalidade = 'carga_solta'
            )
          )
          OR (
            b.cargo_mode <> 'misto'
            AND EXISTS (
              SELECT 1 FROM public.voyage_escala_operation_fronts f
              WHERE f.voyage_id = b.voyage_id
                AND public.normalize_port_code(f.port) = public.normalize_port_code(v_atracacao.port)
                AND f.terminal_id = v_atracacao.terminal_id
                AND f.sentido = 'importacao'
                AND f.modalidade = public.bl_operation_front_modalidade(b.cargo_mode)
            )
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_contact_preferences cp
          WHERE cp.contact_id = cc.id AND cp.nature = 'avisos_operacionais' AND cp.enabled = false
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.portal_suppressed_emails pse
          WHERE lower(btrim(pse.email)) = lower(btrim(cc.email)) AND pse.reason = 'bounce_permanente'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_communication_suppressions ccs
          WHERE lower(btrim(ccs.email)) = lower(btrim(cc.email))
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_communications sent
          WHERE sent.customer_id = b.customer_id
            AND sent.kind = 'aviso_atracacao_nob'
            AND sent.nature = 'avisos_operacionais'
            AND sent.status IN ('enviado', 'simulado')
            AND sent.anchor_atracacao_id = v_atracacao.state_id
        )
      GROUP BY b.customer_id, c.name, c.cnpj_cpf
    LOOP
      v_key := 'aviso_atracacao_nob:' || v_customer_bl.customer_id || ':' || v_atracacao.state_id;
      INSERT INTO public.customer_communication_automation_claims (claim_key)
      VALUES (v_key)
      ON CONFLICT (claim_key) DO UPDATE
        SET claimed_at = now(), released_at = NULL
        WHERE customer_communication_automation_claims.released_at IS NOT NULL
           OR customer_communication_automation_claims.claimed_at < v_as_of - interval '30 minutes';
      IF FOUND THEN
        v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
          'claim_key', v_key,
          'kind', 'aviso_atracacao_nob',
          'nature', 'avisos_operacionais',
          'customer_id', v_customer_bl.customer_id,
          'customer_name', v_customer_bl.customer_name,
          'customer_cnpj', v_customer_bl.cnpj_cpf,
          'voyage_id', v_atracacao.voyage_id,
          'vessel_name', v_atracacao.vessel_name,
          'voyage_number', v_atracacao.voyage_number,
          'port', v_atracacao.port,
          'milestone_at', v_atracacao.terminal_atb,
          'anchor_atracacao_id', v_atracacao.state_id,
          'terminal_id', v_atracacao.terminal_id,
          'terminal_name', v_atracacao.terminal_code,
          'bl_ids', to_jsonb(v_customer_bl.bl_ids),
          'emails', to_jsonb(v_customer_bl.emails)
        ));
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_candidates;
END;
$function$;

REVOKE ALL ON FUNCTION public.evaluate_and_dispatch_automatic_communications(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_and_dispatch_automatic_communications(timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.evaluate_and_dispatch_automatic_communications_045(timestamptz) FROM PUBLIC, anon, authenticated;

-- Migration 088: trava de exclusão pelo CE Mercante; exclusão de viagem em
-- cascata com prévia; exclusão de escala numa operação; atracação e taxa
-- manual com o Administrativo (ADR 0071, itens 1-8; plano
-- docs/plans/2026-09-24-politica-de-exclusao.md, Fase 4a; achado A8).
--
-- - delete_lock_reasons(viagem, porto, terminal): motivos que travam a
--   exclusão. Trava: B/L com CE Mercante; documento financeiro (fatura,
--   fatura consolidada, recebível, fatura de Demurrage) dos B/Ls; ADR de Saída
--   fechado; no nível da viagem, também Granito com CE ou faturado e comunicado
--   ao cliente ancorado na viagem. Lista vazia = pode excluir.
-- - bl_delete_lock_reasons(B/L): a trava do B/L (CE Mercante ou documento
--   financeiro) vale também para excluir o B/L, o container e o veículo dele
--   (ADR 0071, itens 1, 2 e 6). O DELETE direto nessas três tabelas sai de
--   authenticated: a exclusão passa só por delete_records.
-- - delete_records ganha o tipo 'voyage': sem trava e não cancelada, a viagem
--   sai com o que é dela, numa sub-transação. O que sai e o que só se
--   desvincula vem de uma lista explícita (voyage_delete_children_spec), a
--   mesma que voyage_delete_preview conta para o diálogo (ADR 0072, item 2).
--   Tabela nova que aponte para a viagem não entra sozinha: o guard
--   trg_guard_voyage_hard_delete (067) recusa a exclusão até a lista a incluir.
-- - Excluir exige motivo (ADR 0071, item 8): delete_records e delete_escala
--   recusam a execução sem motivo; a prévia não pede.
-- - delete_escala(viagem, porto): substitui as duas chamadas do navegador
--   (marca do POD em audit_logs + exclusão da escala de exportação) por uma
--   operação com trava, motivo e Administrativo. A policy de DELETE de
--   voyage_export_schedules passa de is_active_user() a is_admin()
--   (supersede a decisão da migration 080; ADR 0071, achado A8). Excluir escala
--   leva junto as atracações, as frentes e o ADR de Saída aberto do porto.
-- - Remover atracação (tirar o terminal da escala no modal) passa a exigir o
--   Administrativo e respeitar a trava, por trigger em
--   voyage_escala_terminal_state. O trigger olha o usuário da sessão
--   (auth.uid()), não o dono da função: a remoção feita por
--   save_voyage_escala_terminal_state também passa por ele. Contextos sem
--   usuário (rotinas do banco) não são afetados.
-- - delete_manual_bl_charge passa a exigir o Administrativo (achado A8).
--
-- Não reescreve nem apaga linhas existentes.

CREATE OR REPLACE FUNCTION public.delete_lock_reasons(
  p_voyage_id bigint,
  p_port text DEFAULT NULL,
  p_terminal_id uuid DEFAULT NULL
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_port text := NULLIF(upper(btrim(p_port)), '');
  v_reasons text[] := ARRAY[]::text[];
  v_bls text[];
BEGIN
  v_bls := ARRAY(
    SELECT b.id FROM public.bls b
    WHERE b.voyage_id = p_voyage_id
      AND (v_port IS NULL OR upper(b.pol) = v_port OR upper(b.pod) = v_port)
      -- ponytail: B/L sem terminal gravado herda o da frente de operação
      -- (ADR 0068); sem resolver a frente aqui, ele conta para toda atracação
      -- do porto. Leitura conservadora: pode travar a mais, nunca a menos.
      -- Upgrade: usar o terminal resolvido do B/L quando houver função única.
      AND (p_terminal_id IS NULL OR b.terminal_id = p_terminal_id OR b.terminal_id IS NULL)
  );

  IF EXISTS (SELECT 1 FROM public.bls b WHERE b.id = ANY (v_bls) AND b.ce_mercante IS NOT NULL) THEN
    v_reasons := array_append(v_reasons, 'B/L com CE Mercante');
  END IF;

  IF EXISTS (SELECT 1 FROM public.invoices i WHERE i.bl_id = ANY (v_bls))
     OR EXISTS (SELECT 1 FROM public.invoice_bls ib WHERE ib.bl_id = ANY (v_bls))
     OR EXISTS (SELECT 1 FROM public.bl_receivables r WHERE r.bl_id = ANY (v_bls))
     OR EXISTS (SELECT 1 FROM public.demurrage_invoices d WHERE d.bl_id = ANY (v_bls))
     OR (v_port IS NULL AND EXISTS (SELECT 1 FROM public.bl_receivables r WHERE r.voyage_id = p_voyage_id)) THEN
    v_reasons := array_append(v_reasons, 'documento financeiro emitido');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.agency_departure_reports a
    WHERE a.voyage_id = p_voyage_id AND a.status = 'closed'
      AND (v_port IS NULL OR upper(a.port) = v_port)
      AND (p_terminal_id IS NULL OR a.terminal_id = p_terminal_id)
  ) THEN
    v_reasons := array_append(v_reasons, 'ADR de Saída fechado');
  END IF;

  IF v_port IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.granite_bls g
      JOIN public.granite_manifests m ON m.id = g.manifest_id
      WHERE m.voyage_id = p_voyage_id
        AND (g.ce_mercante IS NOT NULL OR EXISTS (SELECT 1 FROM public.invoice_granite_bls ig WHERE ig.granite_bl_id = g.id))
    ) THEN
      v_reasons := array_append(v_reasons, 'Granito com CE Mercante ou faturado');
    END IF;
    IF EXISTS (SELECT 1 FROM public.customer_communications c WHERE c.anchor_voyage_id = p_voyage_id) THEN
      v_reasons := array_append(v_reasons, 'comunicado enviado ao cliente');
    END IF;
  END IF;

  RETURN v_reasons;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_lock_reasons(bigint, text, uuid) FROM PUBLIC, anon, authenticated;

-- Trava de um B/L: CE Mercante ou documento financeiro emitido dele.
CREATE OR REPLACE FUNCTION public.bl_delete_lock_reasons(p_bl_id text)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_reasons text[] := ARRAY[]::text[];
BEGIN
  IF p_bl_id IS NULL THEN
    RETURN v_reasons;
  END IF;
  IF EXISTS (SELECT 1 FROM public.bls b WHERE b.id = p_bl_id AND NULLIF(btrim(b.ce_mercante), '') IS NOT NULL) THEN
    v_reasons := array_append(v_reasons, 'B/L com CE Mercante');
  END IF;
  IF EXISTS (SELECT 1 FROM public.invoices i WHERE i.bl_id = p_bl_id)
     OR EXISTS (SELECT 1 FROM public.invoice_bls ib WHERE ib.bl_id = p_bl_id)
     OR EXISTS (SELECT 1 FROM public.bl_receivables r WHERE r.bl_id = p_bl_id)
     OR EXISTS (SELECT 1 FROM public.demurrage_invoices d WHERE d.bl_id = p_bl_id) THEN
    v_reasons := array_append(v_reasons, 'documento financeiro emitido');
  END IF;
  RETURN v_reasons;
END;
$function$;

REVOKE ALL ON FUNCTION public.bl_delete_lock_reasons(text) FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS bls_delete_admin ON public.bls;
DROP POLICY IF EXISTS bl_containers_delete_admin ON public.bl_containers;
DROP POLICY IF EXISTS vehicles_delete_admin ON public.vehicles;
REVOKE DELETE ON TABLE public.bls, public.bl_containers, public.vehicles FROM authenticated;

-- O que a exclusão da viagem leva junto, em ordem de execução. 'delete'
-- apaga; 'detach' só tira a viagem (FK SET NULL: o manifesto continua).
-- A prévia do diálogo conta esta mesma lista.
CREATE OR REPLACE FUNCTION public.voyage_delete_children_spec()
RETURNS TABLE(ord integer, table_name text, column_name text, action text, label text)
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  VALUES
    (1, 'vehicles', 'voyage_id', 'delete', 'veículo(s)'),
    (2, 'bls', 'voyage_id', 'delete', 'B/L(s), com containers e taxas'),
    (3, 'import_batches', 'voyage_id', 'delete', 'importação(ões) de manifesto'),
    (4, 'manifestos_mercante', 'voyage_id', 'delete', 'Manifesto(s) Mercante'),
    (5, 'voyage_route_ce_master', 'voyage_id', 'delete', 'CE Master por rota'),
    (6, 'baplie_reconciliation_resolutions', 'voyage_id', 'delete', 'resolução(ões) de BAPLIE'),
    (7, 'baplie_containers', 'voyage_id', 'delete', 'container(es) do BAPLIE'),
    (8, 'agency_departure_reports', 'voyage_id', 'delete', 'ADR(s) de Saída em aberto'),
    (9, 'vazios_bookings', 'voyage_id', 'delete', 'unidade(s) de vazios'),
    (10, 'vazios_export_operations', 'voyage_id', 'delete', 'operação(ões) de embarque de vazios'),
    (11, 'voyage_omissions', 'voyage_id', 'delete', 'omissão(ões) de escala e transbordo'),
    (12, 'voyage_escala_terminal_state', 'voyage_id', 'delete', 'atracação(ões)'),
    (13, 'voyage_escala_operation_fronts', 'voyage_id', 'delete', 'frente(s) de operação'),
    (14, 'voyage_escala_revision_state', 'voyage_id', 'delete', 'revisão(ões) de escala'),
    (15, 'voyage_export_schedules', 'voyage_id', 'delete', 'escala(s) de exportação'),
    (16, 'granite_manifests', 'voyage_id', 'detach', 'manifesto(s) de Granito ficam sem viagem'),
    (17, 'vazios_manifests', 'voyage_id', 'detach', 'manifesto(s) de vazios ficam sem viagem'),
    (18, 'vazios_importacao_manifests', 'voyage_id', 'detach', 'manifesto(s) de vazios de importação ficam sem viagem');
$function$;

REVOKE ALL ON FUNCTION public.voyage_delete_children_spec() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.voyage_delete_preview(p_voyage_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_spec record;
  v_count bigint;
  v_items jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo pode excluir viagem.' USING ERRCODE = '42501';
  END IF;
  FOR v_spec IN SELECT * FROM public.voyage_delete_children_spec() ORDER BY ord LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', v_spec.table_name, v_spec.column_name)
      INTO v_count USING p_voyage_id;
    IF v_count > 0 THEN
      v_items := v_items || jsonb_build_object('table', v_spec.table_name, 'action', v_spec.action, 'label', v_spec.label, 'count', v_count);
    END IF;
  END LOOP;
  IF v_items <> '[]'::jsonb THEN
    v_items := jsonb_build_array(jsonb_build_object(
      'table', 'bl_containers', 'action', 'delete', 'label', 'container(es) dos B/Ls',
      'count', (SELECT count(*) FROM public.bl_containers c JOIN public.bls b ON b.id = c.bl_id WHERE b.voyage_id = p_voyage_id)
    )) || v_items;
  END IF;
  RETURN jsonb_build_object('items', v_items);
END;
$function$;

REVOKE ALL ON FUNCTION public.voyage_delete_preview(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.voyage_delete_preview(bigint) TO authenticated;

-- Executa a lista explícita. Uma passada pode falhar por ordem de FK entre
-- filhos; a seguinte completa. Sobra = o guard 067 recusa a viagem.
CREATE OR REPLACE FUNCTION public.delete_voyage_children(p_voyage_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_spec record;
  v_pass integer;
  v_left boolean;
BEGIN
  FOR v_pass IN 1..3 LOOP
    v_left := false;
    FOR v_spec IN SELECT * FROM public.voyage_delete_children_spec() ORDER BY ord LOOP
      BEGIN
        IF v_spec.action = 'detach' THEN
          EXECUTE format('UPDATE public.%I SET %I = NULL WHERE %I = $1', v_spec.table_name, v_spec.column_name, v_spec.column_name) USING p_voyage_id;
        ELSE
          EXECUTE format('DELETE FROM public.%I WHERE %I = $1', v_spec.table_name, v_spec.column_name) USING p_voyage_id;
        END IF;
      EXCEPTION WHEN foreign_key_violation THEN
        v_left := true;
      END;
    END LOOP;
    EXIT WHEN NOT v_left;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_voyage_children(bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_records(
  p_kind text,
  p_ids text[],
  p_dry_run boolean DEFAULT false,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_id text;
  v_count integer;
  v_deleted jsonb := '[]'::jsonb;
  v_blocked jsonb := '[]'::jsonb;
  v_state text;
  v_message text;
  v_constraint text;
  v_entity text;
  v_lock text[];
  v_status text;
  v_bl_id text;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo pode excluir.' USING ERRCODE = '42501';
  END IF;

  v_entity := CASE p_kind
    WHEN 'bl' THEN 'bl'
    WHEN 'container' THEN 'container'
    WHEN 'vehicle' THEN 'vehicle'
    WHEN 'customer' THEN 'customer'
    WHEN 'voyage' THEN 'voyages'
  END;
  IF v_entity IS NULL THEN
    RAISE EXCEPTION 'Tipo de exclusão desconhecido: %.', p_kind USING ERRCODE = '22023';
  END IF;
  IF NOT COALESCE(p_dry_run, false) AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da exclusão.' USING ERRCODE = '22023';
  END IF;

  FOREACH v_id IN ARRAY ARRAY(
    SELECT u.id FROM unnest(COALESCE(p_ids, ARRAY[]::text[])) WITH ORDINALITY AS u(id, ord)
    GROUP BY u.id ORDER BY min(u.ord)
  ) LOOP
    BEGIN
      v_lock := ARRAY[]::text[];
      IF p_kind = 'voyage' THEN
        SELECT status INTO v_status FROM public.voyages WHERE id = v_id::bigint;
        IF FOUND AND v_status = 'cancelled' THEN
          v_lock := ARRAY['viagem cancelada fica retida'];
        ELSE
          v_lock := public.delete_lock_reasons(v_id::bigint);
        END IF;
      ELSIF p_kind = 'customer' THEN
        IF EXISTS (SELECT 1 FROM public.customers c WHERE c.id = v_id::bigint AND NULLIF(btrim(c.cnpj_cpf), '') IS NOT NULL) THEN
          v_lock := ARRAY['cliente com CNPJ: desative em vez de excluir'];
        END IF;
      ELSE
        v_bl_id := CASE p_kind
          WHEN 'bl' THEN v_id
          WHEN 'container' THEN (SELECT c.bl_id FROM public.bl_containers c WHERE c.id = v_id::bigint)
          ELSE (SELECT COALESCE(v.bl_id, c.bl_id) FROM public.vehicles v
                LEFT JOIN public.bl_containers c ON c.id = v.container_id WHERE v.id = v_id::bigint)
        END;
        v_lock := public.bl_delete_lock_reasons(v_bl_id);
      END IF;
      IF cardinality(v_lock) > 0 THEN
        v_blocked := v_blocked || jsonb_build_object('id', v_id, 'reasons', to_jsonb(v_lock));
        CONTINUE;
      END IF;

      IF p_kind = 'voyage' THEN
        PERFORM public.delete_voyage_children(v_id::bigint);
        DELETE FROM public.voyages WHERE id = v_id::bigint;
      ELSIF p_kind = 'bl' THEN
        DELETE FROM public.vehicles WHERE bl_id = v_id;
        DELETE FROM public.bls WHERE id = v_id;
      ELSIF p_kind = 'container' THEN
        DELETE FROM public.vehicles WHERE container_id = v_id::bigint;
        DELETE FROM public.bl_containers WHERE id = v_id::bigint;
      ELSIF p_kind = 'vehicle' THEN
        DELETE FROM public.vehicles WHERE id = v_id::bigint;
      ELSE
        DELETE FROM public.customer_contacts WHERE customer_id = v_id::bigint;
        DELETE FROM public.customer_rate_overrides WHERE customer_id = v_id::bigint;
        DELETE FROM public.customers WHERE id = v_id::bigint;
      END IF;
      GET DIAGNOSTICS v_count = ROW_COUNT;

      IF v_count = 0 THEN
        v_blocked := v_blocked || jsonb_build_object('id', v_id, 'reasons', jsonb_build_array('não encontrado'));
      ELSIF p_dry_run THEN
        RAISE EXCEPTION USING ERRCODE = 'VL001';
      ELSE
        INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
        VALUES (v_entity, v_id, 'deleted', v_id, NULL, auth.uid(), v_reason);
        v_deleted := v_deleted || to_jsonb(v_id);
      END IF;
    EXCEPTION
      WHEN SQLSTATE 'VL001' THEN
        v_deleted := v_deleted || to_jsonb(v_id);
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS
          v_state = RETURNED_SQLSTATE,
          v_message = MESSAGE_TEXT,
          v_constraint = CONSTRAINT_NAME;
        v_blocked := v_blocked || jsonb_build_object(
          'id', v_id,
          'reasons', jsonb_build_array(public.delete_record_block_reason(v_state, v_message, v_constraint))
        );
    END;
  END LOOP;

  RETURN jsonb_build_object('deleted', v_deleted, 'blocked', v_blocked, 'dry_run', p_dry_run);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_escala(
  p_voyage_id bigint,
  p_port text,
  p_dry_run boolean DEFAULT false,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_port text := NULLIF(upper(btrim(p_port)), '');
  v_lock text[];
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_scope jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo pode excluir escala.' USING ERRCODE = '42501';
  END IF;
  IF v_port IS NULL THEN
    RAISE EXCEPTION 'Porto da escala obrigatório.' USING ERRCODE = '22023';
  END IF;

  v_lock := public.delete_lock_reasons(p_voyage_id, v_port);
  v_scope := jsonb_build_object(
    'export_schedules', (SELECT count(*) FROM public.voyage_export_schedules WHERE voyage_id = p_voyage_id AND upper(pol) = v_port),
    'terminals', (SELECT count(*) FROM public.voyage_escala_terminal_state WHERE voyage_id = p_voyage_id AND upper(port) = v_port),
    'open_departure_reports', (SELECT count(*) FROM public.agency_departure_reports WHERE voyage_id = p_voyage_id AND upper(port) = v_port AND status = 'open')
  );
  -- deletable diz, na prévia, se a execução vai excluir; deleted só é true
  -- quando a escala de fato saiu.
  IF cardinality(v_lock) > 0 OR p_dry_run THEN
    RETURN jsonb_build_object('deleted', false, 'deletable', cardinality(v_lock) = 0,
      'reasons', to_jsonb(v_lock), 'scope', v_scope, 'dry_run', p_dry_run);
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da exclusão da escala.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyage_pod_schedule', p_voyage_id::text || '::' || v_port, 'deleted', 'false', 'true', auth.uid(), v_reason);

  DELETE FROM public.voyage_export_schedules WHERE voyage_id = p_voyage_id AND upper(pol) = v_port;
  DELETE FROM public.agency_departure_reports WHERE voyage_id = p_voyage_id AND upper(port) = v_port AND status = 'open';
  DELETE FROM public.voyage_escala_terminal_state WHERE voyage_id = p_voyage_id AND upper(port) = v_port;
  DELETE FROM public.voyage_escala_operation_fronts WHERE voyage_id = p_voyage_id AND upper(port) = v_port;
  DELETE FROM public.voyage_escala_revision_state WHERE voyage_id = p_voyage_id AND upper(port) = v_port;

  RETURN jsonb_build_object('deleted', true, 'deletable', true, 'reasons', '[]'::jsonb, 'scope', v_scope, 'dry_run', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_escala(bigint, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_escala(bigint, text, boolean, text) TO authenticated;

DROP POLICY IF EXISTS voyage_export_schedules_delete_active_global ON public.voyage_export_schedules;
DROP POLICY IF EXISTS voyage_export_schedules_delete_admin ON public.voyage_export_schedules;
CREATE POLICY voyage_export_schedules_delete_admin
  ON public.voyage_export_schedules
  FOR DELETE TO authenticated
  USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.guard_terminal_state_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_lock text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN OLD;
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo remove atracação.' USING ERRCODE = '42501';
  END IF;
  v_lock := public.delete_lock_reasons(OLD.voyage_id, OLD.port, OLD.terminal_id);
  IF cardinality(v_lock) > 0 THEN
    RAISE EXCEPTION 'Atracação travada: %.', array_to_string(v_lock, ', ') USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_terminal_state_removal() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_terminal_state_removal ON public.voyage_escala_terminal_state;
CREATE TRIGGER trg_guard_terminal_state_removal
  BEFORE DELETE ON public.voyage_escala_terminal_state
  FOR EACH ROW EXECUTE FUNCTION public.guard_terminal_state_removal();

CREATE OR REPLACE FUNCTION public.delete_manual_bl_charge(p_charge_calculation_id bigint, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row RECORD;
  v_bl_id TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo exclui taxa manual do B/L.' USING ERRCODE = '42501';
  END IF;

  SELECT
    cc.id,
    cc.bl_id,
    cc.source,
    cc.charge_item_id,
    cc.quantity,
    cc.total_value_brl,
    cc.total_value_usd,
    b.financial_status AS bl_financial_status
  INTO v_row
  FROM public.charge_calculations AS cc
  LEFT JOIN public.bls AS b ON b.id = cc.bl_id
  WHERE cc.id = p_charge_calculation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linha de calculo % nao encontrada', p_charge_calculation_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_row.source, '') <> 'manual' THEN
    RAISE EXCEPTION 'Somente linhas manuais podem ser removidas' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_row.bl_financial_status, 'open') IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % ja foi faturado; nao e permitido remover taxa manual.', v_row.bl_id
      USING ERRCODE = '22023';
  END IF;

  v_bl_id := v_row.bl_id;

  DELETE FROM public.charge_calculations
  WHERE id = p_charge_calculation_id;

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    changed_at,
    justification
  )
  VALUES (
    'charge_calculation',
    p_charge_calculation_id::TEXT,
    'manual_delete',
    CONCAT('charge_item_id=', COALESCE(v_row.charge_item_id::TEXT, '-'), ' | qty=', COALESCE(v_row.quantity::TEXT, '0')),
    NULL,
    auth.uid(),
    NOW(),
    'Remocao manual de other charge'
  );

  RETURN jsonb_build_object(
    'deleted', true,
    'id', p_charge_calculation_id,
    'bl_id', v_bl_id
  );
END;
$function$;

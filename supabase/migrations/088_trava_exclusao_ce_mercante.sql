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
-- - delete_records ganha o tipo 'voyage': sem trava e não cancelada, a viagem
--   sai com B/Ls, carga, escalas e demais dados operacionais, numa
--   sub-transação; o guard trg_guard_voyage_hard_delete continua como última
--   barreira (passa porque os filhos saem antes). voyage_delete_preview conta
--   o que vai junto, para o diálogo.
-- - delete_escala(viagem, porto): substitui as duas chamadas do navegador
--   (marca do POD em audit_logs + exclusão da escala de exportação) por uma
--   operação com trava, motivo e Administrativo. A policy de DELETE de
--   voyage_export_schedules passa de is_active_user() a is_admin()
--   (supersede a decisão da migration 080; ADR 0071, achado A8). A mesclagem
--   interna de save_voyage_escala_terminal_state roda como dono e não muda.
-- - Remover atracação (tirar o terminal da escala no modal) passa a exigir o
--   Administrativo e respeitar a trava, por trigger em
--   voyage_escala_terminal_state. Contextos sem usuário (rotinas do banco)
--   não são afetados.
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

CREATE OR REPLACE FUNCTION public.voyage_delete_preview(p_voyage_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'bls', (SELECT count(*) FROM public.bls WHERE voyage_id = p_voyage_id),
    'containers', (SELECT count(*) FROM public.bl_containers c JOIN public.bls b ON b.id = c.bl_id WHERE b.voyage_id = p_voyage_id),
    'vehicles', (SELECT count(*) FROM public.vehicles WHERE voyage_id = p_voyage_id),
    'export_schedules', (SELECT count(*) FROM public.voyage_export_schedules WHERE voyage_id = p_voyage_id),
    'terminals', (SELECT count(*) FROM public.voyage_escala_terminal_state WHERE voyage_id = p_voyage_id),
    'vazios_bookings', (SELECT count(*) FROM public.vazios_bookings WHERE voyage_id = p_voyage_id)
  );
$function$;

REVOKE ALL ON FUNCTION public.voyage_delete_preview(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.voyage_delete_preview(bigint) TO authenticated;

-- Apaga, em passadas, as linhas de toda tabela que aponta para a viagem. Uma
-- passada pode falhar por ordem de FK entre filhos; a seguinte completa. A
-- lista vem do catálogo, como no guard de exclusão de viagem.
CREATE OR REPLACE FUNCTION public.delete_voyage_children(p_voyage_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_table text;
  v_column text;
  v_pass integer;
  v_left boolean;
BEGIN
  DELETE FROM public.vehicles WHERE voyage_id = p_voyage_id;
  DELETE FROM public.bls WHERE voyage_id = p_voyage_id;

  FOR v_pass IN 1..5 LOOP
    v_left := false;
    FOR v_table, v_column IN
      SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name IN ('voyage_id', 'anchor_voyage_id')
        AND t.table_type = 'BASE TABLE' AND c.table_name <> 'voyages'
      ORDER BY c.table_name
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE %I::text = $1::text', v_table, v_column) USING p_voyage_id;
      EXCEPTION WHEN foreign_key_violation OR raise_exception THEN
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

  FOREACH v_id IN ARRAY COALESCE(p_ids, ARRAY[]::text[]) LOOP
    BEGIN
      IF p_kind = 'voyage' THEN
        SELECT status INTO v_status FROM public.voyages WHERE id = v_id::bigint;
        IF FOUND AND v_status = 'cancelled' THEN
          v_blocked := v_blocked || jsonb_build_object('id', v_id, 'reasons', jsonb_build_array('viagem cancelada fica retida'));
          CONTINUE;
        END IF;
        v_lock := public.delete_lock_reasons(v_id::bigint);
        IF cardinality(v_lock) > 0 THEN
          v_blocked := v_blocked || jsonb_build_object('id', v_id, 'reasons', to_jsonb(v_lock));
          CONTINUE;
        END IF;
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
        VALUES (v_entity, v_id, 'deleted', v_id, NULL, auth.uid(), COALESCE(NULLIF(btrim(p_reason), ''), 'exclusao manual'));
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
  v_reason text := COALESCE(NULLIF(btrim(p_reason), ''), 'exclusao manual');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo pode excluir escala.' USING ERRCODE = '42501';
  END IF;
  IF v_port IS NULL THEN
    RAISE EXCEPTION 'Porto da escala obrigatório.' USING ERRCODE = '22023';
  END IF;

  v_lock := public.delete_lock_reasons(p_voyage_id, v_port);
  IF cardinality(v_lock) > 0 OR p_dry_run THEN
    RETURN jsonb_build_object('deleted', false, 'reasons', to_jsonb(v_lock), 'dry_run', p_dry_run);
  END IF;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyage_pod_schedule', p_voyage_id::text || '::' || v_port, 'deleted', 'false', 'true', auth.uid(), v_reason);

  DELETE FROM public.voyage_export_schedules WHERE voyage_id = p_voyage_id AND upper(pol) = v_port;

  RETURN jsonb_build_object('deleted', true, 'reasons', '[]'::jsonb, 'dry_run', false);
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

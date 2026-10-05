-- 134: BLs e CEs por escala, derivados dos fatos ao final da transação.
-- A mudança manual vale até o próximo estado documental diferente.
-- O backfill preserva marcações manuais existentes; não apaga dados.
CREATE TABLE public.voyage_documental_state (
  voyage_id bigint NOT NULL REFERENCES public.voyages(id) ON DELETE CASCADE,
  port text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('import', 'export')),
  status text NOT NULL CHECK (status IN ('waiting', 'received', 'approved')),
  PRIMARY KEY (voyage_id, port, direction)
);
ALTER TABLE public.voyage_documental_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voyage_documental_state FROM PUBLIC, anon, authenticated;

-- Um lote marca cada viagem uma vez; a fila é consumida antes do commit.
CREATE TABLE public.voyage_documental_pending (
  voyage_id bigint PRIMARY KEY REFERENCES public.voyages(id) ON DELETE CASCADE
);
ALTER TABLE public.voyage_documental_pending ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voyage_documental_pending FROM PUBLIC, anon, authenticated;

-- O instante da escrita, e não o início da transação, mantém um override
-- manual posterior ao evento automático que ele substitui. O ator continua
-- imposto pelo servidor, sem aceitar data/departamento enviados pelo cliente.
CREATE OR REPLACE FUNCTION public.audit_logs_force_actor() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'authenticated' THEN
    NEW.actor_role := public.current_actor_role();
    NEW.actor_department := NEW.actor_role;
    NEW.changed_at := CASE
      WHEN NEW.entity_type = 'voyage_pod_schedule' AND NEW.field_name IN ('ces', 'export_ces') THEN clock_timestamp()
      ELSE now()
    END;
  END IF;
  RETURN NEW;
END;
$$;

-- jsonb_set não cria pais ausentes: a primeira auditoria de um porto novo
-- precisa inicializar o objeto para que o snapshot acompanhe a conciliação.
DO $snapshot$
DECLARE v_def text; v_old text; v_new text; v_side text;
BEGIN
  v_def := pg_get_functiondef('public.trg_voyage_schedule_snapshot()'::regprocedure);
  FOREACH v_side IN ARRAY ARRAY['pod', 'pol'] LOOP
    v_old := format('COALESCE(%s_schedule_snapshot, ''{}''::jsonb),', v_side);
    v_new := format('COALESCE(%1$s_schedule_snapshot, ''{}''::jsonb) || jsonb_build_object(v_sub_key, COALESCE(%1$s_schedule_snapshot -> v_sub_key, ''{}''::jsonb)),', v_side);
    IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'Migration 134: snapshot % não encontrado', v_side; END IF;
    v_def := replace(v_def, v_old, v_new);
  END LOOP;
  EXECUTE v_def;
END;
$snapshot$;

-- O estado derivado é cache descartável, não uma operação vinculada: a FK
-- o apaga junto da viagem. Todas as travas de dados de negócio permanecem.
DO $delete_guard$
DECLARE v_def text; v_old text := 'AND c.table_name <> ''voyages''';
BEGIN
  v_def := pg_get_functiondef('public.guard_voyage_hard_delete()'::regprocedure);
  IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'Migration 134: catálogo da trava de viagem não encontrado'; END IF;
  EXECUTE replace(v_def, v_old, v_old || ' AND c.table_name NOT IN (''voyage_documental_state'', ''voyage_documental_pending'')');
END;
$delete_guard$;

CREATE FUNCTION public.sync_voyage_documental_status(p_voyage_id bigint, p_backfill boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r record;
  v_status text;
  v_previous text;
  v_current text;
  v_received boolean;
  v_total integer;
  v_missing integer;
  v_reason text := 'Atualização automática de BLs e CEs pela conciliação documental';
  v_saved_reason text := current_setting('vela.documental_justification', true);
BEGIN
  -- Serializa escritores da mesma viagem; a avaliação diferida vê o lote completo.
  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  FOR r IN
    SELECT DISTINCT public.normalize_port_code(pod) AS port, 'import'::text AS direction
    FROM public.bls WHERE voyage_id = p_voyage_id
    UNION
    SELECT DISTINCT public.normalize_port_code(pod), 'import' FROM public.baplie_containers WHERE voyage_id = p_voyage_id
    UNION
    SELECT port, direction FROM public.voyage_documental_state WHERE voyage_id = p_voyage_id
    UNION
    SELECT public.normalize_port_code(pol), 'export' FROM public.voyage_export_schedules WHERE voyage_id = p_voyage_id
  LOOP
    IF r.port IS NULL OR r.port !~ '^BR[A-Z0-9]{3}$' THEN CONTINUE; END IF;
    IF r.direction = 'import' THEN
      SELECT count(*), count(*) FILTER (WHERE nullif(btrim(ce_mercante), '') IS NULL)
      INTO v_total, v_missing FROM public.bls
      WHERE voyage_id = p_voyage_id AND public.normalize_port_code(pod) = r.port
        AND cancelled_at IS NULL AND financial_status IS DISTINCT FROM 'cancelled';

      -- Carga solta não depende do EDI. Na escala mista, ambas as frentes precisam estar recebidas.
      v_received := v_total > 0 AND (
        (NOT EXISTS (SELECT 1 FROM public.bls WHERE voyage_id = p_voyage_id
          AND public.normalize_port_code(pod) = r.port AND cargo_mode = 'container'
          AND cancelled_at IS NULL AND financial_status IS DISTINCT FROM 'cancelled')
         AND NOT EXISTS (SELECT 1 FROM public.baplie_containers WHERE voyage_id = p_voyage_id
           AND public.normalize_port_code(pod) = r.port AND status = 'full'))
        OR (
          EXISTS (SELECT 1 FROM public.baplie_containers WHERE voyage_id = p_voyage_id
            AND public.normalize_port_code(pod) = r.port AND status = 'full')
          AND NOT EXISTS (
            SELECT 1 FROM public.baplie_containers e
            WHERE e.voyage_id = p_voyage_id AND public.normalize_port_code(e.pod) = r.port AND e.status = 'full'
              AND NOT EXISTS (
                SELECT 1 FROM public.bl_containers c JOIN public.bls b ON b.id = c.bl_id
                WHERE b.voyage_id = p_voyage_id AND public.normalize_port_code(b.pod) = r.port
                  AND public.normalize_port_code(b.pol) = public.normalize_port_code(e.pol)
                  AND b.cargo_mode = 'container' AND b.cancelled_at IS NULL AND b.financial_status IS DISTINCT FROM 'cancelled'
                  AND upper(regexp_replace(c.container_number, '\s', '', 'g'))
                    = upper(regexp_replace(e.container_number, '\s', '', 'g'))
              )
          )
        )
      );
      v_status := CASE WHEN v_received AND v_missing = 0 THEN 'approved'
                       WHEN v_received THEN 'received' ELSE 'waiting' END;
      SELECT new_value INTO v_current FROM public.audit_logs
      WHERE entity_type = 'voyage_pod_schedule' AND entity_id = p_voyage_id::text || '::' || r.port AND field_name = 'ces'
      ORDER BY changed_at DESC, id DESC LIMIT 1;
    ELSE
      -- Vazios EXP isolados não têm B/L/CE individual no modelo: continuam manuais.
      -- Granito só automatiza Aprovado, nunca Recebido.
      SELECT count(*), count(*) FILTER (WHERE nullif(btrim(b.ce_mercante), '') IS NULL)
      INTO v_total, v_missing FROM public.granite_bls b JOIN public.granite_manifests m ON m.id = b.manifest_id
      WHERE m.voyage_id = p_voyage_id AND public.normalize_port_code(coalesce(nullif(b.loading_port, ''), m.loading_port)) = r.port;
      v_status := CASE WHEN v_total > 0 AND v_missing = 0 THEN 'approved' ELSE 'waiting' END;
      SELECT ce_status INTO v_current FROM public.voyage_export_schedules
      WHERE voyage_id = p_voyage_id AND public.normalize_port_code(pol) = r.port AND has_granite AND tem_exportacao;
      IF NOT FOUND THEN CONTINUE; END IF;
    END IF;

    SELECT status INTO v_previous FROM public.voyage_documental_state
    WHERE voyage_id = p_voyage_id AND port = r.port AND direction = r.direction;
    IF v_previous IS NOT DISTINCT FROM v_status THEN CONTINUE; END IF;
    INSERT INTO public.voyage_documental_state VALUES (p_voyage_id, r.port, r.direction, v_status)
    ON CONFLICT (voyage_id, port, direction) DO UPDATE SET status = EXCLUDED.status;
    IF p_backfill AND v_current IS NOT NULL THEN CONTINUE; END IF;
    IF coalesce(v_current, 'waiting') = v_status THEN CONTINUE; END IF;

    IF r.direction = 'import' THEN
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
      VALUES ('voyage_pod_schedule', p_voyage_id::text || '::' || r.port, 'ces', coalesce(v_current, 'waiting'), v_status, auth.uid(), clock_timestamp(), v_reason);
    ELSE
      PERFORM set_config('vela.documental_justification', v_reason, true);
      UPDATE public.voyage_export_schedules SET ce_status = v_status
      WHERE voyage_id = p_voyage_id AND public.normalize_port_code(pol) = r.port;
      PERFORM set_config('vela.documental_justification', coalesce(v_saved_reason, ''), true);
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_voyage_documental_status(bigint, boolean) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.trg_sync_voyage_documental_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_old bigint;
  v_new bigint;
BEGIN
  IF TG_TABLE_NAME = 'bl_containers' THEN
    IF TG_OP <> 'INSERT' THEN SELECT voyage_id INTO v_old FROM public.bls WHERE id = OLD.bl_id; END IF;
    IF TG_OP <> 'DELETE' THEN SELECT voyage_id INTO v_new FROM public.bls WHERE id = NEW.bl_id; END IF;
  ELSIF TG_TABLE_NAME = 'granite_bls' THEN
    IF TG_OP <> 'INSERT' THEN SELECT voyage_id INTO v_old FROM public.granite_manifests WHERE id = OLD.manifest_id; END IF;
    IF TG_OP <> 'DELETE' THEN SELECT voyage_id INTO v_new FROM public.granite_manifests WHERE id = NEW.manifest_id; END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN v_old := OLD.voyage_id; END IF;
    IF TG_OP <> 'DELETE' THEN v_new := NEW.voyage_id; END IF;
  END IF;
  INSERT INTO public.voyage_documental_pending(voyage_id)
  SELECT id FROM public.voyages WHERE id IN (v_old, v_new) ORDER BY id
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_sync_voyage_documental_status() FROM PUBLIC, anon, authenticated;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bls', 'bl_containers', 'baplie_containers', 'granite_bls', 'granite_manifests', 'voyage_export_schedules'] LOOP
    EXECUTE format('CREATE TRIGGER trg_documental_status AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.trg_sync_voyage_documental_status()', t);
  END LOOP;
END;
$$;

CREATE FUNCTION public.flush_voyage_documental_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM public.voyage_documental_pending WHERE voyage_id = NEW.voyage_id;
  IF FOUND THEN PERFORM public.sync_voyage_documental_status(NEW.voyage_id); END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.flush_voyage_documental_status() FROM PUBLIC, anon, authenticated;
CREATE CONSTRAINT TRIGGER flush_documental_status AFTER INSERT ON public.voyage_documental_pending
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.flush_voyage_documental_status();

CREATE FUNCTION public.guard_manual_documental_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_reason text; v_current text;
BEGIN
  IF TG_TABLE_NAME = 'audit_logs' THEN
    IF NEW.entity_type <> 'voyage_pod_schedule' OR NEW.field_name <> 'ces' THEN RETURN NEW; END IF;
    IF coalesce(NEW.new_value, 'waiting') NOT IN ('waiting', 'received', 'launching', 'approving', 'approved', 'missing', 'partial') THEN
      RAISE EXCEPTION 'Status de BLs e CEs inválido.' USING ERRCODE = '22023';
    END IF;
    SELECT new_value INTO v_current FROM public.audit_logs
    WHERE entity_type = 'voyage_pod_schedule' AND entity_id = NEW.entity_id AND field_name = 'ces'
    ORDER BY changed_at DESC, id DESC LIMIT 1;
    -- Mesma normalização do editor para estados legados: abrir/salvar não é override.
    v_current := CASE v_current WHEN 'partial' THEN 'launching' WHEN 'missing' THEN 'waiting' ELSE v_current END;
    IF NEW.entity_type = 'voyage_pod_schedule' AND NEW.field_name = 'ces'
      AND coalesce(v_current, 'waiting') IS DISTINCT FROM coalesce(NEW.new_value, 'waiting')
      AND nullif(btrim(NEW.justification), '') IS NULL THEN
      RAISE EXCEPTION 'Informe a justificativa para alterar BLs e CEs.' USING ERRCODE = '22023';
    END IF;
  ELSIF (CASE WHEN TG_OP = 'INSERT' THEN 'waiting' ELSE OLD.ce_status END) IS DISTINCT FROM NEW.ce_status THEN
    v_reason := nullif(btrim(current_setting('vela.documental_justification', true)), '');
    IF v_reason IS NULL THEN RAISE EXCEPTION 'Informe a justificativa para alterar BLs e CEs.' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
    VALUES ('voyage_pod_schedule', NEW.voyage_id::text || '::' || public.normalize_port_code(NEW.pol), 'export_ces', CASE WHEN TG_OP = 'INSERT' THEN 'waiting' ELSE OLD.ce_status END, NEW.ce_status, auth.uid(), clock_timestamp(), v_reason);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_manual_documental_status() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_manual_documental_status BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.guard_manual_documental_status();
CREATE TRIGGER guard_manual_documental_status BEFORE INSERT OR UPDATE OF ce_status ON public.voyage_export_schedules FOR EACH ROW EXECUTE FUNCTION public.guard_manual_documental_status();

-- Reutiliza o dono da transação de Escala; não copia o corpo nem muda grants.
DO $migration$
DECLARE v_def text; v_needle text := E'BEGIN\n';
BEGIN
  v_def := replace(pg_get_functiondef('public.save_voyage_escala_terminal_state(bigint,text,integer,jsonb,jsonb,jsonb,text)'::regprocedure), E'\r\n', E'\n');
  IF position(v_needle IN v_def) = 0 THEN RAISE EXCEPTION 'Migration 134: entrada da RPC da escala não encontrada'; END IF;
  v_def := overlay(v_def placing E'BEGIN\n  PERFORM set_config(''vela.documental_justification'', coalesce(p_justification, ''''), true);\n' from position(v_needle IN v_def) for length(v_needle));
  EXECUTE v_def;
END;
$migration$;

DO $$
DECLARE v_id bigint;
BEGIN
  FOR v_id IN SELECT id FROM public.voyages ORDER BY id LOOP
    PERFORM public.sync_voyage_documental_status(v_id, true);
  END LOOP;
END;
$$;

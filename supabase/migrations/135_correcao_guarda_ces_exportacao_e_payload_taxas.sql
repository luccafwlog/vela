-- 135: duas correções observadas em produção em 2026-10-05.
--
-- 1. Salvar escala falhava com "Informe a justificativa para alterar BLs e
--    CEs." sem nenhuma alteração de BLs e CEs. O editor terminalizado sempre
--    faz upsert de voyage_export_schedules (INSERT ... ON CONFLICT), mesmo em
--    escala só de importação. A guarda da 134 julgava esse INSERT contra
--    'waiting': NULL (linha nova sem ce_status) ou o valor já gravado
--    (linha existente, caminho ON CONFLICT) contavam como alteração manual.
--    Agora NULL equivale a Aguardando e, quando a linha já existe, o INSERT
--    não é julgado: o BEFORE UPDATE do ON CONFLICT compara com OLD.
-- 2. customer_local_charges_communication_payload falhava com
--    "column reference bl_id is ambiguous" (ORDER BY sem qualificar), então o
--    runner automático de comunicados de taxas locais nunca montava o payload.
--
-- Não reescreve nem apaga linhas existentes.

CREATE OR REPLACE FUNCTION public.guard_manual_documental_status() RETURNS trigger
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
    IF coalesce(v_current, 'waiting') IS DISTINCT FROM coalesce(NEW.new_value, 'waiting')
      AND nullif(btrim(NEW.justification), '') IS NULL THEN
      RAISE EXCEPTION 'Informe a justificativa para alterar BLs e CEs.' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT ... ON CONFLICT sobre linha existente: quem julga é o BEFORE UPDATE
  -- disparado pelo DO UPDATE, que enxerga o valor anterior real.
  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1 FROM public.voyage_export_schedules
    WHERE voyage_id = NEW.voyage_id AND pol = NEW.pol
  ) THEN
    RETURN NEW;
  END IF;

  IF coalesce(CASE WHEN TG_OP = 'INSERT' THEN 'waiting' ELSE OLD.ce_status END, 'waiting')
     IS DISTINCT FROM coalesce(NEW.ce_status, 'waiting') THEN
    v_reason := nullif(btrim(current_setting('vela.documental_justification', true)), '');
    IF v_reason IS NULL THEN RAISE EXCEPTION 'Informe a justificativa para alterar BLs e CEs.' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
    VALUES ('voyage_pod_schedule', NEW.voyage_id::text || '::' || public.normalize_port_code(NEW.pol), 'export_ces', CASE WHEN TG_OP = 'INSERT' THEN 'waiting' ELSE OLD.ce_status END, NEW.ce_status, auth.uid(), clock_timestamp(), v_reason);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_manual_documental_status() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.customer_local_charges_communication_payload(p_voyage_id bigint, p_customer_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  RETURN (
    WITH base_bls AS (
      SELECT b.id AS bl_id, b.ce_mercante, b.pod, c.name AS customer_name,
             v.eta, v.voyage_number, vs.name AS vessel_name
      FROM public.bls b
      JOIN public.customers c ON c.id = b.customer_id
      JOIN public.voyages v ON v.id = b.voyage_id
      LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
      WHERE b.voyage_id = p_voyage_id
        AND b.customer_id = p_customer_id
        AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
    ), direct_totals AS (
      SELECT ib.bl_id, sum(COALESCE(ib.subtotal_brl, 0)) AS total_brl
      FROM public.invoice_bls ib
      JOIN base_bls b ON b.bl_id = ib.bl_id
      JOIN public.invoices i ON i.id = ib.invoice_id
      WHERE i.status IN ('issued', 'partially_paid', 'paid', 'covered')
      GROUP BY ib.bl_id
    ), ledger_totals AS (
      SELECT rl.bl_id, sum(COALESCE(rl.subtotal_brl, 0)) AS total_brl
      FROM public.invoice_receivable_links rl
      JOIN base_bls b ON b.bl_id = rl.bl_id
      JOIN public.invoices i ON i.id = rl.invoice_id
      WHERE COALESCE(rl.status, '') <> 'obsolete'
        AND i.status IN ('issued', 'partially_paid', 'paid', 'covered')
        AND NOT EXISTS (SELECT 1 FROM direct_totals d WHERE d.bl_id = rl.bl_id)
      GROUP BY rl.bl_id
    )
    SELECT CASE WHEN count(*) = 0 THEN NULL ELSE jsonb_build_object(
      'customer_id', p_customer_id,
      'customer_name', max(base_bls.customer_name),
      'vessel_name', max(base_bls.vessel_name),
      'voyage_number', max(base_bls.voyage_number),
      'port', (array_agg(COALESCE(base_bls.pod, '—') ORDER BY base_bls.bl_id))[1],
      'milestone_at', max(COALESCE(base_bls.eta::TEXT, '')),
      'bls', jsonb_agg(jsonb_build_object(
        'bl_id', base_bls.bl_id,
        'ce_mercante', NULLIF(btrim(base_bls.ce_mercante), ''),
        'total_brl', COALESCE(direct_totals.total_brl, ledger_totals.total_brl, 0)
      ) ORDER BY base_bls.bl_id)
    ) END
    FROM base_bls
    LEFT JOIN direct_totals ON direct_totals.bl_id = base_bls.bl_id
    LEFT JOIN ledger_totals ON ledger_totals.bl_id = base_bls.bl_id
  );
END;
$function$;

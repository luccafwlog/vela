-- 624: fatura e Invoice de Demurrage canceladas à mão sem nova emissão (decisão
-- 6 do dono de 2026-11-07; ADR 0134, lote C do plano
-- 2026-11-07-brechas-restantes-da-revisao-dos-alertas).
--
-- Cancelar a fatura de Taxas Locais devolve o B/L a não faturado e nada emite
-- de novo sozinho; a Invoice de Demurrage cancelada à mão espera o Gerar
-- Invoice (brecha B07). Dois tipos novos, Normais, 1 dia útil depois do
-- cancelamento (9 horas úteis, `_add_business_hours`, 617):
--   1. `fatura_cancelada_sem_reemissao` (Documentação), por B/L: a última
--      fatura de Taxas Locais do B/L (individual, consolidada ou de Granito;
--      a avulsa fica fora) foi cancelada por uma pessoa, o B/L ficou sem fatura
--      viva (`_bl_live_invoice_numbers`), não é isento nem cancelado. Fecha na
--      nova emissão, na isenção ou no cancelamento do B/L.
--   2. `demurrage_cancelada_sem_reemissao` (Equipamentos), por Invoice: a
--      Invoice foi cancelada à mão (`_demurrage_cancelled_by_hand`) e o grupo
--      dela ainda espera o Gerar Invoice (a mesma conta da divisão A emitir da
--      Demurrage, `cancelled_doc`). Fecha quando o grupo é emitido ou sai de
--      A emitir.
-- A rotina `cancelled-invoice-alerts` (15 minutos) abre e fecha os dois.
-- ponytail: só cancelamentos dos últimos 60 dias abrem alerta, para não
-- cobrar de uma vez faturas canceladas há meses de propósito; alerta aberto é
-- reavaliado até fechar. Upgrade: data de corte própria.
--
-- Plano de preservação: a migration só acrescenta dois tipos ao catálogo,
-- funções e uma rotina; não reescreve nem apaga linha existente. Conferir:
-- `SELECT item_type, status, count(*) FROM alert_items WHERE item_type LIKE
-- '%cancelada_sem_reemissao' GROUP BY 1, 2` depois da primeira rodada.
-- Desfazer: o rollback abaixo e `UPDATE alert_type_catalog SET active = false
-- WHERE type IN ('fatura_cancelada_sem_reemissao',
-- 'demurrage_cancelada_sem_reemissao')`.
--
-- Rollback: `cron.unschedule('cancelled-invoice-alerts')` e dropar
-- `reconcile_cancelled_invoice_alert`, `reconcile_cancelled_demurrage_alert` e
-- `reconcile_cancelled_invoice_alerts`.

INSERT INTO public.alert_type_catalog (type, severity, responsible_department, audience_departments, default_destination, active)
VALUES
  ('fatura_cancelada_sem_reemissao', 'normal', 'documentacao', ARRAY['documentacao'], '/taxas-locais', true),
  ('demurrage_cancelada_sem_reemissao', 'normal', 'equipamentos', ARRAY['equipamentos'], '/demurrage', true)
ON CONFLICT (type) DO NOTHING;

-- 1 --- Taxas Locais, por B/L -------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_cancelled_invoice_alert(p_bl_id text, p_source text DEFAULT 'cancelled_invoice_alerts')
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_last record;
BEGIN
  SELECT i.id, i.invoice_number, i.cancelled_at
  INTO v_last
  FROM public.invoices i
  WHERE i.invoice_type <> 'manual'
    AND (i.bl_id = p_bl_id OR EXISTS (SELECT 1 FROM public.invoice_bls ib WHERE ib.invoice_id = i.id AND ib.bl_id = p_bl_id))
  ORDER BY COALESCE(i.cancelled_at, i.issued_at, i.created_at) DESC, i.id DESC
  LIMIT 1;

  IF NOT FOUND
     OR v_last.cancelled_at IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = v_last.id AND i.status = 'cancelled' AND i.cancelled_by IS NOT NULL)
     OR now() < public._add_business_hours(v_last.cancelled_at, 9)
     OR cardinality(public._bl_live_invoice_numbers(p_bl_id)) > 0
     OR NOT EXISTS (SELECT 1 FROM public.bls b WHERE b.id = p_bl_id AND b.cancelled_at IS NULL
                      AND COALESCE(b.charge_status, '') <> 'exempt') THEN
    PERFORM public.resolve_alert_item('fatura_cancelada_sem_reemissao', 'bl', p_bl_id, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  PERFORM public.upsert_alert_item(
    'fatura_cancelada_sem_reemissao', 'bl', p_bl_id,
    'B/L ' || p_bl_id || ': a fatura ' || v_last.invoice_number || ' foi cancelada em '
      || to_char(v_last.cancelled_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
      || ' e nenhuma fatura nova foi emitida. O Cliente está sem fatura e sem Pix.',
    p_source, 'documentacao',
    jsonb_build_object('invoice_id', v_last.id, 'invoice_number', v_last.invoice_number, 'cancelled_at', v_last.cancelled_at),
    NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_cancelled_invoice_alert(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_cancelled_invoice_alert(text, text) TO service_role;

-- 2 --- Demurrage, por Invoice ------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_cancelled_demurrage_alert(p_invoice_id bigint, p_source text DEFAULT 'cancelled_invoice_alerts')
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_inv record;
  v_cancelled_at timestamptz;
  v_waiting boolean := false;
BEGIN
  SELECT di.id, di.doc_number, di.status, di.bl_id, di.customer_id, b.voyage_id
  INTO v_inv
  FROM public.demurrage_invoices di
  JOIN public.bls b ON b.id = di.bl_id
  WHERE di.id = p_invoice_id;

  IF FOUND AND v_inv.status = 'cancelled' AND public._demurrage_cancelled_by_hand(v_inv.id) THEN
    SELECT a.changed_at INTO v_cancelled_at
    FROM public.audit_logs a
    WHERE a.entity_type = 'demurrage_invoice' AND a.entity_id = v_inv.id::text
      AND a.field_name = 'status' AND a.new_value = 'cancelled'
    ORDER BY a.changed_at DESC, a.id DESC LIMIT 1;
    IF v_cancelled_at IS NOT NULL AND now() >= public._add_business_hours(v_cancelled_at, 9) THEN
      -- O grupo ainda espera o Gerar Invoice por esta Invoice (A emitir).
      SELECT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(public._demurrage_billing_board_core(NULL, v_inv.voyage_id)) AS grp(value)
        WHERE grp.value->>'division' = 'a_emitir' AND grp.value->>'cancelled_doc' = v_inv.doc_number)
      INTO v_waiting;
    END IF;
  END IF;

  IF NOT v_waiting THEN
    PERFORM public.resolve_alert_item('demurrage_cancelada_sem_reemissao', 'demurrage_invoice', p_invoice_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  PERFORM public.upsert_alert_item(
    'demurrage_cancelada_sem_reemissao', 'demurrage_invoice', p_invoice_id::text,
    'Invoice ' || v_inv.doc_number || ' cancelada em '
      || to_char(v_cancelled_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
      || ': os containers dela esperam o Gerar Invoice em A emitir.',
    p_source, 'equipamentos',
    jsonb_build_object('doc_number', v_inv.doc_number, 'bl_id', v_inv.bl_id, 'voyage_id', v_inv.voyage_id, 'cancelled_at', v_cancelled_at),
    NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_cancelled_demurrage_alert(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_cancelled_demurrage_alert(bigint, text) TO service_role;

-- Rotina ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_cancelled_invoice_alerts(p_source text DEFAULT 'cancelled-invoice-alerts')
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  v_count integer := 0;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  FOR r IN
    SELECT DISTINCT x.bl_id FROM (
      SELECT i.bl_id FROM public.invoices i
      WHERE i.status = 'cancelled' AND i.invoice_type <> 'manual' AND i.cancelled_by IS NOT NULL
        AND i.cancelled_at >= now() - interval '60 days' AND i.bl_id IS NOT NULL
      UNION
      SELECT ib.bl_id FROM public.invoices i JOIN public.invoice_bls ib ON ib.invoice_id = i.id
      WHERE i.status = 'cancelled' AND i.invoice_type <> 'manual' AND i.cancelled_by IS NOT NULL
        AND i.cancelled_at >= now() - interval '60 days'
      UNION
      SELECT a.entity_id FROM public.alert_items it JOIN public.alerts a ON a.id = it.alert_id
      WHERE it.item_type = 'fatura_cancelada_sem_reemissao' AND it.status = 'active'
    ) x
  LOOP
    PERFORM public.reconcile_cancelled_invoice_alert(r.bl_id, p_source);
    v_count := v_count + 1;
  END LOOP;

  FOR r IN
    SELECT di.id FROM public.demurrage_invoices di
    WHERE di.status = 'cancelled'
      AND EXISTS (SELECT 1 FROM public.audit_logs a
                  WHERE a.entity_type = 'demurrage_invoice' AND a.entity_id = di.id::text
                    AND a.field_name = 'status' AND a.new_value = 'cancelled'
                    AND a.changed_at >= now() - interval '60 days')
    UNION
    SELECT a.entity_id::bigint FROM public.alert_items it JOIN public.alerts a ON a.id = it.alert_id
    WHERE it.item_type = 'demurrage_cancelada_sem_reemissao' AND it.status = 'active'
  LOOP
    PERFORM public.reconcile_cancelled_demurrage_alert(r.id, p_source);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_cancelled_invoice_alerts(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_cancelled_invoice_alerts(text) TO service_role;

DO $schedule_624$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE WARNING '624: pg_cron ausente; agende cancelled-invoice-alerts no ambiente de produção.';
    RETURN;
  END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cancelled-invoice-alerts';
  PERFORM cron.schedule('cancelled-invoice-alerts', '13-59/15 * * * *',
    $cmd_624$SELECT public.reconcile_cancelled_invoice_alerts('cancelled-invoice-alerts');$cmd_624$);
END;
$schedule_624$;

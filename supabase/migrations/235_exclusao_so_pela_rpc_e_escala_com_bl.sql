-- 235: escala com B/L não se exclui e exclusão só pela RPC (itens A7 e P1 do
-- plano de correções; ADR 0083, item 7; ADR 0071; ADR 0085, falha 4).
--
-- Problema (Postgres local, 2026-10-14):
-- * `delete_escala` aceitava escala com B/L; só a tela recusava (A7).
-- * As policies de DELETE `is_admin()` da migration 002, com o grant de
--   DELETE da 006, deixavam o Administrativo apagar pela API, sem motivo nem
--   Trava, a escala de exportação travada pelo CE, o Baplie de viagem com CE e
--   cadastros sem uso (navio, armador, porto, tabela de Taxas Locais).
--
-- Mudança:
-- 1. `delete_escala` recusa, na prévia e na execução, a escala com B/L (POL
--    ou POD de um B/L da viagem), com o motivo "B/L vinculado à escala". O
--    resto é a definição da migration 088.
-- 2. Saem as policies de DELETE `is_admin()` de todas as tabelas que as têm
--    (lista gerada por `pg_policies` no Postgres local montado pelas
--    migrations), menos `user_profiles` (item A3). Em `billing_runs`,
--    `billing_run_logs`, `customer_reconciliation_queue` e
--    `pricing_rule_versions` saem também as de INSERT e UPDATE do
--    Administrativo: só RPCs `SECURITY DEFINER` escrevem nelas. Em
--    `demurrage_invoices`, `invoice_refunds` e `manifestos_mercante`, já sem
--    grant de DELETE (migrations 012, 136 e 212), a saída é limpeza.
--    `customer_demurrage_agreements` (policy ALL do Administrativo) fica para
--    o item P9.
-- 3. `authenticated` e `anon` perdem DELETE nessas tabelas (em produção, as
--    que nenhuma migration revoga podem ter o privilégio padrão da
--    plataforma, migration 166) e INSERT/UPDATE nas quatro tabelas do item 2.
--    A exclusão fica com `delete_records`, `delete_escala` e
--    `delete_catalog_row`, com motivo e Trava; a tela não apaga essas tabelas
--    direto.
--
-- Só redefine uma função e muda policies e privilégios; não reescreve nem
-- apaga linhas.
-- Rollback: reaplicar `delete_escala` da migration 088, recriar as policies
-- da migration 002 e o GRANT DELETE da 006.

-- 1. Escala com B/L.
CREATE OR REPLACE FUNCTION public.delete_escala(p_voyage_id bigint, p_port text, p_dry_run boolean DEFAULT false, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
  -- Escala com B/L não se exclui (ADR 0083, item 7): primeiro saem os B/Ls,
  -- depois a escala, como a tela já orienta. Conta B/L cancelado também: ele
  -- continua ligado à escala até ser excluído.
  IF EXISTS (
    SELECT 1 FROM public.bls AS b
    WHERE b.voyage_id = p_voyage_id
      AND (COALESCE(public.normalize_port_code(b.pod), upper(btrim(b.pod))) = COALESCE(public.normalize_port_code(v_port), v_port)
        OR COALESCE(public.normalize_port_code(b.pol), upper(btrim(b.pol))) = COALESCE(public.normalize_port_code(v_port), v_port))
  ) THEN
    v_lock := array_prepend('B/L vinculado à escala', v_lock);
  END IF;
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

-- 2. Policies de escrita do Administrativo.
DROP POLICY IF EXISTS alerts_delete_admin ON public.alerts;
DROP POLICY IF EXISTS baplie_containers_delete_admin ON public.baplie_containers;
DROP POLICY IF EXISTS baplie_reconciliation_resolutions_delete_admin ON public.baplie_reconciliation_resolutions;
DROP POLICY IF EXISTS billing_run_logs_delete_admin ON public.billing_run_logs;
DROP POLICY IF EXISTS billing_run_logs_insert_admin ON public.billing_run_logs;
DROP POLICY IF EXISTS billing_runs_delete_admin ON public.billing_runs;
DROP POLICY IF EXISTS billing_runs_insert_admin ON public.billing_runs;
DROP POLICY IF EXISTS billing_runs_update_admin ON public.billing_runs;
DROP POLICY IF EXISTS bl_breakbulk_items_delete_admin ON public.bl_breakbulk_items;
DROP POLICY IF EXISTS bl_freight_lines_delete_admin ON public.bl_freight_lines;
DROP POLICY IF EXISTS carriers_delete_admin ON public.carriers;
DROP POLICY IF EXISTS charge_tables_delete_local_charges_global ON public.charge_tables;
DROP POLICY IF EXISTS crq_delete_admin ON public.customer_reconciliation_queue;
DROP POLICY IF EXISTS crq_insert_admin ON public.customer_reconciliation_queue;
DROP POLICY IF EXISTS crq_update_admin ON public.customer_reconciliation_queue;
DROP POLICY IF EXISTS demurrage_invoices_delete_admin ON public.demurrage_invoices;
DROP POLICY IF EXISTS ended_vessels_delete_admin ON public.ended_vessels;
DROP POLICY IF EXISTS granite_bl_charges_delete_admin ON public.granite_bl_charges;
DROP POLICY IF EXISTS granite_bls_delete_admin ON public.granite_bls;
DROP POLICY IF EXISTS granite_manifests_delete_admin ON public.granite_manifests;
DROP POLICY IF EXISTS import_batches_delete_admin ON public.import_batches;
DROP POLICY IF EXISTS import_errors_delete_admin ON public.import_errors;
DROP POLICY IF EXISTS invoice_refunds_delete_admin ON public.invoice_refunds;
DROP POLICY IF EXISTS manifestos_mercante_delete_policy ON public.manifestos_mercante;
DROP POLICY IF EXISTS ports_delete_admin ON public.ports;
DROP POLICY IF EXISTS pricing_rule_versions_delete_admin ON public.pricing_rule_versions;
DROP POLICY IF EXISTS pricing_rule_versions_insert_admin ON public.pricing_rule_versions;
DROP POLICY IF EXISTS pricing_rule_versions_update_admin ON public.pricing_rule_versions;
DROP POLICY IF EXISTS vazios_bookings_delete_admin ON public.vazios_bookings;
DROP POLICY IF EXISTS vazios_export_operations_delete_admin ON public.vazios_export_operations;
DROP POLICY IF EXISTS vazios_importacao_containers_delete_admin ON public.vazios_importacao_containers;
DROP POLICY IF EXISTS vazios_importacao_manifests_delete_admin ON public.vazios_importacao_manifests;
DROP POLICY IF EXISTS vazios_manifests_delete_admin ON public.vazios_manifests;
DROP POLICY IF EXISTS vessel_schedules_delete_admin ON public.vessel_schedules;
DROP POLICY IF EXISTS vessels_delete_admin ON public.vessels;
DROP POLICY IF EXISTS voyage_export_schedules_delete_admin ON public.voyage_export_schedules;
DROP POLICY IF EXISTS voyage_route_ce_master_delete_admin ON public.voyage_route_ce_master;

-- 3. DELETE direto sai; nas quatro tabelas só de RPC, a escrita inteira.
REVOKE DELETE ON
  public.alerts,
  public.baplie_containers,
  public.baplie_reconciliation_resolutions,
  public.billing_run_logs,
  public.billing_runs,
  public.bl_breakbulk_items,
  public.bl_freight_lines,
  public.carriers,
  public.charge_tables,
  public.customer_reconciliation_queue,
  public.demurrage_invoices,
  public.ended_vessels,
  public.granite_bl_charges,
  public.granite_bls,
  public.granite_manifests,
  public.import_batches,
  public.import_errors,
  public.invoice_refunds,
  public.manifestos_mercante,
  public.ports,
  public.pricing_rule_versions,
  public.vazios_bookings,
  public.vazios_export_operations,
  public.vazios_importacao_containers,
  public.vazios_importacao_manifests,
  public.vazios_manifests,
  public.vessel_schedules,
  public.vessels,
  public.voyage_export_schedules,
  public.voyage_route_ce_master
FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE ON public.billing_runs, public.billing_run_logs, public.customer_reconciliation_queue, public.pricing_rule_versions
FROM PUBLIC, anon, authenticated;

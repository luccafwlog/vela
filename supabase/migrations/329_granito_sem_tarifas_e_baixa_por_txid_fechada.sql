-- 329: as tarifas do Granito saem do banco e a baixa por TXID deixa de ser
-- executável pelo navegador (lote 5b da identidade visual; decisões do
-- responsável de 2026-10-19, registradas em
-- docs/plans/2026-10-13-identidade-visual-tela-a-tela.md).
--
-- Problema:
--   1. Desde a migration `325` o Granito não calcula taxas, mas a tabela
--      `granite_rates` continuava gravável pela API (policies
--      `is_active_user()` de INSERT e UPDATE), o cálculo
--      `calculate_granite_bl_charges` continuava no banco (só para
--      `service_role`) e `guard_used_tariff_delete`, `delete_catalog_row` e
--      `reactivate_catalog_row` ainda tinham ramo para ela. Decisão: "Apagar
--      a tabela".
--   2. `reconcile_invoice_payment_by_txid` (SECURITY DEFINER) era executável
--      por `authenticated` porque `confirm_unified_pix_matches`, SECURITY
--      INVOKER, a chamava com o papel de quem concilia (achado P5 da matriz
--      de permissões, mantido aberto na `328`). Decisão: fechar a função e
--      ajustar o chamador.
--
-- Mudança:
--   1. Granito sem tarifas:
--      - `granite_bl_charges_rate_id_fkey` sai; a coluna
--        `granite_bl_charges.rate_id` fica como id histórico da tarifa. Os
--        snapshots de `granite_bl_charges` e as faturas antigas
--        (`invoice_granite_bls`) continuam intactos;
--      - `calculate_granite_bl_charges(uuid, uuid)` sai (sem chamador desde a
--        `325`; o efeito `granite_billing` já termina sem agir);
--      - `guard_used_tariff_delete`, `delete_catalog_row` e
--        `reactivate_catalog_row` são recriadas com o corpo vigente
--        (migrations `091`/`096`/`261`/`262`/`263`) menos o ramo de
--        `granite_rates`;
--      - `DROP TABLE public.granite_rates` (leva junto as policies, o gatilho
--        de auditoria e as duas travas de tarifa). As linhas de
--        `audit_logs` com `entity_type = 'granite_rates'` ficam como
--        histórico.
--   2. Baixa por TXID só por dentro do banco:
--      - `confirm_unified_pix_matches` passa a SECURITY DEFINER (mesmo corpo;
--        `search_path` já fixo). A primeira instrução já recusa quem não é
--        Financeiro nem Administrativo ativo (`is_financeiro_user()`, ADR
--        0085, D5), então a confirmação continua restrita a esses setores e
--        a baixa por TXID roda como dono;
--      - REVOKE EXECUTE de `reconcile_invoice_payment_by_txid` para PUBLIC,
--        anon e authenticated. Chamam-na só funções do dono:
--        `confirm_unified_pix_matches` e `itau_pix_settle` (Edge Function
--        `itau-pix`, `service_role`). A própria função continua exigindo
--        Financeiro ou Administrativo pelo JWT (`auth.uid()`).
--
-- Reescreve e apaga dados existentes: `DROP TABLE public.granite_rates` apaga
-- as tarifas gravadas. Depende da afirmação "Data status" do AGENTS.md (seção
-- Gotchas): o banco de produção só tem dados de teste.
--
-- Reversão: recriar `granite_rates` pela migration `002` (tabela, policies,
-- gatilhos), a FK de `granite_bl_charges.rate_id`, `calculate_granite_bl_charges`
-- pela `031` (sem grant para `authenticated`, como na `325`) e as três funções
-- de cadastro pelas `091`/`262`/`263`; `ALTER FUNCTION
-- confirm_unified_pix_matches(jsonb) SECURITY INVOKER` e GRANT EXECUTE de
-- `reconcile_invoice_payment_by_txid` a `authenticated`.

-- 1. Granito sem tarifas ----------------------------------------------------

ALTER TABLE public.granite_bl_charges DROP CONSTRAINT IF EXISTS granite_bl_charges_rate_id_fkey;
COMMENT ON COLUMN public.granite_bl_charges.rate_id IS
  'Id histórico da tarifa de Granito do snapshot; a tabela granite_rates saiu na migration 329.';

DROP FUNCTION IF EXISTS public.calculate_granite_bl_charges(uuid, uuid);

CREATE OR REPLACE FUNCTION public.guard_used_tariff_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_used boolean := false;
BEGIN
  -- O seed de catálogo (supabase/seed.sql) substitui as tarifas de um banco
  -- novo: ele liga vela.seed_catalog na própria sessão, sem usuário. A API não
  -- consegue ligar essa marca.
  IF auth.uid() IS NULL AND current_setting('vela.seed_catalog', true) = 'on' THEN
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME = 'charge_table_items' THEN
    v_used := EXISTS (SELECT 1 FROM public.charge_calculations WHERE charge_item_id = OLD.id)
      OR EXISTS (SELECT 1 FROM public.invoice_items WHERE charge_item_id = OLD.id)
      OR EXISTS (SELECT 1 FROM public.pricing_rule_versions WHERE charge_item_id = OLD.id);
  ELSIF TG_TABLE_NAME = 'charge_tables' THEN
    v_used := EXISTS (SELECT 1 FROM public.charge_calculations WHERE charge_table_id = OLD.id)
      OR EXISTS (SELECT 1 FROM public.invoice_items WHERE charge_table_id = OLD.id)
      OR EXISTS (SELECT 1 FROM public.pricing_rule_versions WHERE charge_table_id = OLD.id);
  ELSIF TG_TABLE_NAME = 'customer_rate_overrides' THEN
    v_used := EXISTS (SELECT 1 FROM public.pricing_rule_versions WHERE customer_rate_override_id = OLD.id);
  ELSIF TG_TABLE_NAME IN ('demurrage_rates', 'customer_demurrage_agreements') THEN
    v_used := OLD.valid_from IS NULL OR OLD.valid_from <= current_date;
  END IF;

  IF v_used THEN
    RAISE EXCEPTION 'Esta tarifa já foi usada (ou já está em vigor): desative em vez de excluir.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_catalog_row(p_table text, p_id text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Somente o Administrativo pode excluir.' USING ERRCODE = '42501';
  END IF;
  -- Linha de serviço de vazios é custo interno: qualquer usuário ativo exclui
  -- (ADR 0071, política da migration 087). O resto é do Administrativo.
  IF p_table <> 'vazios_export_service_lines' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo pode excluir.' USING ERRCODE = '42501';
  END IF;
  IF p_table NOT IN (
    'depots', 'depot_services', 'vazios_export_service_lines',
    'demurrage_rates', 'customer_demurrage_agreements', 'customer_rate_overrides',
    'charge_table_items'
  ) THEN
    RAISE EXCEPTION 'Tabela fora da exclusão de cadastro: %.', p_table USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da exclusão.' USING ERRCODE = '22023';
  END IF;

  -- B14 (ADR 0071, item 4): linha de serviço de vazios trava com o ADR de
  -- Saída fechado da escala; reabrir o ADR solta a trava.
  IF p_table = 'vazios_export_service_lines' AND EXISTS (
    SELECT 1 FROM public.vazios_export_service_lines AS line
    JOIN public.vazios_export_operations AS op ON op.id = line.operation_id
    WHERE line.id::text = p_id AND public._vazios_export_locked_by_adr(op.voyage_id, op.embark_port)
  ) THEN
    RAISE EXCEPTION 'ADR de Saida fechado: reabra o ADR para excluir a linha de servico de vazios.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('vela.delete_reason', btrim(p_reason), true);
  -- ponytail: id::text evita um ramo por tipo de chave (uuid/bigint); perde o
  -- índice, aceitável em cadastros pequenos. Se uma tabela crescer, comparar
  -- no tipo da coluna.
  EXECUTE format('DELETE FROM public.%I WHERE id::text = $1', p_table) USING p_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('vela.delete_reason', '', true);

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Nada foi excluído: o registro já não existe.' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reactivate_catalog_row(p_table text, p_id text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo reativa.' USING ERRCODE = '42501';
  END IF;
  IF p_table NOT IN (
    'charge_tables', 'charge_table_items', 'customer_rate_overrides',
    'demurrage_rates', 'customer_demurrage_agreements', 'user_profiles',
    'depots', 'depot_services'
  ) THEN
    RAISE EXCEPTION 'Tabela fora da reativação de cadastro: %.', p_table USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da reativação.' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('vela.import_context', 'Reativação: ' || v_reason, true);
  -- ponytail: id::text evita um ramo por tipo de chave (uuid/bigint), como em
  -- delete_catalog_row; cadastros pequenos.
  EXECUTE format('UPDATE public.%I SET active = true WHERE id::text = $1 AND active = false', p_table) USING p_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('vela.import_context', '', true);

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Nada foi reativado: o registro não existe ou já está ativo.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES (p_table, p_id, 'reativado', 'false', 'true', auth.uid(), v_reason);
END;
$function$;

DROP TABLE IF EXISTS public.granite_rates;

-- 2. Baixa por TXID só por dentro do banco ----------------------------------

-- O corpo vigente (migrations 002/247/264/269) começa recusando quem não é
-- Financeiro nem Administrativo ativo; como dono, ele alcança a baixa por TXID.
ALTER FUNCTION public.confirm_unified_pix_matches(jsonb) SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.confirm_unified_pix_matches(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_unified_pix_matches(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.reconcile_invoice_payment_by_txid(text, numeric, timestamptz) FROM PUBLIC, anon, authenticated;

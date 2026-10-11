-- 208 — Alertas que deixam de ter objeto fecham sozinhos (achados da revisão
-- automática da PR 929 sobre a 204 e a 203).
--
-- 1. Tabela de cobrança faltando (`billing_charge_table_missing`, 204): o
--    B/L só saía da lista quando a fatura saía. B/L cancelado, sem CE (Remover
--    CE Mercante), com outro POD ou outra modalidade, ou de Viagem cancelada
--    não vai mais ser faturado por aquela espera, e ficava para sempre no
--    Alerta, que nunca fechava. Agora essas transições também tiram o B/L da
--    lista, e a lista vazia fecha o Alerta. B/L reativado ou que volta a
--    esperar entra de novo na próxima emissão pelo CE.
-- 2. Datas mudaram em Invoice de Demurrage emitida (`demurrage_invoice_dates_changed`):
--    quando as datas voltam às faturadas, a suspensão da Régua sai (203 para a
--    Invoice com desconto ou disputa; 191 no estorno da baixa), mas o Alerta
--    continuava aberto sem divergência a tratar. Agora a suspensão por datas
--    que sai fecha o Alerta da Invoice. A Invoice cancelada à mão continua
--    sendo conferida pela pessoa que resolve o Alerta (resolução manual).
--
-- Redefine `_write_charge_table_gap` e `resolve_auto_issue_alert_on_invoiced`
-- (204); cria `_drop_bls_from_charge_table_gaps` e três gatilhos. Não reescreve
-- nem apaga linhas existentes. Rollback: DROP dos gatilhos
-- `drop_bl_from_charge_table_gaps`, `drop_voyage_bls_from_charge_table_gaps`
-- e `resolve_dates_changed_alert_on_restore` e das funções novas; reaplicar as
-- definições da 204.

-- Grava o Alerta da tabela faltando com a lista de B/Ls; lista vazia fecha.
CREATE OR REPLACE FUNCTION public._write_charge_table_gap(p_pod text, p_mode text, p_bl_ids text[], p_source text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key text := p_pod || ':' || COALESCE(p_mode, 'container');
  v_count integer := COALESCE(cardinality(p_bl_ids), 0);
BEGIN
  IF v_count = 0 THEN
    PERFORM public.resolve_alert_item('billing_charge_table_missing', 'charge_table_gap', v_key, p_source,
      jsonb_build_object('resolution', CASE WHEN p_source = 'bl_invoiced' THEN 'invoiced' ELSE 'no_longer_billable' END,
        'pod', p_pod, 'cargo_mode', p_mode));
    RETURN;
  END IF;
  PERFORM public.upsert_alert_item(
    'billing_charge_table_missing', 'charge_table_gap', v_key,
    format('Tabela de cobrança faltando para o POD %s (%s): %s B/L(s) aguardando a fatura (%s%s). Cadastre a tabela em Taxas Locais › Tabelas e emita.',
      p_pod, public._cargo_mode_label(p_mode), v_count,
      array_to_string(p_bl_ids[1:10], ', '), CASE WHEN v_count > 10 THEN ', …' ELSE '' END),
    p_source,
    jsonb_build_object('pod', p_pod, 'cargo_mode', p_mode, 'bl_ids', to_jsonb(p_bl_ids)),
    '/taxas-locais/tabelas');
END;
$function$;
REVOKE ALL ON FUNCTION public._write_charge_table_gap(text, text, text[], text) FROM PUBLIC, anon, authenticated;

-- Tira os B/Ls de todas as listas do Alerta de tabela faltando.
CREATE OR REPLACE FUNCTION public._drop_bls_from_charge_table_gaps(p_bl_ids text[], p_source text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_gap record;
BEGIN
  IF COALESCE(cardinality(p_bl_ids), 0) = 0 OR NOT public.alert_actor_is_authorized() THEN
    RETURN;
  END IF;
  FOR v_gap IN
    SELECT i.metadata
    FROM public.alert_items AS i
    JOIN public.alerts AS a ON a.id = i.alert_id
    WHERE i.item_type = 'billing_charge_table_missing' AND i.status = 'active'
      AND a.entity_type = 'charge_table_gap'
      AND COALESCE(i.metadata->'bl_ids', '[]'::jsonb) ?| p_bl_ids
  LOOP
    PERFORM public._write_charge_table_gap(
      v_gap.metadata->>'pod', v_gap.metadata->>'cargo_mode',
      ARRAY(SELECT x FROM jsonb_array_elements_text(v_gap.metadata->'bl_ids') AS x WHERE NOT (x = ANY(p_bl_ids)) ORDER BY 1),
      p_source);
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public._drop_bls_from_charge_table_gaps(text[], text) FROM PUBLIC, anon, authenticated;

-- A fatura que sai tira o B/L da lista (204), agora pela função comum.
CREATE OR REPLACE FUNCTION public.resolve_auto_issue_alert_on_invoiced()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.alert_actor_is_authorized() THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.alert_items AS i
    JOIN public.alerts AS a ON a.id = i.alert_id
    WHERE i.item_type = 'billing_auto_issue_failed' AND i.status = 'active'
      AND a.entity_type = 'bl' AND a.entity_id = NEW.id
  ) THEN
    PERFORM public.resolve_alert_item('billing_auto_issue_failed', 'bl', NEW.id, 'bl_invoiced',
      jsonb_build_object('resolution', 'invoiced', 'financial_status', NEW.financial_status));
  END IF;
  PERFORM public._drop_bls_from_charge_table_gaps(ARRAY[NEW.id], 'bl_invoiced');
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.resolve_auto_issue_alert_on_invoiced() FROM PUBLIC, anon, authenticated;

-- B/L que deixa de esperar aquela tabela: cancelado, sem CE, outro POD ou
-- outra modalidade.
CREATE OR REPLACE FUNCTION public.drop_bl_from_charge_table_gaps_on_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._drop_bls_from_charge_table_gaps(ARRAY[NEW.id],
    CASE WHEN NEW.cancelled_at IS NOT NULL THEN 'bl_cancelled'
         WHEN NULLIF(btrim(COALESCE(NEW.ce_mercante, '')), '') IS NULL THEN 'ce_removed'
         ELSE 'bl_route_changed' END);
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.drop_bl_from_charge_table_gaps_on_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS drop_bl_from_charge_table_gaps ON public.bls;
CREATE TRIGGER drop_bl_from_charge_table_gaps
  AFTER UPDATE OF cancelled_at, ce_mercante, pod, cargo_mode ON public.bls
  FOR EACH ROW
  WHEN ((OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL)
        OR (NULLIF(btrim(COALESCE(OLD.ce_mercante, '')), '') IS NOT NULL
            AND NULLIF(btrim(COALESCE(NEW.ce_mercante, '')), '') IS NULL)
        OR NEW.pod IS DISTINCT FROM OLD.pod
        OR NEW.cargo_mode IS DISTINCT FROM OLD.cargo_mode)
  EXECUTE FUNCTION public.drop_bl_from_charge_table_gaps_on_change();

-- Viagem cancelada: nenhum B/L dela é faturado.
CREATE OR REPLACE FUNCTION public.drop_voyage_bls_from_charge_table_gaps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._drop_bls_from_charge_table_gaps(
    ARRAY(SELECT id FROM public.bls WHERE voyage_id = NEW.id ORDER BY id), 'voyage_cancelled');
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.drop_voyage_bls_from_charge_table_gaps() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS drop_voyage_bls_from_charge_table_gaps ON public.voyages;
CREATE TRIGGER drop_voyage_bls_from_charge_table_gaps
  AFTER UPDATE OF status ON public.voyages
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION public.drop_voyage_bls_from_charge_table_gaps();

-- Suspensão por datas que sai (datas de volta às faturadas): o Alerta da
-- Invoice fecha.
CREATE OR REPLACE FUNCTION public.resolve_dates_changed_alert_on_restore()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.alert_actor_is_authorized() THEN
    RETURN NULL;
  END IF;
  PERFORM public.resolve_alert_item('demurrage_invoice_dates_changed', 'demurrage_invoice', NEW.id::text, 'container-dates',
    jsonb_build_object('resolution', 'dates_restored', 'invoice_id', NEW.id));
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.resolve_dates_changed_alert_on_restore() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS resolve_dates_changed_alert_on_restore ON public.demurrage_invoices;
CREATE TRIGGER resolve_dates_changed_alert_on_restore
  AFTER UPDATE OF dunning_suspended_reason ON public.demurrage_invoices
  FOR EACH ROW
  WHEN (OLD.dunning_suspended_reason LIKE 'Datas de container alteradas%' AND NEW.dunning_suspended_reason IS NULL)
  EXECUTE FUNCTION public.resolve_dates_changed_alert_on_restore();

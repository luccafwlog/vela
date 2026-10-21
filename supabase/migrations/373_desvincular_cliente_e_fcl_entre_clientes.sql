-- 373: desvincular o Cliente do B/L e container FCL entre Clientes (ADR
-- 0093, decisão 13; plano da frente financeira, F-27 e F-29; revisão das
-- importações, itens 2a e I-07).
--
-- Problema:
--   F-27. Tirar o Cliente do B/L (`save_bl_review` com Cliente vazio,
--     `relink_bl_customer` sem Cliente na importação, UPDATE direto) deixava o
--     recebível com o Cliente antigo; em B/L faturado, a fatura era
--     cancelada.
--   I-07. `assert_no_fcl_shared_between_customers` (P0008, 176) só rodava na
--     importação e ignorava B/L sem Cliente: o container FCL terminava
--     dividido entre dois Clientes quando o segundo B/L era vinculado depois
--     (ficha, Base ou Revisão).
--   F-29. Falha do cálculo no vínculo de Cliente (câmbio ausente, usuário
--     inativo) ia só para `audit_logs`; o B/L sumia do "A faturar".
--
-- Mudança: gatilhos em `bls.customer_id`, para qualquer caminho:
--   - tirar o Cliente de B/L faturado é recusado (use Trocar Cliente);
--   - tirar o Cliente de B/L não faturado anula o recebível sem fatura; ele
--     nasce de novo, com a Condição certa, no vínculo seguinte (342);
--   - vincular um Cliente roda a P0008;
--   - falha do cálculo no vínculo abre `billing_calculation_blocked`.
--
-- ponytail: o gatilho do vínculo roda a P0008 por B/L; a Base de Clientes
-- (teto de 3.000 Clientes) passa por ele em cada B/L vinculado. Medir a Base
-- depois do deploy; caminho de melhoria: o lote da Base chamar a P0008 uma
-- vez com todos os B/Ls e o gatilho pular dentro dele.
--
-- Não altera nem apaga linhas existentes.

CREATE OR REPLACE FUNCTION public.guard_bl_customer_unlink()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.customer_id IS NOT NULL AND NEW.customer_id IS NULL AND NEW.cancelled_at IS NULL
     AND (coalesce(NEW.financial_status, 'pending') IN ('invoiced', 'partially_paid', 'paid')
          OR cardinality(public._live_local_invoice_ids_for_bl(NEW.id)) > 0) THEN
    RAISE EXCEPTION 'O B/L % ja foi faturado: nao se desvincula o Cliente. Use Trocar Cliente.', NEW.id
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_bl_customer_unlink() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_bl_customer_unlink
  BEFORE UPDATE OF customer_id ON public.bls
  FOR EACH ROW WHEN (OLD.customer_id IS NOT NULL AND NEW.customer_id IS NULL)
  EXECUTE FUNCTION public.guard_bl_customer_unlink();

CREATE OR REPLACE FUNCTION public.after_bl_customer_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.cancelled_at IS NOT NULL THEN RETURN NULL; END IF;
  IF NEW.customer_id IS NULL THEN
    PERFORM public._void_unbilled_bl_receivables(NEW.id, auth.uid(), 'Cliente desvinculado do B/L');
  ELSE
    PERFORM public.assert_no_fcl_shared_between_customers(ARRAY[NEW.id]);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.after_bl_customer_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER after_bl_customer_change
  AFTER UPDATE OF customer_id ON public.bls
  FOR EACH ROW WHEN (OLD.customer_id IS DISTINCT FROM NEW.customer_id)
  EXECUTE FUNCTION public.after_bl_customer_change();

-- F-29: falha do cálculo no vínculo abre Alerta.
CREATE OR REPLACE FUNCTION public.sync_receivable_on_bl_customer_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_previous_role text;
BEGIN
  IF COALESCE(NEW.financial_status, 'pending') = 'cancelled' OR NEW.cancelled_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.charge_calculations cc
    WHERE cc.bl_id = NEW.id
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing')
  ) THEN
    RETURN NULL;
  END IF;
  IF cardinality(public._live_local_invoice_ids_for_bl(NEW.id)) > 0 THEN
    RETURN NULL;
  END IF;
  BEGIN
    IF COALESCE(NEW.financial_status, 'pending') = 'pending' THEN
      PERFORM public.calculate_bl_local_charges(NEW.id, auth.uid(), true);
    ELSE
      PERFORM public.sync_local_charge_receivable(NEW.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
    VALUES ('bl', NEW.id, 'local_charges_customer_link_calc_error', NULL, SQLERRM, auth.uid(), now(),
      'Falha no recálculo das taxas locais ao vincular o cliente; o recebível nasce no próximo cálculo.');
    -- F-29 (373): a falha fica visível; a emissão do B/L fecha o Alerta (347).
    v_previous_role := current_setting('request.jwt.claim.role', true);
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);
    PERFORM public.upsert_alert_item('billing_calculation_blocked', 'bl', NEW.id,
      'O cálculo das Taxas Locais do B/L ' || NEW.id || ' falhou ao vincular o Cliente: ' || left(SQLERRM, 300)
        || '. Corrija a causa (câmbio, tabela, usuário) e recalcule; sem isso o B/L não entra em "A faturar".',
      'customer_link', 'documentacao', jsonb_build_object('bl_id', NEW.id, 'error', left(SQLERRM, 300)), '/taxas-locais');
    PERFORM set_config('request.jwt.claim.role', coalesce(v_previous_role, ''), true);
  END;
  RETURN NULL;
END;
$function$;

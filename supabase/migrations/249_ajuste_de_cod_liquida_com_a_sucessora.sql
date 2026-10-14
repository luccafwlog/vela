-- Migration 249: o Ajuste de COD sem pagamento se liquida com a fatura
-- sucessora (item A11 do plano
-- docs/plans/2026-10-14-correcoes-decididas-na-revisao-geral.md; ADR 0083,
-- item 11; ADR 0077).
--
-- No COD de B/L faturado e sem pagamento, a correção após emissão já cancela e
-- reemite a fatura sozinha (migrations 128 e 130), mas o ajuste
-- `cancel_and_reissue` ficava pendente no painel "Ajustes de COD" pedindo
-- "Cancelar e reemitir" e o número da sucessora. Agora o vínculo do B/L a uma
-- fatura ativa emitida depois do ajuste o liquida, com a fatura como documento
-- resultante; se a reemissão travar (Reemissão pendente), o ajuste espera a
-- emissão pela ficha do B/L.
--
-- Reescreve os ajustes `cancel_and_reissue` pendentes que já têm sucessora;
-- apoia-se na afirmação "Data status" do AGENTS.md, como exige a regra de
-- migrations que reescrevem linhas.

CREATE OR REPLACE FUNCTION public._settle_cod_reissue_with_successor(p_bl_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  UPDATE public.cod_adjustments AS ca
  SET status = 'settled',
      resulting_document_id = successor.invoice_id,
      resulting_document_type = 'invoice'
  FROM (
    SELECT pending.id AS adjustment_id,
      (SELECT i.id
         FROM public.invoice_bls AS ib
         JOIN public.invoices AS i ON i.id = ib.invoice_id
        WHERE ib.bl_id = pending.bl_id
          AND i.status NOT IN ('cancelled', 'draft')
          AND i.created_at >= pending.created_at
        ORDER BY i.id DESC
        LIMIT 1) AS invoice_id
    FROM public.cod_adjustments AS pending
    WHERE pending.bl_id = p_bl_id
      AND pending.status = 'pending'
      AND pending.action = 'cancel_and_reissue'
  ) AS successor
  WHERE ca.id = successor.adjustment_id
    AND successor.invoice_id IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION public._settle_cod_reissue_with_successor(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.settle_cod_reissue_on_invoice_bl()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._settle_cod_reissue_with_successor(NEW.bl_id);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.settle_cod_reissue_on_invoice_bl() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS settle_cod_reissue_on_invoice_bl ON public.invoice_bls;
CREATE TRIGGER settle_cod_reissue_on_invoice_bl
  AFTER INSERT ON public.invoice_bls
  FOR EACH ROW EXECUTE FUNCTION public.settle_cod_reissue_on_invoice_bl();

-- A reemissão pode acontecer antes de o ajuste ser gravado na mesma operação.
CREATE OR REPLACE FUNCTION public.apply_cod_financial_effect(p_bl_id text, p_omission_id bigint, p_previous_pod text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_before bigint; v_id bigint; v_map jsonb;
BEGIN
  SELECT coalesce(max(id), 0) INTO v_before FROM public.cod_adjustments WHERE bl_id = p_bl_id;
  PERFORM public.apply_cod_financial_effect_legacy_130(p_bl_id, p_omission_id, p_previous_pod);
  SELECT id INTO v_id FROM public.cod_adjustments WHERE bl_id = p_bl_id AND id > v_before ORDER BY id DESC LIMIT 1;
  IF v_id IS NOT NULL THEN
    v_map := coalesce(nullif(current_setting('vela.cod_basis_events', true), ''), '{}')::jsonb;
    PERFORM set_config('vela.cod_basis_events', (v_map || jsonb_build_object(p_bl_id, v_id))::text, true);
    PERFORM public._settle_cod_reissue_with_successor(p_bl_id);
  END IF;
END;
$function$;

SELECT public._settle_cod_reissue_with_successor(bl_id)
FROM (SELECT DISTINCT bl_id FROM public.cod_adjustments WHERE status = 'pending' AND action = 'cancel_and_reissue') AS pending;

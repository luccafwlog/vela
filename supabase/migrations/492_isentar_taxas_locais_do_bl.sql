-- 492: Isentar Taxas Locais à mão (lote 2 do plano
-- `2026-10-28-alterar-taxa-calculada-do-bl`; ADR 0111, decisão D12).
--
-- Na ficha do B/L, bloco Taxas Locais, qualquer setor isenta o B/L inteiro
-- das Taxas Locais e retira a isenção, sempre com justificativa. A isenção é
-- uma decisão sobre o B/L (`bl_local_charge_exemptions`): o cálculo e todo
-- recálculo, inclusive na troca de POD ou de modalidade, põem o B/L no estado
-- **Isento** que o sistema já trata (fila da Validação, CE "Nada a faturar",
-- Desbloqueio de CE com o Financeiro atendido, Portal sem valor), com o
-- motivo "Isenção manual: <justificativa>". As linhas continuam na ficha como
-- referência, Isentas e com total zero; as excluídas continuam excluídas.
-- Retirar a isenção recalcula com as alterações e exclusões que o B/L tinha.
-- A isenção pelo veículo LCL continua como está e vale primeiro.
--
-- Com o B/L isento à mão, nenhuma taxa se altera, exclui ou lança: "B/L isento
-- das Taxas Locais: retire a isenção para alterar as taxas.".
--
-- Não apaga nem reescreve linha existente fora do que o próprio cálculo já
-- refaz: só acrescenta a tabela, os invólucros e as funções.
--
-- Rollback: renomear `_calculate_bl_local_charges_impl_491`,
-- `_lock_bl_for_charge_change_491` e `_update_manual_bl_charge_impl_491` de
-- volta aos nomes sem sufixo (devolvendo o EXECUTE de `update_manual_bl_charge`
-- a authenticated), recriar `add_manual_bl_charge` (106) e
-- `_quote_bl_local_charges` (136); a tabela nova fica sem uso.

-- 1. Dados -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.bl_local_charge_exemptions (
  bl_id text PRIMARY KEY REFERENCES public.bls(id) ON DELETE CASCADE,
  justification text NOT NULL CONSTRAINT bl_local_charge_exemptions_justification_check
    CHECK (length(btrim(justification)) >= 10),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bl_local_charge_exemptions_created_by
  ON public.bl_local_charge_exemptions (created_by);

-- Leitura interna; nenhuma escrita direta pela API (só pelas RPCs abaixo).
ALTER TABLE public.bl_local_charge_exemptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bl_local_charge_exemptions_select_read ON public.bl_local_charge_exemptions;
CREATE POLICY bl_local_charge_exemptions_select_read ON public.bl_local_charge_exemptions
  FOR SELECT TO authenticated USING ((SELECT public.is_active_read_user()));
REVOKE ALL ON TABLE public.bl_local_charge_exemptions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.bl_local_charge_exemptions TO authenticated;
GRANT ALL ON TABLE public.bl_local_charge_exemptions TO service_role;

-- 2. Cálculo -----------------------------------------------------------------

-- O cálculo da 491 continua inteiro; o invólucro aplica a isenção à mão por
-- cima. A isenção LCL (prova positiva do veículo) vale primeiro e devolve
-- antes, como sempre.
ALTER FUNCTION public._calculate_bl_local_charges_impl_106(text, uuid, boolean)
  RENAME TO _calculate_bl_local_charges_impl_491;
REVOKE ALL ON FUNCTION public._calculate_bl_local_charges_impl_491(text, uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public._calculate_bl_local_charges_impl_106(p_bl_id text, p_actor uuid DEFAULT NULL::uuid, p_recalculate boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_exemption public.bl_local_charge_exemptions;
  v_reason text;
BEGIN
  v_result := public._calculate_bl_local_charges_impl_491(p_bl_id, p_actor, p_recalculate);
  SELECT * INTO v_exemption FROM public.bl_local_charge_exemptions e WHERE e.bl_id = p_bl_id;
  IF v_exemption.bl_id IS NULL OR v_result->>'status' = 'exempt' THEN
    RETURN v_result;
  END IF;

  v_reason := 'Isenção manual: ' || btrim(v_exemption.justification);
  -- As linhas ficam como referência: valor por unidade e da tabela mantidos,
  -- total zero. A excluída continua excluída.
  UPDATE public.charge_calculations cc
     SET status = 'exempt',
         total_value_brl = CASE WHEN cc.total_value_brl IS NULL THEN NULL ELSE 0 END,
         total_value_usd = CASE WHEN cc.total_value_usd IS NULL THEN NULL ELSE 0 END
   WHERE cc.bl_id = p_bl_id AND COALESCE(cc.status, 'calculated') <> 'excluded';

  UPDATE public.bls
     SET charge_status = 'exempt',
         charges_calculated_at = now(),
         charge_exemption_reason = v_reason,
         billing_hold_reason = NULL
   WHERE id = p_bl_id;
  PERFORM public.sync_local_charge_receivable(p_bl_id);

  RETURN v_result || jsonb_build_object('status', 'exempt', 'total_brl', 0, 'total_usd', 0,
    'review_required', false, 'exempt', true, 'reason', v_reason, 'manual_exemption', true);
END;
$function$;
REVOKE ALL ON FUNCTION public._calculate_bl_local_charges_impl_106(text, uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;

-- A cotação (correção automática, COD, emissão pelo CE) vê o B/L isento à mão
-- como isento, igual ao B/L cancelado (136).
CREATE OR REPLACE FUNCTION public._quote_bl_local_charges(p_bl_id text, p_roe numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.bls WHERE id = p_bl_id AND cancelled_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.bl_local_charge_exemptions e WHERE e.bl_id = p_bl_id) THEN
    RETURN jsonb_build_object('status', 'exempt', 'total_brl', 0);
  END IF;
  RETURN public._quote_bl_local_charges_legacy_134(p_bl_id, p_roe);
END;
$function$;
REVOKE ALL ON FUNCTION public._quote_bl_local_charges(text, numeric) FROM PUBLIC, anon, authenticated;

-- 3. Nenhuma taxa muda no B/L isento à mão ----------------------------------

CREATE OR REPLACE FUNCTION public._assert_bl_not_manually_exempt(p_bl_id text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.bl_local_charge_exemptions e WHERE e.bl_id = p_bl_id) THEN
    RAISE EXCEPTION 'B/L isento das Taxas Locais: retire a isenção para alterar as taxas.' USING ERRCODE = '22023';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public._assert_bl_not_manually_exempt(text) FROM PUBLIC, anon, authenticated;

-- Alterar, excluir, desfazer e excluir cobrança manual passam por aqui.
ALTER FUNCTION public._lock_bl_for_charge_change(text, text, uuid) RENAME TO _lock_bl_for_charge_change_491;
REVOKE ALL ON FUNCTION public._lock_bl_for_charge_change_491(text, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public._lock_bl_for_charge_change(p_bl_id text, p_justification text, p_actor uuid)
 RETURNS public.bls
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.bls;
BEGIN
  v_bl := public._lock_bl_for_charge_change_491(p_bl_id, p_justification, p_actor);
  PERFORM public._assert_bl_not_manually_exempt(v_bl.id);
  RETURN v_bl;
END;
$function$;
REVOKE ALL ON FUNCTION public._lock_bl_for_charge_change(text, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.add_manual_bl_charge(p_bl_id text, p_charge_item_id bigint, p_quantity numeric DEFAULT 1, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._assert_actor_is_caller(p_actor);
  PERFORM public._assert_bl_not_manually_exempt(upper(btrim(COALESCE(p_bl_id, ''))));
  RETURN public._add_manual_bl_charge_impl_106(p_bl_id, p_charge_item_id, p_quantity, p_notes, p_actor);
END;
$function$;
REVOKE ALL ON FUNCTION public.add_manual_bl_charge(text, bigint, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_manual_bl_charge(text, bigint, numeric, text, uuid) TO authenticated;

ALTER FUNCTION public.update_manual_bl_charge(bigint, numeric, text, uuid) RENAME TO _update_manual_bl_charge_impl_491;
REVOKE ALL ON FUNCTION public._update_manual_bl_charge_impl_491(bigint, numeric, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.update_manual_bl_charge(p_charge_calculation_id bigint, p_quantity numeric, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text;
BEGIN
  SELECT cc.bl_id INTO v_bl_id FROM public.charge_calculations cc WHERE cc.id = p_charge_calculation_id;
  IF v_bl_id IS NOT NULL THEN
    PERFORM public._assert_bl_not_manually_exempt(v_bl_id);
  END IF;
  RETURN public._update_manual_bl_charge_impl_491(p_charge_calculation_id, p_quantity, p_notes, p_actor);
END;
$function$;
REVOKE ALL ON FUNCTION public.update_manual_bl_charge(bigint, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_manual_bl_charge(bigint, numeric, text, uuid) TO authenticated;

-- 4. Isentar e retirar a isenção ---------------------------------------------

-- Isentar Taxas Locais (D12): todos os setores, com justificativa. Vale também
-- para B/L ainda não calculado.
CREATE OR REPLACE FUNCTION public.exempt_bl_local_charges(p_bl_id text, p_justification text, p_actor uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.bls;
  v_justification text := btrim(COALESCE(p_justification, ''));
  v_result jsonb;
BEGIN
  v_bl := public._lock_bl_for_charge_change_491(p_bl_id, p_justification, p_actor);
  IF EXISTS (SELECT 1 FROM public.bl_local_charge_exemptions e WHERE e.bl_id = v_bl.id) THEN
    RAISE EXCEPTION 'B/L % já está isento das Taxas Locais.', v_bl.id USING ERRCODE = '22023';
  END IF;
  IF v_bl.charge_status = 'exempt' THEN
    RAISE EXCEPTION 'B/L % já está isento das Taxas Locais pelo veículo LCL.', v_bl.id USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.bl_local_charge_exemptions (bl_id, justification, created_by)
  VALUES (v_bl.id, v_justification, auth.uid());
  v_result := public._calculate_bl_local_charges_impl_106(v_bl.id, auth.uid(), true);

  PERFORM public._record_bl_charge_event(v_bl.id, NULL, 'exempted', NULL, NULL,
    jsonb_build_object('charge_status', v_bl.charge_status), jsonb_build_object('charge_status', 'exempt'),
    v_justification, auth.uid());
  RETURN jsonb_build_object('bl_id', v_bl.id, 'status', v_result->>'status');
END;
$function$;
REVOKE ALL ON FUNCTION public.exempt_bl_local_charges(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exempt_bl_local_charges(text, text, uuid) TO authenticated;

-- Retirar isenção: o B/L volta a ser calculado com as alterações e exclusões
-- que tinha. A cobrança manual volta ao valor que tinha antes da isenção.
CREATE OR REPLACE FUNCTION public.remove_bl_local_charge_exemption(p_bl_id text, p_justification text, p_actor uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.bls;
  v_justification text := btrim(COALESCE(p_justification, ''));
  v_result jsonb;
BEGIN
  v_bl := public._lock_bl_for_charge_change_491(p_bl_id, p_justification, p_actor);
  DELETE FROM public.bl_local_charge_exemptions e WHERE e.bl_id = v_bl.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não está isento à mão das Taxas Locais.', v_bl.id USING ERRCODE = '22023';
  END IF;

  -- ponytail: a linha manual guarda o valor por unidade durante a isenção; o
  -- total volta como quantidade × unidade, ou o total alterado à mão.
  UPDATE public.charge_calculations cc
     SET status = 'reviewed',
         total_value_brl = CASE WHEN cc.unit_value_brl IS NULL THEN cc.total_value_brl
           WHEN t.kind = 'total' THEN t.value ELSE round(cc.quantity * cc.unit_value_brl, 2) END,
         total_value_usd = CASE WHEN cc.unit_value_usd IS NULL THEN cc.total_value_usd
           WHEN t.kind = 'total' THEN t.value ELSE round(cc.quantity * cc.unit_value_usd, 2) END
    FROM (SELECT c.id, a.kind, a.value
            FROM public.charge_calculations c
            LEFT JOIN public.bl_charge_adjustments a ON a.id = c.adjustment_id AND a.ended_at IS NULL
           WHERE c.bl_id = v_bl.id AND c.source = 'manual' AND c.status = 'exempt') t
   WHERE cc.id = t.id;

  v_result := public._calculate_bl_local_charges_impl_106(v_bl.id, auth.uid(), true);

  PERFORM public._record_bl_charge_event(v_bl.id, NULL, 'exemption_removed', NULL, NULL,
    jsonb_build_object('charge_status', 'exempt'), jsonb_build_object('charge_status', v_result->>'status'),
    v_justification, auth.uid());
  RETURN jsonb_build_object('bl_id', v_bl.id, 'status', v_result->>'status');
END;
$function$;
REVOKE ALL ON FUNCTION public.remove_bl_local_charge_exemption(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_bl_local_charge_exemption(text, text, uuid) TO authenticated;

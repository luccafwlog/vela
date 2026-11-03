-- 580: o Comunicado de CE e Taxas sai para o Cliente com B/L isento.
--
-- Produção, 2026-11-03: o Cliente cujos B/Ls são isentos das Taxas Locais
-- (veículo LCL, ou isenção à mão da 492) nunca recebia o CE e Taxas. A
-- isenção põe o B/L em `charge_status = 'exempt'` e não há o que faturar, mas
-- a prontidão (definição da 339) exigia `financial_status` em `invoiced` ou
-- `paid` de todo B/L: o isento ficava em "faturamento_pendente" para sempre,
-- e o Cliente inteiro bloqueado na régua, no Disparo e no Reenviar. Medido em
-- produção nesse dia (leitura): viagem 169, dois Clientes só com B/Ls
-- isentos (13 e 2 B/Ls), nenhum outro par Cliente × Viagem afetado.
--
-- 1. customer_local_charges_communication_readiness: o B/L isento não
--    precisa de faturamento. CE e revisão continuam exigidos (o Comunicado
--    existe para levar o CE). Cada B/L do retorno ganha `exempt`. Assinatura,
--    permissão e os demais campos não mudam.
-- 2. customer_local_charges_communication_payload (definição da 304): cada
--    B/L ganha `exempt`, lido pela Edge e pela régua para o modelo mostrar só
--    o CE do B/L isento (todos isentos: e-mail só com os CEs, sem valor,
--    total nem botão de pagamento; misto: "Isento" no lugar do valor).
--
-- Efeito ao aplicar: a régua passa a ver como prontos os pares Cliente ×
-- Viagem em que só faltava o faturamento do B/L isento, e envia o CE e Taxas
-- deles uma vez, como a qualquer Cliente que fica pronto.
--
-- Só redefine funções (CREATE OR REPLACE conserva os grants); não reescreve
-- nem apaga linhas.
-- Rollback: reaplicar a prontidão pela 339 e o payload pela 304.

-- 1 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_local_charges_communication_readiness(p_voyage_id bigint, p_customer_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_active_read_user()) THEN
    RAISE EXCEPTION 'Usuário interno ativo é obrigatório.' USING ERRCODE = '42501';
  END IF;
  -- B/L importado sem Cliente (ou sem Viagem) não está pronto: devolve o
  -- veredito em vez de abortar a consulta inteira de quem chamou.
  IF p_voyage_id IS NULL OR p_customer_id IS NULL THEN
    RETURN jsonb_build_object(
      'voyage_id', p_voyage_id,
      'customer_id', p_customer_id,
      'ready', false,
      'reason_code', CASE WHEN p_customer_id IS NULL THEN 'sem_cliente' ELSE 'sem_viagem' END,
      'bl_count', 0,
      'blocked_bl_count', 0,
      'reasons', jsonb_build_array(CASE WHEN p_customer_id IS NULL THEN 'sem_cliente' ELSE 'sem_viagem' END),
      'bls', '[]'::jsonb);
  END IF;

  WITH bl_state AS (
    SELECT
      b.id AS bl_id,
      NULLIF(btrim(b.ce_mercante), '') AS ce_mercante,
      COALESCE(b.financial_status, 'pending') AS financial_status,
      COALESCE(b.cargo_mode, 'container') AS cargo_mode,
      COALESCE(b.charge_status = 'exempt', false) AS exempt,
      b.bb_weight_ton,
      array_remove(ARRAY[
        CASE WHEN b.review_status = 'pending_review' THEN 'revisao_pendente'::text END,
        CASE WHEN COALESCE(b.cargo_mode, 'container') IN ('carga_solta', 'misto')
                  AND (b.bb_weight_ton IS NULL OR b.bb_weight_ton <= 0)
             THEN 'peso_bb_ausente'::text END
      ], NULL) AS review_pendencies
    FROM public.bls AS b
    WHERE b.voyage_id = p_voyage_id
      AND b.customer_id = p_customer_id
      AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
      AND b.cancelled_at IS NULL
  ), annotated AS (
    SELECT
      bl_state.*,
      array_remove(ARRAY[
        CASE WHEN bl_state.ce_mercante IS NULL THEN 'ce_mercante_ausente'::text END,
        CASE WHEN COALESCE(cardinality(bl_state.review_pendencies), 0) > 0 THEN 'revisao_pendente'::text END,
        -- 580: o B/L isento das Taxas Locais não tem o que faturar.
        CASE WHEN bl_state.financial_status NOT IN ('invoiced', 'paid') AND NOT bl_state.exempt
             THEN 'faturamento_pendente'::text END
      ], NULL) AS blocked_reasons
    FROM bl_state
  ), aggregate AS (
    SELECT
      count(*)::integer AS bl_count,
      count(*) FILTER (WHERE cardinality(blocked_reasons) > 0)::integer AS blocked_bl_count,
      COALESCE(bool_and(cardinality(blocked_reasons) = 0), false) AS ready,
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'bl_id', bl_id,
          'ce_mercante', ce_mercante,
          'financial_status', financial_status,
          'cargo_mode', cargo_mode,
          'exempt', exempt,
          'review_pendencies', to_jsonb(review_pendencies),
          'blocked_reasons', to_jsonb(blocked_reasons)
        ) ORDER BY bl_id
      ), '[]'::jsonb) AS bls
    FROM annotated
  ), reason_aggregate AS (
    SELECT COALESCE(jsonb_agg(DISTINCT reason ORDER BY reason), '[]'::jsonb) AS reasons
    FROM annotated
    CROSS JOIN LATERAL unnest(annotated.blocked_reasons) AS reason
  )
  SELECT jsonb_build_object(
    'voyage_id', p_voyage_id,
    'customer_id', p_customer_id,
    'ready', CASE WHEN bl_count = 0 THEN false ELSE ready END,
    'reason_code', CASE
      WHEN bl_count = 0 THEN 'no_bls'
      WHEN ready THEN 'ready'
      ELSE COALESCE(reasons ->> 0, 'readiness_blocked')
    END,
    'bl_count', bl_count,
    'blocked_bl_count', blocked_bl_count,
    'reasons', reasons,
    'bls', bls
  ) INTO v_result
  FROM aggregate CROSS JOIN reason_aggregate;
  RETURN v_result;
END;
$function$;

-- 2 -------------------------------------------------------------------------
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
      SELECT b.id AS bl_id, b.ce_mercante, b.pod, COALESCE(b.charge_status = 'exempt', false) AS exempt, c.name AS customer_name,
             v.eta, v.voyage_number, vs.name AS vessel_name
      FROM public.bls b
      JOIN public.customers c ON c.id = b.customer_id
      JOIN public.voyages v ON v.id = b.voyage_id
      LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
      WHERE b.voyage_id = p_voyage_id
        AND b.customer_id = p_customer_id
        AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
        AND b.cancelled_at IS NULL
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
      'port', public.customer_local_charges_communication_port(p_voyage_id, p_customer_id),
      'milestone_at', max(COALESCE(base_bls.eta::TEXT, '')),
      'bls', jsonb_agg(jsonb_build_object(
        'bl_id', base_bls.bl_id,
        'ce_mercante', NULLIF(btrim(base_bls.ce_mercante), ''),
        'total_brl', COALESCE(direct_totals.total_brl, ledger_totals.total_brl, 0),
        'exempt', base_bls.exempt
      ) ORDER BY base_bls.bl_id)
    ) END
    FROM base_bls
    LEFT JOIN direct_totals ON direct_totals.bl_id = base_bls.bl_id
    LEFT JOIN ledger_totals ON ledger_totals.bl_id = base_bls.bl_id
  );
END;
$function$;

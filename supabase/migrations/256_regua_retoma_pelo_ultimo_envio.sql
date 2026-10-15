-- Item 30 (A15) do plano 2026-10-14: a Régua de Cobrança de Demurrage retoma
-- ancorada no último envio (ADR 0083, item 15). Antes, o calendário ficava
-- preso a first_billed_at + intervalo × tentativas e, depois de uma pausa
-- (Disputa aberta, por exemplo), as cobranças "atrasadas" saíam em rodadas
-- horárias seguidas. Só redefine a função; não reescreve nem apaga linhas.

CREATE OR REPLACE FUNCTION public.claim_demurrage_dunning_candidates(p_as_of timestamp with time zone DEFAULT now(), p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice RECORD;
  v_interval_days INTEGER;
  v_limit INTEGER;
  v_inserted INTEGER;
  v_claimed_at TIMESTAMPTZ;
  v_candidates JSONB := '[]'::JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NOT NULL AND p_limit < 1 THEN
    RAISE EXCEPTION 'O limite do lote deve ser positivo.' USING ERRCODE = '22023';
  END IF;
  v_limit := LEAST(COALESCE(p_limit, 50), 100);
  SELECT GREATEST(COALESCE(demurrage_dunning_interval_days, 7), 1) INTO v_interval_days FROM public.app_settings WHERE id = 1;
  v_interval_days := COALESCE(v_interval_days, 7);

  UPDATE public.demurrage_dunning_claims AS claim
  SET released_at = COALESCE(p_as_of, now())
  WHERE claim.released_at IS NULL
    AND claim.claimed_at < COALESCE(p_as_of, now()) - interval '30 minutes'
    AND NOT EXISTS (
      SELECT 1
      FROM public.customer_communications AS comm
      WHERE comm.kind = 'cobranca_demurrage'
        AND comm.status IN ('enviado', 'simulado', 'parcial')
        AND (
          EXISTS (
            SELECT 1
            FROM public.customer_communication_dunning_invoices AS membership
            WHERE membership.communication_id = comm.id
              AND membership.demurrage_invoice_id = claim.demurrage_invoice_id
              AND membership.attempt_discriminator = claim.attempt_discriminator
          )
          OR (
            NOT EXISTS (
              SELECT 1 FROM public.customer_communication_dunning_groups AS grouped
              WHERE grouped.communication_id = comm.id
            )
            AND comm.attempt_discriminator = claim.attempt_discriminator
            AND (
              comm.anchor_invoice_id = claim.demurrage_invoice_id
              OR EXISTS (
                SELECT 1
                FROM public.customer_communication_bls AS bl
                JOIN public.demurrage_invoices AS di ON di.bl_id = bl.bl_id
                WHERE bl.communication_id = comm.id AND di.id = claim.demurrage_invoice_id
              )
            )
          )
        )
    );

  FOR v_invoice IN
    SELECT di.id, di.customer_id, di.bl_id, di.doc_number, di.total_usd, di.current_total_brl,
      di.current_roe, di.roe_source, di.first_billed_at,
      COALESCE(claims.claimed_at, now()) AS claimed_at,
      COALESCE(di.updated_at::DATE, di.doc_date, CURRENT_DATE)::TEXT AS roe_reference_date,
      COALESCE(claims.attempt_count, 0)::INTEGER + 1 AS attempt_discriminator
    FROM public.demurrage_invoices AS di
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE prior_claim.released_at IS NULL)::INTEGER AS attempt_count,
        max(prior_claim.claimed_at) FILTER (WHERE prior_claim.released_at IS NULL) AS claimed_at
      FROM public.demurrage_dunning_claims AS prior_claim
      WHERE prior_claim.demurrage_invoice_id = di.id
    ) AS claims ON true
    WHERE COALESCE(di.status, 'issued') IN ('issued', 'overdue')
      AND di.dunning_suspended_reason IS NULL
      AND di.first_billed_at IS NOT NULL AND di.paid_at IS NULL
      AND COALESCE(di.dispute_open, false) = false
      AND EXISTS (
        SELECT 1 FROM public.customer_contacts AS cc
        JOIN public.customer_contact_box_links AS bl ON bl.contact_id = cc.id
        WHERE cc.customer_id = di.customer_id
          AND cc.deactivated_at IS NULL
          AND cc.email_normalized IS NOT NULL
          AND cc.email_normalized ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
          AND bl.box_code IN ('demurrage', 'financeiro')
          AND NOT EXISTS (SELECT 1 FROM public.portal_suppressed_emails pse WHERE lower(btrim(pse.email)) = cc.email_normalized AND pse.reason = 'bounce_permanente')
          AND NOT EXISTS (SELECT 1 FROM public.customer_communication_suppressions ccs WHERE lower(btrim(ccs.email)) = cc.email_normalized)
      )
      -- A15: a 1ª cobrança vence na emissão; as seguintes, um intervalo depois do
      -- dia do último envio (São Paulo). Depois de uma pausa sai uma cobrança e as
      -- seguintes seguem o intervalo normal, sem recuperar as "atrasadas".
      AND COALESCE(p_as_of, now()) >= CASE
        WHEN COALESCE(claims.attempt_count, 0) = 0
          THEN di.first_billed_at::TIMESTAMP AT TIME ZONE 'America/Sao_Paulo'
        ELSE ((claims.claimed_at AT TIME ZONE 'America/Sao_Paulo')::DATE + v_interval_days)::TIMESTAMP AT TIME ZONE 'America/Sao_Paulo'
      END
    ORDER BY di.id
    LIMIT v_limit
    FOR UPDATE OF di SKIP LOCKED
  LOOP
    v_inserted := 0;
    v_claimed_at := NULL;
    INSERT INTO public.demurrage_dunning_claims (demurrage_invoice_id, attempt_discriminator)
    VALUES (v_invoice.id, v_invoice.attempt_discriminator)
    ON CONFLICT (demurrage_invoice_id, attempt_discriminator) DO UPDATE
      SET claimed_at = now(), released_at = NULL
      WHERE demurrage_dunning_claims.released_at IS NOT NULL
    RETURNING claimed_at INTO v_claimed_at;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 1 THEN
      v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
        'invoice_id', v_invoice.id, 'customer_id', v_invoice.customer_id, 'bl_id', v_invoice.bl_id,
        'doc_number', v_invoice.doc_number, 'total_usd', v_invoice.total_usd,
        'current_total_brl', v_invoice.current_total_brl, 'current_roe', v_invoice.current_roe,
        'roe_source', v_invoice.roe_source, 'first_billed_at', v_invoice.first_billed_at,
        'claimed_at', v_claimed_at, 'roe_reference_date', v_invoice.roe_reference_date,
        'attempt_discriminator', v_invoice.attempt_discriminator
      ));
    END IF;
  END LOOP;
  RETURN v_candidates;
END;
$function$;

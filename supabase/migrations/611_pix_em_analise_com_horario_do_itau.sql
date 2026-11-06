-- 611: Pix do Itaú que vai para análise pela fila de falhas fica com o horário real
--
-- Problema: `itau_pix_receipt_failed_core_425` (corpo da `471`) lia o horário do
-- retorno do Itaú terminado em Z como UTC. O Itaú manda Brasília com Z indevido
-- (contrato de 07/10/2026, docs/operations/servicos-externos.md), e a consulta
-- (`itauTimeToUtc`, supabase/functions/_shared/itauPix.ts) o lê assim. O Pix do
-- Vela gravado em análise por este caminho (formato inesperado, três falhas de
-- gravação) ficava com `paid_at` 3 h antes do real, e a baixa dele
-- (`itau_pix_settle_received`, migration `443`) usava esse horário: o Pix pago
-- entre 0h e 3h de Brasília caía no dia anterior. O Pix de fora do Vela gravado
-- como recebido por este caminho também ficava 3 h antes.
--
-- Mudança: a mesma leitura da consulta, inclusive a da decisão do dono de
-- 2026-11-06 (o horário com Z que, lido como Brasília, cairia mais de 5 min no
-- futuro é UTC de verdade e vale como veio). Offset explícito e horário sem fuso
-- seguem como antes.
--
-- Não altera nem apaga linhas existentes. Em produção, em 2026-11-06, nenhuma
-- linha de `itau_pix_receipts` tinha `paid_at` igual ao horário cru lido como
-- UTC: nenhum Pix tinha passado por este caminho com horário legível.
--
-- Rollback: reaplicar `itau_pix_receipt_failed_core_425` da `471`.

CREATE OR REPLACE FUNCTION public.itau_pix_receipt_failed_core_425(p_end_to_end_id text, p_txid text, p_raw jsonb, p_error text, p_permanent boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key text := coalesce(nullif(btrim(p_end_to_end_id), ''), 'raw:' || md5(coalesce(p_raw, '{}'::jsonb)::text));
  v_row public.itau_pix_receipt_failures%ROWTYPE;
  v_previous_role text := current_setting('request.jwt.claim.role', true);
  v_e2e text := nullif(btrim(p_end_to_end_id), '');
  v_txid text := coalesce(btrim(p_txid), '');
  v_origin text := public._itau_pix_origin(btrim(p_txid));
  v_amount numeric;
  v_paid_at timestamptz;
  v_horario text;
  v_reason text;
BEGIN
  INSERT INTO public.itau_pix_receipt_failures (failure_key, end_to_end_id, txid, raw, last_error)
  VALUES (v_key, v_e2e, nullif(v_txid, ''), coalesce(p_raw, '{}'::jsonb), left(coalesce(p_error, 'sem motivo'), 500))
  ON CONFLICT (failure_key) DO UPDATE
    SET attempts = itau_pix_receipt_failures.attempts + 1,
        last_error = EXCLUDED.last_error,
        raw = EXCLUDED.raw,
        updated_at = now()
  RETURNING * INTO v_row;

  IF v_row.status <> 'retrying' THEN RETURN 'review'; END IF;
  IF NOT coalesce(p_permanent, false) AND v_row.attempts < 3 THEN RETURN 'retry'; END IF;

  -- Valor e horário do retorno do Itaú, lido como na consulta (`itauTimeToUtc`,
  -- 611): o Z do Itaú é Brasília, salvo quando assim cairia mais de 5 min no
  -- futuro (então é UTC de verdade); offset explícito vale como veio; sem fuso,
  -- Brasília. Retorno ilegível fica só na fila de falhas.
  BEGIN
    v_amount := round((p_raw->>'valor')::numeric, 2);
    v_horario := btrim(p_raw->>'horario');
    v_paid_at := CASE
      WHEN v_horario ~ 'Z$' THEN
        CASE WHEN regexp_replace(v_horario, 'Z$', '-03:00')::timestamptz > now() + interval '5 minutes'
             THEN v_horario::timestamptz
             ELSE regexp_replace(v_horario, 'Z$', '-03:00')::timestamptz END
      WHEN v_horario ~ '[+-][0-9]{2}:?[0-9]{2}$' THEN v_horario::timestamptz
      ELSE (v_horario || '-03:00')::timestamptz END;
  EXCEPTION WHEN OTHERS THEN
    v_amount := NULL; v_paid_at := NULL;
  END;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  IF v_e2e ~ '^[A-Za-z0-9]{1,64}$' AND v_amount > 0 AND v_paid_at IS NOT NULL THEN
    -- Mesmo lock da baixa e do recebimento do mesmo Pix.
    PERFORM pg_advisory_xact_lock(hashtextextended('itau_pix_e2e:' || v_e2e, 0));
    v_reason := CASE WHEN v_origin = 'vela' THEN left('Não foi gravado depois de ' || v_row.attempts || ' tentativa(s): '
      || v_row.last_error || '. Confira no extrato e dê a baixa manual com o identificador do Pix.', 500) END;
    -- A cobrança do Vela liga o Pix à fatura: a baixa dela tira o Pix da análise.
    INSERT INTO public.itau_pix_receipts (end_to_end_id, txid, charge_id, amount_brl, paid_at, status, reason, raw)
    VALUES (v_e2e, v_txid, (SELECT ch.id FROM public.itau_pix_charges ch WHERE ch.txid = v_txid), v_amount, v_paid_at, CASE WHEN v_origin = 'vela' THEN 'review' ELSE 'received' END, v_reason, p_raw)
    ON CONFLICT (end_to_end_id) DO NOTHING;
    UPDATE public.itau_pix_receipt_failures SET status = 'handled', updated_at = now() WHERE failure_key = v_key;
    IF v_origin = 'vela' AND FOUND THEN
      PERFORM public.upsert_alert_item('pix_unreconciled', 'itau_pix_receipt', v_e2e,
        'Pix de R$ ' || to_char(v_amount, 'FM999G999G990D00') || ' recebido pelo Itaú (TXID ' || v_txid
          || ') não foi baixado automaticamente: ' || v_reason,
        'itau_pix', 'administrativo',
        jsonb_build_object('end_to_end_id', v_e2e, 'txid', v_txid, 'amount_brl', v_amount, 'error', v_row.last_error),
        '/reconciliacao');
    END IF;
  ELSE
    UPDATE public.itau_pix_receipt_failures SET status = 'review', updated_at = now() WHERE failure_key = v_key;
    -- Pix de fora do Vela não abre alerta (ADR 0100).
    IF v_origin = 'vela' THEN
      PERFORM public.upsert_alert_item('pix_unreconciled', 'itau_pix_receipt_failure', v_key,
        'Recebimento Itaú (TXID ' || coalesce(nullif(v_txid, ''), 'desconhecido')
          || ') não foi baixado depois de ' || v_row.attempts || ' tentativa(s): ' || v_row.last_error
          || '. Confira no extrato e dê a baixa manual; a consulta seguiu para os próximos.',
        'itau_pix', 'administrativo',
        jsonb_build_object('end_to_end_id', p_end_to_end_id, 'txid', p_txid, 'raw', p_raw, 'error', v_row.last_error),
        '/reconciliacao');
    END IF;
  END IF;
  PERFORM set_config('request.jwt.claim.role', coalesce(v_previous_role, ''), true);
  RETURN 'review';
END;
$function$;


-- Migration 307: avisos do Desbloqueio de CE registram simulação e abrem alerta.
--
-- Plano docs/plans/2026-10-17-correcao-dos-emails.md, itens 1F e 2.3.
--
-- 1. ce_unlock_email_outbox.status ganha:
--    * `simulated` (D11): com a chave Canal de envio real desligada, a Edge
--      resolve os destinatários, registra o envio simulado em
--      portal_email_attempts e fecha a linha. Não é enviado depois.
--    * `partial`: parte dos contatos da caixa recebeu e o restante está na
--      supressão do Portal (bounce/reclamação); não há o que tentar de novo.
--    `skipped` passa a significar só "nenhum destinatário" (sem contato na
--    caixa ou todos suprimidos).
-- 2. ce_unlock_email_finish aceita os estados novos e mantém o alerta
--    desbloqueio_ce_aviso_nao_enviado (Administrativo, D21), um por Cliente:
--    abre quando um aviso termina `skipped` ou `failed` e fecha quando um
--    aviso seguinte do mesmo Cliente sai (`sent`, `partial` ou `simulated`).
--    Falha ao gravar o alerta não desfaz o fechamento da linha.
--
-- Só amplia o CHECK e troca a função; não altera nem apaga linhas.

ALTER TABLE public.ce_unlock_email_outbox DROP CONSTRAINT ce_unlock_email_outbox_status_check;
ALTER TABLE public.ce_unlock_email_outbox ADD CONSTRAINT ce_unlock_email_outbox_status_check
  CHECK (status = ANY (ARRAY['pending', 'sent', 'partial', 'simulated', 'skipped', 'failed']));

INSERT INTO public.alert_type_catalog (type, severity, responsible_department, audience_departments, default_destination)
VALUES ('desbloqueio_ce_aviso_nao_enviado', 'normal', 'administrativo', ARRAY['administrativo'], '/clientes')
ON CONFLICT (type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ce_unlock_email_finish(p_id bigint, p_status text, p_done text[], p_error text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id bigint;
  v_customer_name text;
  v_kind text;
BEGIN
  IF p_status NOT IN ('pending', 'sent', 'partial', 'simulated', 'skipped', 'failed') THEN
    RAISE EXCEPTION 'Estado inválido';
  END IF;

  UPDATE public.ce_unlock_email_outbox
  SET status = p_status,
      done_recipients = coalesce(p_done, done_recipients),
      last_error = left(p_error, 300),
      attempts = attempts + 1,
      processed_at = CASE WHEN p_status = 'pending' THEN processed_at ELSE now() END
  WHERE id = p_id
  RETURNING customer_id, kind INTO v_customer_id, v_kind;

  IF v_customer_id IS NULL OR p_status = 'pending' THEN
    RETURN;
  END IF;

  BEGIN
    IF p_status IN ('skipped', 'failed') THEN
      SELECT c.name INTO v_customer_name FROM public.customers c WHERE c.id = v_customer_id;
      PERFORM public.upsert_alert_item(
        'desbloqueio_ce_aviso_nao_enviado',
        'customer',
        v_customer_id::text,
        'Cliente ' || coalesce(v_customer_name, v_customer_id::text) || ': aviso do Desbloqueio de CE não enviado. '
          || CASE WHEN p_status = 'skipped' THEN 'Nenhum destinatário: ' ELSE 'Falha de envio: ' END
          || coalesce(left(p_error, 300), 'sem motivo informado'),
        'ce_unlock_email',
        jsonb_build_object('customer_id', v_customer_id, 'outbox_id', p_id, 'kind', v_kind, 'status', p_status, 'reason', left(p_error, 300)),
        '/clientes'
      );
    ELSE
      PERFORM public.resolve_alert_item(
        'desbloqueio_ce_aviso_nao_enviado',
        'customer',
        v_customer_id::text,
        'ce_unlock_email',
        jsonb_build_object('outbox_id', p_id, 'status', p_status)
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Alerta desbloqueio_ce_aviso_nao_enviado da linha % nao gravado: %', p_id, SQLERRM;
  END;
END
$function$;

REVOKE ALL ON FUNCTION public.ce_unlock_email_finish(bigint, text, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ce_unlock_email_finish(bigint, text, text[], text) TO service_role;

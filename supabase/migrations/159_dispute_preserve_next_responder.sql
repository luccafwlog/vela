-- Run-2: preservar a proxima acao definida pela conversa; sincronizar o
-- lifecycle legado somente quando o estado da Invoice realmente muda.
-- Nao reescreve registros existentes.
CREATE OR REPLACE FUNCTION public.sync_demurrage_dispute_lifecycle_from_invoice() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_state TEXT;
  v_next_responder TEXT;
BEGIN
  -- A RPC da conversa ja definiu o proximo responsavel. UPDATE OF tambem
  -- dispara quando os valores sao iguais; nao sobrescrever essa decisao.
  IF TG_OP = 'UPDATE'
     AND NEW.dispute_open IS NOT DISTINCT FROM OLD.dispute_open
     AND NEW.dispute_status IS NOT DISTINCT FROM OLD.dispute_status THEN
    RETURN NEW;
  END IF;

  IF NEW.dispute_status = 'resolvido' THEN
    v_state := 'resolvida';
    v_next_responder := 'ninguem';
  ELSIF NEW.dispute_status = 'cancelado' THEN
    v_state := 'cancelada';
    v_next_responder := 'ninguem';
  ELSIF COALESCE(NEW.dispute_open, false) THEN
    v_state := 'aberta';
    v_next_responder := 'equipamentos';
  ELSE
    RETURN NEW;
  END IF;

  WITH target AS (
    SELECT id
    FROM public.demurrage_disputes
    WHERE demurrage_invoice_id = NEW.id
    ORDER BY CASE WHEN state = 'aberta' THEN 0 ELSE 1 END, id DESC
    LIMIT 1
  )
  UPDATE public.demurrage_disputes d
  SET state = v_state,
      next_responder = v_next_responder,
      resolved_at = CASE WHEN v_state = 'resolvida' THEN COALESCE(d.resolved_at, now()) ELSE NULL END,
      cancelled_at = CASE WHEN v_state = 'cancelada' THEN COALESCE(d.cancelled_at, now()) ELSE NULL END
  FROM target
  WHERE d.id = target.id;

  RETURN NEW;
END;
$$;

-- 419: cobrança Itaú reservada e não chamada volta sem contar tentativa
-- (auditoria de segurança run-3, nota de endurecimento).
--
-- Problema: itau_pix_claim (219) soma `attempts` e adia `next_attempt_at` de
-- todo o bloco reservado. Quando o runner para no meio do bloco (429 do Itaú ou
-- banco sem resposta), as cobranças seguintes do bloco não foram chamadas mas
-- ficam com uma tentativa a mais: o atraso cresce e o próximo envio passa pelo
-- ramo de consulta antes de gravar (`attempts > 0`).
--
-- Mudança: `itau_pix_release(p_ids)`, só do service_role, desfaz a reserva das
-- cobranças que o runner não chamou: devolve a tentativa e libera a vez já. O
-- runner chama ao parar no meio do bloco; sem a chamada (versão anterior da Edge
-- Function), a reserva vence sozinha como antes.
--
-- Só cria função; não reescreve nem apaga linhas.
-- Rollback: DROP FUNCTION public.itau_pix_release(bigint[]).

CREATE FUNCTION public.itau_pix_release(p_ids bigint[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.itau_pix_charges
     SET attempts = greatest(attempts - 1, 0), next_attempt_at = now(), updated_at = now()
   WHERE id = ANY(coalesce(p_ids, ARRAY[]::bigint[]))
     AND status IN ('pending_create', 'pending_update', 'pending_expire_check', 'pending_cancel')
     AND attempts > 0
     -- Só a reserva ainda vigente: a linha não foi registrada depois do claim.
     AND next_attempt_at > now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.itau_pix_release(bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itau_pix_release(bigint[]) TO service_role;

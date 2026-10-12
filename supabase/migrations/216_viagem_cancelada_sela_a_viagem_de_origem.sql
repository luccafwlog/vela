-- 216 — Viagem Cancelada: a linha também não SAI dela por UPDATE (revisão
-- final da PR 929).
--
-- `guard_voyage_cancelled_mutation` (da 066/190) resolvia a Viagem só pela
-- linha nova no UPDATE. Trocar `voyage_id` de um B/L, veículo, manifesto ou
-- agenda da Viagem Cancelada para uma Viagem ativa passava (um usuário ativo
-- faz isso direto pelo PostgREST em `bls`, cuja política só pede usuário
-- ativo). A 211 fechou o mesmo caminho nas tabelas que chegam à Viagem pelo
-- B/L ou pelo manifesto (`guard_voyage_cancelled_via_parent`); esta fecha nas
-- que guardam `voyage_id` direto. A exceção só-financeira continua valendo
-- para a linha que fica na Viagem.
--
-- Redefine a função a partir da definição efetiva (190). Não reescreve nem
-- apaga linhas existentes. Rollback: reaplicar a definição anterior.

CREATE OR REPLACE FUNCTION public.guard_voyage_cancelled_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_voyage_id bigint;
BEGIN
  -- Saída da Viagem Cancelada: a linha antiga também é conferida.
  IF TG_OP = 'UPDATE' AND OLD.voyage_id IS DISTINCT FROM NEW.voyage_id AND OLD.voyage_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.voyages WHERE id = OLD.voyage_id AND status = 'cancelled') THEN
    RAISE EXCEPTION 'Viagem % cancelada: operação selada e somente leitura.', OLD.voyage_id USING ERRCODE = '42501';
  END IF;
  v_voyage_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.voyage_id ELSE NEW.voyage_id END;
  IF v_voyage_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.voyages WHERE id = v_voyage_id AND status = 'cancelled') THEN
    IF TG_OP = 'UPDATE' THEN
      IF public._voyage_cancelled_financial_only(TG_TABLE_NAME, to_jsonb(OLD), to_jsonb(NEW)) THEN
        RETURN NEW;
      END IF;
    END IF;
    RAISE EXCEPTION 'Viagem % cancelada: operação selada e somente leitura.', v_voyage_id USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

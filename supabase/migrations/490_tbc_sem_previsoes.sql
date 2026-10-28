-- 490: Atracação TBC sem ETB e ETD (decisão do dono de 2026-10-28; ADR 0109).
--
-- A 482 recusou ATB, ATD e Restow na Atracação TBC e manteve ETB e ETD
-- estimados. Decisão do dono: TBC não é terminal, e a previsão de atracação
-- também é de um terminal. O banco passa a recusar ETB e ETD na Atracação TBC;
-- a previsão entra quando a frente ganha terminal. A Atracação TBC continua
-- existindo, sem datas, enquanto alguma frente está em TBC.
--
-- Data status: limpa ETB e ETD das Atracações TBC existentes. Depende da
-- afirmação "Data status" do AGENTS.md (2026-09-18): a produção não tem dados
-- reais de negócio.
--
-- Rollback: reaplicar `guard_tbc_sem_datas_realizadas` e o gatilho
-- `trg_tbc_sem_datas_realizadas` da `482`. As previsões apagadas não voltam.

-- Viagem cancelada fica como está: está selada (guard_voyage_cancelled_mutation).
UPDATE public.voyage_escala_terminal_state AS s
SET terminal_etb = NULL, terminal_etd = NULL
WHERE s.terminal_id IS NULL
  AND (s.terminal_etb IS NOT NULL OR s.terminal_etd IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM public.voyages v WHERE v.id = s.voyage_id AND v.status = 'cancelled');

CREATE OR REPLACE FUNCTION public.guard_tbc_sem_datas_realizadas()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.terminal_id IS NULL
     AND (NEW.terminal_etb IS NOT NULL OR NEW.terminal_etd IS NOT NULL
       OR NEW.terminal_atb IS NOT NULL OR NEW.terminal_atd IS NOT NULL OR NEW.terminal_rtw IS NOT NULL) THEN
    RAISE EXCEPTION 'TBC não é terminal: ETB, ETD, ATB, ATD e Restow só na atracação de um terminal. Escolha o terminal antes de informar as datas.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_tbc_sem_datas_realizadas() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tbc_sem_datas_realizadas ON public.voyage_escala_terminal_state;
CREATE TRIGGER trg_tbc_sem_datas_realizadas
  BEFORE INSERT OR UPDATE OF terminal_id, terminal_etb, terminal_etd, terminal_atb, terminal_atd, terminal_rtw
  ON public.voyage_escala_terminal_state
  FOR EACH ROW EXECUTE FUNCTION public.guard_tbc_sem_datas_realizadas();

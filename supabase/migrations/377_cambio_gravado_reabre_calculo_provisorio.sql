-- 377: câmbio gravado reabre o cálculo provisório bloqueado por falta dele
-- (revisão das importações, item 2c; plano da frente financeira, F-29).
--
-- Problema: a importação de B/L sem câmbio (ROE) configurado bloqueia o efeito
-- `provisional_charges` na primeira tentativa (22023 é permanente na fila,
-- `178`) e ele não volta quando o câmbio é gravado: o B/L fica sem cálculo
-- até alguém reabrir o efeito à mão.
--
-- Mudança: gravar o câmbio (`exchange_rate_reference`) reabre esses efeitos,
-- como `retry_import_effect`, com o motivo no resultado do efeito.
--
-- Não altera nem apaga linhas existentes na aplicação da migration; o gatilho
-- só reabre efeitos quando o câmbio muda.

CREATE OR REPLACE FUNCTION public.reopen_effects_blocked_by_missing_roe()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.roe IS NULL OR NEW.roe <= 0 THEN RETURN NULL; END IF;
  UPDATE public.import_pending_effects
     SET status = 'retry_wait',
         attempts = 0,
         next_attempt_at = now(),
         lease_until = NULL,
         leased_by = NULL,
         last_error_code = NULL,
         last_error_message = NULL,
         result = coalesce(result, '{}'::jsonb) || jsonb_build_object('reopened_by', 'exchange_rate_saved'),
         updated_at = now()
   WHERE status = 'blocked'
     AND effect_kind = 'provisional_charges'
     AND last_error_message ~* '(cambio|câmbio).*\(ROE\).*configurado';
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.reopen_effects_blocked_by_missing_roe() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER reopen_effects_blocked_by_missing_roe
  AFTER INSERT OR UPDATE OF roe ON public.exchange_rate_reference
  FOR EACH ROW EXECUTE FUNCTION public.reopen_effects_blocked_by_missing_roe();

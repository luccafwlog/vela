-- 348: o alerta "Efeito de importação bloqueado" fecha quando o efeito sai de
-- bloqueado (revisão dos alertas de 2026-10-21, docs/revisao-alertas-2026-10.md;
-- L8 do estudo docs/archive/audits/2026-10-20-auto-resolucao-de-alertas.md).
--
-- Problema: `_record_import_effect_blocked_alert` (025) abre o item
-- `import_effect_blocked` quando o efeito bloqueia, e nenhuma função o fecha.
-- `retry_import_effect` (252), a reabertura com justificativa que o manual de
-- regras apresenta como fim do alerta ("permanece até o operador revisar e
-- reabrir a fila com justificativa"), só muda o efeito para `retry_wait` e grava
-- o audit; o efeito concluído depois também não fecha. O único fechamento na
-- cadeia é o pontual da 325. O alerta ficava aberto para sempre.
--
-- Mudança: gatilho em `import_pending_effects` quando o status sai de
-- `blocked` (reabertura pelo operador, conclusão ou descarte): resolve o item
-- do efeito. Se o efeito bloquear de novo, `_record_import_effect_blocked_alert`
-- reabre o item com nova ocorrência (e nova Notificação Interna). Falha ao
-- resolver não desfaz a reabertura do efeito: vira WARNING, como no produtor.
--
-- Só cria função e gatilho; não reescreve nem apaga linhas. Itens abertos de
-- efeitos que já saíram de bloqueado ficam como estão e aparecem em
-- supabase/scripts/consistencia_alertas.sql (verificação 14).
-- Rollback: DROP TRIGGER resolve_import_effect_blocked_alert_on_exit ON
-- public.import_pending_effects; DROP FUNCTION
-- public.resolve_import_effect_blocked_alert_on_exit().

CREATE OR REPLACE FUNCTION public.resolve_import_effect_blocked_alert_on_exit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  BEGIN
    PERFORM public.resolve_alert_item(
      'import_effect_blocked', 'import_effect', NEW.id::text,
      'import_effect_' || NEW.status,
      jsonb_build_object('effect_id', NEW.id, 'effect_kind', NEW.effect_kind, 'status', NEW.status)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Não foi possível fechar o alerta do efeito %: %', NEW.id, SQLERRM;
  END;
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_import_effect_blocked_alert_on_exit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS resolve_import_effect_blocked_alert_on_exit ON public.import_pending_effects;
CREATE TRIGGER resolve_import_effect_blocked_alert_on_exit
  AFTER UPDATE OF status ON public.import_pending_effects
  FOR EACH ROW
  WHEN (OLD.status = 'blocked' AND NEW.status IS DISTINCT FROM 'blocked')
  EXECUTE FUNCTION public.resolve_import_effect_blocked_alert_on_exit();

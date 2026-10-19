-- Migration 321: remove o job portal-refresh-general-pendencies e a função
-- portal_refresh_general_pendencies(), que duplicavam a pendência geral do
-- Portal.
--
-- Desde os alertas por item, reconcile_client_portal_alerts() (chamado por
-- run_alert_detectors()) abre a pendência como alerta agrupado
-- (alerts.type = 'aggregate' + alert_items.item_type = 'portal_pendencia_geral').
-- O job, a cada 15 minutos, inseria outro alerta antigo
-- (alerts.type = 'portal_pendencia_geral', sem item, sem setor e sem dispensa)
-- porque o NOT EXISTS dele só procurava o tipo antigo. Em produção isso gerou
-- 1549 alertas antigos contra 2 agrupados (consulta de 2026-10-19). Regra em
-- docs/modules/portal-cliente.md, "Pendência geral de prontidão".
--
-- Fecha os alertas antigos ainda abertos: esta migration reescreve linhas
-- existentes e depende do "Data status" do AGENTS.md (o banco de produção não
-- tem dados de negócio). A pendência real continua no reconciliador.

DO $unschedule$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'portal-refresh-general-pendencies') THEN
    PERFORM cron.unschedule('portal-refresh-general-pendencies');
  END IF;
END;
$unschedule$;

DROP FUNCTION IF EXISTS public.portal_refresh_general_pendencies();

UPDATE public.alerts
SET status = 'closed', closed_at = now()
WHERE type = 'portal_pendencia_geral'
  AND status <> 'closed';

-- 625: B/L que fica pronto depois do Comunicado de CE e Taxas abre o alerta de
-- reenvio (decisão 7 do dono de 2026-11-07; ADR 0134, lote D do plano
-- 2026-11-07-brechas-restantes-da-revisao-dos-alertas).
--
-- O Comunicado de CE e Taxas sai uma vez por Cliente e Viagem. O B/L que entra
-- depois na mesma Viagem e fica pronto (CE, Revisão concluída, faturado ou
-- isento; a mesma conta de `customer_local_charges_communication_readiness`)
-- nunca era comunicado, e nada avisava (brecha B13). Agora ele abre o alerta
-- **Reenviar Comunicado de CE e Taxas** (`comunicado_ce_reenvio_pendente`,
-- Normal, Documentação), por B/L, que já fecha sozinho quando um Comunicado
-- de CE e Taxas com o B/L sai (gatilho da 469). A pessoa decide reenviar.
-- A rotina `ce-taxas-late-bl-alerts` (15 minutos) abre.
-- ponytail: só Comunicados dos últimos 60 dias contam, para não abrir de uma
-- vez para Viagens antigas; upgrade: data de corte própria.
--
-- Plano de preservação: a migration só acrescenta funções e uma rotina; não
-- reescreve nem apaga linha existente. Conferir: `SELECT count(*) FROM
-- alert_items WHERE item_type = 'comunicado_ce_reenvio_pendente' AND
-- metadata->>'reason_code' = 'bl_pronto_depois'` depois da primeira rodada.
-- Desfazer: o rollback abaixo; os alertas abertos fecham com justificativa ou
-- no reenvio.
--
-- Rollback: `cron.unschedule('ce-taxas-late-bl-alerts')` e dropar
-- `reconcile_ce_taxas_late_bl_alerts`.

CREATE OR REPLACE FUNCTION public.reconcile_ce_taxas_late_bl_alerts(p_source text DEFAULT 'ce-taxas-late-bl-alerts')
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  v_count integer := 0;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  FOR r IN
    SELECT b.id AS bl_id, last_comm.created_at AS sent_at
    FROM public.bls b
    JOIN LATERAL (
      SELECT max(c.created_at) AS created_at
      FROM public.customer_communications c
      WHERE c.kind = 'ce_mercante_taxas'
        AND c.status IN ('enviado', 'parcial', 'simulado')
        AND c.customer_id = b.customer_id
        AND c.anchor_voyage_id = b.voyage_id
        AND c.created_at >= now() - interval '60 days'
    ) last_comm ON last_comm.created_at IS NOT NULL
    WHERE b.cancelled_at IS NULL
      AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
      AND NULLIF(btrim(b.ce_mercante), '') IS NOT NULL
      AND COALESCE(b.review_status, '') <> 'pending_review'
      AND NOT (COALESCE(b.cargo_mode, 'container') IN ('carga_solta', 'misto') AND COALESCE(b.bb_weight_ton, 0) <= 0)
      AND (COALESCE(b.financial_status, 'pending') IN ('invoiced', 'paid') OR b.charge_status = 'exempt')
      -- Ainda não foi em nenhum Comunicado de CE e Taxas enviado.
      AND NOT EXISTS (
        SELECT 1 FROM public.customer_communication_bls cb
        JOIN public.customer_communications c ON c.id = cb.communication_id
        WHERE cb.bl_id = b.id AND c.kind = 'ce_mercante_taxas' AND c.status IN ('enviado', 'parcial', 'simulado'))
      AND NOT EXISTS (
        SELECT 1 FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
        WHERE a.entity_type = 'bl' AND a.entity_id = b.id
          AND i.item_type = 'comunicado_ce_reenvio_pendente' AND i.status = 'active')
  LOOP
    PERFORM public.upsert_alert_item(
      'comunicado_ce_reenvio_pendente', 'bl', r.bl_id,
      format('O B/L %s ficou pronto depois do Comunicado de CE e Taxas de %s: o Cliente não recebeu o CE nem o valor dele. Reenvie o Comunicado.',
        r.bl_id, to_char(r.sent_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')),
      p_source,
      jsonb_build_object('bl_id', r.bl_id, 'reason_code', 'bl_pronto_depois', 'communication_sent_at', r.sent_at),
      '/bls/' || r.bl_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_ce_taxas_late_bl_alerts(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_ce_taxas_late_bl_alerts(text) TO service_role;

DO $schedule_625$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE WARNING '625: pg_cron ausente; agende ce-taxas-late-bl-alerts no ambiente de produção.';
    RETURN;
  END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ce-taxas-late-bl-alerts';
  PERFORM cron.schedule('ce-taxas-late-bl-alerts', '14-59/15 * * * *',
    $cmd_625$SELECT public.reconcile_ce_taxas_late_bl_alerts('ce-taxas-late-bl-alerts');$cmd_625$);
END;
$schedule_625$;

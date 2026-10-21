-- Consistência dos alertas com o estado real das entidades (somente leitura).
--
-- Revisão dos alertas de 2026-10-21 (docs/revisao-alertas-2026-10.md, seção
-- "Consultas de consistência"). Cada consulta devolve as linhas em que um
-- alerta aberto contradiz o dado de origem; zero linhas é o esperado.
--
-- Como rodar (staging ou produção, pelo SQL Editor ou psql):
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f supabase/scripts/consistencia_alertas.sql
-- O arquivo abre uma transação READ ONLY e termina em ROLLBACK: não grava nada.
-- Não lê segredo nem dado pessoal além do identificador do registro.
--
-- Valem para o schema da cadeia ativa até a migration 345; as consultas não
-- dependem das funções criadas pelas correções da revisão (346 em diante).
-- As consultas 19 a 21 leem `net._http_response` e `cron.job_run_details`, que
-- só existem no Supabase: no Postgres local do replay, pare antes da 19.

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';

-- Cada consulta parte dos itens ativos (`itens_ativos`) com a chave da
-- entidade do alerta. O CTE se repete porque a transação somente leitura não
-- aceita CREATE, nem de objeto temporário.

-- 0. Resumo: quantas linhas cada verificação abaixo devolve.
WITH itens_ativos AS (
  SELECT i.id AS item_id, i.item_type, a.id AS alert_id, a.entity_type, a.entity_id,
         i.metadata, i.created_at, i.updated_at
  FROM public.alert_items i
  JOIN public.alerts a ON a.id = i.alert_id
  WHERE i.status = 'active'
), checks AS (
  SELECT '01 alerta de viagem/escala sem a viagem' AS verificacao, count(*) AS linhas
  FROM itens_ativos t
  WHERE t.entity_type LIKE 'voyage%'
    AND NOT EXISTS (SELECT 1 FROM public.voyages v WHERE v.id::text = split_part(t.entity_id, '::', 1))
  UNION ALL
  SELECT '02 alerta de B/L sem o B/L', count(*)
  FROM itens_ativos t
  WHERE t.entity_type = 'bl' AND NOT EXISTS (SELECT 1 FROM public.bls b WHERE b.id = t.entity_id)
  UNION ALL
  SELECT '03 alerta de Cliente (id) sem o Cliente', count(*)
  FROM itens_ativos t
  WHERE t.entity_type = 'customer' AND t.entity_id ~ '^[0-9]+$'
    AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id::text = t.entity_id)
  UNION ALL
  SELECT '04 alerta de fatura/invoice sem o documento', count(*)
  FROM itens_ativos t
  WHERE (t.entity_type = 'invoice' AND NOT EXISTS (SELECT 1 FROM public.invoices x WHERE x.id::text = t.entity_id))
     OR (t.entity_type = 'demurrage_invoice' AND NOT EXISTS (SELECT 1 FROM public.demurrage_invoices x WHERE x.id::text = t.entity_id))
  UNION ALL
  SELECT '05 Baplie ausente com Baplie importado', count(*)
  FROM itens_ativos t
  WHERE t.item_type = 'voyage_baplie_missing'
    AND EXISTS (SELECT 1 FROM public.baplie_containers bc WHERE bc.voyage_id::text = t.entity_id)
  UNION ALL
  SELECT '06 alerta aberto de viagem cancelada', count(*)
  FROM itens_ativos t
  JOIN public.voyages v ON v.id::text = split_part(t.entity_id, '::', 1)
  WHERE t.entity_type LIKE 'voyage%' AND v.status = 'cancelled'
  UNION ALL
  SELECT '07 B/Ls esperados com todo POD da escala coberto', count(*)
  FROM itens_ativos t
  WHERE t.item_type = 'voyage_bl_expected'
    AND EXISTS (SELECT 1 FROM public.bls b WHERE b.voyage_id::text = t.entity_id AND b.cancelled_at IS NULL)
    AND NOT EXISTS (
      SELECT 1 FROM public.get_voyage_eligible_pods(CASE WHEN t.entity_id ~ '^[0-9]+$' THEN t.entity_id::bigint END) e
      WHERE NOT EXISTS (
        SELECT 1 FROM public.bls b
        WHERE b.voyage_id::text = t.entity_id AND b.cancelled_at IS NULL
          AND COALESCE(public.normalize_port_code(b.pod), upper(btrim(b.pod))) = COALESCE(public.normalize_port_code(e.pod), e.pod)))
  UNION ALL
  SELECT '08 CE Mercante pendente sem B/L vivo sem CE e sem rota de vazios', count(*)
  FROM itens_ativos t
  WHERE t.item_type = 'voyage_ce_mercante_missing'
    AND NOT EXISTS (
      SELECT 1 FROM public.bls b
      WHERE b.voyage_id::text = t.entity_id AND b.cancelled_at IS NULL
        AND NULLIF(btrim(b.ce_mercante), '') IS NULL)
    AND COALESCE((t.metadata->>'missing_vazios_manifest_count')::int, 0) = 0
  UNION ALL
  SELECT '09 exportação pós-ATD sem exportação planejada ou sem ATD no porto', count(*)
  FROM itens_ativos t
  WHERE t.item_type = 'voyage_export_after_atd'
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.voyage_export_schedules e
        WHERE e.voyage_id::text = split_part(t.entity_id, '::', 1)
          AND upper(btrim(e.pol)) = split_part(t.entity_id, '::', 2)
          AND e.tem_exportacao)
      OR NOT EXISTS (
        SELECT 1 FROM public.voyage_escala_terminal_state s
        WHERE s.voyage_id::text = split_part(t.entity_id, '::', 1)
          AND s.port = split_part(t.entity_id, '::', 2)
          AND s.terminal_atd IS NOT NULL))
  UNION ALL
  SELECT '10 exportação pós-ATD com o manifesto exigido já vinculado', count(*)
  FROM itens_ativos t
  JOIN public.voyage_export_schedules e
    ON e.voyage_id::text = split_part(t.entity_id, '::', 1) AND upper(btrim(e.pol)) = split_part(t.entity_id, '::', 2)
  WHERE t.item_type = 'voyage_export_after_atd'
    AND (NOT COALESCE(e.has_granite, false) OR EXISTS (SELECT 1 FROM public.granite_manifests g WHERE g.voyage_id = e.voyage_id))
    AND (NOT COALESCE(e.has_empty, false) OR EXISTS (SELECT 1 FROM public.vazios_manifests m WHERE m.voyage_id = e.voyage_id))
  UNION ALL
  SELECT '11 alerta de faturamento de B/L já faturado, pago ou cancelado', count(*)
  FROM itens_ativos t
  JOIN public.bls b ON b.id = t.entity_id
  WHERE t.entity_type = 'bl'
    AND t.item_type IN ('billing_calculation_blocked', 'billing_auto_issue_failed')
    AND (b.cancelled_at IS NOT NULL OR b.financial_status IN ('invoiced', 'paid'))
  UNION ALL
  SELECT '12 pendência do Portal para Cliente sem B/L vivo', count(*)
  FROM itens_ativos t
  WHERE t.entity_type = 'customer' AND t.entity_id ~ '^[0-9]+$'
    AND t.item_type IN ('portal_pendencia_geral', 'portal_convite_expirado', 'portal_falha_envio', 'portal_email_suprimido')
    AND NOT EXISTS (
      SELECT 1 FROM public.bls b
      WHERE b.customer_id::text = t.entity_id AND b.cancelled_at IS NULL
        AND b.financial_status IS DISTINCT FROM 'cancelled')
  UNION ALL
  SELECT '13 exceção crítica de fatura com a fatura paga, coberta ou cancelada', count(*)
  FROM itens_ativos t
  JOIN public.invoices i ON i.id::text = t.metadata->>'invoice_id'
  WHERE t.item_type = 'portal_excecao_critica_fatura'
    AND i.status IN ('paid', 'partially_paid', 'covered', 'cancelled', 'obsolete')
  UNION ALL
  SELECT '14 efeito de importação bloqueado que já não está bloqueado', count(*)
  FROM itens_ativos t
  LEFT JOIN public.import_pending_effects e ON e.id::text = t.entity_id
  WHERE t.item_type = 'import_effect_blocked' AND (e.id IS NULL OR e.status <> 'blocked')
  UNION ALL
  SELECT '15 B/L sem Cliente sem nenhum B/L pendente do consignatário', count(*)
  FROM itens_ativos t
  WHERE t.item_type = 'review_customer_unlinked'
    AND NOT EXISTS (
      SELECT 1 FROM public.bls b
      WHERE b.customer_id IS NULL AND b.review_status = 'pending_review' AND b.cancelled_at IS NULL
        AND COALESCE(NULLIF(btrim(b.consignee), ''), 'sem_cliente') = t.entity_id)
  UNION ALL
  SELECT '16 agregado aberto sem item ativo ou fechado com item ativo', count(*)
  FROM public.alerts a
  WHERE a.type = 'aggregate'
    AND ((a.status <> 'closed' AND NOT EXISTS (SELECT 1 FROM public.alert_items i WHERE i.alert_id = a.id AND i.status = 'active'))
      OR (a.status = 'closed' AND EXISTS (SELECT 1 FROM public.alert_items i WHERE i.alert_id = a.id AND i.status = 'active')))
  UNION ALL
  SELECT '17 item ativo de tipo desativado no catálogo', count(*)
  FROM itens_ativos t
  JOIN public.alert_type_catalog c ON c.type = t.item_type
  WHERE NOT c.active
  UNION ALL
  SELECT '18 item que abriu mais de 3 vezes nas últimas 24 h (pisca)', count(*)
  FROM (
    SELECT e.alert_item_id
    FROM public.alert_item_events e
    WHERE e.event_type = 'opened' AND e.created_at > now() - interval '24 hours'
    GROUP BY e.alert_item_id
    HAVING count(*) > 3
  ) x
)
SELECT verificacao, linhas FROM checks ORDER BY verificacao;

-- Detalhe das verificações que devolveram linhas. Cada bloco repete o filtro
-- da linha do resumo e mostra o registro para conferência.

-- 01/02/03/04: alertas órfãos.
WITH itens_ativos AS (
  SELECT i.id AS item_id, i.item_type, a.id AS alert_id, a.entity_type, a.entity_id,
         i.metadata, i.created_at, i.updated_at
  FROM public.alert_items i
  JOIN public.alerts a ON a.id = i.alert_id
  WHERE i.status = 'active'
)
SELECT t.item_type, t.entity_type, t.entity_id, t.created_at
FROM itens_ativos t
WHERE (t.entity_type LIKE 'voyage%'
       AND NOT EXISTS (SELECT 1 FROM public.voyages v WHERE v.id::text = split_part(t.entity_id, '::', 1)))
   OR (t.entity_type = 'bl' AND NOT EXISTS (SELECT 1 FROM public.bls b WHERE b.id = t.entity_id))
   OR (t.entity_type = 'customer' AND t.entity_id ~ '^[0-9]+$'
       AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id::text = t.entity_id))
   OR (t.entity_type = 'invoice' AND NOT EXISTS (SELECT 1 FROM public.invoices x WHERE x.id::text = t.entity_id))
   OR (t.entity_type = 'demurrage_invoice' AND NOT EXISTS (SELECT 1 FROM public.demurrage_invoices x WHERE x.id::text = t.entity_id))
ORDER BY t.entity_type, t.entity_id, t.item_type;

-- 05/06: viagem com Baplie e alerta "Baplie ausente"; alertas de viagem cancelada.
WITH itens_ativos AS (
  SELECT i.id AS item_id, i.item_type, a.id AS alert_id, a.entity_type, a.entity_id,
         i.metadata, i.created_at, i.updated_at
  FROM public.alert_items i
  JOIN public.alerts a ON a.id = i.alert_id
  WHERE i.status = 'active'
)
SELECT t.item_type, t.entity_id, v.status AS viagem,
       (SELECT count(*) FROM public.baplie_containers bc WHERE bc.voyage_id = v.id) AS containers_baplie
FROM itens_ativos t
JOIN public.voyages v ON v.id::text = split_part(t.entity_id, '::', 1)
WHERE t.entity_type LIKE 'voyage%'
  AND (v.status = 'cancelled'
       OR (t.item_type = 'voyage_baplie_missing' AND EXISTS (SELECT 1 FROM public.baplie_containers bc WHERE bc.voyage_id = v.id)))
ORDER BY v.id, t.item_type;

-- 06b: alertas de viagem concluída (o detector anterior à 346 não os reavalia).
WITH itens_ativos AS (
  SELECT i.id AS item_id, i.item_type, a.id AS alert_id, a.entity_type, a.entity_id,
         i.metadata, i.created_at, i.updated_at
  FROM public.alert_items i
  JOIN public.alerts a ON a.id = i.alert_id
  WHERE i.status = 'active'
)
SELECT t.item_type, t.entity_id, t.updated_at AS ultima_reconciliacao
FROM itens_ativos t
JOIN public.voyages v ON v.id::text = split_part(t.entity_id, '::', 1)
WHERE t.entity_type LIKE 'voyage%' AND v.status = 'completed'
ORDER BY t.updated_at;

-- 11/12/13/14: faturamento, Portal e efeitos de importação.
WITH itens_ativos AS (
  SELECT i.id AS item_id, i.item_type, a.id AS alert_id, a.entity_type, a.entity_id,
         i.metadata, i.created_at, i.updated_at
  FROM public.alert_items i
  JOIN public.alerts a ON a.id = i.alert_id
  WHERE i.status = 'active'
)
SELECT t.item_type, t.entity_type, t.entity_id,
       b.financial_status, b.cancelled_at IS NOT NULL AS bl_cancelado
FROM itens_ativos t
LEFT JOIN public.bls b ON t.entity_type = 'bl' AND b.id = t.entity_id
WHERE (t.item_type IN ('billing_calculation_blocked', 'billing_auto_issue_failed')
       AND (b.cancelled_at IS NOT NULL OR b.financial_status IN ('invoiced', 'paid')))
   OR (t.item_type IN ('portal_pendencia_geral', 'portal_convite_expirado', 'portal_falha_envio', 'portal_email_suprimido')
       AND t.entity_id ~ '^[0-9]+$'
       AND NOT EXISTS (SELECT 1 FROM public.bls x WHERE x.customer_id::text = t.entity_id
                       AND x.cancelled_at IS NULL AND x.financial_status IS DISTINCT FROM 'cancelled'))
   OR (t.item_type = 'import_effect_blocked'
       AND NOT EXISTS (SELECT 1 FROM public.import_pending_effects e WHERE e.id::text = t.entity_id AND e.status = 'blocked'))
ORDER BY t.item_type, t.entity_id;

-- 18: itens que piscam (abriram mais de 3 vezes em 24 h).
SELECT i.item_type, a.entity_type, a.entity_id, count(*) AS aberturas_24h, i.status AS status_agora
FROM public.alert_item_events e
JOIN public.alert_items i ON i.id = e.alert_item_id
JOIN public.alerts a ON a.id = i.alert_id
WHERE e.event_type = 'opened' AND e.created_at > now() - interval '24 hours'
GROUP BY i.item_type, a.entity_type, a.entity_id, i.status
HAVING count(*) > 3
ORDER BY count(*) DESC;

-- 19: chamadas HTTP dos jobs (pg_net) com resposta diferente de 2xx nas
-- últimas 24 h. `cron.job_run_details` marca a chamada como `succeeded` assim
-- que ela entra na fila; o status real fica aqui. A resposta não traz a URL:
-- compare o horário com `cron.job_run_details` (consulta 20).
SELECT date_trunc('hour', r.created) AS hora, r.status_code, r.timed_out, count(*) AS respostas,
       left(min(r.error_msg), 120) AS exemplo_de_erro
FROM net._http_response r
WHERE r.created > now() - interval '24 hours'
  AND (r.timed_out OR r.status_code IS NULL OR r.status_code NOT BETWEEN 200 AND 299)
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 2;

-- 20: execuções de job que o próprio pg_cron marcou como falha nas últimas
-- 24 h (jobs só de SQL, como data-retention e portal-mark-expired-invites, não
-- passam pelo pg_net e não aparecem na consulta 19).
SELECT j.jobname, d.status, count(*) AS execucoes, max(d.start_time) AS ultima,
       left(max(d.return_message), 160) AS mensagem
FROM cron.job_run_details d
JOIN cron.job j ON j.jobid = d.jobid
WHERE d.start_time > now() - interval '24 hours' AND d.status <> 'succeeded'
GROUP BY j.jobname, d.status
ORDER BY ultima DESC;

-- 21: jobs ativos sem execução registrada no dobro do intervalo esperado
-- (aproximação: compara com a última execução de qualquer status).
SELECT j.jobname, j.schedule, j.active, max(d.start_time) AS ultima_execucao
FROM cron.job j
LEFT JOIN cron.job_run_details d ON d.jobid = j.jobid
GROUP BY j.jobname, j.schedule, j.active
ORDER BY ultima_execucao NULLS FIRST;

ROLLBACK;

-- 352: alerta "B/L sem Cliente perto do ETA" (revisão dos alertas de
-- 2026-10-21, docs/revisao-alertas-2026-10.md, sugestão S7 e decisão P4 do
-- Lucca: 5 dias).
--
-- Problema: `review_customer_unlinked` avisa o B/L em revisão sem Cliente, mas
-- não olha o prazo. Um B/L que chega a dias da atracação sem Cliente não pode
-- ser faturado nem comunicado, e nada distingue esse caso do B/L importado com
-- semanas de folga.
--
-- Mudança:
--   1. Tipo `bl_sem_cliente_perto_eta` no catálogo: crítico, Documentação.
--   2. `reconcile_bl_sem_cliente_perto_eta_alerts(viagem)`: um alerta por
--      escala (`voyage_pod_schedule` / `<viagem>::<porto>`, porto normalizado,
--      como os Comunicados) quando há B/L vivo (`cancelled_at IS NULL`) sem
--      Cliente com POD na escala e o ETA da escala (dia de Brasília, audit da
--      escala lido por `customer_communication_scale_schedules`, o parser
--      seguro dos Comunicados) está a 5 dias ou menos de hoje, inclusive ETA
--      já passado. Escala excluída ou omitida e viagem cancelada não contam.
--      A mensagem e o metadata listam os B/Ls e os consignatários.
--   3. Fecha na hora do fato: gatilhos de restrição adiados (fim da
--      transação) em `bls` (B/L sem Cliente criado, excluído, vinculado,
--      cancelado, trocado de viagem ou de POD), no audit da escala (ETA,
--      exclusão, omissão) e no status da viagem. Cada viagem é reconciliada
--      uma vez por transação, com o estado final: a importação em lote não
--      repete a conta por B/L. O mesmo reconcile abre na hora o B/L que entra
--      sem Cliente numa escala já dentro do prazo. Falha no alerta não desfaz
--      a gravação de origem (WARNING).
--   4. A passagem do tempo (o ETA ficou a 5 dias sem nenhuma gravação) abre
--      pelo detector: `detect_bl_review_pendencies()` (rodada de 15 minutos)
--      reconcilia as viagens com B/L sem Cliente e as que têm o alerta aberto.
--
-- Só cria tipo, funções e gatilhos e redefine `detect_bl_review_pendencies`
-- (definição da migration 002 com o passo 5); não reescreve nem apaga linhas.
-- As escalas que já estão no prazo abrem na primeira rodada do detector.
--
-- ponytail: a reconciliação adiada guarda as viagens já feitas numa GUC da
-- transação (`alerts.bl_sem_cliente_eta_done`). Um gatilho adiado de outra
-- tabela que mudasse Cliente, cancelamento, viagem ou POD de um B/L no próprio
-- COMMIT, depois da conta, ficaria para o detector (até 15 min). Nenhum faz
-- isso hoje; o upgrade é marcar a viagem como suja em vez de feita.
--
-- Rollback: DROP TRIGGER bl_sem_cliente_perto_eta_on_bls_insert,
-- bl_sem_cliente_perto_eta_on_bls_update e bl_sem_cliente_perto_eta_on_bls_delete
-- ON public.bls; DROP TRIGGER bl_sem_cliente_perto_eta_on_audit ON
-- public.audit_logs; DROP TRIGGER bl_sem_cliente_perto_eta_on_voyage ON
-- public.voyages; DROP das funções criadas aqui; reaplicar
-- `detect_bl_review_pendencies` da migration 002; `UPDATE
-- public.alert_type_catalog SET active = false WHERE type =
-- 'bl_sem_cliente_perto_eta'` (os itens referenciam o tipo por FK).

-- 1 -------------------------------------------------------------------------
INSERT INTO public.alert_type_catalog (type, severity, responsible_department, audience_departments, default_destination)
VALUES ('bl_sem_cliente_perto_eta', 'critical', 'documentacao', ARRAY['documentacao'], '/revisao?causa=cliente')
ON CONFLICT (type) DO NOTHING;

-- 2 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_bl_sem_cliente_perto_eta_alerts(
  p_voyage_id bigint,
  p_source text DEFAULT 'bl_sem_cliente_perto_eta'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- Decisão P4 (2026-10-21): o alerta abre a 5 dias do ETA da escala.
  v_limit date := (now() AT TIME ZONE 'America/Sao_Paulo')::date + 5;
  v_status text;
  v_scale record;
  v_open text[] := ARRAY[]::text[];
  v_entity text;
  v_list text;
BEGIN
  IF p_voyage_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT v.status INTO v_status FROM public.voyages v WHERE v.id = p_voyage_id;

  IF FOUND AND v_status IS DISTINCT FROM 'cancelled' THEN
    FOR v_scale IN
      WITH scales AS (
        SELECT s.port, (s.eta AT TIME ZONE 'America/Sao_Paulo')::date AS eta_day
        FROM public.customer_communication_scale_schedules(p_voyage_id, NULL) s
        WHERE NOT s.deleted
          AND NOT COALESCE(s.omitted, false)
          AND s.eta IS NOT NULL
          AND (s.eta AT TIME ZONE 'America/Sao_Paulo')::date <= v_limit
      )
      SELECT sc.port, sc.eta_day,
        count(*) AS bl_count,
        array_agg(b.id ORDER BY b.id) AS bl_ids,
        jsonb_agg(jsonb_build_object('bl_id', b.id, 'consignee', NULLIF(btrim(b.consignee), '')) ORDER BY b.id) AS bls
      FROM scales sc
      JOIN public.bls b
        ON b.voyage_id = p_voyage_id
       AND b.cancelled_at IS NULL
       AND b.customer_id IS NULL
       AND public.normalize_port_code(b.pod) = sc.port
      GROUP BY sc.port, sc.eta_day
      ORDER BY sc.port
    LOOP
      v_entity := p_voyage_id::text || '::' || v_scale.port;
      v_open := array_append(v_open, v_entity);
      -- Até dez B/Ls na mensagem; a lista inteira fica no metadata.
      SELECT string_agg(x.bl_id || COALESCE(' (' || x.consignee || ')', ''), ', ' ORDER BY x.bl_id)
        INTO v_list
      FROM (
        SELECT e->>'bl_id' AS bl_id, e->>'consignee' AS consignee
        FROM jsonb_array_elements(v_scale.bls) e
        ORDER BY e->>'bl_id'
        LIMIT 10
      ) x;
      PERFORM public.upsert_alert_item(
        'bl_sem_cliente_perto_eta', 'voyage_pod_schedule', v_entity,
        CASE WHEN v_scale.bl_count = 1 THEN '1 B/L sem Cliente' ELSE v_scale.bl_count || ' B/Ls sem Cliente' END
          || ' com ETA em ' || to_char(v_scale.eta_day, 'DD/MM/YYYY') || ': ' || v_list
          || CASE WHEN v_scale.bl_count > 10 THEN format(' e mais %s', v_scale.bl_count - 10) ELSE '' END
          || '.',
        p_source,
        jsonb_build_object(
          'voyage_id', p_voyage_id,
          'port', v_scale.port,
          'eta', v_scale.eta_day::text,
          'deadline_days', 5,
          'bl_ids', to_jsonb(v_scale.bl_ids),
          'bls', v_scale.bls
        ),
        '/revisao?causa=cliente'
      );
    END LOOP;
  END IF;

  -- Escala que saiu do prazo, ficou sem B/L pendente, foi excluída ou omitida,
  -- ou viagem cancelada ou apagada: fecha.
  FOR v_entity IN
    SELECT a.entity_id
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'bl_sem_cliente_perto_eta'
      AND i.status = 'active'
      AND a.entity_type = 'voyage_pod_schedule'
      AND a.entity_id LIKE p_voyage_id::text || '::%'
      AND NOT (a.entity_id = ANY (v_open))
  LOOP
    PERFORM public.resolve_alert_item('bl_sem_cliente_perto_eta', 'voyage_pod_schedule', v_entity, p_source, '{}'::jsonb);
  END LOOP;

  RETURN cardinality(v_open);
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_bl_sem_cliente_perto_eta_alerts(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_bl_sem_cliente_perto_eta_alerts(bigint, text) TO service_role;

-- 3 -------------------------------------------------------------------------
-- Uma reconciliação por viagem e transação, no COMMIT (gatilhos adiados).
CREATE OR REPLACE FUNCTION public._reconcile_bl_sem_cliente_perto_eta_once(p_voyage_id bigint, p_source text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_done text := COALESCE(current_setting('alerts.bl_sem_cliente_eta_done', true), '');
  v_previous text := current_setting('alerts.foundation_trigger', true);
BEGIN
  IF p_voyage_id IS NULL OR position(',' || p_voyage_id::text || ',' IN v_done) > 0 THEN
    RETURN;
  END IF;
  PERFORM set_config('alerts.bl_sem_cliente_eta_done',
    CASE WHEN v_done = '' THEN ',' ELSE v_done END || p_voyage_id::text || ',', true);
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  BEGIN
    PERFORM public.reconcile_bl_sem_cliente_perto_eta_alerts(p_voyage_id, p_source);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Alerta de B/L sem Cliente perto do ETA da viagem % não atualizado: %', p_voyage_id, SQLERRM;
  END;
  PERFORM set_config('alerts.foundation_trigger', COALESCE(v_previous, ''), true);
END;
$function$;

REVOKE ALL ON FUNCTION public._reconcile_bl_sem_cliente_perto_eta_once(bigint, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reconcile_bl_sem_cliente_perto_eta_on_bls()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public._reconcile_bl_sem_cliente_perto_eta_once(OLD.voyage_id, 'bl_sem_cliente_eta_bl');
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public._reconcile_bl_sem_cliente_perto_eta_once(NEW.voyage_id, 'bl_sem_cliente_eta_bl');
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_bl_sem_cliente_perto_eta_on_bls() FROM PUBLIC, anon, authenticated;

-- Só os B/Ls que estão (ou estavam) vivos e sem Cliente chegam à fila do
-- COMMIT; o WHEN de um gatilho de restrição é avaliado na hora da gravação.
DROP TRIGGER IF EXISTS bl_sem_cliente_perto_eta_on_bls_insert ON public.bls;
CREATE CONSTRAINT TRIGGER bl_sem_cliente_perto_eta_on_bls_insert
  AFTER INSERT ON public.bls
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.customer_id IS NULL AND NEW.cancelled_at IS NULL)
  EXECUTE FUNCTION public.reconcile_bl_sem_cliente_perto_eta_on_bls();

DROP TRIGGER IF EXISTS bl_sem_cliente_perto_eta_on_bls_delete ON public.bls;
CREATE CONSTRAINT TRIGGER bl_sem_cliente_perto_eta_on_bls_delete
  AFTER DELETE ON public.bls
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.customer_id IS NULL AND OLD.cancelled_at IS NULL)
  EXECUTE FUNCTION public.reconcile_bl_sem_cliente_perto_eta_on_bls();

DROP TRIGGER IF EXISTS bl_sem_cliente_perto_eta_on_bls_update ON public.bls;
CREATE CONSTRAINT TRIGGER bl_sem_cliente_perto_eta_on_bls_update
  AFTER UPDATE OF customer_id, cancelled_at, voyage_id, pod, consignee ON public.bls
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (
    ((OLD.customer_id IS NULL AND OLD.cancelled_at IS NULL) OR (NEW.customer_id IS NULL AND NEW.cancelled_at IS NULL))
    AND (OLD.customer_id IS DISTINCT FROM NEW.customer_id
      OR OLD.cancelled_at IS DISTINCT FROM NEW.cancelled_at
      OR OLD.voyage_id IS DISTINCT FROM NEW.voyage_id
      OR OLD.pod IS DISTINCT FROM NEW.pod
      OR OLD.consignee IS DISTINCT FROM NEW.consignee)
  )
  EXECUTE FUNCTION public.reconcile_bl_sem_cliente_perto_eta_on_bls();

CREATE OR REPLACE FUNCTION public.reconcile_bl_sem_cliente_perto_eta_on_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Guarda antes do cast: chave fora do formato `<viagem>::<porto>` não
  -- reconcilia nada (F7a da revisão).
  IF NEW.entity_id ~ '^[0-9]+::' THEN
    PERFORM public._reconcile_bl_sem_cliente_perto_eta_once(
      split_part(NEW.entity_id, '::', 1)::bigint, 'bl_sem_cliente_eta_escala');
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_bl_sem_cliente_perto_eta_on_audit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bl_sem_cliente_perto_eta_on_audit ON public.audit_logs;
CREATE CONSTRAINT TRIGGER bl_sem_cliente_perto_eta_on_audit
  AFTER INSERT ON public.audit_logs
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.entity_type = 'voyage_pod_schedule' AND NEW.field_name IN ('eta', 'deleted', 'omitted'))
  EXECUTE FUNCTION public.reconcile_bl_sem_cliente_perto_eta_on_audit();

CREATE OR REPLACE FUNCTION public.reconcile_bl_sem_cliente_perto_eta_on_voyage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._reconcile_bl_sem_cliente_perto_eta_once(NEW.id, 'bl_sem_cliente_eta_viagem');
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_bl_sem_cliente_perto_eta_on_voyage() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bl_sem_cliente_perto_eta_on_voyage ON public.voyages;
CREATE CONSTRAINT TRIGGER bl_sem_cliente_perto_eta_on_voyage
  AFTER UPDATE OF status ON public.voyages
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.reconcile_bl_sem_cliente_perto_eta_on_voyage();

-- 4 -------------------------------------------------------------------------
-- Definição da migration 002 com o passo 5.
CREATE OR REPLACE FUNCTION public.detect_bl_review_pendencies()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cust RECORD;
  v_cons RECORD;
  v_old_alert RECORD;
  v_count INTEGER := 0;
  v_type TEXT;
  v_voyage_id BIGINT;
BEGIN
  PERFORM set_config('alerts.foundation_trigger', 'on', true);

  -- 1. Reconcilia clientes vinculados com B/Ls em pending_review
  FOR v_cust IN
    SELECT DISTINCT customer_id
    FROM public.bls
    WHERE review_status = 'pending_review'
      AND customer_id IS NOT NULL
  LOOP
    PERFORM public.reconcile_customer_bl_review_alerts(v_cust.customer_id, NULL, 'detector_bl_review');
    v_count := v_count + 1;
  END LOOP;

  -- 2. Reconcilia consignatários não vinculados com B/Ls em pending_review
  FOR v_cons IN
    SELECT DISTINCT COALESCE(NULLIF(btrim(consignee), ''), 'sem_cliente') AS consignee_key
    FROM public.bls
    WHERE review_status = 'pending_review'
      AND customer_id IS NULL
  LOOP
    PERFORM public.reconcile_customer_bl_review_alerts(NULL, v_cons.consignee_key, 'detector_bl_review');
    v_count := v_count + 1;
  END LOOP;

  -- 3. Resolve alertas ativos de clientes que não possuem mais pendências
  FOR v_old_alert IN
    SELECT DISTINCT a.entity_id, i.item_type
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.status = 'active'
      AND a.entity_type = 'customer'
      AND i.item_type IN (
        'review_customer_unlinked',
        'review_customer_email_missing',
        'review_portal_not_ready',
        'review_breakbulk_weight_missing'
      )
  LOOP
    IF v_old_alert.entity_id ~ '^[0-9]+$' THEN
      PERFORM public.reconcile_customer_bl_review_alerts(v_old_alert.entity_id::BIGINT, NULL, 'detector_bl_review_cleanup');
    ELSE
      PERFORM public.reconcile_customer_bl_review_alerts(NULL, v_old_alert.entity_id, 'detector_bl_review_cleanup');
    END IF;
  END LOOP;

  -- 4. Limpa itens legados por B/L
  FOREACH v_type IN ARRAY ARRAY[
    'review_customer_unlinked',
    'review_customer_email_missing',
    'review_portal_not_ready',
    'review_breakbulk_weight_missing'
  ] LOOP
    FOR v_old_alert IN
      SELECT a.entity_id
      FROM public.alert_items i
      JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.status = 'active'
        AND a.entity_type = 'bl'
        AND i.item_type = v_type
    LOOP
      PERFORM public.resolve_alert_item(v_type, 'bl', v_old_alert.entity_id, 'detector_bl_review_cleanup', '{}'::jsonb);
    END LOOP;
  END LOOP;

  -- 5. B/L sem Cliente perto do ETA (352): a passagem do tempo abre. Viagens
  -- com B/L vivo sem Cliente e viagens com o alerta aberto. Uma viagem que
  -- falha não derruba as outras nem os passos acima.
  FOR v_voyage_id IN
    SELECT b.voyage_id
    FROM public.bls b
    WHERE b.customer_id IS NULL AND b.cancelled_at IS NULL AND b.voyage_id IS NOT NULL
    UNION
    SELECT CASE WHEN a.entity_id ~ '^[0-9]+::' THEN split_part(a.entity_id, '::', 1)::bigint END
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'bl_sem_cliente_perto_eta'
      AND i.status = 'active'
      AND a.entity_type = 'voyage_pod_schedule'
  LOOP
    CONTINUE WHEN v_voyage_id IS NULL;
    BEGIN
      PERFORM public.reconcile_bl_sem_cliente_perto_eta_alerts(v_voyage_id, 'detector_bl_sem_cliente_eta');
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Alerta de B/L sem Cliente perto do ETA da viagem % não atualizado: %', v_voyage_id, SQLERRM;
    END;
  END LOOP;

  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RETURN v_count;
END;
$function$;

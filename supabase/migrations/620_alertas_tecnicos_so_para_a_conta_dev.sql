-- 620: alertas técnicos vão só para a conta Dev (decisões do dono de
-- 2026-11-07; ADR 0133).
--
-- O dono, que é a conta Dev do Administrativo, é o único com as ferramentas
-- para resolver problema técnico. Avisar os setores, inclusive o resto do
-- Administrativo, não adianta. Mudança:
--   1. Só a conta Dev recebe e enxerga: Fila de efeitos de importação parada,
--      Provedor de e-mail sem retorno, Rotina agendada com resposta de erro,
--      Rotina interna sem rodar, Consulta de Pix do Itaú parada (antes do
--      Financeiro) e Retorno do provedor não aplicado. Ficam no
--      Administrativo com a marca `notify_dev_only` (605): o sino só às contas
--      Dev, e a fila, as contagens por setor e o número do menu só mostram
--      esses itens a quem tem a marca Dev.
--   2. A equipe continua recebendo e a conta Dev passa a receber também
--      (`alert_type_catalog.also_notify_dev`): Faturamento automático falhou,
--      Revisão de B/L — fatura retida não saiu (Portal) e Passo da importação
--      bloqueado.
--   3. Separados pela causa (`_alert_item_is_technical`): no Aviso do
--      Desbloqueio de CE não enviado, a falha de envio (`status = 'failed'`);
--      na Cobrança de Demurrage recusada, as falhas seguidas (não a recusa
--      definitiva); no Comunicado recusado, quando toda claim do alerta é
--      falha repetida do provedor (`provider_failures >= 3`). Com causa
--      técnica, o item vai só à conta Dev (sino e fila); com causa no contato
--      do Cliente, segue com a equipe.
--   Sem nenhuma conta Dev ativa, o crítico cai no desvio de sempre (todo o
--   Administrativo, 476).
--
-- Plano de preservação: a seção 4 reescreve `alert_items.department` dos
-- itens ativos de `itau_pix_consulta_parada` (Financeiro → Administrativo).
-- O setor anterior fica no evento `updated` de `alert_item_events`
-- (`metadata.department_from`, `metadata.migration = '620'`). Itens
-- resolvidos e notificações entregues não mudam. Conferir: `SELECT
-- item_type, department, status, count(*) FROM alert_items WHERE item_type =
-- 'itau_pix_consulta_parada' GROUP BY 1, 2, 3` antes e depois. Desfazer:
-- voltar `department` pelo `metadata.department_from` dos eventos da 620, o
-- catálogo pelos valores anteriores (Consulta Itaú: Financeiro; os seis tipos
-- com `notify_dev_only = false`), dropar a coluna `also_notify_dev`, e
-- reaplicar os corpos anteriores das funções corrigidas abaixo.

BEGIN;

-- 1 --- Catálogo ------------------------------------------------------------
ALTER TABLE public.alert_type_catalog
  ADD COLUMN IF NOT EXISTS also_notify_dev boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.alert_type_catalog.also_notify_dev IS
  'O sino do tipo vai também às contas Dev, além da equipe (620; falha técnica que a equipe contorna).';

UPDATE public.alert_type_catalog SET responsible_department = 'administrativo', audience_departments = ARRAY['administrativo'], notify_dev_only = true WHERE type = 'import_effects_queue_stalled';
UPDATE public.alert_type_catalog SET responsible_department = 'administrativo', audience_departments = ARRAY['administrativo'], notify_dev_only = true WHERE type = 'email_retorno_provedor_silencioso';
UPDATE public.alert_type_catalog SET responsible_department = 'administrativo', audience_departments = ARRAY['administrativo'], notify_dev_only = true WHERE type = 'rotina_http_falhou';
UPDATE public.alert_type_catalog SET responsible_department = 'administrativo', audience_departments = ARRAY['administrativo'], notify_dev_only = true WHERE type = 'rotina_interna_sem_rodar';
UPDATE public.alert_type_catalog SET responsible_department = 'administrativo', audience_departments = ARRAY['administrativo'], notify_dev_only = true WHERE type = 'itau_pix_consulta_parada';
UPDATE public.alert_type_catalog SET responsible_department = 'administrativo', audience_departments = ARRAY['administrativo'], notify_dev_only = true WHERE type = 'email_retorno_nao_aplicado';
UPDATE public.alert_type_catalog SET also_notify_dev = true WHERE type IN ('billing_auto_issue_failed', 'portal_reprocessamento_falhou', 'import_effect_blocked');

-- 2 --- Causa técnica e visibilidade -----------------------------------------
CREATE OR REPLACE FUNCTION public._alert_item_is_technical(p_type text, p_metadata jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE p_type
    WHEN 'desbloqueio_ce_aviso_nao_enviado' THEN COALESCE(p_metadata->>'status', '') = 'failed'
    WHEN 'cobranca_demurrage_recusada' THEN COALESCE(p_metadata->>'outcome', '') NOT IN ('', 'refused')
    WHEN 'comunicado_recusado' THEN
      jsonb_typeof(p_metadata->'claims') = 'array' AND jsonb_array_length(p_metadata->'claims') > 0
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_metadata->'claims') c
        WHERE COALESCE((c->>'permanent')::boolean, false) OR COALESCE((c->>'provider_failures')::int, 0) < 3)
    ELSE false
  END;
$function$;
REVOKE ALL ON FUNCTION public._alert_item_is_technical(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._alert_item_is_technical(text, jsonb) TO service_role;

-- Item que só a conta Dev enxerga na fila e nas contagens.
CREATE OR REPLACE FUNCTION public._alert_item_visible_to_caller(p_type text, p_metadata jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT NOT (
      COALESCE((SELECT c.notify_dev_only FROM public.alert_type_catalog c WHERE c.type = p_type), false)
      OR public._alert_item_is_technical(p_type, p_metadata))
    OR auth.role() IS NOT DISTINCT FROM 'service_role'
    OR EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.active AND up.is_dev);
$function$;
REVOKE ALL ON FUNCTION public._alert_item_visible_to_caller(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._alert_item_visible_to_caller(text, jsonb) TO authenticated, service_role;

-- 3 --- Correções nas funções vigentes ----------------------------------------
DO $patch$
DECLARE
  v_patch record;
  v_def text;
BEGIN
  FOR v_patch IN
    SELECT * FROM (VALUES
      -- Sino: técnico só às contas Dev; also_notify_dev acrescenta as contas Dev.
      ('public.fanout_alert_item_for_department(bigint,bigint,bigint,text)', 1,
       $old$  v_fallback BOOLEAN := false;$old$,
       $new$  v_fallback BOOLEAN := false;
  v_tech BOOLEAN;$new$),
      ('public.fanout_alert_item_for_department(bigint,bigint,bigint,text)', 2,
       $old$  -- O papel legado `operator` é Documentação, como no resto do sistema (328).$old$,
       $new$  -- 620: alerta técnico (pelo tipo ou pela causa) só às contas Dev.
  v_tech := COALESCE(v_catalog.notify_dev_only, false) OR public._alert_item_is_technical(v_item.item_type, v_item.metadata);

  -- O papel legado `operator` é Documentação, como no resto do sistema (328).$new$),
      ('public.fanout_alert_item_for_department(bigint,bigint,bigint,text)', 3,
       $old$      AND (CASE up.role WHEN 'operator' THEN 'documentacao' ELSE up.role END) = ANY (v_audience)
      -- 605: tipo só da conta Dev (calendário de feriados).
      AND (NOT COALESCE(v_catalog.notify_dev_only, false) OR up.is_dev)$old$,
       $new$      AND (
        (NOT v_tech AND (CASE up.role WHEN 'operator' THEN 'documentacao' ELSE up.role END) = ANY (v_audience))
        -- 605/620: tipo ou causa técnica, só a conta Dev.
        OR (v_tech AND up.is_dev)
        -- 620: a equipe recebe e a conta Dev também.
        OR (COALESCE(v_catalog.also_notify_dev, false) AND up.is_dev))$new$),
      -- O catálogo vence o setor do produtor também na Consulta Itaú.
      ('public._alert_item_department(text,text)', 1,
       $old$c.type IN ('demurrage_ptax_recalc_failed', 'calendario_feriados_pendente', 'voyage_export_after_atd')$old$,
       $new$c.type IN ('demurrage_ptax_recalc_failed', 'calendario_feriados_pendente', 'voyage_export_after_atd', 'itau_pix_consulta_parada')$new$),
      -- O Comunicado recusado guarda as falhas do provedor de cada claim.
      ('public.refresh_customer_communication_refusal_alert(bigint)', 1,
       $old$        'attempts', cl.attempts,$old$,
       $new$        'attempts', cl.attempts,
        'provider_failures', cl.provider_failures,$new$),
      -- Fila e contagens: o item técnico só para a conta Dev.
      ('public.list_alert_queue_page(text,text,integer,integer,text)', 1,
       $old$JOIN public.alert_items i ON i.alert_id = a.id AND i.status = 'active'$old$,
       $new$JOIN public.alert_items i ON i.alert_id = a.id AND i.status = 'active'
      AND public._alert_item_visible_to_caller(i.item_type, i.metadata)$new$)
    ) AS p(fn, step, old_text, new_text)
    ORDER BY fn, step
  LOOP
    v_def := pg_get_functiondef(v_patch.fn::regprocedure);
    IF position(v_patch.new_text in v_def) > 0 THEN CONTINUE; END IF;  -- já aplicado
    IF (length(v_def) - length(replace(v_def, v_patch.old_text, ''))) / length(v_patch.old_text) <> 1 THEN
      RAISE EXCEPTION '620: trecho não encontrado uma única vez em %: %', v_patch.fn, left(v_patch.old_text, 50);
    END IF;
    EXECUTE replace(v_def, v_patch.old_text, v_patch.new_text);
  END LOOP;
END;
$patch$;

DO $patch$
DECLARE
  v_fn text;
  v_def text;
  v_old text := $old$JOIN public.alert_items i ON i.alert_id = a.id AND i.status = 'active'$old$;
  v_new text := $new$JOIN public.alert_items i ON i.alert_id = a.id AND i.status = 'active'
      AND public._alert_item_visible_to_caller(i.item_type, i.metadata)$new$;
BEGIN
  FOR v_fn IN SELECT p.oid::regprocedure::text FROM pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('count_alert_queue', 'summarize_alert_queue_by_department')
  LOOP
    v_def := pg_get_functiondef(v_fn::regprocedure);
    IF position(v_new in v_def) > 0 THEN CONTINUE; END IF;
    IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
      RAISE EXCEPTION '620: trecho não encontrado uma única vez em %', v_fn;
    END IF;
    EXECUTE replace(v_def, v_old, v_new);
  END LOOP;
END;
$patch$;

-- 4 --- Itens ativos da Consulta Itaú passam ao Administrativo ---------------
WITH moved AS (
  UPDATE public.alert_items AS i
  SET department = 'administrativo', updated_at = now()
  FROM (
    SELECT i2.id, i2.department AS department_from
    FROM public.alert_items i2
    WHERE i2.item_type = 'itau_pix_consulta_parada' AND i2.status = 'active'
      AND i2.department IS DISTINCT FROM 'administrativo'
      AND NOT EXISTS (SELECT 1 FROM public.alert_items f
                      WHERE f.alert_id = i2.alert_id AND f.item_type = i2.item_type AND f.department = 'administrativo')
  ) src
  WHERE i.id = src.id
  RETURNING i.id, i.occurrence_id, src.department_from
)
INSERT INTO public.alert_item_events (alert_item_id, occurrence_id, event_type, previous_status, new_status, actor_id, metadata)
SELECT m.id, m.occurrence_id, 'updated', 'active', 'active', NULL,
  jsonb_build_object('migration', '620', 'department_from', m.department_from, 'department_to', 'administrativo')
FROM moved m;

COMMIT;

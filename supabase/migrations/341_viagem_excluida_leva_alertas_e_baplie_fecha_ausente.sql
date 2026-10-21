-- 341: excluir a viagem leva os alertas dela; importar o Baplie fecha o
-- "Baplie ausente" (sessão de testes de 2026-10-20, observações 2 e 3).
--
-- Problema:
--   Obs. 2. `delete_records('voyage', …)` apaga os filhos da lista
--     `voyage_delete_children_spec()` (migration 088), que não tem `alerts`.
--     A tabela é polimórfica (`entity_type`/`entity_id` em texto, sem FK para
--     `voyages`), então nada em cascata apaga os alertas: a viagem saía e os
--     alertas dela (`voyage` = `<id>`, `voyage_pod_schedule` = `<id>::<porto>`,
--     `voyage_escala_terminal` = `<id>::<porto>::<terminal>`, …) ficavam
--     abertos para um registro que não existe mais. E o audit `voyages` que a
--     exclusão grava dispara `reconcile_voyage_operation_alerts_on_audit`,
--     que reconciliava a viagem já apagada.
--   Obs. 3. `import_baplie_staging_transactional` (envelope da 268 sobre o
--     corpo `_legacy_189`, migration 121) reconcilia só a cobertura
--     documental e grava o audit com `entity_type = 'voyage'` (singular). O
--     trigger de audit só reage a `voyage_pod_schedule`, `voyage_pol_schedule`
--     e `voyages`, então `reconcile_voyage_baplie_missing_alerts` (324) não
--     rodava: o "Baplie ausente" ficava aberto até outro evento da viagem
--     (na produção, a importação de B/L 45 s depois).
--
-- Mudança:
--   1. `delete_voyage_alerts(viagem)`: apaga os alertas cujo `entity_type`
--      começa com `voyage` e cujo `entity_id` é a viagem ou começa com
--      `<viagem>::` (o `::` impede que a 62 leve a 620), e os itens de outros
--      alertas com `metadata.voyage_id` = a viagem; o alerta de outra entidade
--      que perde itens é recontado (`refresh_alert_aggregate`) e fecha se
--      ficar sem item. Itens, eventos, dispensas e Notificações Internas saem
--      pelo `ON DELETE CASCADE` das FKs.
--   2. `delete_voyage_children` chama essa função depois da lista: a
--      exclusão da viagem leva os alertas na mesma transação.
--   3. `voyage_delete_preview` conta os alertas que vão junto.
--   4. `reconcile_voyage_operation_alerts_on_audit` ignora audit de viagem que
--      não existe mais: excluir não reabre alerta da viagem apagada.
--   5. O envelope do Baplie reconcilia também o "Baplie ausente", na mesma
--      transação da importação (resolve com origem `baplie_import`).
--   6. Buracos do mesmo tipo achados no estudo
--      (docs/archive/audits/2026-10-20-auto-resolucao-de-alertas.md, L3 e L4):
--      o audit de escala (`voyage_pod_schedule`: ETA, exclusão, omissão)
--      reconcilia também os alertas de prazo da viagem (B/Ls esperados,
--      Baplie ausente, CE Mercante ausente), e o audit de CE do B/L (`bl` /
--      `ce_mercante`) reconcilia o "CE Mercante ausente" da viagem.
--
-- Navio (`vessels`): não há caminho de exclusão de navio na aplicação nem
-- alerta com chave de navio; nada a corrigir.
--
-- Só redefine funções; não reescreve nem apaga linhas existentes.
-- Rollback: reaplicar as definições das migrations 088 (delete_voyage_children,
-- voyage_delete_preview), 002 (reconcile_voyage_operation_alerts_on_audit) e
-- 268 (import_baplie_staging_transactional); DROP FUNCTION
-- public.delete_voyage_alerts(bigint).

CREATE OR REPLACE FUNCTION public.voyage_alert_scope(p_voyage_id bigint)
RETURNS TABLE(alert_id bigint, alert_item_id bigint)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  -- Alertas inteiros da viagem (cabeçalho e todos os itens).
  SELECT a.id, NULL::bigint
  FROM public.alerts a
  WHERE a.entity_type LIKE 'voyage%'
    AND (a.entity_id = p_voyage_id::text OR a.entity_id LIKE p_voyage_id::text || '::%')
  UNION ALL
  -- Itens de outros alertas que dizem ser desta viagem.
  SELECT NULL::bigint, i.id
  FROM public.alert_items i
  JOIN public.alerts a ON a.id = i.alert_id
  WHERE i.metadata->>'voyage_id' = p_voyage_id::text
    AND NOT (
      a.entity_type LIKE 'voyage%'
      AND (a.entity_id = p_voyage_id::text OR a.entity_id LIKE p_voyage_id::text || '::%')
    );
$function$;

REVOKE ALL ON FUNCTION public.voyage_alert_scope(bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_voyage_alerts(p_voyage_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_alerts integer;
  v_items integer;
  v_parents bigint[];
  v_parent bigint;
BEGIN
  SELECT array_agg(DISTINCT i.alert_id) INTO v_parents
  FROM public.alert_items i
  WHERE i.id IN (SELECT s.alert_item_id FROM public.voyage_alert_scope(p_voyage_id) s WHERE s.alert_item_id IS NOT NULL);

  DELETE FROM public.alert_items
  WHERE id IN (SELECT s.alert_item_id FROM public.voyage_alert_scope(p_voyage_id) s WHERE s.alert_item_id IS NOT NULL);
  GET DIAGNOSTICS v_items = ROW_COUNT;

  -- O alerta de outra entidade que perdeu itens é recontado; sem item, fecha
  -- (alerta aberto sem item aparece na fila como linha legada).
  FOREACH v_parent IN ARRAY COALESCE(v_parents, ARRAY[]::bigint[]) LOOP
    PERFORM public.refresh_alert_aggregate(v_parent);
  END LOOP;

  DELETE FROM public.alerts
  WHERE id IN (SELECT s.alert_id FROM public.voyage_alert_scope(p_voyage_id) s WHERE s.alert_id IS NOT NULL);
  GET DIAGNOSTICS v_alerts = ROW_COUNT;

  RETURN v_alerts + v_items;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_voyage_alerts(bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_voyage_children(p_voyage_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_spec record;
  v_pass integer;
  v_left boolean;
BEGIN
  FOR v_pass IN 1..3 LOOP
    v_left := false;
    FOR v_spec IN SELECT * FROM public.voyage_delete_children_spec() ORDER BY ord LOOP
      BEGIN
        IF v_spec.action = 'detach' THEN
          EXECUTE format('UPDATE public.%I SET %I = NULL WHERE %I = $1', v_spec.table_name, v_spec.column_name, v_spec.column_name) USING p_voyage_id;
        ELSE
          EXECUTE format('DELETE FROM public.%I WHERE %I = $1', v_spec.table_name, v_spec.column_name) USING p_voyage_id;
        END IF;
      EXCEPTION WHEN foreign_key_violation THEN
        v_left := true;
      END;
    END LOOP;
    EXIT WHEN NOT v_left;
  END LOOP;
  -- Alertas não têm FK para a viagem (chave em texto): saem por aqui (341).
  PERFORM public.delete_voyage_alerts(p_voyage_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_voyage_children(bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.voyage_delete_preview(p_voyage_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_spec record;
  v_count bigint;
  v_items jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo pode excluir viagem.' USING ERRCODE = '42501';
  END IF;
  FOR v_spec IN SELECT * FROM public.voyage_delete_children_spec() ORDER BY ord LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', v_spec.table_name, v_spec.column_name)
      INTO v_count USING p_voyage_id;
    IF v_count > 0 THEN
      v_items := v_items || jsonb_build_object('table', v_spec.table_name, 'action', v_spec.action, 'label', v_spec.label, 'count', v_count);
    END IF;
  END LOOP;
  IF v_items <> '[]'::jsonb THEN
    v_items := jsonb_build_array(jsonb_build_object(
      'table', 'bl_containers', 'action', 'delete', 'label', 'container(es) dos B/Ls',
      'count', (SELECT count(*) FROM public.bl_containers c JOIN public.bls b ON b.id = c.bl_id WHERE b.voyage_id = p_voyage_id)
    )) || v_items;
  END IF;
  -- Alertas da viagem e itens que apontam para ela (mesmo escopo que a
  -- exclusão apaga, migration 341). Conta os ativos e os já resolvidos.
  SELECT count(*) INTO v_count FROM public.voyage_alert_scope(p_voyage_id);
  IF v_count > 0 THEN
    v_items := v_items || jsonb_build_object('table', 'alerts', 'action', 'delete', 'label', 'alerta(s) da viagem', 'count', v_count);
  END IF;
  RETURN jsonb_build_object('items', v_items);
END;
$function$;

REVOKE ALL ON FUNCTION public.voyage_delete_preview(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.voyage_delete_preview(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.reconcile_voyage_operation_alerts_on_audit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_voyage_id BIGINT;
  v_port TEXT;
BEGIN
  IF NEW.entity_type = 'bl' AND NEW.field_name = 'ce_mercante' THEN
    -- CE gravado ou removido (porta única `_set_bl_ce_mercante`, 230): o
    -- "CE Mercante ausente" da viagem fecha ou reabre agora (341).
    -- ponytail: uma reconciliação da viagem por B/L; a importação de CE em
    -- lote repete a mesma conta N vezes. Agrupar no fim do lote é o upgrade.
    SELECT b.voyage_id INTO v_voyage_id FROM public.bls b WHERE b.id = NEW.entity_id;
    IF v_voyage_id IS NOT NULL THEN
      PERFORM public.reconcile_voyage_ce_mercante_missing_alerts(v_voyage_id, 'voyage_operation_trigger');
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.entity_type NOT IN ('voyage_pod_schedule', 'voyage_pol_schedule', 'voyages') THEN
    RETURN NEW;
  END IF;
  v_voyage_id := NULLIF(split_part(NEW.entity_id, '::', 1), '')::BIGINT;
  -- A exclusão da viagem grava o audit depois do DELETE: viagem que não existe
  -- mais não tem alerta a reconciliar (341).
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = v_voyage_id) THEN
    RETURN NEW;
  END IF;
  IF NEW.entity_type = 'voyages' THEN
    PERFORM public.reconcile_voyage_operation_alerts(v_voyage_id, 'voyage_operation_trigger');
  ELSE
    v_port := NULLIF(upper(btrim(split_part(NEW.entity_id, '::', 2))), '');
    IF v_port IS NOT NULL THEN
      PERFORM public.reconcile_voyage_schedule_date_alerts(v_voyage_id, v_port, 'voyage_operation_trigger');
    END IF;
    -- ETA, exclusão ou omissão da escala mudam o primeiro ETA brasileiro, que
    -- decide o prazo D-7/D-5 dos alertas de nível viagem (341).
    IF NEW.entity_type = 'voyage_pod_schedule' THEN
      PERFORM public.reconcile_voyage_bl_expected_alerts(v_voyage_id, 'voyage_operation_trigger');
      PERFORM public.reconcile_voyage_baplie_missing_alerts(v_voyage_id, 'voyage_operation_trigger');
      PERFORM public.reconcile_voyage_ce_mercante_missing_alerts(v_voyage_id, 'voyage_operation_trigger');
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Reconciliação de alertas de viagem ignorada para audit_logs.id=%: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_voyage_operation_alerts_on_audit() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.import_baplie_staging_transactional(p_voyage_id bigint, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para importar Baplie.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_rows, 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'O Baplie não tem nenhum container: confira o arquivo antes de importar. O Baplie anterior da viagem foi mantido.'
      USING ERRCODE = '22023';
  END IF;
  PERFORM public._set_import_context('Baplie', p_voyage_id, NULL);
  v_count := public.import_baplie_staging_transactional_legacy_189(p_voyage_id, p_rows);
  -- O corpo reconcilia só a cobertura; o "Baplie ausente" fecha aqui, na
  -- mesma transação (341).
  PERFORM public.reconcile_voyage_baplie_missing_alerts(p_voyage_id, 'baplie_import');
  RETURN v_count;
END $function$;

REVOKE ALL ON FUNCTION public.import_baplie_staging_transactional(bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_baplie_staging_transactional(bigint, jsonb) TO authenticated;

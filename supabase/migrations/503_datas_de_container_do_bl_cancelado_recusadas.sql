-- 503: as datas do container de B/L cancelado ficam como estão também pela
-- ficha (ADR 0094, B4).
--
-- Problema:
--   A aba Faturamento da ficha de um B/L cancelado ainda oferecia a devolução
--   do container, e `set_container_dates` (211) não recusava a gravação.
--   `_apply_container_dates_core` (380) pula a linha do B/L cancelado: a data
--   ia só ao mesmo container dos B/Ls irmãos ativos na Viagem, ou a lugar
--   nenhum. A chamada terminava sem erro e a tela dizia "Data de devolução
--   salva.". A planilha de datas já recusava o B/L cancelado desde a 478.
--
-- Mudança:
--   `set_container_dates` recusa o container cujo B/L está cancelado, com a
--   mesma mensagem e o mesmo código da planilha (478): "B/L <id> cancelado:
--   somente leitura. Reative para corrigir." (42501). A conferência vem depois
--   das travas e antes de qualquer gravação: nada muda no B/L cancelado nem nos
--   irmãos. O resto do corpo é o da 211.
--
-- Só redefine a função; não reescreve nem apaga linhas existentes.
-- Rollback: reaplicar `set_container_dates` da 211.

CREATE OR REPLACE FUNCTION public.set_container_dates(p_container_id bigint, p_discharge_date date, p_return_date date, p_reason text DEFAULT NULL::text, p_keep_discharge boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_old record;
  v_touched text[];
  v_request uuid := gen_random_uuid();
  v_role text := public.current_actor_role();
  v_discharge date := p_discharge_date;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  -- O conjunto do container compartilhado antes da linha (211).
  PERFORM public._lock_container_date_sets(ARRAY[p_container_id]);
  SELECT c.id, c.bl_id, c.container_number, c.discharge_date, c.return_date INTO v_old
  FROM public.bl_containers AS c WHERE c.id = p_container_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Container % nao encontrado.', p_container_id USING ERRCODE = 'P0002';
  END IF;
  -- 503 (ADR 0094, B4): o B/L cancelado é somente leitura. Sem esta recusa, a
  -- data ia só aos B/Ls irmãos ativos (380) e a ficha dizia que salvou.
  IF EXISTS (SELECT 1 FROM public.bls WHERE id = v_old.bl_id AND cancelled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'B/L % cancelado: somente leitura. Reative para corrigir.', v_old.bl_id USING ERRCODE = '42501';
  END IF;
  -- Só a devolução muda (210): a descarga é a gravada, lida sob a trava.
  IF p_keep_discharge THEN
    v_discharge := v_old.discharge_date;
  END IF;
  IF p_return_date IS NOT NULL AND v_discharge IS NOT NULL AND p_return_date < v_discharge THEN
    RAISE EXCEPTION 'Devolução anterior à descarga.' USING ERRCODE = '22023';
  END IF;
  IF p_return_date IS NOT NULL AND v_discharge IS NULL THEN
    RAISE EXCEPTION 'Informe a descarga antes da devolução.' USING ERRCODE = '22023';
  END IF;
  IF ((v_old.discharge_date IS NOT NULL AND v_discharge IS NULL)
      OR (v_old.return_date IS NOT NULL AND p_return_date IS NULL))
     AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo para remover a data.' USING ERRCODE = '22023';
  END IF;

  v_touched := public._apply_container_dates_core(p_container_id, v_discharge, p_return_date, false);

  IF cardinality(v_touched) > 0 THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification, actor_role, actor_department)
    VALUES ('bl', v_old.bl_id, 'container_dates',
      jsonb_build_object('container', v_old.container_number, 'discharge_date', v_old.discharge_date, 'return_date', v_old.return_date)::text,
      jsonb_build_object('container', v_old.container_number, 'discharge_date', v_discharge, 'return_date', p_return_date, 'propagated_bl_ids', v_touched)::text,
      v_actor, COALESCE(v_reason, 'Edição das datas do container'), v_role, v_role);
  END IF;

  RETURN jsonb_build_object(
    'container_id', p_container_id,
    'propagated_bl_ids', to_jsonb(v_touched),
    'demurrage', CASE WHEN cardinality(v_touched) > 0 THEN public._after_container_dates(v_request, v_touched, v_actor) ELSE '{}'::jsonb END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_container_dates(bigint, date, date, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_container_dates(bigint, date, date, text, boolean) TO authenticated, service_role;

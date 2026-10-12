-- 210 — Remover só a devolução preserva a descarga gravada (achado da
-- revisão automática da PR 929 sobre `updateContainerReturnDate`).
--
-- A ficha do B/L lia a descarga e chamava `set_container_dates` com ela. Se
-- outra sessão corrigisse a descarga entre a leitura e a gravação, a correção
-- era revertida pela leitura antiga. Agora, com `p_keep_discharge`, a RPC usa
-- a descarga gravada, lida sob a trava do container, e a tela não a manda
-- mais. Sem o parâmetro (DEFAULT false), o comportamento é o anterior.
--
-- Redefine `set_container_dates` a partir da 179. Não reescreve nem apaga
-- linhas existentes. Rollback: reaplicar a definição de quatro argumentos da
-- 179 e remover a de cinco.

DROP FUNCTION IF EXISTS public.set_container_dates(bigint, date, date, text);

CREATE FUNCTION public.set_container_dates(
  p_container_id bigint,
  p_discharge_date date,
  p_return_date date,
  p_reason text DEFAULT NULL,
  p_keep_discharge boolean DEFAULT false
)
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
  SELECT c.id, c.bl_id, c.container_number, c.discharge_date, c.return_date INTO v_old
  FROM public.bl_containers AS c WHERE c.id = p_container_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Container % nao encontrado.', p_container_id USING ERRCODE = 'P0002';
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

-- 182: Baplie (M11 da revisão de 2026-10-09; etapa 9 do plano de correção;
-- ADR 0078, item 21).
--
-- 1. Marcas físicas (IMO, OOG, classe, ONU e SOC/COC) do Baplie valem para
--    todos os B/Ls ativos que dividem o container; B/L cancelado é ignorado.
--    Antes, container em dois B/Ls ficava sem marca nenhuma.
-- 2. `bl_containers.profile_source` diz de onde veio o perfil IMO/OOG
--    (`bl`, `baplie`, `manual`). Perfil corrigido à mão
--    (`set_bl_container_profile`) não é sobrescrito: o Baplie diferente vira
--    Divergente; **Aplicar IMO/OOG agora** usa a mesma regra.
-- 3. Baplie completo: container ausente do Baplie novo, ou marca ausente,
--    apaga as marcas que vieram do Baplie anterior (perfil `baplie`, dono
--    `baplie`). A prévia (`preview_baplie_physical_flags`) lista o que cai
--    antes de confirmar; a gravação devolve o que aplicou e onde.
-- 4. "Vale o B/L" (`resolve_baplie_divergence`): encerra a divergência de
--    SOC/COC (ou de perfil manual) com motivo; o valor do B/L passa a correção
--    manual e a resolução fica registrada.
--
-- Não reescreve linhas existentes (a coluna nova nasce nula).
--
-- Rollback: reaplicar `_apply_baplie_physical_flags_before_reissue_126` da
-- 126 e `set_bl_container_profile` da 115; DROP das funções novas, da coluna
-- `profile_source` e voltar os CHECKs de `baplie_reconciliation_resolutions`.

ALTER TABLE public.bl_containers ADD COLUMN IF NOT EXISTS profile_source text;
ALTER TABLE public.bl_containers DROP CONSTRAINT IF EXISTS bl_containers_profile_source_check;
ALTER TABLE public.bl_containers
  ADD CONSTRAINT bl_containers_profile_source_check CHECK (profile_source IS NULL OR profile_source IN ('bl', 'baplie', 'manual'));
COMMENT ON COLUMN public.bl_containers.profile_source IS
  'Origem do perfil IMO/OOG: bl (documento), baplie (último Baplie) ou manual (correção com justificativa, protegida do Baplie).';

ALTER TABLE public.baplie_reconciliation_resolutions DROP CONSTRAINT IF EXISTS baplie_reconciliation_resolutions_field_name_check;
ALTER TABLE public.baplie_reconciliation_resolutions
  ADD CONSTRAINT baplie_reconciliation_resolutions_field_name_check
  CHECK (field_name IN ('is_imo', 'imo_class', 'un_number', 'ownership', 'profile'));
ALTER TABLE public.baplie_reconciliation_resolutions DROP CONSTRAINT IF EXISTS baplie_reconciliation_resolutions_resolution_check;
ALTER TABLE public.baplie_reconciliation_resolutions
  ADD CONSTRAINT baplie_reconciliation_resolutions_resolution_check CHECK (resolution IN ('manifest', 'vale_o_bl'));
ALTER TABLE public.baplie_reconciliation_resolutions ADD COLUMN IF NOT EXISTS justification text;

-- 2. Correção manual do perfil.
CREATE OR REPLACE FUNCTION public.set_bl_container_profile(p_container_id bigint, p_profile text, p_justification text, p_changed_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_container public.bl_containers%ROWTYPE;
  v_financial_status text;
  v_actor uuid := COALESCE(p_changed_by, auth.uid());
  v_is_imo boolean := p_profile IN ('imo', 'imo_oog');
  v_is_oog boolean := p_profile IN ('oog', 'imo_oog');
  v_justification text := NULLIF(btrim(COALESCE(p_justification, '')), '');
  v_charges jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário interno ativo é obrigatório.' USING ERRCODE = '42501';
  END IF;
  IF p_changed_by IS NOT NULL AND p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'O autor da alteração deve ser o usuário autenticado.' USING ERRCODE = '42501';
  END IF;
  IF p_profile IS NULL OR p_profile NOT IN ('standard', 'oog', 'imo', 'imo_oog') THEN
    RAISE EXCEPTION 'Perfil de container inválido: %.', p_profile USING ERRCODE = '22023';
  END IF;
  IF v_justification IS NULL THEN
    RAISE EXCEPTION 'A justificativa da alteração de perfil é obrigatória.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_container FROM public.bl_containers WHERE id = p_container_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Container % não encontrado.', p_container_id USING ERRCODE = 'P0002';
  END IF;

  SELECT financial_status INTO v_financial_status FROM public.bls WHERE id = v_container.bl_id FOR UPDATE;
  IF v_financial_status IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % já foi faturado; o perfil não pode mudar porque as taxas não podem ser recalculadas.', v_container.bl_id
      USING ERRCODE = '55000';
  END IF;

  IF COALESCE(v_container.is_imo, false) = v_is_imo AND COALESCE(v_container.is_oog, false) = v_is_oog THEN
    RAISE EXCEPTION 'O container já está com este perfil.' USING ERRCODE = '22023';
  END IF;

  -- Correção manual (o armador confirma fora do Baplie): o Baplie não a
  -- sobrescreve; Baplie diferente vira Divergente (migration 182).
  UPDATE public.bl_containers
  SET is_imo = v_is_imo,
      is_oog = v_is_oog,
      imo_class = CASE WHEN v_is_imo THEN imo_class END,
      un_number = CASE WHEN v_is_imo THEN un_number END,
      profile_source = 'manual'
  WHERE id = v_container.id;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, changed_at, justification
  ) VALUES (
    'bl', v_container.bl_id, 'container_profile',
    jsonb_build_object('container', v_container.container_number, 'is_imo', COALESCE(v_container.is_imo, false), 'is_oog', COALESCE(v_container.is_oog, false))::text,
    jsonb_build_object('container', v_container.container_number, 'is_imo', v_is_imo, 'is_oog', v_is_oog)::text,
    v_actor, now(), v_justification
  );

  v_charges := public.calculate_bl_local_charges(v_container.bl_id, v_actor, true);

  RETURN jsonb_build_object(
    'bl_id', v_container.bl_id,
    'container_id', v_container.id,
    'profile', p_profile,
    'charges', v_charges
  );
END;
$function$;

-- 1/2/3. Plano único: o que o Baplie (gravado ou um arquivo novo) faz em cada
--        container de B/L ativo da Viagem.
CREATE OR REPLACE FUNCTION public._baplie_flag_plan(p_voyage_id bigint, p_staged jsonb DEFAULT NULL)
RETURNS TABLE (
  bl_container_id bigint,
  bl_id text,
  container_number text,
  action text,
  old_is_imo boolean, old_imo_class text, old_un_number text, old_is_oog boolean, old_ownership text,
  new_is_imo boolean, new_imo_class text, new_un_number text, new_is_oog boolean, new_ownership text,
  new_ownership_source text, new_profile_source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH staged AS (
    SELECT upper(btrim(s.container_number)) AS container_number, s.status, s.is_imo, s.imo_class, s.un_number, s.is_oog, s.ownership
    FROM public.baplie_containers AS s
    WHERE p_staged IS NULL AND s.voyage_id = p_voyage_id
    UNION ALL
    SELECT upper(btrim(r.container_number)), r.status, r.is_imo, r.imo_class, r.un_number, r.is_oog,
      CASE WHEN upper(btrim(r.ownership)) IN ('SOC', 'COC') THEN upper(btrim(r.ownership)) END
    FROM jsonb_to_recordset(COALESCE(p_staged, '[]'::jsonb)) AS r(
      container_number text, status text, is_imo boolean, imo_class text, un_number text, is_oog boolean, ownership text)
    WHERE p_staged IS NOT NULL
  ), desired AS (
    SELECT container_number,
      bool_or(COALESCE(is_imo, false)) AS is_imo,
      max(imo_class) FILTER (WHERE imo_class IS NOT NULL) AS imo_class,
      max(un_number) FILTER (WHERE un_number IS NOT NULL) AS un_number,
      bool_or(COALESCE(is_oog, false)) AS is_oog,
      max(ownership) FILTER (WHERE ownership IS NOT NULL) AS ownership
    FROM staged
    WHERE status = 'full' AND container_number ~ '^[A-Z]{4}[0-9]{7}$'
    GROUP BY container_number
  ), targets AS (
    SELECT c.*, d.container_number AS desired_number, d.is_imo AS d_imo,
      CASE WHEN d.is_imo THEN d.imo_class END AS d_class, CASE WHEN d.is_imo THEN d.un_number END AS d_un,
      d.is_oog AS d_oog, d.ownership AS d_ownership
    FROM public.bl_containers AS c
    JOIN public.bls AS b ON b.id = c.bl_id
    LEFT JOIN desired AS d ON d.container_number = upper(btrim(c.container_number))
    WHERE b.voyage_id = p_voyage_id AND b.cancelled_at IS NULL
  ), planned AS (
    SELECT t.id, t.bl_id, t.container_number,
      t.is_imo AS o_imo, t.imo_class AS o_class, t.un_number AS o_un, t.is_oog AS o_oog, t.ownership AS o_own,
      t.profile_source, t.ownership_source,
      t.desired_number IS NOT NULL AS in_baplie,
      -- Perfil: manual fica; no Baplie, vale o Baplie; fora dele, cai só o que veio do Baplie.
      CASE
        WHEN t.profile_source = 'manual' THEN COALESCE(t.is_imo, false)
        WHEN t.desired_number IS NOT NULL THEN t.d_imo
        WHEN t.profile_source = 'baplie' THEN false
        ELSE COALESCE(t.is_imo, false)
      END AS n_imo,
      CASE
        WHEN t.profile_source = 'manual' THEN t.imo_class
        WHEN t.desired_number IS NOT NULL THEN t.d_class
        WHEN t.profile_source = 'baplie' THEN NULL
        ELSE t.imo_class
      END AS n_class,
      CASE
        WHEN t.profile_source = 'manual' THEN t.un_number
        WHEN t.desired_number IS NOT NULL THEN t.d_un
        WHEN t.profile_source = 'baplie' THEN NULL
        ELSE t.un_number
      END AS n_un,
      CASE
        WHEN t.profile_source = 'manual' THEN COALESCE(t.is_oog, false)
        WHEN t.desired_number IS NOT NULL THEN t.d_oog
        WHEN t.profile_source = 'baplie' THEN false
        ELSE COALESCE(t.is_oog, false)
      END AS n_oog,
      CASE
        WHEN t.profile_source = 'manual' THEN 'manual'
        WHEN t.desired_number IS NOT NULL THEN 'baplie'
        WHEN t.profile_source = 'baplie' THEN NULL
        ELSE t.profile_source
      END AS n_profile_source,
      -- SOC/COC: B/L e correção manual são soberanos; fora do Baplie, cai o que veio dele.
      CASE
        WHEN t.ownership_source IN ('bl', 'manual') THEN t.ownership
        WHEN t.desired_number IS NOT NULL THEN t.d_ownership
        ELSE NULL
      END AS n_own,
      CASE
        WHEN t.ownership_source IN ('bl', 'manual') THEN t.ownership_source
        WHEN t.desired_number IS NOT NULL AND t.d_ownership IS NOT NULL THEN 'baplie'
        ELSE NULL
      END AS n_own_source,
      t.d_imo, t.d_oog
    FROM targets AS t
  )
  SELECT p.id, p.bl_id, p.container_number,
    CASE
      WHEN p.profile_source = 'manual' AND p.in_baplie
           AND (p.d_imo IS DISTINCT FROM COALESCE(p.o_imo, false) OR p.d_oog IS DISTINCT FROM COALESCE(p.o_oog, false))
        THEN 'divergent_manual'
      WHEN COALESCE(p.o_imo, false) IS NOT DISTINCT FROM p.n_imo
           AND COALESCE(p.o_oog, false) IS NOT DISTINCT FROM p.n_oog
           AND upper(COALESCE(p.o_class, '')) = upper(COALESCE(p.n_class, ''))
           AND upper(COALESCE(p.o_un, '')) = upper(COALESCE(p.n_un, ''))
           AND p.o_own IS NOT DISTINCT FROM p.n_own
        THEN CASE WHEN p.in_baplie AND p.profile_source IS DISTINCT FROM p.n_profile_source THEN 'source_only' ELSE 'unchanged' END
      WHEN NOT p.in_baplie THEN 'clear'
      ELSE 'apply'
    END,
    COALESCE(p.o_imo, false), p.o_class, p.o_un, COALESCE(p.o_oog, false), p.o_own,
    p.n_imo, p.n_class, p.n_un, p.n_oog, p.n_own, p.n_own_source, p.n_profile_source
  FROM planned AS p;
$function$;

REVOKE ALL ON FUNCTION public._baplie_flag_plan(bigint, jsonb) FROM PUBLIC, anon, authenticated;

-- Prévia: o que um arquivo novo faria, sem gravar (o que entra, o que cai e
-- onde há perfil manual divergente).
CREATE OR REPLACE FUNCTION public.preview_baplie_physical_flags(p_voyage_id bigint, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'apply', COALESCE(jsonb_agg(jsonb_build_object('container', p.container_number, 'bl_id', p.bl_id,
        'before', public._baplie_flags_label(p.old_is_imo, p.old_is_oog, p.old_ownership),
        'after', public._baplie_flags_label(p.new_is_imo, p.new_is_oog, p.new_ownership)) ORDER BY p.container_number, p.bl_id)
        FILTER (WHERE p.action = 'apply'), '[]'::jsonb),
      'clear', COALESCE(jsonb_agg(jsonb_build_object('container', p.container_number, 'bl_id', p.bl_id,
        'before', public._baplie_flags_label(p.old_is_imo, p.old_is_oog, p.old_ownership),
        'after', public._baplie_flags_label(p.new_is_imo, p.new_is_oog, p.new_ownership)) ORDER BY p.container_number, p.bl_id)
        FILTER (WHERE p.action = 'clear'), '[]'::jsonb),
      'divergent_manual', COALESCE(jsonb_agg(jsonb_build_object('container', p.container_number, 'bl_id', p.bl_id)
        ORDER BY p.container_number, p.bl_id) FILTER (WHERE p.action = 'divergent_manual'), '[]'::jsonb)
    )
    FROM public._baplie_flag_plan(p_voyage_id, COALESCE(p_rows, '[]'::jsonb)) AS p
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.preview_baplie_physical_flags(bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_baplie_physical_flags(bigint, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public._baplie_flags_label(p_imo boolean, p_oog boolean, p_ownership text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(NULLIF(concat_ws(', ',
    CASE WHEN p_imo THEN 'IMO' END,
    CASE WHEN p_oog THEN 'OOG' END,
    p_ownership), ''), 'sem marca');
$function$;

CREATE OR REPLACE FUNCTION public._apply_baplie_physical_flags_before_reissue_126(p_voyage_id bigint, p_changes jsonb, p_changed_by uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_filter text[] := NULL;
  v_item jsonb;
  v_num text;
  v_updated bigint[] := ARRAY[]::bigint[];
  v_cleared jsonb := '[]'::jsonb;
  v_applied_to jsonb := '[]'::jsonb;
  v_divergent jsonb := '[]'::jsonb;
  v_plan record;
  v_bl_id text;
  v_action_id uuid := gen_random_uuid();
  v_recalculated integer := 0;
  v_calc_errors jsonb := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_voyage_id IS NULL THEN
    RAISE EXCEPTION 'Viagem obrigatoria.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem % nao encontrada', p_voyage_id USING ERRCODE = 'P0002';
  END IF;

  IF p_changes IS NOT NULL THEN
    IF jsonb_typeof(p_changes) <> 'array' THEN
      RAISE EXCEPTION 'Filtro de flags invalido.' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_changes) LOOP
      v_num := CASE WHEN jsonb_typeof(v_item) = 'string' THEN upper(btrim(v_item #>> '{}'))
                    ELSE upper(btrim(COALESCE(v_item->>'container_number', ''))) END;
      IF NULLIF(v_num, '') IS NOT NULL THEN v_filter := array_append(v_filter, v_num); END IF;
    END LOOP;
  END IF;

  FOR v_plan IN
    SELECT * FROM public._baplie_flag_plan(p_voyage_id, NULL) AS p
    WHERE p.action IN ('apply', 'clear', 'divergent_manual', 'source_only')
      AND (v_filter IS NULL OR upper(btrim(p.container_number)) = ANY(v_filter))
    ORDER BY p.bl_container_id
  LOOP
    IF v_plan.action = 'divergent_manual' THEN
      v_divergent := v_divergent || jsonb_build_array(jsonb_build_object('container', v_plan.container_number, 'bl_id', v_plan.bl_id));
    END IF;
    UPDATE public.bl_containers AS c
       SET is_imo = v_plan.new_is_imo,
           imo_class = v_plan.new_imo_class,
           un_number = v_plan.new_un_number,
           is_oog = v_plan.new_is_oog,
           ownership = v_plan.new_ownership,
           ownership_source = v_plan.new_ownership_source,
           profile_source = v_plan.new_profile_source
     WHERE c.id = v_plan.bl_container_id
       AND (c.is_imo IS DISTINCT FROM v_plan.new_is_imo OR c.imo_class IS DISTINCT FROM v_plan.new_imo_class
            OR c.un_number IS DISTINCT FROM v_plan.new_un_number OR c.is_oog IS DISTINCT FROM v_plan.new_is_oog
            OR c.ownership IS DISTINCT FROM v_plan.new_ownership OR c.ownership_source IS DISTINCT FROM v_plan.new_ownership_source
            OR c.profile_source IS DISTINCT FROM v_plan.new_profile_source);
    IF FOUND AND v_plan.action IN ('apply', 'clear') THEN
      v_updated := array_append(v_updated, v_plan.bl_container_id);
      IF v_plan.action = 'clear' THEN
        v_cleared := v_cleared || jsonb_build_array(jsonb_build_object('container', v_plan.container_number, 'bl_id', v_plan.bl_id));
      ELSE
        v_applied_to := v_applied_to || jsonb_build_array(jsonb_build_object('container', v_plan.container_number, 'bl_id', v_plan.bl_id,
          'flags', public._baplie_flags_label(v_plan.new_is_imo, v_plan.new_is_oog, v_plan.new_ownership)));
      END IF;
    END IF;
  END LOOP;

  IF cardinality(v_updated) = 0 THEN
    RETURN jsonb_build_object('voyage_id', p_voyage_id, 'updated_ids', ARRAY[]::bigint[], 'applied', 0,
      'applied_to', v_applied_to, 'cleared', v_cleared, 'divergent_manual', v_divergent,
      'recalculated', 0, 'calculation_errors', '[]'::jsonb);
  END IF;

  v_role := public.current_actor_role();
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification, actor_role, actor_department)
  VALUES ('voyage', p_voyage_id::text, 'baplie_physical_flags',
    jsonb_build_object('voyage_id', p_voyage_id)::text,
    jsonb_build_object('voyage_id', p_voyage_id, 'updated_ids', v_updated, 'applied', cardinality(v_updated),
      'cleared', jsonb_array_length(v_cleared))::text,
    v_actor, 'Baplie: marcas físicas aplicadas a todos os B/Ls ativos do container (conjunto atômico)', v_role, v_role);

  FOR v_bl_id IN
    SELECT DISTINCT c.bl_id FROM public.bl_containers AS c JOIN public.bls AS b ON b.id = c.bl_id
    WHERE c.id = ANY (v_updated) AND COALESCE(b.financial_status, 'pending') NOT IN ('invoiced', 'partially_paid', 'paid')
    ORDER BY 1
  LOOP
    BEGIN
      PERFORM public.calculate_bl_local_charges(v_bl_id, v_actor, true);
      v_recalculated := v_recalculated + 1;
    EXCEPTION WHEN OTHERS THEN
      v_calc_errors := v_calc_errors || jsonb_build_array(jsonb_build_object('bl_id', v_bl_id, 'message', SQLERRM));
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
      VALUES ('bl', v_bl_id, 'local_charges_auto_calc_error', NULL, SQLERRM, v_actor, now(),
        'Falha no recalculo de taxas locais apos aplicar flags fisicas do Baplie');
      PERFORM public.enqueue_import_effect(v_action_id, 'provisional_charges', v_bl_id, v_actor, 1, NULL,
        jsonb_build_object('voyage_id', p_voyage_id, 'source', 'baplie_physical_flags'));
    END;
  END LOOP;

  RETURN jsonb_build_object('voyage_id', p_voyage_id, 'updated_ids', v_updated, 'applied', cardinality(v_updated),
    'applied_to', v_applied_to, 'cleared', v_cleared, 'divergent_manual', v_divergent,
    'recalculated', v_recalculated, 'calculation_errors', v_calc_errors);
END;
$function$;

-- 4. Vale o B/L: encerra a divergência com motivo.
CREATE OR REPLACE FUNCTION public.resolve_baplie_divergence(p_bl_container_id bigint, p_field text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_container public.bl_containers%ROWTYPE;
  v_voyage bigint;
  v_baplie text;
  v_bl_value text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_field NOT IN ('ownership', 'profile') THEN
    RAISE EXCEPTION 'Divergência inválida: %.', p_field USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo de valer o B/L.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_container FROM public.bl_containers WHERE id = p_bl_container_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Container % não encontrado.', p_bl_container_id USING ERRCODE = 'P0002';
  END IF;
  SELECT voyage_id INTO v_voyage FROM public.bls WHERE id = v_container.bl_id;

  IF p_field = 'ownership' THEN
    SELECT max(s.ownership) INTO v_baplie FROM public.baplie_containers AS s
    WHERE s.voyage_id = v_voyage AND upper(btrim(s.container_number)) = upper(btrim(v_container.container_number));
    v_bl_value := v_container.ownership;
    IF v_bl_value IS NOT NULL THEN
      UPDATE public.bl_containers SET ownership_source = 'manual' WHERE id = v_container.id;
    END IF;
  ELSE
    SELECT public._baplie_flags_label(bool_or(COALESCE(s.is_imo, false)), bool_or(COALESCE(s.is_oog, false)), NULL) INTO v_baplie
    FROM public.baplie_containers AS s
    WHERE s.voyage_id = v_voyage AND upper(btrim(s.container_number)) = upper(btrim(v_container.container_number));
    v_bl_value := public._baplie_flags_label(COALESCE(v_container.is_imo, false), COALESCE(v_container.is_oog, false), NULL);
    UPDATE public.bl_containers SET profile_source = 'manual' WHERE id = v_container.id;
  END IF;

  INSERT INTO public.baplie_reconciliation_resolutions
    (voyage_id, bl_container_id, field_name, baplie_value, manifest_value, resolution, resolved_by, justification)
  VALUES (v_voyage, v_container.id, p_field, COALESCE(v_baplie, ''), COALESCE(v_bl_value, ''), 'vale_o_bl', auth.uid(), v_reason)
  ON CONFLICT (voyage_id, bl_container_id, field_name, baplie_value, manifest_value, resolution)
  DO UPDATE SET resolved_by = EXCLUDED.resolved_by, resolved_at = now(), justification = EXCLUDED.justification;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bl', v_container.bl_id, 'baplie_divergence_' || p_field,
    jsonb_build_object('container', v_container.container_number, 'baplie', v_baplie)::text,
    jsonb_build_object('container', v_container.container_number, 'vale', v_bl_value)::text,
    auth.uid(), 'Vale o B/L: ' || v_reason);

  RETURN jsonb_build_object('bl_container_id', v_container.id, 'field', p_field, 'baplie_value', v_baplie, 'bl_value', v_bl_value);
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_baplie_divergence(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_baplie_divergence(bigint, text, text) TO authenticated;

-- 380: escrita direta fechada nas tabelas de carga e B/L cancelado somente
-- leitura também nos containers e veículos (ADR 0094, B1 e B4).
--
-- Problema: usuário interno ativo gravava direto (PostgREST) em
-- `bl_containers`, `baplie_containers`, `vehicles`, `vazios_*` e `granite_*`,
-- contornando as funções que conferem as regras e o rastro, como a 366 já
-- fechou em `bls`. B/L cancelado era somente leitura na ficha e nas
-- importações, mas os containers e veículos dele aceitavam alteração; a
-- planilha de datas gravava a data também no container do B/L cancelado.
--
-- Mudança:
--   1. `authenticated` perde INSERT e UPDATE nessas tabelas. Ficam liberados,
--      por coluna, só os pontos que a tela grava direto:
--      `bl_containers.unpacking_location` e
--      `vazios_importacao_containers.natureza`; `vazios_export_*`,
--      `voyages`, `vessels` e `carriers` continuam como estão. As importações
--      e correções passam pelas funções do sistema, que já gravam como dono.
--   2. Gatilho `guard_cancelled_bl_cargo` em `bl_containers` e `vehicles`:
--      linha de B/L cancelado não é criada, alterada nem apagada, salvo o
--      status de Demurrage que o sistema recalcula e a exclusão do próprio B/L
--      (ou da Viagem) pela exclusão com motivo e, até a frente das
--      importações deixar a aba VIN, o chassi que passa ao B/L reemitido.
--   3. A planilha de datas grava só nos B/Ls ativos do container.
--
-- Não altera nem apaga linhas existentes.

DO $grants_380$
DECLARE v_table text;
BEGIN
  FOR v_table IN
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
      AND (c.relname IN ('bl_containers', 'baplie_containers', 'vehicles')
           OR (c.relname LIKE 'vazios\_%' AND c.relname NOT LIKE 'vazios\_export\_%')
           OR c.relname LIKE 'granite\_%')
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM anon, authenticated', v_table);
  END LOOP;
END;
$grants_380$;
GRANT UPDATE (unpacking_location) ON public.bl_containers TO authenticated;
GRANT UPDATE (natureza) ON public.vazios_importacao_containers TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_cancelled_bl_cargo()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_bl text;
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('vela.deleting_records', true) = 'on' THEN
    RETURN OLD;
  END IF;
  SELECT b.id INTO v_bl FROM public.bls b
  WHERE b.cancelled_at IS NOT NULL
    AND b.id IN (CASE WHEN TG_OP <> 'INSERT' THEN OLD.bl_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.bl_id END)
  LIMIT 1;
  IF v_bl IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  -- ponytail: o chassi do B/L cancelado ainda passa ao B/L reemitido pelo
  -- arquivo de B/L (aba VIN, A3 da auditoria das importações). A frente das
  -- importações deixa de ler a aba VIN; com isso esta exceção sai.
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'vehicles'
     AND EXISTS (SELECT 1 FROM public.bls b WHERE b.id = NEW.bl_id AND b.cancelled_at IS NULL)
     AND (to_jsonb(NEW) - ARRAY['bl_id', 'container_id', 'voyage_id', 'updated_at'])
       = (to_jsonb(OLD) - ARRAY['bl_id', 'container_id', 'voyage_id', 'updated_at']) THEN
    RETURN NEW;
  END IF;
  -- O status de Demurrage é derivado e recalculado pelo sistema (197, 200).
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'bl_containers'
     AND public._voyage_cancelled_financial_only('bl_containers', to_jsonb(OLD), to_jsonb(NEW)) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'B/L % cancelado é somente leitura: reative o B/L pela ficha para alterar containers ou veículos.', v_bl
    USING ERRCODE = '22023';
END;
$$;
REVOKE ALL ON FUNCTION public.guard_cancelled_bl_cargo() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_cancelled_bl_cargo
  BEFORE INSERT OR UPDATE OR DELETE ON public.bl_containers
  FOR EACH ROW EXECUTE FUNCTION public.guard_cancelled_bl_cargo();
CREATE TRIGGER guard_cancelled_bl_cargo
  BEFORE INSERT OR UPDATE OR DELETE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.guard_cancelled_bl_cargo();

-- Exclusão com motivo leva a carga do B/L cancelado.
CREATE OR REPLACE FUNCTION public.delete_records(p_kind text, p_ids text[], p_dry_run boolean DEFAULT false, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id text;
  v_count integer;
  v_deleted jsonb := '[]'::jsonb;
  v_blocked jsonb := '[]'::jsonb;
  v_state text;
  v_message text;
  v_constraint text;
  v_entity text;
  v_lock text[];
  v_status text;
  v_bl_id text;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_bl_voyage bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo pode excluir.' USING ERRCODE = '42501';
  END IF;

  v_entity := CASE p_kind
    WHEN 'bl' THEN 'bl'
    WHEN 'container' THEN 'container'
    WHEN 'vehicle' THEN 'vehicle'
    WHEN 'customer' THEN 'customer'
    WHEN 'voyage' THEN 'voyages'
  END;
  IF v_entity IS NULL THEN
    RAISE EXCEPTION 'Tipo de exclusão desconhecido: %.', p_kind USING ERRCODE = '22023';
  END IF;
  IF NOT COALESCE(p_dry_run, false) AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da exclusão.' USING ERRCODE = '22023';
  END IF;

  FOREACH v_id IN ARRAY ARRAY(
    SELECT u.id FROM unnest(COALESCE(p_ids, ARRAY[]::text[])) WITH ORDINALITY AS u(id, ord)
    GROUP BY u.id ORDER BY min(u.ord)
  ) LOOP
    BEGIN
      v_lock := ARRAY[]::text[];
      IF p_kind = 'voyage' THEN
        SELECT status INTO v_status FROM public.voyages WHERE id = v_id::bigint;
        IF FOUND AND v_status = 'cancelled' THEN
          v_lock := ARRAY['viagem cancelada fica retida'];
        ELSE
          v_lock := public.delete_lock_reasons(v_id::bigint);
        END IF;
      ELSIF p_kind = 'customer' THEN
        IF EXISTS (SELECT 1 FROM public.customers c WHERE c.id = v_id::bigint AND NULLIF(btrim(c.cnpj_cpf), '') IS NOT NULL) THEN
          v_lock := ARRAY['cliente com CNPJ: desative em vez de excluir'];
        END IF;
      ELSE
        v_bl_id := CASE p_kind
          WHEN 'bl' THEN v_id
          WHEN 'container' THEN (SELECT c.bl_id FROM public.bl_containers c WHERE c.id = v_id::bigint)
          ELSE (SELECT COALESCE(v.bl_id, c.bl_id) FROM public.vehicles v
                LEFT JOIN public.bl_containers c ON c.id = v.container_id WHERE v.id = v_id::bigint)
        END;
        v_lock := public.bl_delete_lock_reasons(v_bl_id);
      END IF;
      IF cardinality(v_lock) > 0 THEN
        v_blocked := v_blocked || jsonb_build_object('id', v_id, 'reasons', to_jsonb(v_lock));
        CONTINUE;
      END IF;

      -- 380: a exclusão do B/L (ou da Viagem) leva junto os containers e
      -- veículos, mesmo de B/L cancelado, que é somente leitura no resto.
      PERFORM set_config('vela.deleting_records', CASE WHEN p_kind IN ('voyage', 'bl') THEN 'on' ELSE 'off' END, true);
      IF p_kind = 'voyage' THEN
        PERFORM public.delete_voyage_children(v_id::bigint);
        DELETE FROM public.voyages WHERE id = v_id::bigint;
      ELSIF p_kind = 'bl' THEN
        SELECT b.voyage_id INTO v_bl_voyage FROM public.bls AS b WHERE b.id = v_id;
        DELETE FROM public.vehicles WHERE bl_id = v_id;
        DELETE FROM public.bls WHERE id = v_id;
      ELSIF p_kind = 'container' THEN
        DELETE FROM public.vehicles WHERE container_id = v_id::bigint;
        DELETE FROM public.bl_containers WHERE id = v_id::bigint;
      ELSIF p_kind = 'vehicle' THEN
        DELETE FROM public.vehicles WHERE id = v_id::bigint;
      ELSE
        DELETE FROM public.customer_contacts WHERE customer_id = v_id::bigint;
        DELETE FROM public.customer_rate_overrides WHERE customer_id = v_id::bigint;
        DELETE FROM public.customers WHERE id = v_id::bigint;
      END IF;
      GET DIAGNOSTICS v_count = ROW_COUNT;

      IF v_count = 0 THEN
        v_blocked := v_blocked || jsonb_build_object('id', v_id, 'reasons', jsonb_build_array('não encontrado'));
      ELSIF p_dry_run THEN
        RAISE EXCEPTION USING ERRCODE = 'VL001';
      ELSE
        INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
        VALUES (v_entity, v_id, 'deleted', v_id, NULL, auth.uid(), v_reason);
        IF p_kind = 'bl' AND v_bl_voyage IS NOT NULL THEN
          INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
          VALUES ('voyages', v_bl_voyage::text, 'bl_deleted', v_id, 'excluído', auth.uid(), v_reason);
        END IF;
        v_deleted := v_deleted || to_jsonb(v_id);
      END IF;
    EXCEPTION
      WHEN SQLSTATE 'VL001' THEN
        v_deleted := v_deleted || to_jsonb(v_id);
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS
          v_state = RETURNED_SQLSTATE,
          v_message = MESSAGE_TEXT,
          v_constraint = CONSTRAINT_NAME;
        v_blocked := v_blocked || jsonb_build_object(
          'id', v_id,
          'reasons', jsonb_build_array(public.delete_record_block_reason(v_state, v_message, v_constraint))
        );
    END;
  END LOOP;

  RETURN jsonb_build_object('deleted', v_deleted, 'blocked', v_blocked, 'dry_run', p_dry_run);
END;
$function$;

-- Planilha de datas: só B/Ls ativos.
CREATE OR REPLACE FUNCTION public._apply_container_dates_core(p_container_id bigint, p_discharge date, p_return date, p_keep_return boolean)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_number text;
  v_voyage_id bigint;
  v_bls text[];
  v_conflict record;
BEGIN
  SELECT upper(btrim(c.container_number)), b.voyage_id INTO v_number, v_voyage_id
  FROM public.bl_containers AS c JOIN public.bls AS b ON b.id = c.bl_id
  WHERE c.id = p_container_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Container % nao encontrado.', p_container_id USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.bl_containers AS c
  JOIN public.bls AS b ON b.id = c.bl_id
  WHERE (c.id = p_container_id)
     OR (upper(btrim(c.container_number)) = v_number AND b.voyage_id = v_voyage_id AND b.cancelled_at IS NULL)
  ORDER BY c.id
  FOR UPDATE OF c;

  -- A data que ficaria gravada não pode ter devolução antes da descarga
  -- (CHECK `bl_containers_return_after_discharge_chk`): com a devolução vazia
  -- na planilha, a gravada é mantida e a descarga nova pode passar dela.
  SELECT c.container_number, CASE WHEN p_keep_return THEN c.return_date ELSE p_return END AS return_date
    INTO v_conflict
  FROM public.bl_containers AS c
  JOIN public.bls AS b ON b.id = c.bl_id
  WHERE b.cancelled_at IS NULL
    AND ((c.id = p_container_id)
         OR (upper(btrim(c.container_number)) = v_number AND b.voyage_id = v_voyage_id AND b.cancelled_at IS NULL))
    AND p_discharge IS NOT NULL
    AND CASE WHEN p_keep_return THEN c.return_date ELSE p_return END < p_discharge
    -- Só a linha que o UPDATE abaixo vai escrever.
    AND (c.discharge_date IS DISTINCT FROM p_discharge
         OR (NOT p_keep_return AND c.return_date IS DISTINCT FROM p_return))
  ORDER BY c.id
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'A descarga informada (%) do container % é posterior à devolução % (%). Informe a devolução corrigida junto com a descarga, ou remova a devolução pela edição do container, com motivo.',
      to_char(p_discharge, 'DD/MM/YYYY'), upper(btrim(v_conflict.container_number)),
      CASE WHEN p_keep_return THEN 'gravada' ELSE 'informada' END,
      to_char(v_conflict.return_date, 'DD/MM/YYYY')
      USING ERRCODE = '22023';
  END IF;

  WITH targets AS (
    SELECT c.id
    FROM public.bl_containers AS c
    JOIN public.bls AS b ON b.id = c.bl_id
    -- 380 (ADR 0094, B4): a data vai só aos B/Ls ativos do container; o
    -- cancelado é somente leitura e fica como está.
    WHERE b.cancelled_at IS NULL
      AND ((c.id = p_container_id)
       OR (upper(btrim(c.container_number)) = v_number AND b.voyage_id = v_voyage_id AND b.cancelled_at IS NULL))
    ORDER BY c.id
    FOR UPDATE OF c
  ), changed AS (
    UPDATE public.bl_containers AS c
       SET discharge_date = p_discharge,
           return_date = CASE WHEN p_keep_return THEN c.return_date ELSE p_return END
      FROM targets
     WHERE c.id = targets.id
       AND (c.discharge_date IS DISTINCT FROM p_discharge
            OR (NOT p_keep_return AND c.return_date IS DISTINCT FROM p_return))
     RETURNING c.bl_id
  )
  SELECT COALESCE(array_agg(DISTINCT bl_id), ARRAY[]::text[]) INTO v_bls FROM changed;
  RETURN v_bls;
END;
$function$;

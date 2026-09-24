-- Migration 077: importação do Baplie aberta a todo Departamento interno ativo.
--
-- Decisão de 2026-09-23 (plano docs/plans/2026-09-23-alinhamento-apresentacao-docs-codigo.md,
-- R1): o Alerta "Baplie ausente" é da Documentação e a ADR 0046 libera a
-- escrita interna a todo Departamento. A RPC deixa de exigir is_admin(); a
-- sessão continua obrigatória e ativa e a tela pede confirmação antes de
-- substituir um Baplie existente.
--
-- Com a importação aberta, o autor precisa ser confiável: imported_by passa a
-- vir da sessão (auth.uid()), não do corpo enviado pela tela, e cada
-- importação grava em audit_logs um evento da Viagem ('baplie_import') com a
-- quantidade de containers antes e depois. Assim "quem substituiu o Baplie
-- desta viagem, e quando?" tem resposta mesmo depois que o Baplie anterior foi
-- apagado.
-- Não reescreve linhas existentes.

CREATE OR REPLACE FUNCTION public.import_baplie_staging_transactional(p_voyage_id bigint, p_rows jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_count INTEGER := COALESCE(jsonb_array_length(p_rows), 0);
  v_actor UUID := auth.uid();
  v_previous INTEGER := 0;
  v_role TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para importar Baplie.' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('alerts.baplie_coverage_deferred', 'on', true);

  SELECT count(*) INTO v_previous
  FROM public.baplie_containers
  WHERE voyage_id = p_voyage_id;

  DELETE FROM public.baplie_containers
  WHERE voyage_id = p_voyage_id;

  IF v_count > 0 THEN
    INSERT INTO public.baplie_containers (
      voyage_id,
      container_number,
      size_type,
      status,
      weight_kg,
      pol,
      pod,
      final_dest,
      bl_ref,
      slot,
      is_imo,
      imo_class,
      un_number,
      is_oog,
      imported_by
    )
    SELECT
      p_voyage_id,
      row.container_number,
      row.size_type,
      row.status,
      row.weight_kg,
      row.pol,
      row.pod,
      row.final_dest,
      row.bl_ref,
      row.slot,
      row.is_imo,
      row.imo_class,
      row.un_number,
      row.is_oog,
      v_actor
    FROM jsonb_to_recordset(p_rows) AS row(
      container_number TEXT,
      size_type TEXT,
      status TEXT,
      weight_kg NUMERIC,
      pol TEXT,
      pod TEXT,
      final_dest TEXT,
      bl_ref TEXT,
      slot TEXT,
      is_imo BOOLEAN,
      imo_class TEXT,
      un_number TEXT,
      is_oog BOOLEAN
    );
  END IF;

  v_role := public.current_actor_role();
  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, justification, actor_role, actor_department
  ) VALUES (
    'voyage', p_voyage_id::text, 'baplie_import',
    v_previous::text, v_count::text,
    v_actor,
    CASE WHEN v_previous > 0 THEN 'Baplie substituído' ELSE 'Baplie importado' END,
    v_role, v_role
  );

  PERFORM set_config('alerts.baplie_coverage_deferred', 'off', true);
  PERFORM public.reconcile_voyage_baplie_coverage_alerts(p_voyage_id, 'baplie_coverage_import');
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.import_baplie_staging_transactional(bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_baplie_staging_transactional(bigint, jsonb) TO authenticated;

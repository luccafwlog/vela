-- Migration 077: importação do Baplie aberta a todo Departamento interno ativo.
--
-- Decisão de 2026-09-23 (plano docs/plans/2026-09-23-alinhamento-apresentacao-docs-codigo.md,
-- R1): o Alerta "Baplie ausente" é da Documentação e a ADR 0046 libera a
-- escrita interna a todo Departamento. A RPC deixa de exigir is_admin(); a
-- sessão continua obrigatória e ativa, o autor segue em imported_by e a tela
-- pede confirmação antes de substituir um Baplie existente.
-- Não reescreve linhas existentes.

CREATE OR REPLACE FUNCTION public.import_baplie_staging_transactional(p_voyage_id bigint, p_rows jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_count INTEGER := COALESCE(jsonb_array_length(p_rows), 0);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para importar Baplie.' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('alerts.baplie_coverage_deferred', 'on', true);

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
      row.imported_by
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
      is_oog BOOLEAN,
      imported_by UUID
    );
  END IF;

  PERFORM set_config('alerts.baplie_coverage_deferred', 'off', true);
  PERFORM public.reconcile_voyage_baplie_coverage_alerts(p_voyage_id, 'baplie_coverage_import');
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.import_baplie_staging_transactional(bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_baplie_staging_transactional(bigint, jsonb) TO authenticated;

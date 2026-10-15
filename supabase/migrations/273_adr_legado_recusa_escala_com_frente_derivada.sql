-- 273: o ADR legado por porto também é recusado quando a escala tem frente de
-- operação derivada dos dados, não só gravada (revisão da PR 954; item B6,
-- migration 259; ADR 0035).
--
-- Problema: a 259 recusava o ADR sem terminal só quando havia linha em
-- `voyage_escala_operation_fronts`, que nasce quando alguém salva o editor de
-- terminais da escala. A aba ADR usa as frentes derivadas
-- (`deriveOperationFronts`, `src/services/escalaTerminalAllocation.ts`): B/Ls
-- com POD no porto, vazios de importação e exportação declarada. Numa escala
-- com B/Ls cujo editor nunca foi salvo, a aba mostrava "Nenhum terminal
-- atribuído às frentes desta escala (TBC)", mas assinar ou fechar pela API
-- ainda criava e fechava o ADR legado, sem a trava das frentes TBC.
--
-- Mudança: `_escala_has_operation_fronts` reúne as fontes que a tela usa e
-- `ensure_agency_departure_report` recusa o ADR legado novo quando alguma
-- existe. O ADR legado que já existe continua operável.
--
-- ponytail: a tela também deriva a frente de importação do marcador
-- "tem importação" da escala, projetado de `audit_logs`
-- (`voyageRouteSchedules.ts`). Esse marcador sozinho, sem B/L, vazio nem
-- exportação, não entra aqui: a escala declarada e ainda sem carga pode abrir o
-- ADR legado pela API. Espelhar a projeção no banco é o caminho se isso
-- importar.
--
-- Só redefine e cria funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar `ensure_agency_departure_report` da migration 259 e
-- apagar `_escala_has_operation_fronts`.

CREATE OR REPLACE FUNCTION public._escala_has_operation_fronts(p_voyage_id bigint, p_port text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
      SELECT 1 FROM public.voyage_escala_operation_fronts AS f
      WHERE f.voyage_id = p_voyage_id AND upper(btrim(f.port)) = upper(btrim(p_port))
    ) OR EXISTS (
      SELECT 1 FROM public.bls AS b
      WHERE b.voyage_id = p_voyage_id
        AND public.normalize_port_code(b.pod) = public.normalize_port_code(p_port)
    ) OR EXISTS (
      SELECT 1
      FROM public.vazios_importacao_containers AS c
      JOIN public.vazios_importacao_manifests AS m ON m.id = c.manifest_id
      WHERE m.voyage_id = p_voyage_id
        AND public.normalize_port_code(c.pod) = public.normalize_port_code(p_port)
    ) OR EXISTS (
      SELECT 1 FROM public.voyage_export_schedules AS e
      WHERE e.voyage_id = p_voyage_id
        AND public.normalize_port_code(e.pol) = public.normalize_port_code(p_port)
        AND e.tem_exportacao
        AND (e.has_granite OR e.has_empty)
    );
$function$;

REVOKE ALL ON FUNCTION public._escala_has_operation_fronts(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._escala_has_operation_fronts(bigint, text) TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_agency_departure_report(p_voyage_id bigint, p_port text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_report_id UUID;
  v_port TEXT := upper(btrim(COALESCE(p_port, '')));
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  IF v_port = '' THEN
    RAISE EXCEPTION 'Porto obrigatorio.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_report_id
  FROM public.agency_departure_reports
  WHERE voyage_id = p_voyage_id AND port = v_port AND terminal_id IS NULL
  FOR UPDATE;
  IF FOUND THEN
    RETURN v_report_id;
  END IF;

  -- B6: escala com frente de operação (gravada ou derivada dos dados, como na
  -- aba ADR) é do modelo terminalizado. Sem terminal atribuído (frentes TBC)
  -- não há ADR a abrir; o ADR legado por porto só continua para as escalas sem
  -- frente e para os relatórios que já existem.
  IF public._escala_has_operation_fronts(p_voyage_id, v_port) THEN
    RAISE EXCEPTION 'Escala com frentes de operacao: atribua o terminal as frentes para abrir o ADR do terminal.'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.agency_departure_reports (voyage_id, port)
  VALUES (p_voyage_id, v_port)
  RETURNING id INTO v_report_id;
  RETURN v_report_id;
END;
$function$;

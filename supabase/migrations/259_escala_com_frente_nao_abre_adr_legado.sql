-- Item 33 (B6) do plano 2026-10-14: escala com frente de operação não cai no
-- ADR legado (por porto, sem terminal). Antes, com as frentes TBC, a primeira
-- escrita criava um ADR sem terminal que podia ser assinado e fechado sem a
-- trava de frente TBC (ADR 0035; ADR 0083, item 26). Só redefine a função;
-- não reescreve nem apaga linhas.

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

  -- B6: escala com frente de operação é do modelo terminalizado. Sem terminal
  -- atribuído (frentes TBC) não há ADR a abrir; o ADR legado por porto só
  -- continua para as escalas sem frente e para os relatórios que já existem.
  IF EXISTS (
    SELECT 1 FROM public.voyage_escala_operation_fronts AS f
    WHERE f.voyage_id = p_voyage_id AND upper(btrim(f.port)) = v_port
  ) THEN
    RAISE EXCEPTION 'Escala com frentes de operacao: atribua o terminal as frentes para abrir o ADR do terminal.'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.agency_departure_reports (voyage_id, port)
  VALUES (p_voyage_id, v_port)
  RETURNING id INTO v_report_id;
  RETURN v_report_id;
END;
$function$;

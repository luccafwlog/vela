-- 538: o Granito importado entra no ADR por terminal, e o fechamento confere
-- a frente dele como confere as de importação (537).
--
-- Problema (mapeamento de 2026-10-30, docs/archive/audits/
-- viagem-terminal-adr-2026-10-30.md): a frente `exportacao:granito` só nascia
-- da declaração de exportação da escala ("tem exportação" + Granito), e a
-- importação do Granito não mexe na declaração. Granito importado num porto
-- sem a declaração ficava sem frente, e a seção Carga carregada do ADR por
-- terminal escondia o Granito. A tela passa a derivar a frente do Granito
-- gravado (`fetchEscalaTerminalState`) e Editar escala abre com o Granito
-- declarado quando há Granito no porto.
--
-- Mudança: `_escala_fronts_without_terminal` devolve, como 'sentido:modalidade',
-- as frentes que a tela deriva dos dados sem frente gravada com terminal — as
-- de importação da 537 e a de Granito (B/L pelo porto de carregamento, com o
-- do manifesto na falta dele, a régua do ADR e da migration 412) —, e
-- `assert_voyage_escala_ready_for_report_close` passa a usá-la. A mensagem
-- lista as frentes ("Frente TBC impede o fechamento do ADR: granito, veículos.").
--
-- ponytail: fonte nova de frente derivada (o Embarque de vazios, por exemplo)
-- entra nesta função e em `fetchEscalaTerminalState`, nos dois lados.
--
-- Só cria e redefine funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar `assert_voyage_escala_ready_for_report_close` da 537 e
-- apagar `_escala_fronts_without_terminal`.

CREATE OR REPLACE FUNCTION public._escala_fronts_without_terminal(p_voyage_id bigint, p_port text)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(array_agg(f ORDER BY f), ARRAY[]::text[])
  FROM (
    SELECT 'importacao:' || m AS f
    FROM unnest(public._escala_import_fronts_without_terminal(p_voyage_id, p_port)) AS m
    UNION
    SELECT 'exportacao:granito'
    WHERE EXISTS (
      SELECT 1
      FROM public.granite_bls AS b
      JOIN public.granite_manifests AS gm ON gm.id = b.manifest_id
      WHERE gm.voyage_id = p_voyage_id
        AND public.normalize_port_code(COALESCE(b.loading_port, gm.loading_port)) = public.normalize_port_code(p_port)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.voyage_escala_operation_fronts AS fr
      WHERE fr.voyage_id = p_voyage_id
        AND upper(btrim(fr.port)) = upper(btrim(p_port))
        AND fr.sentido = 'exportacao'
        AND fr.modalidade = 'granito'
        AND fr.terminal_id IS NOT NULL
    )
  ) AS fronts;
$function$;

REVOKE ALL ON FUNCTION public._escala_fronts_without_terminal(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._escala_fronts_without_terminal(bigint, text) TO service_role;

CREATE OR REPLACE FUNCTION public.assert_voyage_escala_ready_for_report_close(p_voyage_id bigint, p_port text, p_report_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_port TEXT := upper(btrim(COALESCE(p_port, '')));
  v_port_id BIGINT;
  v_report RECORD;
  v_terminal_code TEXT;
  v_terminal_tipo TEXT;
  v_terminal_port_id BIGINT;
  v_sem_terminal TEXT[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  SELECT p.id
  INTO v_port_id
  FROM public.ports AS p
  WHERE upper(btrim(p.locode)) = v_port
    AND upper(btrim(p.locode)) LIKE 'BR%'
  ORDER BY p.id
  LIMIT 1;
  IF v_port_id IS NULL THEN
    RAISE EXCEPTION 'Porto brasileiro % nao encontrado.', v_port USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  SELECT r.id, r.voyage_id, r.port, r.terminal_id, r.terminal_port_id
  INTO v_report
  FROM public.agency_departure_reports AS r
  WHERE r.id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report_id nao pertence a escala %::%.', p_voyage_id, v_port
      USING ERRCODE = '23514';
  END IF;
  IF v_report.voyage_id <> p_voyage_id
     OR upper(btrim(v_report.port)) <> v_port THEN
    RAISE EXCEPTION 'report_id nao pertence a escala %::%.', p_voyage_id, v_port
      USING ERRCODE = '23514';
  END IF;

  SELECT d.code, d.tipo, d.port_id
  INTO v_terminal_code, v_terminal_tipo, v_terminal_port_id
  FROM public.depots AS d
  WHERE d.id = v_report.terminal_id;
  IF v_report.terminal_id IS NULL OR v_report.terminal_port_id IS NULL THEN
    RAISE EXCEPTION 'report_id deve referenciar ADR terminalizado do porto %.', v_port
      USING ERRCODE = '23514';
  END IF;
  IF v_terminal_tipo IS DISTINCT FROM 'terminal_portuario'
     OR v_terminal_port_id IS DISTINCT FROM v_port_id
     OR v_report.terminal_port_id IS DISTINCT FROM v_port_id THEN
    RAISE EXCEPTION 'report_id deve referenciar ADR terminalizado do porto %.', v_port
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.voyage_escala_operation_fronts AS f
    WHERE f.voyage_id = p_voyage_id AND f.port = v_port AND f.terminal_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Frente TBC impede o fechamento do ADR.'
      USING ERRCODE = '23514', DETAIL = 'Atribua todas as frentes a um terminal antes do fechamento.';
  END IF;

  -- 537/538: a frente que a aba deriva dos dados (B/L, veículo, vazio de
  -- importação, Granito) e que ainda não foi gravada com terminal também é TBC.
  v_sem_terminal := public._escala_fronts_without_terminal(p_voyage_id, v_port);
  IF cardinality(v_sem_terminal) > 0 THEN
    RAISE EXCEPTION 'Frente TBC impede o fechamento do ADR: %.', (
        SELECT string_agg(label, ', ' ORDER BY label)
        FROM (
          SELECT CASE f
              WHEN 'importacao:carga_cheia' THEN 'carga cheia'
              WHEN 'importacao:carga_solta' THEN 'carga solta'
              WHEN 'importacao:vazio' THEN 'vazios de importação'
              WHEN 'importacao:veiculo' THEN 'veículos'
              WHEN 'exportacao:granito' THEN 'granito'
              WHEN 'exportacao:vazio' THEN 'embarque de vazios'
              ELSE f
            END AS label
          FROM unnest(v_sem_terminal) AS f
        ) AS labels
      )
      USING ERRCODE = '23514', DETAIL = 'Atribua o terminal destas frentes em Editar escala antes do fechamento.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.voyage_escala_operation_fronts AS f
    WHERE f.voyage_id = p_voyage_id AND f.port = v_port
      AND f.terminal_id = v_report.terminal_id
  ) THEN
    RAISE EXCEPTION 'ADR % nao corresponde a terminal atribuido na escala.', v_terminal_code
      USING ERRCODE = '23514';
  END IF;
END;
$function$;

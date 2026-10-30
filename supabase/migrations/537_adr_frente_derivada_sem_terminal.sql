-- 537: o ADR por terminal não fecha enquanto a escala tiver frente de
-- importação derivada dos dados e ainda sem terminal (veículos, vazios, carga).
--
-- Problema (teste do dono em BRVIX, 2026-10-30): veículos e vazios de
-- importação apareciam nos cards do porto da aba Importação e não no ADR.
--   1. A frente `importacao:veiculo` nunca era derivada: a tela a tirava de
--      `bls.cargo_mode = 'veiculo'`, valor que não existe (o B/L é
--      `container`, `carga_solta` ou `misto`; o veículo viaja em container).
--      A seção Veículos do ADR por terminal ficava sem frente e escondia os
--      veículos. Corrigido na tela (`fetchEscalaTerminalState`): a frente nasce
--      do veículo gravado nos B/Ls da escala.
--   2. A frente derivada dos dados (vazios de importação importados, por
--      exemplo, depois da última gravação de Editar escala) fica TBC até
--      alguém salvar a escala com terminal. A aba mostrava "Não há frente
--      atribuída a este terminal." e o fechamento só recusava a frente TBC
--      gravada (`voyage_escala_operation_fronts.terminal_id IS NULL`): o ADR
--      fechava, e congelava o retrato, sem os vazios.
--
-- Mudança: `_escala_import_fronts_without_terminal` lista as frentes de
-- importação que a tela deriva dos dados da escala (B/L por `cargo_mode`,
-- com o misto nas duas; vazio de importação; veículo) sem frente gravada com
-- terminal, e `assert_voyage_escala_ready_for_report_close` recusa o
-- fechamento quando a lista não é vazia. O resto do corpo é o da 509.
--
-- ponytail: espelha as fontes de importação de `fetchEscalaTerminalState`
-- (`src/services/escalaTerminalAllocation.ts`), como a 273 espelha em
-- `_escala_has_operation_fronts`. Fora dele: o marcador "tem importação" da
-- escala (projeção de `audit_logs`) e as frentes de exportação derivadas da
-- declaração (Granito e Embarque de vazios), que a tela já bloqueia. Fonte
-- nova de frente derivada entra nos dois lados.
--
-- Só cria e redefine funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar `assert_voyage_escala_ready_for_report_close` da 509 e
-- apagar `_escala_import_fronts_without_terminal`.

CREATE OR REPLACE FUNCTION public._escala_import_fronts_without_terminal(p_voyage_id bigint, p_port text)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH derived AS (
    SELECT DISTINCT kind
    FROM public.bls AS b
    CROSS JOIN LATERAL unnest(
      CASE WHEN lower(btrim(COALESCE(b.cargo_mode, ''))) = 'misto'
        THEN ARRAY['carga_cheia', 'carga_solta']
        ELSE ARRAY[public.bl_operation_front_modalidade(b.cargo_mode)]
      END
    ) AS kind
    WHERE b.voyage_id = p_voyage_id
      AND public.normalize_port_code(b.pod) = public.normalize_port_code(p_port)
    UNION
    SELECT 'vazio'
    WHERE EXISTS (
      SELECT 1
      FROM public.vazios_importacao_containers AS c
      JOIN public.vazios_importacao_manifests AS m ON m.id = c.manifest_id
      WHERE m.voyage_id = p_voyage_id
        AND public.normalize_port_code(c.pod) = public.normalize_port_code(p_port)
    )
    UNION
    SELECT 'veiculo'
    WHERE EXISTS (
      SELECT 1
      FROM public.vehicles AS v
      JOIN public.bls AS b ON b.id = v.bl_id
      WHERE b.voyage_id = p_voyage_id
        AND public.normalize_port_code(b.pod) = public.normalize_port_code(p_port)
    )
  )
  SELECT COALESCE(array_agg(d.kind ORDER BY d.kind), ARRAY[]::text[])
  FROM derived AS d
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.voyage_escala_operation_fronts AS f
    WHERE f.voyage_id = p_voyage_id
      AND upper(btrim(f.port)) = upper(btrim(p_port))
      AND f.sentido = 'importacao'
      AND f.modalidade = d.kind
      AND f.terminal_id IS NOT NULL
  );
$function$;

REVOKE ALL ON FUNCTION public._escala_import_fronts_without_terminal(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._escala_import_fronts_without_terminal(bigint, text) TO service_role;

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

  -- 537: a frente que a aba deriva dos dados (veículos, vazios, B/Ls) e que
  -- ainda não foi gravada com terminal também é TBC.
  v_sem_terminal := public._escala_import_fronts_without_terminal(p_voyage_id, v_port);
  IF cardinality(v_sem_terminal) > 0 THEN
    RAISE EXCEPTION 'Frente TBC impede o fechamento do ADR: importação de %.', (
        SELECT string_agg(CASE m
            WHEN 'carga_cheia' THEN 'carga cheia'
            WHEN 'carga_solta' THEN 'carga solta'
            WHEN 'vazio' THEN 'vazios'
            WHEN 'veiculo' THEN 'veículos'
            ELSE m
          END, ', ' ORDER BY m)
        FROM unnest(v_sem_terminal) AS m
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

-- 547: o Embarque de vazios anterior à 541 sem frente Vazios EXP com terminal
-- é frente TBC do ADR por terminal; a exceção de terminal do B/L em transbordo
-- não decide o ADR da escala de descarga (revisão da release
-- luccafwlog/vela#1117).
--
-- Problema:
--   1. Embarque antigo. A 541 (ADR 0113) exige a frente Vazios EXP com
--      terminal para criar o embarque, mas manteve os que já existiam sem ela.
--      Esse embarque não era fonte de frente: `_escala_fronts_without_terminal`
--      (538) e a aba ADR (`fetchEscalaTerminalState`) o ignoravam. O ADR por
--      terminal da escala fechava sem a seção Embarque de vazios, e a trava do
--      ADR fechado (`_vazios_export_locked_by_adr`) não pegava o embarque,
--      contra a ADR 0113 ("o embarque sempre cai no ADR de Saída de um
--      terminal"). `_escala_has_operation_fronts` (540) também não o contava, e
--      a escala com só esse embarque ainda abria ADR legado pela API.
--   2. Transbordo com exceção de terminal. O B/L em transbordo mantém o POD e
--      a exceção de terminal do porto omitido; a aba ADR da escala de descarga
--      recortava a carga e os veículos dele pela exceção, de outro porto, e eles
--      sumiam de todos os ADRs de lá. O recorte é da tela
--      (`escalaBlTerminalException`, `src/services/agencyDepartureReport.ts`):
--      no banco, a frente que esse B/L cria na escala de descarga já não
--      depende da exceção (539), e nada no banco recorta o conteúdo do ADR por
--      terminal. Esta migration não muda nada para o item 2; o teste local-pg
--      prende a regra. A exceção continua gravada no B/L, porque a omissão
--      pode ser revertida.
--
-- Mudança: `_escala_fronts_without_terminal` devolve 'exportacao:vazio' quando
-- há Embarque de vazios no porto (régua de porto normalizada, como a 541) sem a
-- frente Vazios EXP com terminal gravada; a mensagem do fechamento já tem o
-- rótulo ("embarque de vazios", 538). `_escala_has_operation_fronts` passa a
-- contar o embarque, como a aba. Definir o terminal pela tela do embarque
-- (`create_vazios_export_operation`) ou em Editar escala tira a frente da lista.
--
-- Só redefine duas funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar `_escala_fronts_without_terminal` da 538 e
-- `_escala_has_operation_fronts` da 540.

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
    UNION
    -- 547: Embarque de vazios anterior à 541, sem a frente Vazios EXP com terminal.
    SELECT 'exportacao:vazio'
    WHERE EXISTS (
      SELECT 1
      FROM public.vazios_export_operations AS o
      WHERE o.voyage_id = p_voyage_id
        AND COALESCE(public.normalize_port_code(o.embark_port), upper(btrim(o.embark_port)))
          = COALESCE(public.normalize_port_code(p_port), upper(btrim(p_port)))
    )
    AND public._vazios_export_front_terminal(p_voyage_id, p_port) IS NULL
  ) AS fronts;
$function$;

REVOKE ALL ON FUNCTION public._escala_fronts_without_terminal(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._escala_fronts_without_terminal(bigint, text) TO service_role;

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
      FROM public.bl_transshipments AS bt
      JOIN public.voyage_omissions AS o ON o.id = bt.omission_id
      WHERE o.voyage_id = p_voyage_id
        AND public.normalize_port_code(o.discharge_pod) = public.normalize_port_code(p_port)
        AND o.reverted_at IS NULL
        AND bt.disposition = 'transshipment'
    ) OR EXISTS (
      SELECT 1
      FROM public.vazios_importacao_containers AS c
      JOIN public.vazios_importacao_manifests AS m ON m.id = c.manifest_id
      WHERE m.voyage_id = p_voyage_id
        AND public.normalize_port_code(c.pod) = public.normalize_port_code(p_port)
    ) OR EXISTS (
      SELECT 1
      FROM public.granite_bls AS gb
      JOIN public.granite_manifests AS gm ON gm.id = gb.manifest_id
      WHERE gm.voyage_id = p_voyage_id
        AND public.normalize_port_code(COALESCE(gb.loading_port, gm.loading_port)) = public.normalize_port_code(p_port)
    ) OR EXISTS (
      SELECT 1 FROM public.voyage_export_schedules AS e
      WHERE e.voyage_id = p_voyage_id
        AND public.normalize_port_code(e.pol) = public.normalize_port_code(p_port)
        AND e.tem_exportacao
        AND (e.has_granite OR e.has_empty)
    ) OR EXISTS (
      -- 547: Embarque de vazios no porto, como a aba ADR.
      SELECT 1 FROM public.vazios_export_operations AS ve
      WHERE ve.voyage_id = p_voyage_id
        AND COALESCE(public.normalize_port_code(ve.embark_port), upper(btrim(ve.embark_port)))
          = COALESCE(public.normalize_port_code(p_port), upper(btrim(p_port)))
    );
$function$;

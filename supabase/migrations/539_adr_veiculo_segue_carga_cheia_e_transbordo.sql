-- 539: veículo não tem frente própria, e a carga em transbordo cria as frentes
-- da escala onde descarrega. Redefine a lista de frentes de importação sem
-- terminal que trava o fechamento do ADR (537, usada pela 538).
--
-- 1. Veículo segue a Carga cheia (decisão do dono de 2026-10-30). O veículo
--    viaja dentro de container do B/L, e a planilha de veículos já o liga ao
--    container: a frente dele é sempre a dos containers. A 537 derivava uma
--    frente `importacao:veiculo` do veículo gravado e exigia terminal para
--    ela; sai. O B/L do veículo já deriva a Carga cheia, e a seção Veículos do
--    ADR é atendida por essa frente (`frontServesSection`,
--    `src/services/escalaTerminalAllocation.ts`).
-- 2. Transbordo. Na Omissão de Escala, o B/L em transbordo mantém o POD do
--    porto omitido (só o COD o reescreve) e descarrega no porto de transbordo.
--    O conteúdo do ADR desse porto já soma a carga dele
--    (`listTransshipmentBlIds`), mas as frentes vinham só dos B/Ls com POD no
--    porto: carga solta (ou carga cheia) que só chegava em transbordo ficava
--    sem frente, escondida no ADR por terminal, e o fechamento não travava.
--    Os B/Ls em transbordo (omissão não revertida, disposição
--    `transshipment`) passam a derivar frentes aqui, como na tela.
--
-- ponytail: `_escala_has_operation_fronts` (273, recusa do ADR legado) segue
-- sem o transbordo: a escala que só recebe carga em transbordo e nenhum outro
-- dado ainda abre ADR legado pela API. Espelhar ali é o caminho se importar.
--
-- Só redefine uma função; não reescreve nem apaga linhas.
-- Rollback: reaplicar `_escala_import_fronts_without_terminal` da 537.

CREATE OR REPLACE FUNCTION public._escala_import_fronts_without_terminal(p_voyage_id bigint, p_port text)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH escala_bls AS (
    SELECT b.cargo_mode
    FROM public.bls AS b
    WHERE b.voyage_id = p_voyage_id
      AND public.normalize_port_code(b.pod) = public.normalize_port_code(p_port)
    UNION ALL
    SELECT b.cargo_mode
    FROM public.bls AS b
    WHERE b.id IN (
      SELECT bt.bl_id
      FROM public.bl_transshipments AS bt
      JOIN public.voyage_omissions AS o ON o.id = bt.omission_id
      WHERE o.voyage_id = p_voyage_id
        AND public.normalize_port_code(o.discharge_pod) = public.normalize_port_code(p_port)
        AND o.reverted_at IS NULL
        AND bt.disposition = 'transshipment'
    )
  ), derived AS (
    SELECT DISTINCT kind
    FROM escala_bls AS b
    CROSS JOIN LATERAL unnest(
      CASE WHEN lower(btrim(COALESCE(b.cargo_mode, ''))) = 'misto'
        THEN ARRAY['carga_cheia', 'carga_solta']
        ELSE ARRAY[public.bl_operation_front_modalidade(b.cargo_mode)]
      END
    ) AS kind
    UNION
    SELECT 'vazio'
    WHERE EXISTS (
      SELECT 1
      FROM public.vazios_importacao_containers AS c
      JOIN public.vazios_importacao_manifests AS m ON m.id = c.manifest_id
      WHERE m.voyage_id = p_voyage_id
        AND public.normalize_port_code(c.pod) = public.normalize_port_code(p_port)
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

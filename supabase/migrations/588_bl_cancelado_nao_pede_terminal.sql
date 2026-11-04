-- 588: o B/L cancelado não cria frente de operação sem terminal (decisão do
-- dono de 2026-11-04, sobre a revisão da release staging → main; ADR 0109,
-- faixa "Situação atual").
--
-- Problema: a conta das frentes que o banco deriva da carga
-- (`_escala_import_fronts_without_terminal`, migrations 537 e 539) contava
-- também o B/L cancelado. Essa conta trava o Fechar ADR, abre "Escala sem
-- terminal" (584) e pinta o TBC em âmbar no Painel. Uma escala com a carga
-- cheia no TVV e um único B/L de carga solta cancelado ficava com "Frente sem
-- terminal: carga solta" e com o Fechar ADR recusado, e a única saída era
-- escolher um terminal para uma carga que não veio, criando uma Atracação
-- inventada. Nenhuma ADR nem migration decidiu contar o B/L cancelado; o NOB
-- já o ignorava (584).
--
-- Mudança: a conta ignora o B/L cancelado e o cancelado no financeiro, o mesmo
-- recorte do NOB (`cancelled_at IS NULL` e `financial_status <> 'cancelled'`),
-- no POD da escala e no transbordo de escala omitida. A tela Editar escala faz
-- a mesma conta (`isCancelledBl`, `src/services/escalaTerminalAllocation.ts`).
-- Frente já gravada em TBC em Editar escala continua contando até ser
-- retirada ali; quem decide se a escala tem ADR
-- (`_escala_has_operation_fronts`) não muda.
--
-- Plano de preservação: a migration não reescreve nem apaga linha existente;
-- redefine uma função de leitura. Conferir: numa escala cujo único B/L de uma
-- modalidade está cancelado, `SELECT public._escala_fronts_without_terminal(
-- <viagem>, '<porto>')` não lista essa modalidade, e a rodada de 15 minutos
-- fecha "Escala sem terminal" se não restar outra frente. Desfazer: reaplicar
-- `_escala_import_fronts_without_terminal` da migration 539.
BEGIN;

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
      -- 588: B/L cancelado, ou cancelado no financeiro, não traz carga.
      AND b.cancelled_at IS NULL
      AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
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
      AND b.cancelled_at IS NULL
      AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
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

COMMIT;

-- 359: Data de Referência da Tarifa com o POD normalizado e no dia de
-- Brasília (revisão das importações de 2026-10-21, I-33b; entra junto do
-- lote 0 da frente financeira porque a data congela no CE, ADR 0093,
-- decisão 3).
--
-- Problema: `bl_local_charge_reference_date` (248) lia a escala com a chave
-- exata do POD do B/L: POD BRVIT numa escala BRVIX (ou BRNVT × BRITJ) não
-- achava a ETA e caía em CURRENT_DATE. A ETA geral (`eta::date`) e o
-- CURRENT_DATE usavam o dia UTC: depois das 21h de Brasília virava o dia
-- seguinte, e a Condição de Cliente escolhida podia ser a errada.
--
-- Mudança: a escala é procurada pela chave cujo código normalizado
-- (`normalize_port_code`) é o do POD; a ETA geral e o dia de hoje são os de
-- Brasília.
--
-- Não altera nem apaga linhas existentes.

CREATE OR REPLACE FUNCTION public.bl_local_charge_reference_date(p_bl_id text, p_pod text DEFAULT NULL::text)
RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Data de Referência da Tarifa (ADR 0040; migration 171): ETA da escala do
  -- POD, depois a ETA geral da Viagem, depois hoje, no dia de Brasília.
  -- Escolhe a Condição de Cliente; não escolhe a tabela.
  SELECT COALESCE(
    (SELECT min(nullif(btrim(s.value ->> 'eta'), '')::date)
       FROM public.voyages AS v
       CROSS JOIN LATERAL jsonb_each(coalesce(v.pod_schedule_snapshot, '{}'::jsonb)) AS s
      WHERE v.id = b.voyage_id
        AND jsonb_typeof(s.value) = 'object'
        AND public.normalize_port_code(s.key) = public.normalize_port_code(COALESCE(p_pod, b.pod))
        AND btrim(s.value ->> 'eta') ~ '^\d{4}-\d{2}-\d{2}$'),
    (SELECT (v.eta AT TIME ZONE 'America/Sao_Paulo')::date FROM public.voyages AS v WHERE v.id = b.voyage_id AND v.eta IS NOT NULL),
    (now() AT TIME ZONE 'America/Sao_Paulo')::date)
  FROM public.bls AS b
  WHERE b.id = upper(btrim(p_bl_id));
$$;

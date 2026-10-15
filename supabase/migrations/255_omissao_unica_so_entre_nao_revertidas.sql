-- Item 28 (A8) do plano 2026-10-14: a unicidade da omissão de escala vale só
-- entre as não revertidas; a revertida fica no histórico e o POD pode ser
-- omitido de novo (ADR 0083, item 8). O índice parcial mantém o nome da
-- constraint, que omit_voyage_escala traduz em "ja foi omitida".
-- Só troca a constraint por índice; não reescreve nem apaga linhas.

ALTER TABLE public.voyage_omissions DROP CONSTRAINT voyage_omissions_voyage_id_omitted_pod_key;
CREATE UNIQUE INDEX voyage_omissions_voyage_id_omitted_pod_key
  ON public.voyage_omissions (voyage_id, omitted_pod)
  WHERE reverted_at IS NULL;

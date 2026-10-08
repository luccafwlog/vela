-- 163: índice no número de contêiner normalizado de bl_containers.
--
-- Sintoma (08/10/2026): importar 6 B/Ls da GREEN BRAZIL / 8 estourou o limite
-- de 8 s do papel authenticated (57014) em todas as tentativas. O log do
-- Postgres aponta capture_invoice_basis() (linha 20) durante o INSERT dos
-- contêineres; esses B/Ls têm centenas de contêineres cada.
--
-- Causa: capture_invoice_basis (trigger por linha em bl_containers),
-- _apply_baplie_physical_flags_before_reissue_126 e bl_invoice_basis_snapshot
-- buscam contêiner por upper(btrim(container_number)). O índice existente é na
-- coluna crua, então cada busca varria a tabela inteira (~6 ms com 6.855
-- linhas): uma varredura por contêiner importado.
--
-- Medição em produção (transação desfeita, 6 B/Ls x 200 contêineres):
-- sem o índice 29,4 s; com o índice 9,5 s. O restante é linear por contêiner,
-- e o cliente passa a limitar cada chamada pelo número de contêineres
-- (src/services/blFreightImport.ts).
--
-- Não reescreve nem apaga linhas existentes.

CREATE INDEX IF NOT EXISTS idx_bl_containers_number_normalized
  ON public.bl_containers ((upper(btrim(container_number))));

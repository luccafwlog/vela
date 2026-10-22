-- 397: índice da FK `bl_manifesto_mercante_parking.manifesto_mercante_id`
-- (tabela da migration 396). Toda FK de B/L tem índice que começa pelas suas
-- colunas (advisor, migration 320): excluir um Manifesto Mercante não varre a
-- guarda inteira.
--
-- Só cria índice; não reescreve nem apaga linhas.
-- Rollback: DROP INDEX public.bl_manifesto_mercante_parking_manifesto_idx.

CREATE INDEX IF NOT EXISTS bl_manifesto_mercante_parking_manifesto_idx
  ON public.bl_manifesto_mercante_parking (manifesto_mercante_id);

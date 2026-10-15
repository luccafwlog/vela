-- Item 39 (B25) do plano 2026-10-14: a remoção do pré-voo e do backfill do
-- provisionamento do Portal foi decidida (migration arquivada 203), mas
-- portal_provisioning_backfill voltou ao catálogo (migration arquivada 293,
-- mantida no dump 002), sem chamador e sem grant a authenticated. Sai de vez.
-- Só remove a função; não reescreve nem apaga linhas.

DROP FUNCTION IF EXISTS public.portal_provisioning_backfill(text);

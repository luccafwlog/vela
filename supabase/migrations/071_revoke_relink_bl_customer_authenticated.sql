-- Migration 071: Revoga EXECUTE em relink_bl_customer concedido inadvertidamente
-- a authenticated na migration 070. A funcao e SECURITY DEFINER, sem guarda de
-- perfil ativo interno, e destina-se estritamente a execucao interna como sub-rotina
-- de import_bl_freight_transactional (ou por service_role).

REVOKE ALL ON FUNCTION public.relink_bl_customer(text, bigint, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.relink_bl_customer(text, bigint, uuid, text) TO service_role;

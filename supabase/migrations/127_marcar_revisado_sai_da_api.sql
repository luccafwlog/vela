-- 127: "Marcar revisado" deixa de existir (ADR 0077, decisão do dono em
-- 2026-10-01). A confirmação do cálculo é o CE Mercante; não há ato separado
-- de aprovação. A RPC transformava linhas `review_required` em `reviewed` sem
-- justificativa e liberava a emissão. Linha que precisa de revisão se resolve
-- corrigindo o B/L e recalculando. Nenhuma função do banco chama esta RPC.
-- Não reescreve nem apaga linhas existentes.
REVOKE ALL ON FUNCTION public.mark_bl_charges_reviewed(text, uuid) FROM PUBLIC, anon, authenticated;

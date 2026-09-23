-- Migration 080: qualquer Departamento interno ativo remove a declaração de
-- exportação de uma escala sem vínculo (decisão R8 de 2026-09-23, plano
-- docs/plans/2026-09-23-alinhamento-apresentacao-docs-codigo.md).
--
-- A lixeira da escala em Viagens pode apagar voyage_export_schedules, cuja
-- policy de DELETE exigia is_admin(). Em Chegadas e Saídas, qualquer perfil já
-- removia a mesma escala marcando "não escala". A policy passa a aceitar
-- is_active_user(); o que protege o dado continua no banco:
-- - trg_guard_export_schedule_removal recusa remover exportação com Granito
--   ou embarque de vazios na escala;
-- - trg_guard_voyage_cancelled_voyage_export_schedules sela viagem cancelada;
-- - audit_voyage_export_schedules grava a exclusão com autor.
-- Exceção registrada à regra de exclusão operacional da ADR 0046.
-- Não reescreve linhas existentes.

DROP POLICY IF EXISTS voyage_export_schedules_delete_admin ON public.voyage_export_schedules;

CREATE POLICY voyage_export_schedules_delete_active_global
  ON public.voyage_export_schedules
  FOR DELETE TO authenticated
  USING (public.is_active_user());

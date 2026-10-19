-- Migration 308: aviso "sua senha foi alterada" do Portal do Cliente.
--
-- Plano docs/plans/2026-10-17-correcao-dos-emails.md, item 4.8 (D12).
-- Ao concluir a recuperação de senha, a Edge portal-password-reset avisa o
-- Email de Recuperação da conta. A tentativa é registrada em
-- portal_email_attempts com o kind novo `senha_alterada`. Suspensão e
-- reativação da conta não avisam o Cliente por e-mail.
--
-- Só amplia o CHECK; não altera nem apaga linhas.

ALTER TABLE public.portal_email_attempts DROP CONSTRAINT portal_email_attempts_kind_check;
ALTER TABLE public.portal_email_attempts ADD CONSTRAINT portal_email_attempts_kind_check
  CHECK (kind = ANY (ARRAY['convite', 'reenvio', 'recuperacao', 'alteracao_email', 'alerta_critico', 'resumo_diario', 'contato_bounced_notificacao', 'ce_unlock_notificacao', 'senha_alterada']));

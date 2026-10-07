-- 157: repõe o catálogo estrutural de tipos de Comunicado.
-- Em 2026-10-06 a conferência institucional em produção passou, mas o disparo
-- simulado falhou com 22023: customer_communication_kinds estava vazia.
-- As combinações são as mesmas da migration 002; não altera preferências,
-- histórico nem a chave de envio real. Idempotente e somente aditiva.
-- Reversão: manter o catálogo; remover as entradas impediria novos Comunicados
-- e não é uma reversão operacional segura.
INSERT INTO public.customer_communication_kinds (kind, nature)
VALUES
  ('aviso_chegada_noa', 'avisos_operacionais'),
  ('aviso_prontidao_nor', 'avisos_operacionais'),
  ('aviso_atracacao_nob', 'avisos_operacionais'),
  ('ce_mercante_taxas', 'documentacao'),
  ('cobranca_demurrage', 'demurrage'),
  ('institucional', 'avisos_gerais'),
  ('livre', 'avisos_gerais'),
  ('livre', 'avisos_operacionais'),
  ('livre', 'documentacao'),
  ('livre', 'demurrage')
ON CONFLICT (kind, nature) DO NOTHING;

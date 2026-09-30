-- Migration 108: cópia do conteúdo enviado em cada Comunicado (auditoria
-- run-2, #10).
--
-- `send-customer-communication` passa a renderizar `livre` e `institucional`
-- no servidor e grava aqui o assunto, o texto e o hash do HTML efetivamente
-- enviados. Só a Edge Function (service_role) escreve; authenticated segue
-- com SELECT apenas. Colunas novas e nulas: não reescreve nem apaga linhas.

ALTER TABLE public.customer_communications
  ADD COLUMN IF NOT EXISTS rendered_subject text,
  ADD COLUMN IF NOT EXISTS rendered_text text,
  ADD COLUMN IF NOT EXISTS rendered_html_sha256 text;

COMMENT ON COLUMN public.customer_communications.rendered_subject IS 'Assunto enviado, gravado pela Edge Function send-customer-communication.';
COMMENT ON COLUMN public.customer_communications.rendered_text IS 'Versão texto enviada, gravada pela Edge Function send-customer-communication.';
COMMENT ON COLUMN public.customer_communications.rendered_html_sha256 IS 'SHA-256 hexadecimal do HTML enviado.';

-- Migration 312: tira TRUNCATE, TRIGGER e REFERENCES de anon e authenticated
-- nas tabelas de Comunicado e de e-mail (plano de correção dos e-mails, item
-- 5.3, CLI-13).
--
-- Conferido em produção em 2026-10-18 (information_schema.role_table_grants,
-- somente leitura): authenticated tem REFERENCES e TRIGGER em 89 tabelas do
-- schema public e TRUNCATE em 81; anon, os três em 4 tabelas, nenhuma de
-- e-mail. É o padrão de privilégios do schema inteiro, não um desvio destas
-- tabelas; a revisão global fica com a revisão de segurança. Aqui saem só das
-- tabelas de Comunicado e de e-mail. TRUNCATE não passa pela RLS nem pelos
-- gatilhos de DELETE: um usuário autenticado podia esvaziar o Histórico dos
-- Comunicados.
--
-- Nenhuma tela nem Edge usa esses privilégios (a Data API não expõe TRUNCATE,
-- TRIGGER nem REFERENCES); SELECT, INSERT, UPDATE e DELETE ficam como estão.
-- Tabela ausente no ambiente é ignorada. Não altera nem apaga linhas.

DO $grants_312$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'customer_communications',
    'customer_communication_attempts',
    'customer_communication_attachments',
    'customer_communication_bls',
    'customer_communication_box_kinds',
    'customer_communication_boxes',
    'customer_communication_kinds',
    'customer_communication_saved_templates',
    'customer_communication_suppressions',
    'customer_communication_templates',
    'customer_communication_automation_claims',
    'customer_communication_dunning_invoices',
    'portal_email_attempts',
    'portal_email_events',
    'portal_email_event_attempts',
    'portal_suppressed_emails',
    'ce_unlock_email_outbox'
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.%I FROM anon, authenticated', v_table);
    END IF;
  END LOOP;
END;
$grants_312$;

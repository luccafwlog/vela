-- Item 40 (P10) do plano 2026-10-14: add_agency_report_occurrence perdeu a
-- tela quando as Ocorrências viraram Observação por seção (ADR 0030) e ainda
-- recusava o Financeiro; função sem tela sai (ADR 0085, funções sem tela). A
-- tabela agency_departure_report_occurrences fica: os ADRs antigos ainda leem
-- e imprimem as ocorrências gravadas.
-- Só remove a função; não reescreve nem apaga linhas.

DROP FUNCTION IF EXISTS public.add_agency_report_occurrence(bigint, text, text, text);

-- 294: a emissão automática da Invoice de Demurrage também sai no número do
-- ano, `DEM-AAAA-NNNN` (revisão da PR 969 sobre a migration 293).
--
-- 1. `_run_import_effect_demurrage` (179) passava `DEM-AUTO-<id do efeito>`
--    a `issue_demurrage_invoice_for_bl`: a devolução lançada pela planilha de
--    datas emitia `DEM-AUTO-…` em vez do número sequencial decidido em
--    2026-10-16. Agora não passa número e o banco gera o do ano. A repetição do
--    mesmo efeito não emite duas vezes: a cobertura por caixa (214) devolve
--    `existing` sob a trava de `_lock_demurrage_box_billing`.
-- 2. `next_demurrage_doc_number` (293) pula o número que já existe ou cujo
--    TXID já existe (número informado à mão em `p_doc_number`). Antes, a
--    emissão que caía nesse número falhava, a transação desfazia o contador e
--    toda nova tentativa caía no mesmo número.
--
-- Não reescreve linhas. Rollback: reaplicar `_run_import_effect_demurrage` da
-- 179 e `next_demurrage_doc_number` da 293.

CREATE OR REPLACE FUNCTION public.next_demurrage_doc_number()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_year integer := extract(year FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::integer;
  v_next integer;
  v_doc text;
BEGIN
  LOOP
    INSERT INTO public.demurrage_doc_counters (year, last_number) VALUES (v_year, 1)
    ON CONFLICT (year) DO UPDATE SET last_number = public.demurrage_doc_counters.last_number + 1
    RETURNING last_number INTO v_next;
    v_doc := format('DEM-%s-%s', v_year, lpad(v_next::text, 4, '0'));
    -- Mesma expressão do índice `demurrage_invoices_pix_txid_unique` (278).
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.demurrage_invoices
      WHERE upper(left(regexp_replace(doc_number, '[^A-Za-z0-9]', '', 'g'), 25))
          = upper(left(regexp_replace(v_doc, '[^A-Za-z0-9]', '', 'g'), 25)));
  END LOOP;
  RETURN v_doc;
END;
$function$;
REVOKE ALL ON FUNCTION public.next_demurrage_doc_number() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._run_import_effect_demurrage(p_effect_id bigint, p_bl_id text, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM 1 FROM public.bls WHERE id = p_bl_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado para Demurrage.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  RETURN public.issue_demurrage_invoice_for_bl(p_bl_id, NULL);
END;
$function$;

-- 276: a liquidação automática do Ajuste de COD deixa rastro e acompanha a
-- vida da fatura sucessora (revisão da PR 954; item A11, migration 249; ADR
-- 0077; ADR 0083, item 11).
--
-- Problemas da 249:
-- 1. `_settle_cod_reissue_with_successor` passava o ajuste de `pending` a
--    `settled` sem `audit_logs`; a liquidação manual
--    (`settle_cod_adjustment`) grava "Liquidação financeira de ajuste de COD".
-- 2. A liquidação só disparava com o vínculo `invoice_bls`. Fatura criada em
--    rascunho e emitida depois não liquidava: o painel ficava em "Reemissão
--    automática" sem ação.
-- 3. Cancelada a sucessora, o ajuste seguia `settled`, apontando para uma
--    fatura cancelada.
--
-- Mudança:
-- 1. A liquidação grava `audit_logs` (`cod_adjustment`, `status`,
--    pending → settled) com a fatura sucessora na justificativa.
-- 2. Emitir uma fatura que estava em rascunho liquida os ajustes pendentes dos
--    B/Ls dela, pela mesma regra.
-- 3. Cancelar a sucessora devolve o ajuste a `pending` (com rastro), salvo se o
--    B/L já tiver outro ajuste pendente da mesma omissão; a próxima reemissão o
--    liquida de novo, e, se já houver outra fatura viva do B/L emitida depois
--    do ajuste, ele é liquidado com ela na hora.
--
-- Só redefine e cria funções e um gatilho; não reescreve nem apaga linhas.
-- Rollback: reaplicar `_settle_cod_reissue_with_successor` da migration 249 e
-- DROP TRIGGER cod_reissue_follows_successor_status ON public.invoices;
-- DROP FUNCTION public.cod_reissue_follows_successor_status().

CREATE OR REPLACE FUNCTION public._settle_cod_reissue_with_successor(p_bl_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  WITH settled AS (
    UPDATE public.cod_adjustments AS ca
    SET status = 'settled',
        resulting_document_id = successor.invoice_id,
        resulting_document_type = 'invoice'
    FROM (
      SELECT pending.id AS adjustment_id,
        (SELECT i.id
           FROM public.invoice_bls AS ib
           JOIN public.invoices AS i ON i.id = ib.invoice_id
          WHERE ib.bl_id = pending.bl_id
            AND i.status NOT IN ('cancelled', 'draft')
            AND i.created_at >= pending.created_at
          ORDER BY i.id DESC
          LIMIT 1) AS invoice_id
      FROM public.cod_adjustments AS pending
      WHERE pending.bl_id = p_bl_id
        AND pending.status = 'pending'
        AND pending.action = 'cancel_and_reissue'
    ) AS successor
    WHERE ca.id = successor.adjustment_id
      AND successor.invoice_id IS NOT NULL
    RETURNING ca.id, ca.resulting_document_id
  )
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  SELECT 'cod_adjustment', settled.id::text, 'status', 'pending', 'settled', auth.uid(), now(),
    'Liquidado com a fatura sucessora ' || settled.resulting_document_id || ' (reemissão automática do COD).'
  FROM settled;
END;
$function$;

REVOKE ALL ON FUNCTION public._settle_cod_reissue_with_successor(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cod_reissue_follows_successor_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text;
BEGIN
  IF NEW.status = 'cancelled' THEN
    WITH reopened AS (
      UPDATE public.cod_adjustments AS ca
      SET status = 'pending', resulting_document_id = NULL, resulting_document_type = NULL
      WHERE ca.action = 'cancel_and_reissue'
        AND ca.status = 'settled'
        AND ca.resulting_document_type = 'invoice'
        AND ca.resulting_document_id = NEW.id
        AND NOT EXISTS (
          SELECT 1 FROM public.cod_adjustments AS other
          WHERE other.bl_id = ca.bl_id AND other.omission_id IS NOT DISTINCT FROM ca.omission_id
            AND other.status = 'pending' AND other.id <> ca.id
        )
      RETURNING ca.id, ca.bl_id
    ), logged AS (
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
      SELECT 'cod_adjustment', reopened.id::text, 'status', 'settled', 'pending', auth.uid(), now(),
        'Fatura sucessora ' || NEW.id || ' cancelada: o ajuste aguarda a próxima reemissão.'
      FROM reopened
      RETURNING entity_id
    )
    SELECT min(reopened.bl_id) INTO v_bl_id FROM reopened;
  END IF;

  -- Rascunho emitido, ou sucessora cancelada com outra fatura viva do B/L.
  FOR v_bl_id IN SELECT DISTINCT ib.bl_id FROM public.invoice_bls AS ib WHERE ib.invoice_id = NEW.id LOOP
    PERFORM public._settle_cod_reissue_with_successor(v_bl_id);
  END LOOP;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.cod_reissue_follows_successor_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cod_reissue_follows_successor_status ON public.invoices;
CREATE TRIGGER cod_reissue_follows_successor_status
  AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW
  WHEN (
    (OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'cancelled'))
    OR (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
  )
  EXECUTE FUNCTION public.cod_reissue_follows_successor_status();

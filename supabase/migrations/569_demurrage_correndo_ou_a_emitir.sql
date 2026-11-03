-- 569: "correndo ou a emitir" no lugar de "a faturar" no motivo que recusa
-- cancelar o B/L com Demurrage sem Invoice.
--
-- Decisão do dono de 2026-11-03: o container de Demurrage ainda sem Invoice se
-- diz "correndo" (fora, passado do free time) ou "a emitir" (devolvido), como
-- as divisões da página Demurrage (ADR 0112) e o glossário, que já mandava
-- evitar "a faturar". A mesma PR troca as fichas do B/L e do Cliente.
--
-- bl_open_financial_reasons é a definição vigente (546, lida com
-- pg_get_functiondef no Postgres local com toda a cadeia aplicada) com SÓ o
-- texto do motivo trocado: "Demurrage a faturar: …" passa a "Demurrage
-- correndo ou a emitir: …". O motivo cobre os dois casos (container fora ou
-- devolvido, sem Invoice nem dispensa). A ficha do B/L reconhece os dois
-- começos (BlDetalhe.tsx), para a tela publicada antes desta migration.
--
-- Só redefine a função; os motivos são calculados na hora, nada gravado muda.
-- Rollback: reaplicar a função pela migration 546.

CREATE OR REPLACE FUNCTION public.bl_open_financial_reasons(p_bl_id text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reasons text[] := ARRAY[]::text[];
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.status IN ('draft', 'issued', 'partially_paid')
      AND (i.bl_id = p_bl_id OR EXISTS (SELECT 1 FROM public.invoice_bls ib WHERE ib.invoice_id = i.id AND ib.bl_id = p_bl_id))
  ) THEN
    v_reasons := array_append(v_reasons, 'fatura em aberto');
  END IF;
  -- Só o recebível ligado a fatura viva ou com baixa trava; o resto é anulado
  -- (362: vínculo de fatura cancelada não trava, decisão 12).
  IF EXISTS (
    SELECT 1 FROM public.bl_receivables r
    WHERE r.bl_id = p_bl_id AND r.status IN ('open', 'partially_settled')
      AND (r.settled_amount_brl > 0
           OR EXISTS (SELECT 1 FROM public.invoice_receivable_links l JOIN public.invoices li ON li.id = l.invoice_id WHERE l.receivable_id = r.id AND COALESCE(l.status, '') <> 'obsolete' AND coalesce(li.status, 'issued') NOT IN ('cancelled', 'obsolete'))
           OR EXISTS (SELECT 1 FROM public.ledger_settlements s WHERE s.receivable_id = r.id))
  ) THEN
    v_reasons := array_append(v_reasons, 'recebível em aberto');
  END IF;
  -- A Invoice do grupo é emitida no B/L-âncora com as caixas dos irmãos
  -- (ADR 0078, item 20): o item que aponta para container deste B/L também
  -- trava, como a Invoice do próprio B/L.
  IF EXISTS (
    SELECT 1 FROM public.demurrage_invoices d
    WHERE d.status IN ('draft', 'issued', 'overdue')
      AND (d.bl_id = p_bl_id OR EXISTS (
        SELECT 1 FROM public.demurrage_invoice_items AS item
        JOIN public.bl_containers AS c ON c.id = item.container_id
        WHERE item.invoice_id = d.id AND c.bl_id = p_bl_id
      ))
  ) THEN
    v_reasons := array_append(v_reasons, 'fatura de Demurrage em aberto');
  END IF;
  -- 517 (ADR 0112, D7 e D26): caixa do B/L com sobreestadia sem Invoice viva
  -- nem dispensa, devolvida ou ainda fora e passada do free time, que nenhum
  -- outro B/L ativo do mesmo Cliente na Viagem segura: cancelar perderia a
  -- cobrança. Sai com a Invoice emitida ou com a dispensa.
  IF EXISTS (
    SELECT 1
      FROM public.bls AS b
      JOIN public.voyages AS v ON v.id = b.voyage_id
      JOIN public.bl_containers AS c ON c.bl_id = b.id
     WHERE b.id = p_bl_id AND b.customer_id IS NOT NULL
       AND v.status IS DISTINCT FROM 'cancelled'
       AND c.ownership IS DISTINCT FROM 'SOC'
       AND c.discharge_date IS NOT NULL
       AND NULLIF(btrim(c.container_number), '') IS NOT NULL
       AND public._container_free_days(b.id, c.type, c.discharge_date) IS NOT NULL
       AND (COALESCE(c.return_date, (now() AT TIME ZONE 'America/Sao_Paulo')::date) - c.discharge_date)
           > public._container_free_days(b.id, c.type, c.discharge_date)
       AND NOT EXISTS (
         SELECT 1 FROM public._demurrage_billed_container_keys(b.voyage_id, b.customer_id) AS billed
          WHERE billed.container_key = upper(btrim(c.container_number)))
       AND NOT EXISTS (
         SELECT 1 FROM public.bl_containers AS other_c
         JOIN public.bls AS other ON other.id = other_c.bl_id
          WHERE other.id <> b.id AND other.cancelled_at IS NULL
            AND other.voyage_id = b.voyage_id AND other.customer_id = b.customer_id
            AND upper(btrim(other_c.container_number)) = upper(btrim(c.container_number)))
  ) THEN
    v_reasons := array_append(v_reasons, 'Demurrage correndo ou a emitir: devolva o container e emita a Invoice, ou dispense a cobrança na Demurrage');
  END IF;
  -- 530 (decisão do dono de 2026-10-30): B/L sem Cliente, ou caixa de tipo
  -- sem tarifa e sem free time (Travado desde a descarga, D27), com
  -- sobreestadia ou travada e sem dispensa: cancelar também perderia a
  -- cobrança em silêncio.
  IF EXISTS (
    SELECT 1
      FROM public.bls AS b
      JOIN public.voyages AS v ON v.id = b.voyage_id
      JOIN public.bl_containers AS c ON c.bl_id = b.id
     WHERE b.id = p_bl_id
       AND v.status IS DISTINCT FROM 'cancelled'
       AND c.ownership IS DISTINCT FROM 'SOC'
       AND c.discharge_date IS NOT NULL
       AND NULLIF(btrim(c.container_number), '') IS NOT NULL
       AND (b.customer_id IS NULL OR public._container_free_days(b.id, c.type, c.discharge_date) IS NULL)
       AND (public._container_free_days(b.id, c.type, c.discharge_date) IS NULL
            OR (COALESCE(c.return_date, (now() AT TIME ZONE 'America/Sao_Paulo')::date) - c.discharge_date)
               > public._container_free_days(b.id, c.type, c.discharge_date))
       AND NOT EXISTS (
         SELECT 1 FROM public._demurrage_billed_container_keys(b.voyage_id, b.customer_id) AS billed
          WHERE billed.container_key = upper(btrim(c.container_number)))
       -- 546: outro B/L ativo do mesmo Cliente na Viagem segura a caixa, como
       -- acima (517); dispensar no duplicado tiraria a cobrança do outro.
       AND NOT (b.customer_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.bl_containers AS other_c
         JOIN public.bls AS other ON other.id = other_c.bl_id
          WHERE other.id <> b.id AND other.cancelled_at IS NULL
            AND other.voyage_id = b.voyage_id AND other.customer_id = b.customer_id
            AND upper(btrim(other_c.container_number)) = upper(btrim(c.container_number))))
  ) THEN
    v_reasons := array_append(v_reasons, 'Demurrage travada: vincule o Cliente ou cadastre a tarifa e emita a Invoice, ou dispense a cobrança na Demurrage');
  END IF;
  RETURN v_reasons;
END;
$function$;

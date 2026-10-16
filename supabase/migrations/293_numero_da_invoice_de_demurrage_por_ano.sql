-- 293: número da Invoice de Demurrage sequencial por ano, `DEM-AAAA-NNNN`
-- (decisão do responsável de 2026-10-16, lote 2 da identidade), como a fatura
-- de Taxas Locais (`INV-AAAA-NNNN`). Substitui `DEM-<AAAAMMDDHHMMSSmmm>-<B/L>`
-- (migration 278), de 36 caracteres. São 13 caracteres: o TXID do Pix
-- (número sem pontuação, até 25) continua único, porque o contador nunca
-- repete um número no ano, e o índice `demurrage_invoices_pix_txid_unique`
-- (278) segue de guarda.
--
-- O contador é uma linha por ano em `demurrage_doc_counters`; o UPDATE trava a
-- linha até o fim da transação, então duas emissões simultâneas não pegam o
-- mesmo número. ponytail: um número consumido por emissão que falha depois
-- deixa um salto na sequência (aceito; a fatura de Taxas Locais faz o mesmo).
--
-- Data status: relies on the AGENTS.md "Data status" bullet (asserted
-- 2026-09-18) — renumera todas as Invoices de Demurrage existentes (dados de
-- teste) para o formato novo, por ano de emissão e ordem de id, e refaz o QR
-- estático com o TXID novo. Cobranças Itaú já registradas guardam o TXID antigo.
-- Rollback: reaplicar a definição de issue_demurrage_invoice_for_bl da 278;
-- os números renumerados não voltam.

CREATE TABLE IF NOT EXISTS public.demurrage_doc_counters (
  year integer PRIMARY KEY,
  last_number integer NOT NULL DEFAULT 0 CHECK (last_number >= 0)
);
ALTER TABLE public.demurrage_doc_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.demurrage_doc_counters FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.next_demurrage_doc_number()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_year integer := extract(year FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::integer;
  v_next integer;
BEGIN
  INSERT INTO public.demurrage_doc_counters (year, last_number) VALUES (v_year, 1)
  ON CONFLICT (year) DO UPDATE SET last_number = public.demurrage_doc_counters.last_number + 1
  RETURNING last_number INTO v_next;
  RETURN format('DEM-%s-%s', v_year, lpad(v_next::text, 4, '0'));
END;
$function$;
REVOKE ALL ON FUNCTION public.next_demurrage_doc_number() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  r record;
  v_doc text;
BEGIN
  -- Primeiro tira todos do caminho (o UNIQUE de doc_number e o índice do TXID
  -- recusariam um número novo igual ao antigo de outra linha).
  UPDATE public.demurrage_invoices SET doc_number = format('TMP-%s-%s', id, md5(doc_number));
  FOR r IN
    SELECT id, current_total_brl, pix_payload,
           extract(year FROM COALESCE(billed_at, (created_at AT TIME ZONE 'America/Sao_Paulo')::date))::integer AS y,
           row_number() OVER (
             PARTITION BY extract(year FROM COALESCE(billed_at, (created_at AT TIME ZONE 'America/Sao_Paulo')::date))
             ORDER BY id) AS n
    FROM public.demurrage_invoices
  LOOP
    v_doc := format('DEM-%s-%s', r.y, lpad(r.n::text, 4, '0'));
    UPDATE public.demurrage_invoices
       SET doc_number = v_doc,
           pix_payload = CASE WHEN r.pix_payload IS NOT NULL AND r.current_total_brl > 0
             THEN public.build_transshipping_pix_payload(r.current_total_brl, v_doc)
             ELSE r.pix_payload END
     WHERE id = r.id;
  END LOOP;
  INSERT INTO public.demurrage_doc_counters (year, last_number)
  SELECT extract(year FROM COALESCE(billed_at, (created_at AT TIME ZONE 'America/Sao_Paulo')::date))::integer, count(*)
  FROM public.demurrage_invoices GROUP BY 1
  ON CONFLICT (year) DO UPDATE SET last_number = GREATEST(public.demurrage_doc_counters.last_number, EXCLUDED.last_number);
END $$;

CREATE OR REPLACE FUNCTION public.issue_demurrage_invoice_for_bl(p_bl_id text, p_doc_number text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_group text[] := public.demurrage_group_bl_ids(p_bl_id);
  v_anchor text := v_group[1];
  v_customer_id bigint;
  v_voyage_id bigint;
  v_covering bigint[];
  v_uncovered integer;
  v_container_ids bigint[];
  v_calculation jsonb;
  v_doc text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('vela.demurrage_internal', true) IS DISTINCT FROM 'on'
     AND (auth.uid() IS NULL OR NOT public.is_active_user()) THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bls WHERE id = p_bl_id AND cancelled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'O B/L % está cancelado: a Invoice de Demurrage não é emitida para B/L cancelado.', p_bl_id
      USING ERRCODE = '22023';
  END IF;

  SELECT customer_id, voyage_id INTO v_customer_id, v_voyage_id FROM public.bls WHERE id = v_anchor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'B/L % sem cliente para emissão de Demurrage.', v_anchor USING ERRCODE = '22023';
  END IF;

  -- Cada caixa uma vez (214): a cobertura é por caixa na Viagem e no Cliente,
  -- não pelo grupo de hoje. A trava vale até o fim da transação.
  PERFORM public._lock_demurrage_box_billing(v_voyage_id, v_customer_id);
  WITH boxes AS (
    SELECT DISTINCT upper(btrim(c.container_number)) AS container_key
    FROM public.bl_containers AS c
    WHERE c.bl_id = ANY(v_group) AND c.ownership IS DISTINCT FROM 'SOC'
      AND NULLIF(btrim(c.container_number), '') IS NOT NULL
  ), billed AS (
    SELECT * FROM public._demurrage_billed_container_keys(v_voyage_id, v_customer_id)
  )
  SELECT
    (SELECT array_agg(DISTINCT billed.invoice_id ORDER BY billed.invoice_id)
       FROM billed JOIN boxes USING (container_key)),
    (SELECT count(*) FROM boxes
      WHERE NOT EXISTS (SELECT 1 FROM billed WHERE billed.container_key = boxes.container_key))
  INTO v_covering, v_uncovered;
  IF cardinality(v_covering) > 0 AND v_uncovered = 0 THEN
    RETURN jsonb_build_object('status', 'existing', 'invoice_id', v_covering[cardinality(v_covering)],
      'invoice_ids', to_jsonb(v_covering), 'anchor_bl_id', v_anchor, 'idempotent', true);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bl_containers
    WHERE bl_id = ANY(v_group) AND ownership IS DISTINCT FROM 'SOC' AND return_date IS NULL
  ) THEN
    RETURN jsonb_build_object('status', 'waiting_return', 'anchor_bl_id', v_anchor, 'group_bl_ids', to_jsonb(v_group));
  END IF;

  SELECT COALESCE(array_agg(pick.id ORDER BY pick.id), ARRAY[]::bigint[]) INTO v_container_ids
  FROM (
    SELECT DISTINCT ON (upper(btrim(c.container_number))) c.id
    FROM public.bl_containers AS c
    WHERE c.bl_id = ANY(v_group) AND c.ownership IS DISTINCT FROM 'SOC'
      AND NULLIF(btrim(c.container_number), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public._demurrage_billed_container_keys(v_voyage_id, v_customer_id) AS billed
        WHERE billed.container_key = upper(btrim(c.container_number))
      )
    ORDER BY upper(btrim(c.container_number)), (c.bl_id = v_anchor) DESC, c.id
  ) AS pick;
  IF cardinality(v_container_ids) = 0 THEN
    RETURN jsonb_build_object('status', 'no_containers', 'anchor_bl_id', v_anchor);
  END IF;

  v_calculation := public._calculate_demurrage_invoice_authoritative(
    v_anchor, v_container_ids, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  IF COALESCE((v_calculation->>'total_usd')::numeric, 0) <= 0 THEN
    RETURN jsonb_build_object('status', 'no_overstay', 'anchor_bl_id', v_anchor);
  END IF;

  v_doc := COALESCE(NULLIF(btrim(p_doc_number), ''), public.next_demurrage_doc_number());
  RETURN public.create_demurrage_invoice_authoritative(v_doc, v_anchor, v_customer_id, v_container_ids, NULL)
    || jsonb_build_object('status', 'issued', 'anchor_bl_id', v_anchor, 'group_bl_ids', to_jsonb(v_group),
         'complementary', COALESCE(cardinality(v_covering), 0) > 0,
         'covering_invoice_ids', to_jsonb(COALESCE(v_covering, ARRAY[]::bigint[])));
END;
$function$;

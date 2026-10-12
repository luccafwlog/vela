-- 200 — Demurrage: container de B/L ou de Viagem Cancelados não fica "em
-- atraso" (revisão da PR 929, achado da revisão automática na 197).
--
-- A 197 voltou a gravar `overdue`. Mas o job diário pulava B/L e Viagem
-- Cancelados, e nenhum cancelamento mexia no status. O container que já estava
-- em atraso quando o B/L ou a Viagem foi cancelado continuava aparecendo no
-- selo de Demurrage do cabeçalho, no KPI de containers em atraso, na ficha do
-- Cliente e na lista da página Demurrage. Essas telas leem o status gravado sem
-- olhar o cancelamento.
--
-- Agora:
-- - o status derivado (`_container_demurrage_status`) nunca dá `overdue` para
--   container de B/L Cancelado ou de Viagem Cancelada: fica `within_free_time`,
--   ou `returned` com devolução;
-- - cancelar ou reativar o B/L (`bls.cancelled_at`) e cancelar a Viagem
--   (`voyages.status`) refazem na hora o status dos containers;
-- - o job diário `container-demurrage-status` também cobre esses containers;
-- - em `bl_containers`, a guarda da Viagem Cancelada aceita a mudança só do
--   `demurrage_status`. O gatilho da 197 recalcula o valor antes da guarda,
--   então não dá para gravar outro à mão.
--
-- Esta migration reescreve `bl_containers.demurrage_status` das linhas
-- existentes (chamada final do job) e depende da linha "Data status" do
-- AGENTS.md (dados de produção são fixtures de teste).
-- Rollback: reaplicar `_container_demurrage_status` e
-- `refresh_containers_demurrage_status` da 197 e `_voyage_cancelled_financial_only`
-- e `guard_voyage_cancelled_via_parent` da 190; DROP dos dois gatilhos e da
-- função `refresh_demurrage_status_on_cancellation`.

CREATE OR REPLACE FUNCTION public._container_demurrage_status(p_bl_id text, p_container_type text, p_discharge_date date, p_return_date date, p_ownership text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_free integer;
BEGIN
  IF p_return_date IS NOT NULL THEN
    RETURN 'returned';
  END IF;
  IF p_discharge_date IS NULL OR p_ownership = 'SOC' THEN
    RETURN 'within_free_time';
  END IF;
  -- B/L Cancelado ou Viagem Cancelada não corre Demurrage.
  IF EXISTS (
    SELECT 1 FROM public.bls AS b LEFT JOIN public.voyages AS v ON v.id = b.voyage_id
    WHERE b.id = p_bl_id AND (b.cancelled_at IS NOT NULL OR v.status = 'cancelled')
  ) THEN
    RETURN 'within_free_time';
  END IF;
  v_free := public._container_free_days(p_bl_id, p_container_type, p_discharge_date);
  -- ponytail: sem free time cadastrado (tabela ou acordo) não há como dizer que
  -- venceu; o container fica no prazo até a tabela existir.
  IF v_free IS NOT NULL AND current_date - p_discharge_date > v_free THEN
    RETURN 'overdue';
  END IF;
  RETURN 'within_free_time';
END;
$function$;
REVOKE ALL ON FUNCTION public._container_demurrage_status(text, text, date, date, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._voyage_cancelled_financial_only(p_table text, p_old jsonb, p_new jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT NOT EXISTS (
    SELECT 1
    FROM jsonb_each(p_new) AS n
    WHERE n.value IS DISTINCT FROM p_old -> n.key
      AND NOT (n.key = ANY (CASE p_table
        WHEN 'bls' THEN ARRAY['financial_status', 'updated_at']
        WHEN 'granite_bls' THEN ARRAY['charge_status']
        WHEN 'bl_containers' THEN ARRAY['demurrage_status']
        ELSE ARRAY[]::text[]
      END))
  );
$function$;
REVOKE ALL ON FUNCTION public._voyage_cancelled_financial_only(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_voyage_cancelled_via_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  v_voyage_id bigint;
BEGIN
  v_voyage_id := CASE TG_TABLE_NAME
    WHEN 'bl_containers' THEN (SELECT voyage_id FROM public.bls WHERE id = v_row->>'bl_id')
    WHEN 'invoice_bls' THEN (SELECT voyage_id FROM public.bls WHERE id = v_row->>'bl_id')
    WHEN 'invoice_receivable_links' THEN (SELECT voyage_id FROM public.bls WHERE id = v_row->>'bl_id')
    WHEN 'customer_communication_bls' THEN (SELECT voyage_id FROM public.bls WHERE id = v_row->>'bl_id')
    -- Avulsa traz a Viagem no cabeçalho; individual, pelo B/L.
    WHEN 'invoices' THEN COALESCE(NULLIF(v_row->>'voyage_id', '')::bigint,
      (SELECT voyage_id FROM public.bls WHERE id = v_row->>'bl_id'))
    WHEN 'granite_bls' THEN (SELECT voyage_id FROM public.granite_manifests WHERE id = (v_row->>'manifest_id')::uuid)
    WHEN 'customer_communications' THEN NULLIF(v_row->>'anchor_voyage_id', '')::bigint
  END;
  IF v_voyage_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.voyages WHERE id = v_voyage_id AND status = 'cancelled') THEN
    -- Granito: só o status de cobrança (190). Container: só o status de
    -- Demurrage, que o gatilho da 197 recalcula (200).
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME IN ('granite_bls', 'bl_containers') THEN
      IF public._voyage_cancelled_financial_only(TG_TABLE_NAME, to_jsonb(OLD), to_jsonb(NEW)) THEN
        RETURN NEW;
      END IF;
    END IF;
    RAISE EXCEPTION 'Viagem % cancelada: operação selada e somente leitura.', v_voyage_id USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

-- Só containers sem devolução, e só onde o status muda. Inclui B/L e Viagem
-- Cancelados: o atraso de antes do cancelamento sai.
CREATE OR REPLACE FUNCTION public.refresh_containers_demurrage_status()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_updated integer := 0;
BEGIN
  UPDATE public.bl_containers AS c
     SET demurrage_status = target.status
    FROM (
      SELECT c2.id,
             public._container_demurrage_status(c2.bl_id, c2.type, c2.discharge_date, c2.return_date, c2.ownership) AS status
        FROM public.bl_containers AS c2
       WHERE c2.return_date IS NULL
    ) AS target
   WHERE c.id = target.id
     AND c.demurrage_status IS DISTINCT FROM target.status;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$function$;
REVOKE ALL ON FUNCTION public.refresh_containers_demurrage_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_containers_demurrage_status() TO service_role;

-- Cancelar ou reativar o B/L, ou cancelar a Viagem, refaz o status dos
-- containers na hora (sem esperar o job diário).
CREATE OR REPLACE FUNCTION public.refresh_demurrage_status_on_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_ids text[];
BEGIN
  -- Um comando por tabela: `NEW.id` é texto em `bls` e bigint em `voyages`.
  IF TG_TABLE_NAME = 'bls' THEN
    IF (OLD.cancelled_at IS NULL) = (NEW.cancelled_at IS NULL) THEN
      RETURN NULL;
    END IF;
    v_bl_ids := ARRAY[NEW.id::text];
  ELSE
    IF (OLD.status = 'cancelled') IS NOT DISTINCT FROM (NEW.status = 'cancelled') THEN
      RETURN NULL;
    END IF;
    SELECT array_agg(b.id) INTO v_bl_ids FROM public.bls AS b WHERE b.voyage_id = NEW.id::bigint;
  END IF;

  UPDATE public.bl_containers AS c
     SET demurrage_status = public._container_demurrage_status(c.bl_id, c.type, c.discharge_date, c.return_date, c.ownership)
   WHERE c.bl_id = ANY (COALESCE(v_bl_ids, ARRAY[]::text[]))
     AND c.return_date IS NULL
     AND c.demurrage_status IS DISTINCT FROM
         public._container_demurrage_status(c.bl_id, c.type, c.discharge_date, c.return_date, c.ownership);
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.refresh_demurrage_status_on_cancellation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bls_cancel_refreshes_demurrage_status ON public.bls;
CREATE TRIGGER trg_bls_cancel_refreshes_demurrage_status
  AFTER UPDATE OF cancelled_at ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public.refresh_demurrage_status_on_cancellation();

DROP TRIGGER IF EXISTS trg_voyages_cancel_refreshes_demurrage_status ON public.voyages;
CREATE TRIGGER trg_voyages_cancel_refreshes_demurrage_status
  AFTER UPDATE OF status ON public.voyages
  FOR EACH ROW EXECUTE FUNCTION public.refresh_demurrage_status_on_cancellation();

-- Containers já gravados (Data status do AGENTS.md).
SELECT public.refresh_containers_demurrage_status();

-- 197 — Demurrage: o status "em atraso" (`overdue`) volta a ser gravado
-- (revisão da PR 929, achado P1 da revisão automática na 179).
--
-- Antes da 179 a tela calculava o status ao gravar as datas do container
-- (`within_free_time` ou `overdue` pelo free time). A 179 levou as datas para o
-- servidor e normalizou `returned`, mas nada mais gravava `overdue`: o selo de
-- Demurrage do cabeçalho, o KPI de containers em atraso, a Demurrage correndo da
-- ficha do Cliente e a lista da página Demurrage (que filtram o status gravado)
-- deixaram de mostrar container vencido sem devolução.
--
-- Agora:
-- - o gatilho de status calcula o atraso a cada gravação de datas, tipo, B/L ou
--   SOC/COC do container (sem devolução: `overdue` quando os dias desde a
--   descarga passam do free time do B/L, do acordo do Cliente ou da tabela);
-- - `refresh_containers_demurrage_status()` refaz o status dos containers sem
--   devolução, e o job diário `container-demurrage-status` (pg_cron, SQL) o
--   chama para o container que vence sem ninguém mexer nele;
-- - SOC nunca fica em atraso (regra da 121, mantida pelo gatilho dela).
--
-- O free time segue a mesma ordem do cálculo da Invoice
-- (`_calculate_demurrage_invoice_authoritative`): free time do B/L, acordo de
-- Demurrage do Cliente vigente na descarga, tabela de Demurrage vigente.
--
-- Esta migration reescreve `bl_containers.demurrage_status` das linhas
-- existentes (chamada final de `refresh_containers_demurrage_status`) e depende
-- da linha "Data status" do AGENTS.md (dados de produção são fixtures de teste).
-- Rollback: reaplicar `normalize_container_demurrage_status` e o gatilho da 179;
-- DROP das funções novas e `cron.unschedule('container-demurrage-status')`.

CREATE OR REPLACE FUNCTION public._container_free_days(p_bl_id text, p_container_type text, p_discharge_date date)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT b.free_time_override FROM public.bls AS b WHERE b.id = p_bl_id),
    (SELECT a.free_days
       FROM public.customer_demurrage_agreements AS a
       JOIN public.bls AS b ON b.customer_id = a.customer_id
      WHERE b.id = p_bl_id AND a.active = true
        AND p_discharge_date >= a.valid_from
        AND (a.valid_to IS NULL OR p_discharge_date <= a.valid_to)
      ORDER BY a.valid_from DESC, a.id DESC
      LIMIT 1),
    (SELECT r.free_days
       FROM public._active_demurrage_rates(current_date) AS r
      WHERE public._demurrage_canonical_type(r.container_type) = public._demurrage_canonical_type(p_container_type)
      ORDER BY r.valid_from DESC, r.id DESC
      LIMIT 1)
  );
$function$;
REVOKE ALL ON FUNCTION public._container_free_days(text, text, date) FROM PUBLIC, anon, authenticated;

-- Status de um container sem devolução, pela data de hoje.
CREATE OR REPLACE FUNCTION public._container_demurrage_status(
  p_bl_id text, p_container_type text, p_discharge_date date, p_return_date date, p_ownership text
)
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

-- demurrage_status com uma semântica (179) e o atraso calculado na gravação.
-- SECURITY DEFINER: o gatilho também roda em gravação feita pela sessão do
-- usuário, e o cálculo lê acordo e tabela de Demurrage (funções sem EXECUTE
-- para `authenticated`).
CREATE OR REPLACE FUNCTION public.normalize_container_demurrage_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.demurrage_status := public._container_demurrage_status(
    NEW.bl_id, NEW.type, NEW.discharge_date, NEW.return_date, NEW.ownership);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_container_demurrage_status_semantics ON public.bl_containers;
CREATE TRIGGER trg_container_demurrage_status_semantics
  BEFORE INSERT OR UPDATE OF return_date, discharge_date, demurrage_status, type, bl_id, ownership ON public.bl_containers
  FOR EACH ROW EXECUTE FUNCTION public.normalize_container_demurrage_status();

-- Container que vence sem ninguém mexer nele: o job diário refaz o status.
-- Só containers sem devolução, de B/L ativo e Viagem não cancelada (B/L e
-- Viagem Cancelados são somente leitura), e só onde o status muda.
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
        JOIN public.bls AS b ON b.id = c2.bl_id
        JOIN public.voyages AS v ON v.id = b.voyage_id
       WHERE c2.return_date IS NULL
         AND b.cancelled_at IS NULL
         AND v.status IS DISTINCT FROM 'cancelled'
    ) AS target
   WHERE c.id = target.id
     AND c.demurrage_status IS DISTINCT FROM target.status;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$function$;
REVOKE ALL ON FUNCTION public.refresh_containers_demurrage_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_containers_demurrage_status() TO service_role;

DO $cron_197$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'container-demurrage-status') THEN
      PERFORM cron.unschedule('container-demurrage-status');
    END IF;
    PERFORM cron.schedule('container-demurrage-status', '17 3 * * *', $cmd_197$SELECT public.refresh_containers_demurrage_status();$cmd_197$);
  ELSE
    RAISE WARNING '197: pg_cron ausente; agende public.refresh_containers_demurrage_status() uma vez por dia neste ambiente.';
  END IF;
END;
$cron_197$;

-- Containers já gravados (Data status do AGENTS.md).
SELECT public.refresh_containers_demurrage_status();

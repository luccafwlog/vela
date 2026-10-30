-- 527: Alerta de Demurrage travada reconciliado uma vez por Viagem, no fim da
-- transação (revisão final da PR luccafwlog/vela#1113, ADR 0112 D25).
--
-- Os gatilhos da 516 refaziam a classificação da Viagem inteira a cada
-- comando em `bl_containers` (sem olhar a coluna: até o lacre disparava) e a
-- cada linha de `bls`. A planilha de datas grava um container por comando, a
-- de CE um B/L por chamada e a Base de Clientes vincula os B/Ls um a um: numa
-- Viagem de 900 containers, 30 devoluções passavam de 0,2 s para 15,8 s, e a
-- planilha grande estourava o limite de 60 s sem gravar nada. Uma falha da
-- reconciliação também desfazia a gravação do operador.
--
-- 1. Os gatilhos só anotam as Viagens tocadas (`vela.travado_pending`, da
--    transação), e só quando muda o que a classificação lê: número, B/L,
--    tipo, descarga, devolução e SOC/COC do container; CE, Cliente,
--    cancelamento, Viagem e free time do B/L.
-- 2. Um gatilho adiado reconcilia cada Viagem anotada uma vez, no fim da
--    transação. Falha vira aviso no log, sem desfazer a gravação: a rotina
--    `demurrage-travado-alerts` (15 minutos) reconcilia todas as Viagens.
--
-- ponytail: a reconciliação ainda refaz a classificação da Viagem inteira
-- (cerca de 0,5 s com 900 containers), agora uma vez por transação. Se a
-- Viagem crescer além disso, reconciliar só os grupos dos B/Ls tocados.
--
-- Não reescreve nem apaga linhas existentes.
--
-- Rollback: recriar `_bl_containers_travado_alerts`, `_bls_travado_alerts` e
-- os gatilhos da 516; apagar os desta migration.

CREATE OR REPLACE FUNCTION public._demurrage_travado_mark(p_voyage_ids bigint[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pending text := COALESCE(NULLIF(current_setting('vela.travado_pending', true), ''), ',');
  v_voyage bigint;
BEGIN
  FOREACH v_voyage IN ARRAY COALESCE(p_voyage_ids, ARRAY[]::bigint[]) LOOP
    IF v_voyage IS NOT NULL AND position(',' || v_voyage || ',' IN v_pending) = 0 THEN
      v_pending := v_pending || v_voyage || ',';
    END IF;
  END LOOP;
  PERFORM set_config('vela.travado_pending', v_pending, true);
END;
$function$;
REVOKE ALL ON FUNCTION public._demurrage_travado_mark(bigint[]) FROM PUBLIC, anon, authenticated;

-- Fim da transação: uma reconciliação por Viagem anotada.
CREATE OR REPLACE FUNCTION public._demurrage_travado_flush()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pending text := NULLIF(NULLIF(current_setting('vela.travado_pending', true), ''), ',');
  v_voyage text;
BEGIN
  IF v_pending IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('vela.travado_pending', '', true);
  FOREACH v_voyage IN ARRAY string_to_array(btrim(v_pending, ','), ',') LOOP
    BEGIN
      PERFORM public.reconcile_demurrage_travado_alerts(v_voyage::bigint, 'demurrage_travado_containers');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Alerta de Demurrage travada da Viagem % não reconciliado: %', v_voyage, SQLERRM;
    END;
  END LOOP;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._demurrage_travado_flush() FROM PUBLIC, anon, authenticated;

-- Containers: anota as Viagens das linhas que mudaram o que a classificação lê.
CREATE OR REPLACE FUNCTION public._bl_containers_travado_alerts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._demurrage_travado_mark(ARRAY(
      SELECT DISTINCT b.voyage_id FROM new_rows AS n JOIN public.bls AS b ON b.id = n.bl_id));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public._demurrage_travado_mark(ARRAY(
      SELECT DISTINCT b.voyage_id FROM old_rows AS o JOIN public.bls AS b ON b.id = o.bl_id));
  ELSE
    PERFORM public._demurrage_travado_mark(ARRAY(
      SELECT DISTINCT b.voyage_id
        FROM new_rows AS n
        JOIN old_rows AS o ON o.id = n.id
        JOIN public.bls AS b ON b.id IN (n.bl_id, o.bl_id)
       WHERE n.container_number IS DISTINCT FROM o.container_number
          OR n.bl_id IS DISTINCT FROM o.bl_id
          OR n.type IS DISTINCT FROM o.type
          OR n.discharge_date IS DISTINCT FROM o.discharge_date
          OR n.return_date IS DISTINCT FROM o.return_date
          OR n.ownership IS DISTINCT FROM o.ownership));
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_bl_containers_travado_alerts_upd ON public.bl_containers;
CREATE TRIGGER trg_bl_containers_travado_alerts_upd
  AFTER UPDATE ON public.bl_containers REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._bl_containers_travado_alerts();
DROP TRIGGER IF EXISTS trg_bl_containers_travado_alerts_ins ON public.bl_containers;
CREATE TRIGGER trg_bl_containers_travado_alerts_ins
  AFTER INSERT ON public.bl_containers REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._bl_containers_travado_alerts();
DROP TRIGGER IF EXISTS trg_bl_containers_travado_alerts_del ON public.bl_containers;
CREATE TRIGGER trg_bl_containers_travado_alerts_del
  AFTER DELETE ON public.bl_containers REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._bl_containers_travado_alerts();

-- B/L: anota a Viagem (e a anterior, na troca de Viagem).
CREATE OR REPLACE FUNCTION public._bls_travado_alerts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._demurrage_travado_mark(ARRAY[NEW.voyage_id, OLD.voyage_id]);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_bls_travado_alerts ON public.bls;
CREATE TRIGGER trg_bls_travado_alerts
  AFTER UPDATE OF ce_mercante, customer_id, cancelled_at, voyage_id, free_time_override ON public.bls
  FOR EACH ROW
  WHEN (NEW.ce_mercante IS DISTINCT FROM OLD.ce_mercante
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
     OR NEW.voyage_id IS DISTINCT FROM OLD.voyage_id
     OR NEW.free_time_override IS DISTINCT FROM OLD.free_time_override)
  EXECUTE FUNCTION public._bls_travado_alerts();

-- Os gatilhos adiados disparam no commit; o primeiro esvazia a lista e os
-- demais saem na primeira linha.
CREATE CONSTRAINT TRIGGER trg_bl_containers_travado_flush_ins
  AFTER INSERT ON public.bl_containers DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public._demurrage_travado_flush();
CREATE CONSTRAINT TRIGGER trg_bl_containers_travado_flush_del
  AFTER DELETE ON public.bl_containers DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public._demurrage_travado_flush();
CREATE CONSTRAINT TRIGGER trg_bl_containers_travado_flush_upd
  AFTER UPDATE ON public.bl_containers DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.container_number IS DISTINCT FROM OLD.container_number
     OR NEW.bl_id IS DISTINCT FROM OLD.bl_id
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.discharge_date IS DISTINCT FROM OLD.discharge_date
     OR NEW.return_date IS DISTINCT FROM OLD.return_date
     OR NEW.ownership IS DISTINCT FROM OLD.ownership)
  EXECUTE FUNCTION public._demurrage_travado_flush();
CREATE CONSTRAINT TRIGGER trg_bls_travado_flush
  AFTER UPDATE OF ce_mercante, customer_id, cancelled_at, voyage_id, free_time_override ON public.bls
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.ce_mercante IS DISTINCT FROM OLD.ce_mercante
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
     OR NEW.voyage_id IS DISTINCT FROM OLD.voyage_id
     OR NEW.free_time_override IS DISTINCT FROM OLD.free_time_override)
  EXECUTE FUNCTION public._demurrage_travado_flush();

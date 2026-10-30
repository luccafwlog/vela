-- 528: tarifa resolvida pelo código do grupo e código de tipo em uso que não
-- muda (revisão final da PR luccafwlog/vela#1113, ADR 0112 D28, D29 e D34).
--
-- 1. A tarifa (`demurrage_rates.container_type`, chave para o grupo desde a
--    514) passava por `_demurrage_canonical_type`, que olhava primeiro o
--    cadastro de tipos. Os seis grupos (20GP, 40GP, 20FR, 40FR, 20RF, 40RF)
--    também são tipos no cadastro: mudar o grupo do tipo 40FR para 40' dry
--    fazia a tarifa do 40' especial contar como 40' dry, e os 40FH, 40FM e
--    48FR caíam em Travado, ou o 40' dry era cobrado pela tarifa errada.
--    O código de grupo passa a resolver para ele mesmo, antes do cadastro,
--    em todo lugar que usa a função (classificação, emissão, Portal, free time).
-- 2. O tipo cujo código é o de um grupo não muda de grupo nem de código.
-- 3. Qualquer Departamento renomeava o código de um tipo usado em B/L, o que
--    tirava a tarifa de todos os containers dele, como desativar (só o
--    Administrativo, D34). O código de tipo usado em B/L não muda: cadastre o
--    novo e desative o antigo (ADR 0073).
--
-- Não reescreve nem apaga linhas existentes.
--
-- Rollback: recriar `_demurrage_canonical_type` (514) e apagar a guarda.

CREATE OR REPLACE FUNCTION public._demurrage_canonical_type(p_type text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT g.code FROM public.demurrage_rate_groups g WHERE g.code = upper(btrim(COALESCE(p_type, '')))),
    (SELECT t.rate_group FROM public.container_types t WHERE t.code = upper(btrim(COALESCE(p_type, ''))) AND t.active)
  );
$function$;

CREATE OR REPLACE FUNCTION public.guard_container_type_code_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.demurrage_rate_groups g WHERE g.code = OLD.code)
     AND (NEW.code IS DISTINCT FROM OLD.code OR NEW.rate_group IS DISTINCT FROM OLD.rate_group) THEN
    RAISE EXCEPTION 'O tipo % é o código do grupo de tarifa: o grupo e o código dele não mudam.', OLD.code
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code
     AND EXISTS (SELECT 1 FROM public.bl_containers c WHERE upper(btrim(c.type)) = OLD.code) THEN
    RAISE EXCEPTION 'Tipo de container % já usado em B/L: o código não muda. Cadastre o novo código e desative este.', OLD.code
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_container_type_code_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_container_type_code_change BEFORE UPDATE OF code, rate_group ON public.container_types
  FOR EACH ROW EXECUTE FUNCTION public.guard_container_type_code_change();

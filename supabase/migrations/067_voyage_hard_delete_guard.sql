-- 067: hard-delete de Viagem somente quando ela nao tem dados vinculados.
-- A migration e aditiva: nao reescreve nem exclui linhas existentes. A
-- afirmacao "Data status" do AGENTS.md continua registrada para deixar claro
-- que nenhuma limpeza de dados e feita aqui.

-- Cancelamento e retencao operacional; a exclusao fisica e reservada para
-- viagens que ainda nao receberam nenhum dado de operacao.
CREATE OR REPLACE FUNCTION public.guard_voyage_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_table text;
  v_column text;
  v_has_rows boolean;
BEGIN
  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'Viagem % cancelada deve permanecer retida; use a rotina de recuperacao explicita.', OLD.id
      USING ERRCODE = '42501';
  END IF;

  -- O catalogo e a fonte da lista: uma nova tabela que passe a apontar para
  -- uma Viagem nao pode abrir uma cascata silenciosa por falta de atualizacao
  -- deste guard. O cast textual permite cobrir voyage_id bigint e integer, e
  -- tambem referencias opcionais como customer_communications.anchor_voyage_id.
  FOR v_table, v_column IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns AS c
    JOIN information_schema.tables AS t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name IN ('voyage_id', 'anchor_voyage_id')
      AND t.table_type = 'BASE TABLE'
      AND c.table_name <> 'voyages'
    ORDER BY c.table_name, c.column_name
  LOOP
    EXECUTE format(
      'SELECT EXISTS (
         SELECT 1
         FROM public.%I
         WHERE %I IS NOT NULL AND %I::text = $1::text
       )',
      v_table,
      v_column,
      v_column
    )
    INTO v_has_rows
    USING OLD.id;

    IF v_has_rows THEN
      RAISE EXCEPTION 'Viagem % nao pode ser excluida: ha dados vinculados em %.%.', OLD.id, v_table, v_column
        USING ERRCODE = 'P0003';
    END IF;
  END LOOP;

  RETURN OLD;
END;
$function$;

COMMENT ON FUNCTION public.guard_voyage_hard_delete() IS
  'Impede hard-delete de Viagem com dados vinculados; canceladas permanecem retidas.';

REVOKE ALL ON FUNCTION public.guard_voyage_hard_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_voyage_hard_delete ON public.voyages;
CREATE TRIGGER trg_guard_voyage_hard_delete
BEFORE DELETE ON public.voyages
FOR EACH ROW
EXECUTE FUNCTION public.guard_voyage_hard_delete();

-- 407: a tela de Taxas Locais sabe quais tabelas já foram usadas (revisão da
-- PR 1021, achado R-05; decisão do responsável de 2026-10-22 sobre a ADR 0093,
-- decisão 2: item de tabela ainda não usada fica com todos os setores).
--
-- Problema: desde a 354, `guard_tariff_correction_admin` recusa a quem não é
-- Administrativo incluir ou corrigir item só em tabela já usada (vínculo,
-- cálculo ou fatura, `charge_table_in_use`). A tela não tinha como saber o uso
-- (a 384 fechou `charge_table_in_use` para a API) e escondia Editar de todo
-- item para quem não é Administrativo, inclusive em tabela nova, que o banco
-- aceita.
--
-- Mudança:
--   1. `charge_tables_in_use(ids)`: devolve, das tabelas pedidas, as que estão
--      em uso pela mesma régua da guarda (`charge_table_in_use`). Só leitura,
--      para usuário interno ativo (`is_active_read_user`); a decisão de
--      permitir a correção continua no gatilho.
--   2. Índice parcial em `charge_calculations (charge_table_id)`: a régua
--      consulta o cálculo de cada tabela sem vínculo, e a coluna não tinha
--      índice (vínculo e fatura já têm).
--
-- Só cria função e índice; não reescreve nem apaga linhas existentes.
--
-- Rollback: DROP FUNCTION public.charge_tables_in_use(bigint[]);
-- DROP INDEX public.idx_charge_calculations_charge_table_id.

CREATE INDEX IF NOT EXISTS idx_charge_calculations_charge_table_id
  ON public.charge_calculations (charge_table_id)
  WHERE charge_table_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.charge_tables_in_use(p_table_ids bigint[])
RETURNS bigint[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF cardinality(COALESCE(p_table_ids, ARRAY[]::bigint[])) > 500 THEN
    RAISE EXCEPTION 'Tabelas demais numa consulta: peça até 500.' USING ERRCODE = '22023';
  END IF;
  RETURN ARRAY(
    SELECT DISTINCT t.id
    FROM unnest(COALESCE(p_table_ids, ARRAY[]::bigint[])) AS t(id)
    WHERE t.id IS NOT NULL AND public.charge_table_in_use(t.id)
    ORDER BY t.id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.charge_tables_in_use(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.charge_tables_in_use(bigint[]) TO authenticated, service_role;

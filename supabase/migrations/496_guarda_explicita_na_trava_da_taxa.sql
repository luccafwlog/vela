-- 496: Guarda explícita no invólucro de trava das ações de taxa do B/L
-- (ADR 0111; correção do check de segurança `verificar_guardas.py`, [3] e [6]).
--
-- A 492 transformou `_lock_bl_for_charge_change` em invólucro da
-- `_lock_bl_for_charge_change_491`, que confere o usuário antes do
-- `FOR UPDATE`. A guarda continuava valendo, mas dois níveis abaixo, onde o
-- check não a enxerga, e por isso **Alterar**, **Excluir** e **Desfazer** taxa
-- apareciam como trava antes da guarda. O invólucro passa a conferir o usuário
-- interno ativo antes de chamar a função interna. O comportamento não muda.
--
-- Não muda dado.
--
-- Rollback: recriar o invólucro da 492 (sem o IF).

CREATE OR REPLACE FUNCTION public._lock_bl_for_charge_change(p_bl_id text, p_justification text, p_actor uuid)
 RETURNS public.bls
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.bls;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Somente usuário interno ativo altera as taxas do B/L.' USING ERRCODE = '42501';
  END IF;
  v_bl := public._lock_bl_for_charge_change_491(p_bl_id, p_justification, p_actor);
  PERFORM public._assert_bl_not_manually_exempt(v_bl.id);
  RETURN v_bl;
END;
$function$;
REVOKE ALL ON FUNCTION public._lock_bl_for_charge_change(text, text, uuid) FROM PUBLIC, anon, authenticated;

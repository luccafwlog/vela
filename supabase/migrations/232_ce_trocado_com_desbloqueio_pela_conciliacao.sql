-- Migration 232: troca ou remoção do CE de B/L com Desbloqueio conferido volta a
-- abrir o alerta `ce_trocado_com_desbloqueio` e a avisar na prévia (correção B1
-- do plano de correções de 2026-10-14; ADR 0078, item 4).
--
-- Problema: `_set_bl_ce_mercante` e `_analyze_ce_mercante_rows` (195) tratam
-- como conferido o B/L com `ce_unlock_request_bls.confirmed_at`, a confirmação
-- manual retirada na `160`. O fluxo vigente marca o B/L como *Desbloqueio
-- conferido* pela conciliação ZPT (`ce_unlock_reconcile`), em
-- `ce_unlock_zpt_status` com `status = 'unlocked'`. Resultado: o alerta e o
-- aviso da prévia nunca disparavam.
--
-- Mudança: as duas funções passam a ler a conciliação para o CE anterior do
-- B/L. Texto do alerta, assinatura, grants e SECURITY DEFINER preservados
-- (substituição pontual sobre a definição vigente). Nenhuma linha é alterada.
--
-- Rollback: reaplicar as definições de `_set_bl_ce_mercante` e
-- `_analyze_ce_mercante_rows` da migration `195`.

DO $migration$
DECLARE
  v_def text;
  v_old_set constant text := 'SELECT 1 FROM public.ce_unlock_request_bls AS u
    WHERE u.bl_id = p_bl_id AND u.active AND u.confirmed_at IS NOT NULL';
  v_new_set constant text := 'SELECT 1 FROM public.ce_unlock_zpt_status AS z
    WHERE z.bl_id = p_bl_id AND z.status = ''unlocked''
      AND public.ce_mercante_key(z.ce_mercante) = public.ce_mercante_key(v_old_ce)';
  v_old_an constant text := 'SELECT 1 FROM public.ce_unlock_request_bls AS u WHERE u.bl_id = v_bl.id AND u.active AND u.confirmed_at IS NOT NULL';
  v_new_an constant text := 'SELECT 1 FROM public.ce_unlock_zpt_status AS z WHERE z.bl_id = v_bl.id AND z.status = ''unlocked''
          AND public.ce_mercante_key(z.ce_mercante) = public.ce_mercante_key(v_bl.ce_mercante)';
BEGIN
  v_def := pg_get_functiondef('public._set_bl_ce_mercante(text,text,uuid,text,text)'::regprocedure);
  IF position(v_old_set IN v_def) = 0 THEN
    RAISE EXCEPTION '_set_bl_ce_mercante: trecho esperado da 195 não encontrado';
  END IF;
  EXECUTE replace(v_def, v_old_set, v_new_set);

  v_def := pg_get_functiondef('public._analyze_ce_mercante_rows(jsonb,text,bigint)'::regprocedure);
  IF position(v_old_an IN v_def) = 0 THEN
    RAISE EXCEPTION '_analyze_ce_mercante_rows: trecho esperado da 195 não encontrado';
  END IF;
  EXECUTE replace(v_def, v_old_an, v_new_an);
END
$migration$;

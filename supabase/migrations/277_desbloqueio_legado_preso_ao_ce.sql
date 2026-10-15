-- 277: a confirmação manual legada do Desbloqueio de CE vale só para o CE que
-- ela confirmou (decisão do dono de 2026-10-15 na revisão da PR 954; item B1,
-- migration 230; ADR 0078, item 4).
--
-- Problema: `_bl_ce_unlock_conferred(bl, ce)` (230) compara a conciliação ZPT
-- com o CE anterior, mas o ramo da confirmação manual legada
-- (`ce_unlock_request_bls.confirmed_at`, anterior à migration 160) não olhava
-- o CE. Exemplo: o CE …051 do B/L foi desbloqueado; corrigido para …052, o
-- alerta `ce_trocado_com_desbloqueio` abre, como deve; corrigido de novo para
-- …053, o alerta reabria, como se …052 tivesse sido desbloqueado.
--
-- Mudança: o ramo legado exige que o CE confirmado (`confirmed_ce`, ou o CE do
-- pedido, `ce_at_request`) seja o CE anterior, pela mesma chave
-- (`ce_mercante_key`), como a conciliação ZPT. Confirmação legada sem nenhum
-- dos dois gravado segue valendo, porque não há CE para comparar.
--
-- Só redefine uma função; não reescreve nem apaga linhas.
-- Rollback: reaplicar a definição da migration 230.

CREATE OR REPLACE FUNCTION public._bl_ce_unlock_conferred(p_bl_id text, p_ce text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT NULLIF(btrim(COALESCE(p_ce, '')), '') IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.ce_unlock_zpt_status AS z
      WHERE z.bl_id = p_bl_id AND z.status = 'unlocked'
        AND public.ce_mercante_key(z.ce_mercante) = public.ce_mercante_key(p_ce))
    OR EXISTS (
      SELECT 1 FROM public.ce_unlock_request_bls AS u
      WHERE u.bl_id = p_bl_id AND u.active AND u.confirmed_at IS NOT NULL
        AND (
          COALESCE(NULLIF(btrim(u.confirmed_ce), ''), NULLIF(btrim(u.ce_at_request), '')) IS NULL
          OR public.ce_mercante_key(COALESCE(NULLIF(btrim(u.confirmed_ce), ''), u.ce_at_request)) = public.ce_mercante_key(p_ce)
        ))
  );
$function$;

REVOKE ALL ON FUNCTION public._bl_ce_unlock_conferred(text, text) FROM PUBLIC, anon, authenticated;

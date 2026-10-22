-- 384: `charge_table_in_use` (354) e `bl_calculation_is_current` (355) são
-- SECURITY DEFINER sem guarda de perfil e só são chamadas por funções
-- SECURITY DEFINER do próprio banco (guard_tariff_correction_admin,
-- _auto_bill_bl_core, _refresh_bl_calculation_if_stale). A tela não as usa.
-- Fecha o EXECUTE para authenticated (scripts/security/verificar_guardas.py).

REVOKE EXECUTE ON FUNCTION public.charge_table_in_use(bigint) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.bl_calculation_is_current(text) FROM authenticated;

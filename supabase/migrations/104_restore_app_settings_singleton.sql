-- Production preflight on 2026-09-28 found the singleton absent after migration 044.
-- Restore the fail-closed default without overwriting an existing operator setting.
INSERT INTO public.app_settings (
  id,
  communications_enabled,
  demurrage_dunning_interval_days
)
VALUES (1, false, 7)
ON CONFLICT (id) DO NOTHING;

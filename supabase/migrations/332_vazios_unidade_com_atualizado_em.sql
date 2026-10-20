-- 332: a Unidade Embarcada guarda quando foi alterada, para o "Atualizado em"
-- da lista de embarques (revisão do lote 5b, 2026-10-20).
--
-- Problema:
--   A lista de embarques (`/embarquevazios`) mostra em "Atualizado em" a data
--   mais recente entre o embarque, as linhas de serviço (`updated_at`) e as
--   unidades. `vazios_bookings` só tinha `created_at`: editar as datas, o
--   local ou a condição de uma unidade, ou reimportar a planilha por cima, não
--   mudava o "Atualizado em", e o embarque não subia na lista.
--
-- Mudança:
--   - `vazios_bookings.updated_at` (timestamptz), com default `now()` para as
--     unidades novas;
--   - gatilho `set_vazios_booking_updated_at` (BEFORE UPDATE) grava `now()` a
--     cada alteração, pela RPC manual, pela importação ou por gravação direta.
--   A coluna nasce vazia nas unidades existentes (a tela usa `created_at`
--   quando ela falta): o `ADD COLUMN` vem sem default de propósito, para não
--   carimbar todas com a hora da migration.
--
-- Não reescreve nem apaga linha existente.
-- Reversão: `DROP TRIGGER set_vazios_booking_updated_at ON public.vazios_bookings;
-- DROP FUNCTION public.set_vazios_booking_updated_at();
-- ALTER TABLE public.vazios_bookings DROP COLUMN updated_at;`

ALTER TABLE public.vazios_bookings ADD COLUMN updated_at timestamp with time zone;
ALTER TABLE public.vazios_bookings ALTER COLUMN updated_at SET DEFAULT now();

CREATE OR REPLACE FUNCTION public.set_vazios_booking_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_vazios_booking_updated_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER set_vazios_booking_updated_at
  BEFORE UPDATE ON public.vazios_bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_vazios_booking_updated_at();

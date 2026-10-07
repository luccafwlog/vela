-- 156: impede apagar o singleton app_settings.
-- A linha id = 1 sumiu de produção duas vezes por ação externa ao repositório
-- (restaurada pelas migrations 104 e 155; origem não identificada). Desde a 152
-- ela também referencia user_profiles, então um TRUNCATE user_profiles CASCADE a
-- levaria junto. Apagar a configuração passa a falhar com erro visível, inclusive
-- em cascata; quem precisar mesmo removê-la tem de desabilitar o gatilho de
-- propósito. Aditiva: só cria gatilhos.
BEGIN;

CREATE FUNCTION public.app_settings_block_removal() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'app_settings é configuração única do sistema; não pode ser apagada (%).', TG_OP
    USING ERRCODE = '55000',
          HINT = 'Altere os valores com UPDATE. Para remover de propósito, desabilite o gatilho app_settings_block_removal.';
END;
$$;
REVOKE ALL ON FUNCTION public.app_settings_block_removal() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER app_settings_block_delete BEFORE DELETE ON public.app_settings
FOR EACH ROW EXECUTE FUNCTION public.app_settings_block_removal();
CREATE TRIGGER app_settings_block_truncate BEFORE TRUNCATE ON public.app_settings
FOR EACH STATEMENT EXECUTE FUNCTION public.app_settings_block_removal();

COMMIT;

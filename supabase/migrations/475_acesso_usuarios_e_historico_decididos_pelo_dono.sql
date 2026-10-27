-- 475: Acesso, usuários e Histórico (decisões do dono de 2026-10-27, lote 7 do
-- plano de correções).
--
-- Problema e mudança, por seção:
--   1. ACE-D16 — o Histórico mostrava "—" no autor para quem não é do
--      Administrativo, porque só ele lê o cadastro de usuários. A função
--      `get_user_display_names` devolve só o id e o nome de quem fez, a todo
--      usuário interno ativo ([ADR 0106](../../docs/adr/0106-nome-do-autor-no-historico-para-todos.md));
--      o cadastro de usuários continua do Administrativo.
--   2. ACE-D12 — a reativação de usuário gravava duas linhas no Histórico de
--      ações, e a do motivo ficava no assunto "Outro registro". Agora o motivo
--      vai na linha da troca de situação do usuário (assunto Usuário, com o
--      nome) e não sai a segunda linha.
--   3. ACE-D06 — a Administração é do Administrativo "inclusive leitura" (ADR
--      0085), mas o banco deixava todos lerem as falhas de entrega dos alertas
--      e as linhas de Usuário do Histórico de ações (setor, situação, senha).
--      As duas passam a ser leitura só do Administrativo. Os demais assuntos do
--      Histórico e o Prazo do ADR seguem lidos por todos, porque são os mesmos
--      dados do Histórico do B/L, da Viagem, do Cliente e do ADR de Saída
--      (decisão do dono de 2026-10-27; ADR 0106).
--
-- Rollback: reaplicar `reactivate_catalog_row` da `329`; DROP FUNCTION
-- public.get_user_display_names(uuid[]); recriar as policies
-- `alert_notification_failures_select_active` (`is_active_user()`) e
-- `audit_logs_select_active` (`is_active_read_user()`).

-- 1. ACE-D16
CREATE OR REPLACE FUNCTION public.get_user_display_names(p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, full_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(cardinality(p_user_ids), 0) > 500 THEN
    RAISE EXCEPTION 'No máximo 500 autores por consulta.' USING ERRCODE = '22023';
  END IF;
  -- Só o nome: e-mail, setor e situação continuam do Administrativo. Usuário
  -- desativado mantém o nome, porque o Histórico é do que já aconteceu.
  RETURN QUERY
  SELECT up.id, up.full_name
  FROM public.user_profiles AS up
  WHERE up.id = ANY(COALESCE(p_user_ids, ARRAY[]::uuid[]));
END;
$function$;
REVOKE ALL ON FUNCTION public.get_user_display_names(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_display_names(uuid[]) TO authenticated;

-- 2. ACE-D12
CREATE OR REPLACE FUNCTION public.reactivate_catalog_row(p_table text, p_id text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo reativa.' USING ERRCODE = '42501';
  END IF;
  IF p_table NOT IN (
    'charge_tables', 'charge_table_items', 'customer_rate_overrides',
    'demurrage_rates', 'customer_demurrage_agreements', 'user_profiles',
    'depots', 'depot_services'
  ) THEN
    RAISE EXCEPTION 'Tabela fora da reativação de cadastro: %.', p_table USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da reativação.' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('vela.import_context', 'Reativação: ' || v_reason, true);
  -- 475 (ACE-D12): no usuário, o motivo vai na linha da troca de situação que o
  -- gatilho `audit_user_profile_changes` grava (assunto Usuário, com o nome),
  -- e não sai a segunda linha genérica.
  IF p_table = 'user_profiles' THEN
    PERFORM set_config('vela.access_change_reason', v_reason, true);
  END IF;
  -- ponytail: id::text evita um ramo por tipo de chave (uuid/bigint), como em
  -- delete_catalog_row; cadastros pequenos.
  EXECUTE format('UPDATE public.%I SET active = true WHERE id::text = $1 AND active = false', p_table) USING p_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('vela.import_context', '', true);
  PERFORM set_config('vela.access_change_reason', '', true);

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Nada foi reativado: o registro não existe ou já está ativo.' USING ERRCODE = 'P0002';
  END IF;

  IF p_table <> 'user_profiles' THEN
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES (p_table, p_id, 'reativado', 'false', 'true', auth.uid(), v_reason);
  END IF;
END;
$function$;

-- 3. ACE-D06
DROP POLICY IF EXISTS alert_notification_failures_select_active ON public.alert_notification_failures;
DROP POLICY IF EXISTS alert_notification_failures_select_admin ON public.alert_notification_failures;
CREATE POLICY alert_notification_failures_select_admin ON public.alert_notification_failures
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS audit_logs_select_active ON public.audit_logs;
CREATE POLICY audit_logs_select_active ON public.audit_logs
  FOR SELECT TO authenticated
  USING ((SELECT public.is_active_read_user()) AND (entity_type <> 'user_profile' OR (SELECT public.is_admin())));

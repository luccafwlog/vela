-- 603: a gravidade de cada tipo de alerta passa a ser trocada na tela Regras
-- de alertas, pelo Administrativo, com motivo (pedido do dono de 2026-11-06;
-- ADR 0130).
--
-- Até aqui a gravidade (Crítico ou Normal) de um tipo só mudava por migration
-- (a 467 fez Crítico a Fatura desatualizada). Ela decide a ordem da fila (os
-- críticos vêm primeiro), o cartão Críticos e, quando o setor responsável não
-- tem ninguém ativo, se o aviso vai ao Administrativo (só o crítico vai,
-- `fanout_alert_item_for_department`).
--
-- 1. `list_alert_type_settings()`: leitura de todo usuário interno ativo. Para
--    cada tipo ativo do catálogo, a gravidade vigente, quantos alertas abertos
--    ele tem e a última troca (quando, quem, a gravidade anterior e o motivo).
-- 2. `set_alert_type_severity(tipo, gravidade, motivo)`: só o Administrativo
--    (`is_admin()`, que inclui a conta Dev), com motivo de 10 caracteres ou
--    mais. Troca a gravidade no catálogo e nos alertas abertos do tipo, na
--    mesma transação, e grava a troca em `audit_logs` (`alert_type`, campo
--    `severity`), lida em Admin › Histórico de ações (assunto Alerta). Os
--    alertas resolvidos guardam a gravidade que tinham; as notificações do
--    sino já entregues não mudam, e a troca não avisa ninguém de novo.
--    `upsert_alert_item` já grava a gravidade do catálogo em todo alerta que
--    abre ou atualiza (078), então os próximos seguem a nova.
--
-- Plano de preservação: a migration não reescreve nem apaga linha. Os UPDATE
-- abaixo são o corpo de `set_alert_type_severity`, que só roda quando o
-- Administrativo confirma a troca na tela, e tocam
-- `alert_type_catalog.severity` de um tipo e `alert_items.severity` dos
-- alertas ativos desse tipo. O valor anterior fica em `audit_logs`
-- (`entity_type = 'alert_type'`, `old_value`, com o autor e o motivo).
-- Conferir: `SELECT type, severity FROM alert_type_catalog ORDER BY 1` igual
-- antes e depois desta migration. Desfazer uma troca: trocar de volta pela
-- própria tela (ou chamar a função com a gravidade anterior).
--
-- Rollback: `DROP FUNCTION public.set_alert_type_severity(text, text, text)`
-- e `DROP FUNCTION public.list_alert_type_settings()`. As trocas já feitas
-- ficam no catálogo e em `audit_logs`.

CREATE OR REPLACE FUNCTION public.list_alert_type_settings()
 RETURNS TABLE(
   type text,
   severity text,
   active_items integer,
   changed_at timestamp with time zone,
   changed_by_name text,
   previous_severity text,
   change_reason text
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT c.type,
         c.severity,
         (SELECT count(*)::integer
            FROM public.alert_items i
           WHERE i.item_type = c.type AND i.status = 'active'),
         last_change.changed_at,
         up.full_name,
         last_change.old_value,
         last_change.justification
  FROM public.alert_type_catalog c
  LEFT JOIN LATERAL (
    SELECT l.changed_at, l.changed_by, l.old_value, l.justification
    FROM public.audit_logs l
    WHERE l.entity_type = 'alert_type'
      AND l.entity_id = c.type
      AND l.field_name = 'severity'
    ORDER BY l.changed_at DESC, l.id DESC
    LIMIT 1
  ) last_change ON true
  LEFT JOIN public.user_profiles up ON up.id = last_change.changed_by
  WHERE c.active
  ORDER BY c.type;
END;
$function$;

COMMENT ON FUNCTION public.list_alert_type_settings() IS
  'Gravidade vigente de cada tipo ativo de alerta, alertas abertos e a última troca feita na tela Regras de alertas (603, ADR 0130).';

REVOKE ALL ON FUNCTION public.list_alert_type_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_alert_type_settings() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_alert_type_severity(p_type text, p_severity text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_type text := NULLIF(btrim(COALESCE(p_type, '')), '');
  v_severity text := NULLIF(btrim(COALESCE(p_severity, '')), '');
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_previous text;
  v_items integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  -- ADR 0130: só o Administrativo (e a conta Dev, que é do Administrativo).
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo troca a gravidade de um alerta.' USING ERRCODE = '42501';
  END IF;
  IF v_severity IS NULL OR v_severity NOT IN ('critical', 'normal') THEN
    RAISE EXCEPTION 'Gravidade inválida: escolha Crítico ou Normal.' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 10 THEN
    RAISE EXCEPTION 'Informe o motivo da troca, com pelo menos 10 caracteres.' USING ERRCODE = '22023';
  END IF;

  SELECT c.severity INTO v_previous
  FROM public.alert_type_catalog c
  WHERE c.type = v_type AND c.active
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tipo de alerta fora do catálogo: %.', COALESCE(v_type, '(vazio)') USING ERRCODE = 'P0002';
  END IF;
  -- Outra pessoa trocou antes: a tela estava velha.
  IF v_previous = v_severity THEN
    RAISE EXCEPTION 'A gravidade deste alerta já é %; atualize a página.',
      CASE v_severity WHEN 'critical' THEN 'Crítico' ELSE 'Normal' END
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.alert_type_catalog
  SET severity = v_severity
  WHERE type = v_type;

  -- ponytail: um `upsert_alert_item` que leu o catálogo antes desta troca e
  -- grava depois dela devolve a gravidade antiga a um alerta aberto; a próxima
  -- atualização dele (o detector de 15 minutos, nos de prazo) corrige. Se isso
  -- pesar, o upsert passa a ler o catálogo com `FOR SHARE`.
  UPDATE public.alert_items
  SET severity = v_severity,
      updated_at = now()
  WHERE item_type = v_type
    AND status = 'active'
    AND severity IS DISTINCT FROM v_severity;
  GET DIAGNOSTICS v_items = ROW_COUNT;

  -- Histórico de ações (assunto Alerta), com o autor e o motivo.
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('alert_type', v_type, 'severity', v_previous, v_severity, auth.uid(), v_reason);

  RETURN jsonb_build_object(
    'type', v_type,
    'previous_severity', v_previous,
    'severity', v_severity,
    'active_items', v_items
  );
END;
$function$;

COMMENT ON FUNCTION public.set_alert_type_severity(text, text, text) IS
  'Troca a gravidade (critical/normal) de um tipo de alerta e dos alertas abertos dele; só o Administrativo, com motivo (603, ADR 0130).';

REVOKE ALL ON FUNCTION public.set_alert_type_severity(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_alert_type_severity(text, text, text) TO authenticated, service_role;

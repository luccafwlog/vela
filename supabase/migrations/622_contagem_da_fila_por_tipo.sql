-- 622: quantos alertas de cada tipo a pessoa vê na fila agora (decisão do
-- dono de 2026-11-07, ADR 0134, item 2). É o número de cada cartão do mapa
-- da tela Regras de alertas; clicar nele abre a fila filtrada no tipo.
--
-- Conta o que a fila mostra a quem pergunta, item por item, como
-- `list_alert_queue_page`: o alerta técnico (620, `_alert_item_visible_to_caller`)
-- conta só para a conta Dev. O "Abertos agora" da ficha
-- (`list_alert_type_settings`, 603) continua contando todos os itens do tipo,
-- porque é o que a troca de gravidade alcança.
--
-- Plano de preservação: só cria uma função de leitura; não grava, não muda
-- nem apaga linha. Conferir: `SELECT * FROM public.count_alert_queue_by_type()`
-- como usuário interno ativo soma o mesmo que a fila ativa dele. Desfazer:
-- `DROP FUNCTION public.count_alert_queue_by_type()`.

CREATE FUNCTION public.count_alert_queue_by_type()
 RETURNS TABLE(type text, active_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT i.item_type, count(*)::bigint
  FROM public.alerts a
  JOIN public.alert_items i ON i.alert_id = a.id AND i.status = 'active'
  WHERE a.status <> 'closed'
    AND public._alert_item_visible_to_caller(i.item_type, i.metadata)
  GROUP BY i.item_type
  ORDER BY i.item_type;
END;
$function$;

COMMENT ON FUNCTION public.count_alert_queue_by_type() IS
  'Alertas ativos por tipo que a pessoa vê na fila (622, ADR 0134): o técnico conta só para a conta Dev.';

REVOKE ALL ON FUNCTION public.count_alert_queue_by_type() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_alert_queue_by_type() TO authenticated, service_role;

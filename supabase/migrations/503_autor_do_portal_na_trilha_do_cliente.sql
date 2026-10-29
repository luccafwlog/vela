-- 503: mudança de cadastro feita pelo Cliente no Perfil do Portal aparece em
-- Alterações do cadastro (ficha do Cliente) como "Cliente pelo Portal", não
-- como "Usuário interno".
--
-- Problema: `portal_update_profile` grava endereço, cidade, UF e CEP em
-- `customers`; o gatilho `audit_customers` registra a mudança com o usuário
-- de login do Portal (`auth.uid()`). `customer_audit_timeline` (404) devolve
-- esse id em `changed_by`, mas ele não tem perfil interno: o nome não vem e a
-- tela cai em "Usuário interno". Os contatos já distinguem o Portal por
-- `customer_contact_change_events.source`; a trilha do cadastro não tinha como.
--
-- Mudança: `customer_audit_timeline` ganha a coluna `changed_by_portal`
-- (verdadeira quando `changed_by` é o login de uma conta do Portal,
-- `customer_portal_accounts.auth_user_id`, ativa ou não, porque a trilha é do
-- que já aconteceu). O resto da função é o da 404. A troca do tipo de retorno
-- pede DROP e CREATE; os grants são refeitos iguais.
--
-- Só redefine função; não reescreve nem apaga linhas.
-- Rollback: DROP FUNCTION public.customer_audit_timeline(bigint, integer) e
-- reaplicar a definição e os grants da 404.

DROP FUNCTION IF EXISTS public.customer_audit_timeline(bigint, integer);

CREATE FUNCTION public.customer_audit_timeline(p_customer_id bigint, p_limit integer DEFAULT 100)
RETURNS TABLE(id bigint, subject text, field_name text, old_value text, new_value text, changed_by uuid, changed_at timestamp with time zone, justification text, changed_by_portal boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- ponytail: o contato já excluído é achado pelo JSON do rastro, numa
  -- varredura das linhas criado/excluído de `customer_contacts` (poucas). Se
  -- crescer, o upgrade é gravar o Cliente na linha, como `bl_id` faz para o B/L.
  WITH contacts AS (
    SELECT cc.id::text AS id FROM public.customer_contacts cc WHERE cc.customer_id = p_customer_id
    UNION
    SELECT a.entity_id FROM public.audit_logs a
    WHERE a.entity_type = 'customer_contacts' AND a.field_name IN ('criado', 'excluido')
      AND public._audit_json_field(COALESCE(a.new_value, a.old_value), 'customer_id') = p_customer_id::text
  ),
  events AS (
    -- Linhas semânticas do Cliente (edição com justificativa, desativação).
    SELECT a.id, 'cliente'::text AS subject, a.field_name, a.old_value, a.new_value, a.changed_by, a.changed_at, a.justification
    FROM public.audit_logs a
    WHERE a.entity_type = 'customer' AND a.entity_id = p_customer_id::text
    UNION ALL
    -- Gatilho de `customers` (Base de Clientes e outras portas), sem repetir a
    -- linha semântica do mesmo campo no mesmo instante.
    SELECT a.id, 'cliente', a.field_name, a.old_value, a.new_value, a.changed_by, a.changed_at, a.justification
    FROM public.audit_logs a
    WHERE a.entity_type = 'customers' AND a.entity_id = p_customer_id::text
      AND a.field_name IN ('name', 'trade_name', 'address', 'city', 'state', 'zip', 'notes', 'cnpj_cpf')
      AND NOT EXISTS (
        SELECT 1 FROM public.audit_logs s
        WHERE s.entity_type = 'customer' AND s.entity_id = a.entity_id
          AND s.field_name = a.field_name AND s.changed_at = a.changed_at)
    UNION ALL
    -- E-mails que a Base de Clientes incluiu, mudou ou tirou (as outras
    -- portas já aparecem pelos eventos de contato).
    SELECT a.id, 'contato',
      CASE a.field_name WHEN 'criado' THEN 'contact_added' WHEN 'excluido' THEN 'contact_removed' ELSE 'contact_email' END,
      CASE WHEN a.field_name = 'excluido' THEN public._audit_json_field(a.old_value, 'email')
           WHEN a.field_name = 'criado' THEN NULL ELSE a.old_value END,
      CASE WHEN a.field_name = 'criado' THEN public._audit_json_field(a.new_value, 'email')
           WHEN a.field_name = 'excluido' THEN NULL ELSE a.new_value END,
      a.changed_by, a.changed_at, a.justification
    FROM public.audit_logs a
    WHERE a.entity_type = 'customer_contacts'
      AND a.entity_id IN (SELECT id FROM contacts)
      AND a.field_name IN ('criado', 'excluido', 'email')
      AND a.justification LIKE 'Importação de Base de Clientes%'
  )
  SELECT e.*,
    -- Login do Portal não tem perfil interno; a tela mostra o Cliente.
    EXISTS (SELECT 1 FROM public.customer_portal_accounts pa WHERE pa.auth_user_id = e.changed_by) AS changed_by_portal
  FROM events e
  WHERE public.is_active_read_user()
  ORDER BY e.changed_at DESC, e.id DESC
  LIMIT GREATEST(COALESCE(p_limit, 100), 0);
$function$;

REVOKE ALL ON FUNCTION public.customer_audit_timeline(bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_audit_timeline(bigint, integer) TO authenticated;

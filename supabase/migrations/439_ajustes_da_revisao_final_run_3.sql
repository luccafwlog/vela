-- 439: ajuste da revisão final da PR da auditoria run-3.
--
-- `_internal_token_current` (432) truncava o marco da revogação ao segundo:
-- o access token renovado ANTES da revogação, no mesmo segundo dela,
-- seguia valendo até expirar (até 1 hora), não por menos de 1 s. O `iat`
-- tem segundos inteiros e não distingue antes de depois dentro do segundo,
-- então o marco passa a ser arredondado para CIMA: só vale o token emitido
-- a partir do segundo seguinte. O login feito no mesmo segundo da
-- revogação é recusado e pede login de novo; a revogação só parte de
-- Editar acesso ou Desativar (admin-users), nunca do próprio usuário.
--
-- Só redefine funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar `_internal_token_current` da 432.

CREATE OR REPLACE FUNCTION public._internal_token_current()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.internal_credential_revocations AS r
    WHERE r.user_id = auth.uid()
      AND auth.jwt() ->> 'sub' = auth.uid()::text
      -- Sem `iat` numérico não há como provar emissão posterior ao marco.
      AND NOT COALESCE(
        CASE WHEN auth.jwt() ->> 'iat' ~ '^[0-9]+(\.[0-9]+)?$'
          -- O `iat` tem segundos inteiros: dentro do segundo do marco não se
          -- sabe se o token veio antes ou depois, e o caso vai para a recusa.
          THEN to_timestamp((auth.jwt() ->> 'iat')::double precision)
            >= to_timestamp(ceil(extract(epoch FROM r.revoked_at)))
        END,
        false)
  );
$function$;

-- 326 — Base de Clientes gravada numa vez só (regra de 2026-10-19, lote 6a da
-- identidade: importação com erro é recusada inteira e não grava nada).
--
-- Antes, a tela chamava `apply_customer_base_row_atomic` uma vez por Cliente e
-- seguia quando o banco recusava um (e-mail inválido, razão social trocada
-- depois da prévia): a base ficava gravada em parte ("Base gravada em parte").
-- Agora o arquivo inteiro vai numa chamada só:
--
--   `apply_customer_base_batch_atomic(p_rows, p_changed_by)`
--   `p_rows` = [{ cnpj, name, trade_name, address, city, state, zip, emails[],
--                 confirm_name_change, expected_current_name }, ...]
--
-- Cada Cliente passa pela mesma RPC por linha de sempre (invólucro da 189,
-- `_legacy_189` da 192: vínculo dos B/Ls pendentes, Revisão, Alertas, Taxas
-- Locais), num bloco próprio para que a recusa de um Cliente seja anotada com o
-- motivo sem interromper a conferência dos outros. No fim, se algum Cliente foi
-- recusado, o bloco externo é desfeito inteiro: nenhum Cliente, contato,
-- vínculo de B/L ou linha do Histórico fica gravado, e a função devolve
-- `{ ok: false, errors: [{ cnpj, code, message }] }`. Sem recusa, devolve
-- `{ ok: true, imported, updated, contacts_created, bls_linked, linked_bl_ids }`.
--
-- Fecha também a janela do `ponytail:` de `importCustomerBaseRows`: o aceite da
-- troca de razão social vale para o nome de antes que a prévia mostrou
-- (`expected_current_name`), conferido aqui com o Cliente travado; se outra
-- sessão renomeou o Cliente depois da prévia, a linha é recusada.
--
-- Permissão: o mesmo contrato da RPC por linha — usuário ativo,
-- `p_changed_by` igual a `auth.uid()`; EXECUTE só para `authenticated` (como a
-- 185 deu à `apply_customer_base_row_atomic`), revogado de PUBLIC e anon.
--
-- A RPC por linha continua (testes de integração e o Histórico a usam); a tela
-- deixa de chamá-la. Só cria função: não reescreve nem apaga linhas
-- existentes. Rollback: `DROP FUNCTION public.apply_customer_base_batch_atomic(jsonb, uuid);`

CREATE OR REPLACE FUNCTION public.apply_customer_base_batch_atomic(
  p_rows jsonb,
  p_changed_by uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_row jsonb;
  v_cnpj text;
  v_expected text;
  v_current text;
  v_result jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_imported integer := 0;
  v_updated integer := 0;
  v_contacts integer := 0;
  v_bls integer := 0;
  v_linked jsonb := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'Base de Clientes vazia.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_rows) > 5000 THEN
    RAISE EXCEPTION 'Base com mais de 5000 Clientes: divida o arquivo.' USING ERRCODE = '22023';
  END IF;

  BEGIN
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
      v_cnpj := NULLIF(btrim(COALESCE(v_row->>'cnpj', '')), '');
      BEGIN
        IF jsonb_typeof(v_row) <> 'object' THEN
          RAISE EXCEPTION 'Linha da base invalida.' USING ERRCODE = '22023';
        END IF;
        -- O aceite da troca vale para o nome que a prévia mostrou.
        IF COALESCE((v_row->>'confirm_name_change')::boolean, false) THEN
          v_expected := NULLIF(btrim(COALESCE(v_row->>'expected_current_name', '')), '');
          SELECT btrim(COALESCE(name, '')) INTO v_current
          FROM public.customers WHERE cnpj_cpf = v_cnpj FOR UPDATE;
          IF v_expected IS NULL OR NOT FOUND OR v_current IS DISTINCT FROM v_expected THEN
            RAISE EXCEPTION 'A razão social do Cliente % mudou depois da prévia: leia o arquivo de novo.', v_cnpj
              USING ERRCODE = 'P0001';
          END IF;
        END IF;

        v_result := public.apply_customer_base_row_atomic(
          v_cnpj,
          v_row->>'name',
          v_row->>'trade_name',
          v_row->>'address',
          v_row->>'city',
          v_row->>'state',
          v_row->>'zip',
          COALESCE(v_row->'emails', '[]'::jsonb),
          p_changed_by,
          COALESCE((v_row->>'confirm_name_change')::boolean, false)
        );
        IF COALESCE((v_result->>'created')::boolean, false) THEN
          v_imported := v_imported + 1;
        ELSE
          v_updated := v_updated + 1;
        END IF;
        v_contacts := v_contacts + COALESCE((v_result->>'contacts_created')::integer, 0);
        v_bls := v_bls + COALESCE((v_result->>'bls_linked')::integer, 0);
        v_linked := v_linked || COALESCE(v_result->'linked_bl_ids', '[]'::jsonb);
      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'cnpj', COALESCE(v_cnpj, ''), 'code', SQLSTATE, 'message', SQLERRM));
      END;
    END LOOP;

    IF jsonb_array_length(v_errors) > 0 THEN
      -- Desfaz os Clientes aceitos: a base é recusada inteira.
      RAISE EXCEPTION 'base de clientes recusada' USING ERRCODE = 'VB326';
    END IF;
  EXCEPTION WHEN SQLSTATE 'VB326' THEN
    RETURN jsonb_build_object('ok', false, 'errors', v_errors);
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'imported', v_imported,
    'updated', v_updated,
    'contacts_created', v_contacts,
    'bls_linked', v_bls,
    'linked_bl_ids', v_linked
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_customer_base_batch_atomic(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_customer_base_batch_atomic(jsonb, uuid) TO authenticated;

-- 460: o prazo do desbloqueio fica parado depois da exportação, o anual vencido
-- que cobre B/L exportado só sai depois da conferência e o vínculo do CE ignora
-- a auditoria de um B/L excluído com o mesmo número (revisão da PR de release
-- luccafwlog/vela#1061, migrations 450, 456 e 457).
--
-- Problema:
--   1. A 450 prometeu "exportado, o prazo fica" (ADR 0101, decisão 3), mas só
--      limitou à exportação o evento `complete`. Os demais fatos do prazo (envio,
--      entrega do original, liquidação, avulsa, aprovação de cada documento)
--      continuavam valendo depois dela: o desk desmarca a entrega de um B/L já
--      exportado, a `updated_at` da entrega vira o início do prazo e o B/L que
--      saiu fora do prazo passa a "Exportado no prazo". O mesmo com documento
--      revisto, liquidação, pagamento de avulsa ou reenvio depois da exportação.
--   2. A 457 guardou o anual vencido que ainda cobre B/L do Cliente, mas tratou o
--      B/L exportado como encerrado. Exportado não é conferido: se a ZPT devolve
--      "Divergente", reexportar exige termo e procuração. Em janeiro, com o anual
--      novo aprovado, a limpeza revogava o anual do ano anterior que cobria o B/L
--      exportado em dezembro e ainda não conferido; o item perdia termo,
--      procuração e a cobertura VIP, e a reexportação ficava impossível.
--   3. `ce_unlock_private.ce_link_day` (456) lia toda a auditoria com o id do
--      B/L. Um B/L excluído e importado de novo com o mesmo número herdava a data
--      de vínculo do CE do B/L antigo.
--
-- Mudança (no lugar, `pg_get_functiondef` + `replace`, como as 450 e 454):
--   1. `ce_unlock_private.item`: com o B/L exportado, cada fato do prazo só
--      conta até a exportação (o mesmo limite que a 450 deu ao `complete`). O
--      comentário da 449 sobre a data de importação passa a citar a 456.
--   2. `ce_unlock_cleanup_candidates`: o anual vencido que cobre B/L do Cliente
--      fica até o B/L ser conferido (`confirmed_at`), não só até a exportação.
--      O teto de um ano depois da vigência (457) não muda.
--   3. `ce_unlock_private.ce_link_day`: só a auditoria a partir da criação do
--      B/L atual (`changed_at >= created_at`).
--
-- Efeito: o prazo de um B/L exportado não muda mais; um prazo já deslocado por
-- um fato posterior à exportação volta ao valor certo na próxima leitura (é
-- calculado, não gravado).
--
-- Só redefine funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar `item` e `ce_unlock_cleanup_candidates` como estavam
-- depois da 457 (o `pg_get_functiondef` delas antes desta migration) e
-- `ce_link_day` da 456.

DO $patch$
DECLARE
  v_patch record;
  v_def text;
BEGIN
  FOR v_patch IN
    SELECT * FROM (VALUES
      (
        'ce_unlock_private.item(text,uuid)'::regprocedure,
        $s$ -- 449: o anual só cobre o B/L importado no Vela dentro da vigência dele.$s$,
        $s$ -- 456: o anual cobre o B/L com o CE vinculado dentro da vigência dele (covers).$s$
      ),
      (
        'ce_unlock_private.item(text,uuid)'::regprocedure,
        $s$WHERE e.request_id=r.id AND e.action='submit'),$s$,
        $s$WHERE e.request_id=r.id AND e.action='submit'
  -- 460: exportado, cada fato do prazo só conta até a exportação.
  AND (i.exported_at IS NULL OR e.created_at<=i.exported_at)),$s$
      ),
      (
        'ce_unlock_private.item(text,uuid)'::regprocedure,
        $s$(SELECT d.updated_at FROM public.ce_unlock_bl_deliveries d WHERE d.bl_id=p_bl),$s$,
        $s$(SELECT d.updated_at FROM public.ce_unlock_bl_deliveries d WHERE d.bl_id=p_bl
  AND (i.exported_at IS NULL OR d.updated_at<=i.exported_at)),$s$
      ),
      (
        'ce_unlock_private.item(text,uuid)'::regprocedure,
        $s$WHERE x.bl_id=p_bl AND x.status<>'void'),$s$,
        $s$WHERE x.bl_id=p_bl AND x.status<>'void'
  AND (i.exported_at IS NULL OR s.created_at<=i.exported_at)),$s$
      ),
      (
        'ce_unlock_private.item(text,uuid)'::regprocedure,
        $s$AND n.invoice_type='manual' AND n.customer_id=b.customer_id),$s$,
        $s$AND n.invoice_type='manual' AND n.customer_id=b.customer_id
  AND (i.exported_at IS NULL OR p.created_at<=i.exported_at)),$s$
      ),
      (
        'ce_unlock_private.item(text,uuid)'::regprocedure,
        $s$(SELECT d.reviewed_at FROM public.ce_unlock_documents d WHERE d.id=i.termo_document_id),$s$,
        $s$(SELECT d.reviewed_at FROM public.ce_unlock_documents d WHERE d.id=i.termo_document_id
  AND (i.exported_at IS NULL OR d.reviewed_at<=i.exported_at)),$s$
      ),
      (
        'ce_unlock_private.item(text,uuid)'::regprocedure,
        $s$(SELECT d.reviewed_at FROM public.ce_unlock_documents d WHERE d.id=i.procuracao_document_id),$s$,
        $s$(SELECT d.reviewed_at FROM public.ce_unlock_documents d WHERE d.id=i.procuracao_document_id
  AND (i.exported_at IS NULL OR d.reviewed_at<=i.exported_at)),$s$
      ),
      (
        'public.ce_unlock_cleanup_candidates()'::regprocedure,
        $s$AND NOT EXISTS(SELECT 1 FROM public.ce_unlock_request_bls u WHERE u.bl_id=b.id AND (u.exported_at IS NOT NULL OR u.confirmed_at IS NOT NULL)))))$s$,
        $s$-- 460: exportado ainda pode voltar "Divergente" e ser reexportado; o anual fica até a conferência.
 AND NOT EXISTS(SELECT 1 FROM public.ce_unlock_request_bls u WHERE u.bl_id=b.id AND u.confirmed_at IS NOT NULL))))$s$
      ),
      (
        'ce_unlock_private.ce_link_day(text)'::regprocedure,
        $s$AND public.ce_mercante_key(a.old_value) IS DISTINCT FROM public.ce_mercante_key(b.ce_mercante)),$s$,
        $s$AND public.ce_mercante_key(a.old_value) IS DISTINCT FROM public.ce_mercante_key(b.ce_mercante)
      -- 460: só a auditoria do B/L atual; a de um B/L excluído com o mesmo número não conta.
      AND a.changed_at>=b.created_at),$s$
      )
    ) AS p(fn, old_clause, new_clause)
  LOOP
    v_def := pg_get_functiondef(v_patch.fn);
    IF position(v_patch.old_clause IN v_def) = 0 THEN
      RAISE EXCEPTION '460: trecho não encontrado em %', v_patch.fn;
    END IF;
    IF position(v_patch.old_clause IN substr(v_def, position(v_patch.old_clause IN v_def) + 1)) > 0 THEN
      RAISE EXCEPTION '460: trecho repetido em %', v_patch.fn;
    END IF;
    EXECUTE replace(v_def, v_patch.old_clause, v_patch.new_clause);
  END LOOP;
END;
$patch$;

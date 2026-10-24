-- 450: o prazo do desbloqueio parte da validação da solicitação e não some
-- depois da exportação (revisão final da 448, ponto 10 das observações de
-- 2026-10-23).
--
-- Problema:
--   1. A 448 começa o prazo no último fato da lista dela (envio, entrega,
--      liquidação, avulsa, aprovação). Quando o que completa a solicitação é
--      outro fato, o prazo nasce no passado e o Vela já mostra "Venceu":
--      o B/L pendente muda para uma solicitação nova (`bl_moved`) e a antiga
--      fica só com os B/Ls prontos; as Taxas Locais viram isentas; a troca de
--      Cliente, o ajuste COD ou a Fatura desatualizada se resolvem. O aviso
--      "documentação validada" (sino e e-mail) sai com esse prazo vencido.
--   2. Com a 448, um requisito que cai depois da exportação (anual VIP que
--      vence na virada do ano, entrega desmarcada, avulsa nova) apaga o prazo
--      já medido: "Exportado no prazo" vira "Sem prazo".
--   3. A ficha do Cliente só mostrava o prazo da solicitação em aberto, e com
--      a 448 a solicitação só tem prazo quando está concluída: a coluna Prazo
--      ficava sempre "—".
--
-- Mudança (no lugar, `pg_get_functiondef` + `replace`, como as 322 e 453):
--   1. `ce_unlock_private.item`: a validação da solicitação (evento
--      `complete`, gravado por `refresh_completion` quando todos os B/Ls
--      ativos cumprem os quatro requisitos) também conta como fato do prazo,
--      até a exportação do B/L. Exportado, o prazo fica mesmo que um
--      requisito caia depois.
--   2. `ce_unlock_private.refresh_completion` (161): o aviso "documentação
--      validada" usa `request_sla_start` depois de gravar a validação, o mesmo
--      prazo que o Portal e o Vela mostram.
--   3. `ce_unlock_customer_requests` (448): devolve `exported_at` (a última
--      exportação, quando todos os B/Ls ativos foram exportados), para a ficha
--      mostrar o prazo da concluída como o detalhe da solicitação.
--
-- Efeito: o prazo da solicitação começa quando o último requisito se cumpre e
-- o sistema valida a solicitação — na hora, quando o fato passa por comando do
-- módulo; em até 5 minutos, quando vem da liquidação (job `ce-unlock-notify-
-- email`). Se esse job parar, a validação e o prazo atrasam junto.
--
-- ponytail: `ce_unlock_customer_requests` calcula `item()` de cada B/L de todo
-- o histórico do Cliente antes de paginar (O(solicitações × B/Ls) por página).
-- Upgrade: calcular o prazo só para a página, depois de ordenar.
--
-- Só redefine funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar `item` da 449, `refresh_completion` da 161 e
-- `ce_unlock_customer_requests` da 448 (com o patch da 454, se já aplicada).

DO $patch$
DECLARE
  v_patch record;
  v_def text;
BEGIN
  FOR v_patch IN
    SELECT * FROM (VALUES
      (
        'ce_unlock_private.item(text,uuid)'::regprocedure,
        $s$ AND paid AND td AND pd AND delivered THEN$s$,
        $s$ AND ((paid AND td AND pd AND delivered) OR i.exported_at IS NOT NULL) THEN
 -- 450: exportado, o prazo fica, mesmo que um requisito caia depois; e a
 -- validação da solicitação (evento complete) também é fato, até a exportação.$s$
      ),
      (
        'ce_unlock_private.item(text,uuid)'::regprocedure,
        $s$(SELECT d.reviewed_at FROM public.ce_unlock_documents d WHERE d.id=i.procuracao_document_id));$s$,
        $s$(SELECT d.reviewed_at FROM public.ce_unlock_documents d WHERE d.id=i.procuracao_document_id),
 (SELECT max(e.created_at) FROM public.ce_unlock_events e WHERE e.request_id=r.id AND e.action='complete'
  AND (i.exported_at IS NULL OR e.created_at<=i.exported_at)));$s$
      ),
      (
        'ce_unlock_private.refresh_completion(uuid)'::regprocedure,
        $s$ce_unlock_private.sla_deadline(coalesce(started,now()))$s$,
        $s$ce_unlock_private.sla_deadline(coalesce(ce_unlock_private.request_sla_start(r.id),now()))$s$
      ),
      (
        'public.ce_unlock_customer_requests(bigint,text,integer)'::regprocedure,
        $s$'sla_started_at', ce_unlock_private.request_sla_start(r.id),$s$,
        $s$'sla_started_at', ce_unlock_private.request_sla_start(r.id),
      -- 450: a concluída mostra o prazo até a última exportação, como o detalhe.
      'exported_at', (SELECT CASE WHEN count(*) > 0 AND bool_and(i.exported_at IS NOT NULL) THEN max(i.exported_at) END
        FROM public.ce_unlock_request_bls i WHERE i.request_id = r.id AND i.active),$s$
      )
    ) AS p(fn, old_clause, new_clause)
  LOOP
    v_def := pg_get_functiondef(v_patch.fn);
    IF position(v_patch.old_clause IN v_def) = 0 THEN
      RAISE EXCEPTION '450: trecho não encontrado em %', v_patch.fn;
    END IF;
    IF position(v_patch.old_clause IN substr(v_def, position(v_patch.old_clause IN v_def) + 1)) > 0 THEN
      RAISE EXCEPTION '450: trecho repetido em %', v_patch.fn;
    END IF;
    EXECUTE replace(v_def, v_patch.old_clause, v_patch.new_clause);
  END LOOP;
END;
$patch$;

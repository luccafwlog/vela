-- 577: Desbloqueio de CE › Andamento dos B/Ls: busca com espaço e "&",
-- filtros "Requisito atendido" e "VIP" e o histórico de cada B/L (pedidos do
-- dono de 2026-11-03).
--
-- 1. Busca.
--    - `public.search_term_tokens` (461) passa a separar também por "&": colar
--      "CSC45300C04Q00&CSC45300C04Q01" acha os dois B/Ls (com espaços em volta
--      do "&" já achava). Vale para toda busca por lista do Vela e do Portal;
--      `src/lib/searchTerms.ts` (SEPARATORS) muda junto.
--    - `ce_unlock_private.search_compact` (nova): o texto sem espaços (os
--      mesmos da lista, inclusive os Unicode) e sem "&", vírgula e ponto e
--      vírgula nas pontas. B/L e CE casam com ele: "CSC45300C04Q00 " (espaço
--      colado no fim), " CSC45300C04Q00" e "CSC 45300C04Q00" acham o B/L. O nome
--      do Cliente continua casando com o texto, só sem os espaços das pontas.
-- 2. `ce_unlock_private.list` (448, busca da 454) ganha os filtros
--    `met_requirement` (o inverso de `pending_requirement`: termo, procuracao,
--    taxas, bl_fisico) e `vip` (`customer`: Cliente com condição VIP;
--    `request`: solicitação VIP; `none`: Cliente sem VIP). Ajustada no lugar
--    (`pg_get_functiondef` + `replace`, como a 454), sem sobrescrever o resto.
-- 3. `ce_unlock_private.bl_history` (nova) e a leitura `bl_history` em
--    `public.ce_unlock_read` (redefinida da 250): os registros que fazem cada
--    requisito do B/L, com quando e quem, com ou sem solicitação, montados só
--    do que já é gravado:
--    - B/L original: eventos `delivery` do B/L (marcar e desmarcar, com motivo);
--    - termo e procuração: eventos `review` dos documentos das solicitações do
--      B/L e dos anuais VIP que o cobrem (aprovado, recusado, com motivo);
--    - taxas locais: baixas (`ledger_settlements`) dos recebíveis de Taxas
--      Locais do B/L, quem registrou pelo pagamento ou pela auditoria da baixa,
--      e pagamentos de fatura avulsa do B/L;
--    - contexto: rascunho, envio, cancelamento e validação das solicitações do
--      B/L, mudança de solicitação e envio à ZPT.
--    ponytail: baixa estornada some do histórico (a linha é apagada; só a
--    auditoria guarda); isenção de Taxas Locais não tem data própria aqui. Upgrade:
--    ler o DELETE de `audit_logs` e a marca de isenção, se o desk pedir.
--
-- Só redefine e cria funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar `search_term_tokens` pela 461, `ce_unlock_private.list`
-- pela 448 com o patch da 454 e `public.ce_unlock_read` pela 250; DROP FUNCTION
-- ce_unlock_private.bl_history(text), ce_unlock_private.search_compact(text).

-- 1. Busca -------------------------------------------------------------------

DO $patch$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.search_term_tokens(text)'::regprocedure);
  IF position(',;]+' IN v_def) = 0 THEN
    RAISE EXCEPTION '577: separadores não encontrados em search_term_tokens';
  END IF;
  EXECUTE replace(v_def, ',;]+', ',;&]+');
END;
$patch$;

CREATE OR REPLACE FUNCTION ce_unlock_private.search_compact(p_search text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Mesmos espaços de `search_term_tokens`; "&", vírgula e ponto e vírgula só
  -- saem das pontas (no meio, separam a lista, que os termos já cobrem).
  SELECT regexp_replace(
    regexp_replace(coalesce(p_search, ''), '[ \t\n\v\f\r   -     　﻿]+', '', 'g'),
    '^[&,;]+|[&,;]+$', '', 'g');
$function$;
REVOKE ALL ON FUNCTION ce_unlock_private.search_compact(text) FROM PUBLIC, anon, authenticated;

-- 2. Filtros da lista ----------------------------------------------------------

DO $patch$
DECLARE
  v_patch record;
  v_def text := pg_get_functiondef('ce_unlock_private.list(bigint,jsonb,integer,boolean)'::regprocedure);
BEGIN
  FOR v_patch IN
    SELECT * FROM (VALUES
      (
        $s$(coalesce(p_filters->>'search','')='' OR (j->>'bl_id') ILIKE '%'||(p_filters->>'search')||'%' OR (j->>'ce_mercante') ILIKE '%'||(p_filters->>'search')||'%' OR (j->>'customer_name') ILIKE '%'||(p_filters->>'search')||'%'$s$,
        $s$(ce_unlock_private.search_compact(p_filters->>'search')=''
    -- 577: B/L e CE casam o texto sem espaços; o nome, o texto sem os espaços das pontas.
    OR (j->>'bl_id') ILIKE '%'||ce_unlock_private.search_compact(p_filters->>'search')||'%'
    OR (j->>'ce_mercante') ILIKE '%'||ce_unlock_private.search_compact(p_filters->>'search')||'%'
    OR (j->>'customer_name') ILIKE '%'||btrim(p_filters->>'search', E' \t\n\r ')||'%'$s$
      ),
      (
        $s$ELSE p_filters->>'pending_requirement' END))::boolean,false));$s$,
        $s$ELSE p_filters->>'pending_requirement' END))::boolean,false))
 -- 577: requisito atendido (o inverso do pendente) e condição VIP.
 AND (coalesce(p_filters->>'met_requirement','')='' OR coalesce((j->>(CASE p_filters->>'met_requirement' WHEN 'taxas' THEN 'paid' WHEN 'bl_fisico' THEN 'delivered' ELSE p_filters->>'met_requirement' END))::boolean,false))
 AND (coalesce(p_filters->>'vip','')=''
 OR (p_filters->>'vip'='customer' AND coalesce((j->>'vip')::boolean,false))
 OR (p_filters->>'vip'='request' AND j->>'request_id' IS NOT NULL AND j->>'source'='vip_annual')
 OR (p_filters->>'vip'='none' AND NOT coalesce((j->>'vip')::boolean,false)));$s$
      )
    ) AS p(old_clause, new_clause)
  LOOP
    IF position(v_patch.old_clause IN v_def) = 0 THEN
      RAISE EXCEPTION '577: cláusula não encontrada em ce_unlock_private.list: %', left(v_patch.old_clause, 60);
    END IF;
    v_def := replace(v_def, v_patch.old_clause, v_patch.new_clause);
  END LOOP;
  EXECUTE v_def;
END;
$patch$;

-- 3. Histórico do B/L ---------------------------------------------------------

CREATE OR REPLACE FUNCTION ce_unlock_private.bl_history(p_bl text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE b public.bls; events jsonb;
BEGIN
 SELECT * INTO b FROM public.bls WHERE id=p_bl;
 IF b.id IS NULL THEN RAISE EXCEPTION 'B/L não encontrado'; END IF;
 WITH reqs AS (
   SELECT DISTINCT i.request_id FROM public.ce_unlock_request_bls i WHERE i.bl_id=p_bl
 ), docs AS (
   -- Documentos que contam para o B/L: os das solicitações dele, os ligados aos
   -- itens dele e os anuais VIP que o cobrem hoje.
   SELECT d.id, d.type, d.source, d.coverage_year, r.protocol
   FROM public.ce_unlock_documents d LEFT JOIN public.ce_unlock_requests r ON r.id=d.request_id
   WHERE d.type IN('termo','procuracao') AND (d.request_id IN(SELECT request_id FROM reqs)
     OR d.id IN(SELECT termo_document_id FROM public.ce_unlock_request_bls WHERE bl_id=p_bl
                UNION SELECT procuracao_document_id FROM public.ce_unlock_request_bls WHERE bl_id=p_bl)
     OR d.id=ce_unlock_private.annual_for_bl(b.customer_id,'termo',p_bl)
     OR d.id=ce_unlock_private.annual_for_bl(b.customer_id,'procuracao',p_bl))
 ), rows AS (
   -- B/L original
   SELECT e.created_at AS at, 'bl_original' AS requirement,
     CASE WHEN coalesce((e.payload->>'delivered')::boolean,false) THEN 'delivered' ELSE 'undelivered' END AS event,
     NULL::text AS detail, NULL::numeric AS amount, e.actor_id, e.reason, e.id AS ord
   FROM public.ce_unlock_events e WHERE e.action='delivery' AND e.bl_id=p_bl
   UNION ALL
   -- Termo de devolução e procuração
   SELECT e.created_at, d.type,
     CASE WHEN e.payload->>'decision'='approved' THEN 'approved' ELSE 'rejected' END,
     CASE WHEN d.source='vip_annual' THEN 'Anual VIP '||coalesce((e.payload->>'coverage_year'),d.coverage_year::text,'') ELSE d.protocol END,
     NULL, e.actor_id, e.reason, e.id
   FROM public.ce_unlock_events e JOIN docs d ON d.id::text=e.payload->>'document_id'
   WHERE e.action='review'
   UNION ALL
   -- Taxas locais: baixas dos recebíveis de Taxas Locais do B/L
   SELECT s.created_at, 'taxas', 'settled',
     CASE s.source WHEN 'manual' THEN 'baixa manual' WHEN 'pix_extract' THEN 'extrato Pix' WHEN 'itau_pix' THEN 'Pix Itaú' WHEN 'backfill' THEN 'carga inicial' ELSE s.source END,
     s.amount_brl,
     coalesce(p.registered_by,(SELECT a.changed_by FROM public.audit_logs a WHERE a.entity_type='ledger_settlements' AND a.entity_id=s.id::text ORDER BY a.changed_at LIMIT 1)),
     NULL, s.id
   FROM public.ledger_settlements s JOIN public.bl_receivables x ON x.id=s.receivable_id AND x.bl_id=p_bl AND x.source='local_charges'
   LEFT JOIN public.payments p ON p.id=s.payment_id
   UNION ALL
   -- Taxas locais: pagamento de fatura avulsa do B/L (também trava o requisito)
   SELECT p.created_at, 'taxas', 'manual_invoice_paid',
     n.invoice_number, p.amount_brl,
     p.registered_by, NULL, p.id
   FROM public.payments p JOIN public.invoices n ON n.id=p.invoice_id
   WHERE n.bl_id=p_bl AND n.invoice_type='manual' AND n.customer_id=b.customer_id
   UNION ALL
   -- Contexto: solicitações do B/L
   SELECT e.created_at, 'solicitacao', 'request_'||e.action, r.protocol, NULL, e.actor_id, e.reason, e.id
   FROM public.ce_unlock_events e JOIN public.ce_unlock_requests r ON r.id=e.request_id
   WHERE e.request_id IN(SELECT request_id FROM reqs) AND e.action IN('draft','submit','cancel','complete')
   UNION ALL
   SELECT e.created_at, 'solicitacao', 'bl_moved', r.protocol, NULL, e.actor_id, e.reason, e.id
   FROM public.ce_unlock_events e LEFT JOIN public.ce_unlock_requests r ON r.id=e.request_id
   WHERE e.action='bl_moved' AND e.bl_id=p_bl
   UNION ALL
   -- Contexto: envio à ZPT
   SELECT e.created_at, 'zpt', 'exported', NULL, NULL, e.actor_id, NULL, e.id
   FROM public.ce_unlock_events e WHERE e.action='export' AND e.payload->'bl_ids' ? p_bl
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('at',x.at,'requirement',x.requirement,'event',x.event,'detail',x.detail,'amount',x.amount,'reason',x.reason,
   'actor',coalesce(
     (SELECT up.full_name FROM public.user_profiles up WHERE up.id=x.actor_id),
     CASE WHEN EXISTS(SELECT 1 FROM public.customer_portal_accounts a WHERE a.auth_user_id=x.actor_id) THEN 'Cliente pelo Portal' END,
     CASE WHEN x.actor_id='00000000-0000-0000-0000-000000000000' THEN 'Sistema' END))
   ORDER BY x.at DESC, x.ord DESC),'[]'::jsonb) INTO events FROM rows x;
 RETURN jsonb_build_object('bl_id',p_bl,'item',ce_unlock_private.item(p_bl),'events',events);
END $function$;
REVOKE ALL ON FUNCTION ce_unlock_private.bl_history(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ce_unlock_read(p_kind text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ DECLARE role_name text; BEGIN
 role_name:=ce_unlock_private.actor();
 CASE p_kind WHEN 'bls' THEN RETURN ce_unlock_private.list(NULL,p_payload->'filters',coalesce((p_payload->>'page')::int,1));
 WHEN 'review_queue' THEN RETURN ce_unlock_private.review_queue(coalesce((p_payload->>'page')::int,1));
 WHEN 'request' THEN
   -- Documentos para todos; a referência externa da confirmação segue do desk.
   IF role_name IN('administrativo','documentacao') THEN
     RETURN ce_unlock_private.request_json((p_payload->>'request_id')::uuid,NULL,true);
   END IF;
   RETURN ce_unlock_private.request_json((p_payload->>'request_id')::uuid,NULL,false)
     || jsonb_build_object('documents', ce_unlock_private.request_json((p_payload->>'request_id')::uuid,NULL,true)->'documents');
 WHEN 'vip' THEN RETURN ce_unlock_private.vip_json((p_payload->>'customer_id')::bigint,true);
 WHEN 'exports' THEN PERFORM ce_unlock_private.actor(true); RETURN coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY created_at DESC) FROM public.ce_unlock_exports e),'[]');
 WHEN 'model' THEN RETURN (SELECT ce_unlock_private.doc_json(id) FROM public.ce_unlock_documents WHERE source='model' AND status='approved' ORDER BY created_at DESC LIMIT 1);
 -- 577: histórico do B/L na aba Andamento dos B/Ls, para todos os setores (como o da solicitação).
 WHEN 'bl_history' THEN RETURN ce_unlock_private.bl_history(p_payload->>'bl_id');
 ELSE RAISE EXCEPTION 'Leitura inválida'; END CASE;
END $function$;

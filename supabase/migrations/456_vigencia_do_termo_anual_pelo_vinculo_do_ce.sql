-- 456: a vigência do termo e da procuração anuais vale pela data em que o CE
-- Mercante foi vinculado ao B/L, e o anual continua cobrindo depois de vencer
-- (decisão do responsável de 2026-10-25, ADR 0102; substitui a decisão 4 da
-- ADR 0101 e a regra da migration 449).
--
-- Problema: a 449 usava a data de importação do B/L (`bls.created_at`) e
-- exigia o anual vigente no dia do pedido. Na virada do ano, o B/L do ano que
-- acabou perdia a cobertura: o pedido VIP aberto em dezembro travava em
-- janeiro ("Aplicar renovação VIP" recusava com "Cobertura anual incompleta")
-- e o Cliente precisava pedir de novo numa solicitação comum.
--
-- Regra: o anual (e cada renovação) cobre o B/L cujo CE Mercante atual foi
-- vinculado dentro da vigência dele, no calendário de Brasília. Vale a data do
-- vínculo do CE atual: a troca do número muda a data; a reformatação do mesmo
-- número (mesma `ce_mercante_key`) não. Depois de 31/12 o anual continua
-- cobrindo esses B/Ls, enquanto estiver aprovado (revogado ou recusado não
-- cobre). O B/L com o CE vinculado antes da vigência segue as regras de quem
-- não tem o anual. A situação VIP do Cliente na tela (termo e procuração
-- anuais vigentes hoje, `valid_doc`) não muda.
--
-- Mudança:
--   1. `ce_unlock_private.ce_link_day(text)`: o dia do vínculo do CE atual.
--      Sai da auditoria, que registra toda troca do CE (`audit_bls`, entidade
--      `bls`, e o registro explícito das importações, entidade `bl`): a última
--      troca para o CE atual vinda de outro número ou de vazio. Sem registro,
--      o B/L nasceu com esse CE e vale a criação dele.
--   2. `ce_unlock_private.covers`: troca a data de importação pelo vínculo do
--      CE e deixa de exigir o anual vigente hoje. `annual_for_bl`, `item` e
--      `command` usam `covers` e seguem a regra nova sem mudar.
--   3. `ce_unlock_private.bl_import_day` sai: só `covers` a usava.
--
-- ponytail: a data do vínculo vem da auditoria, não de uma coluna própria.
-- Teto: depende de toda gravação do CE passar pela auditoria (gatilho ou
-- registro explícito) e da retenção dela (5 anos; depois disso vale a criação
-- do B/L, bem antes de qualquer anual em uso). Upgrade: coluna
-- `bls.ce_mercante_linked_at` carimbada por gatilho, preenchida pela mesma
-- regra desta função.
--
-- Só cria, redefine e remove funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar `bl_import_day` e `covers` da 449 e DROP FUNCTION
-- ce_unlock_private.ce_link_day(text).

-- 1 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ce_unlock_private.ce_link_day(p_bl text)
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT (coalesce(
   (SELECT max(a.changed_at) FROM public.audit_logs a
    WHERE a.entity_type IN ('bl','bls') AND a.entity_id=b.id AND a.field_name='ce_mercante'
      AND public.ce_mercante_key(a.new_value)=public.ce_mercante_key(b.ce_mercante)
      AND public.ce_mercante_key(a.old_value) IS DISTINCT FROM public.ce_mercante_key(b.ce_mercante)),
   b.created_at) AT TIME ZONE 'America/Sao_Paulo')::date
 FROM public.bls b WHERE b.id=p_bl AND public.ce_mercante_key(b.ce_mercante) IS NOT NULL
$function$;

REVOKE ALL ON FUNCTION ce_unlock_private.ce_link_day(text) FROM PUBLIC, anon, authenticated;

-- 2 -------------------------------------------------------------------------
-- O anual cobre o B/L: aprovado e com o CE atual vinculado dentro da vigência.
-- Não precisa estar vigente hoje; a vigência não retroage.
CREATE OR REPLACE FUNCTION ce_unlock_private.covers(p_doc uuid, p_bl text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT coalesce((SELECT d.status='approved' AND d.source='vip_annual' AND d.valid_until=make_date(d.coverage_year,12,31)
   AND ce_unlock_private.ce_link_day(p_bl) BETWEEN d.valid_from AND d.valid_until
   FROM public.ce_unlock_documents d WHERE d.id=p_doc),false)
$function$;

-- 3 -------------------------------------------------------------------------
DROP FUNCTION ce_unlock_private.bl_import_day(text);

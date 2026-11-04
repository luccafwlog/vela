-- 587: os alertas de dinheiro que só o Financeiro resolve passam para o setor
-- Financeiro (decisão do dono de 2026-11-04, sobre a revisão da release
-- staging → main; ADR 0107, faixa "Situação atual").
--
-- Problema: desde a migration 583, baixar, conciliar o Pix e confirmar a
-- Restituição são do Financeiro e da conta Dev. Os alertas que pedem essas
-- ações seguiam no setor Administrativo, que não as faz mais: "Pix não
-- conciliado", "Restituição pendente" e "Consulta de Pix do Itaú parada"
-- apareciam na fila e nos cartões como do Administrativo e tocavam o sino de
-- quem vê o botão desativado. O Financeiro não era setor de alerta.
--
-- Mudança:
--   1. O Financeiro passa a ser setor de alerta: a gravação do item aceita
--      `financeiro` (`upsert_alert_item_before_milestone_hardening`).
--   2. Os três tipos têm o Financeiro como responsável e como audiência no
--      catálogo. A fila continua uma só e todos os setores veem todos os
--      alertas; o setor diz de quem é a ação, filtra a fila e o cartão, e
--      decide o sino (só o Financeiro; sem ninguém ativo nele, o crítico cai no
--      fallback do Administrativo, como antes).
--   3. Tipo do Financeiro grava o item no Financeiro, qualquer que seja o setor
--      que o produtor informa (`_alert_item_department`, chamada no começo de
--      `upsert_alert_item`).
--   4. Os itens desses tipos ainda ativos em outro setor passam para o
--      Financeiro, com um evento `updated` no histórico do item.
--   "Fatura desatualizada" não muda: o que ela pede (Fatura Avulsa, Tentar
--   aplicar correção) segue com todos os setores, e ela continua no
--   Administrativo, avisando o Financeiro.
--
-- ponytail: os produtores (baixa Itaú, cancelamento de baixa, exceções do
-- extrato, Restituição, checkpoint do Itaú) continuam passando
-- 'administrativo'; o catálogo vence para os tipos do Financeiro. O passo
-- seguinte, se outro tipo mudar de setor, é cada produtor ler o setor do
-- catálogo (a `upsert_alert_item` de 7 argumentos já faz isso).
--
-- Plano de preservação: a seção 4 reescreve `alert_items.department` dos itens
-- ativos de `pix_unreconciled`, `restituicao_pendente` e
-- `itau_pix_consulta_parada` fora do Financeiro (na produção de 2026-11-04 não
-- há nenhum item desses tipos, ativo ou resolvido). O setor anterior fica no
-- evento `updated` de `alert_item_events` de cada item movido
-- (`metadata.department_from`). Itens resolvidos não mudam. Conferir:
-- `SELECT item_type, department, status, count(*) FROM alert_items WHERE
-- item_type IN (...) GROUP BY 1, 2, 3` e os eventos com
-- `metadata->>'migration' = '587'`. Desfazer: voltar `department` de cada item
-- pelo `metadata.department_from` do evento, o catálogo para
-- `responsible_department = 'administrativo'` e `audience_departments =
-- ARRAY['administrativo', 'financeiro']`, e reaplicar
-- `upsert_alert_item` da 485 e `upsert_alert_item_before_milestone_hardening`
-- da 078.
BEGIN;

-- 1 e 3 --- O Financeiro é setor de alerta; tipo dele grava no Financeiro -----

CREATE FUNCTION public._alert_item_department(p_type text, p_department text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  -- O catálogo vence para os tipos do Financeiro (587); nos demais, o setor
  -- que o produtor informa (o ADR e a Demurrage travada gravam por setor).
  SELECT COALESCE(
    (SELECT 'financeiro' FROM public.alert_type_catalog c
      WHERE c.type = p_type AND c.responsible_department = 'financeiro'),
    p_department);
$$;
REVOKE ALL ON FUNCTION public._alert_item_department(text, text) FROM PUBLIC, anon, authenticated;

DO $patch$
DECLARE
  v_patch record;
  v_def text;
BEGIN
  FOR v_patch IN
    SELECT * FROM (VALUES
      ('public.upsert_alert_item_before_milestone_hardening(text,text,text,text,text,text,jsonb,text)',
       $s$IF v_department NOT IN ('operacoes', 'documentacao', 'equipamentos', 'administrativo') THEN$s$,
       $s$IF v_department NOT IN ('operacoes', 'documentacao', 'equipamentos', 'administrativo', 'financeiro') THEN$s$),
      ('public.upsert_alert_item(text,text,text,text,text,text,jsonb,text)',
       $s$BEGIN
  -- 476: resolvido com justificativa$s$,
       $s$BEGIN
  -- 587: tipo do Financeiro grava o item no Financeiro.
  p_department := public._alert_item_department(p_type, p_department);
  -- 476: resolvido com justificativa$s$)
    ) AS p(fn, old_text, new_text)
  LOOP
    v_def := pg_get_functiondef(v_patch.fn::regprocedure);
    IF (length(v_def) - length(replace(v_def, v_patch.old_text, ''))) / length(v_patch.old_text) <> 1 THEN
      RAISE EXCEPTION '587: trecho não encontrado uma única vez em %', v_patch.fn;
    END IF;
    EXECUTE replace(v_def, v_patch.old_text, v_patch.new_text);
  END LOOP;
END;
$patch$;

-- 2 --- Catálogo --------------------------------------------------------------

UPDATE public.alert_type_catalog SET responsible_department = 'financeiro', audience_departments = ARRAY['financeiro'] WHERE type = 'pix_unreconciled';
UPDATE public.alert_type_catalog SET responsible_department = 'financeiro', audience_departments = ARRAY['financeiro'] WHERE type = 'restituicao_pendente';
UPDATE public.alert_type_catalog SET responsible_department = 'financeiro', audience_departments = ARRAY['financeiro'] WHERE type = 'itau_pix_consulta_parada';

-- 4 --- Itens ativos passam para o Financeiro, com o setor anterior no histórico

WITH moved AS (
  UPDATE public.alert_items AS i
  SET department = 'financeiro', updated_at = now()
  FROM (
    SELECT i2.id, i2.department AS department_from
    FROM public.alert_items AS i2
    WHERE i2.item_type IN ('pix_unreconciled', 'restituicao_pendente', 'itau_pix_consulta_parada')
      AND i2.status = 'active'
      AND i2.department IS DISTINCT FROM 'financeiro'
      -- Sem item do Financeiro no mesmo alerta (a gravação é por tipo e setor).
      AND NOT EXISTS (
        SELECT 1 FROM public.alert_items AS f
        WHERE f.alert_id = i2.alert_id AND f.item_type = i2.item_type AND f.department = 'financeiro'
      )
  ) AS src
  WHERE i.id = src.id
  RETURNING i.id, i.occurrence_id, src.department_from
)
INSERT INTO public.alert_item_events (alert_item_id, occurrence_id, event_type, previous_status, new_status, actor_id, metadata)
SELECT m.id, m.occurrence_id, 'updated', 'active', 'active', NULL,
  jsonb_build_object('migration', '587', 'department_from', m.department_from, 'department_to', 'financeiro')
FROM moved AS m;

COMMIT;

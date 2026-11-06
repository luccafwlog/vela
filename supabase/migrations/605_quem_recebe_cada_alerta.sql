-- 605: quem recebe cada alerta (decisões D5 e D7, e o aviso da D1, do dono de
-- 2026-11-06; ADR 0131, lote 2 do plano 2026-11-06-decisoes-da-revisao-dos-alertas).
--
-- A revisão de 2026-11-06 achou alertas que chegam a quem não pode agir
-- (brechas B19 a B22). Mudança:
--   1. "Falha na atualização da PTAX Demurrage" passa da Documentação a
--      Equipamentos, que usa Informar PTAX.
--   2. "Calendário de feriados pendente" passa ao Administrativo e avisa só a
--      conta com a marca Dev (`alert_type_catalog.notify_dev_only`), que é quem
--      cadastra os feriados.
--   3. "Exportação pendente pós-ATD" passa de Operações a Equipamentos, que
--      lança o Granito e o Embarque de vazios.
--   4. "Tabela de cobrança faltando", "Cálculo bloqueado" e "Revisão de B/L —
--      Portal não provisionado" continuam da Documentação e avisam também o
--      Administrativo, que ativa a tabela e concede a Liberação.
--   5. O aviso de nova solicitação de desbloqueio de CE vai também ao
--      Administrativo.
--   Os tipos 1 a 3 gravam no setor do catálogo, qualquer que seja o setor que
--   o produtor informa (`_alert_item_department`, como os do Financeiro, 587).
--
-- Plano de preservação: a seção 4 reescreve `alert_items.department` dos itens
-- ativos de `demurrage_ptax_recalc_failed`, `calendario_feriados_pendente` e
-- `voyage_export_after_atd` fora do setor novo. O setor anterior fica no
-- evento `updated` de `alert_item_events` de cada item movido
-- (`metadata.department_from`, `metadata.migration = '605'`). Itens
-- resolvidos não mudam. As notificações já entregues não mudam. Conferir:
-- `SELECT item_type, department, status, count(*) FROM alert_items WHERE
-- item_type IN (...) GROUP BY 1, 2, 3` antes e depois. Desfazer: voltar
-- `department` pelo `metadata.department_from` dos eventos da 605 e o
-- catálogo pelos valores da seção 2 anteriores (Documentação, Documentação e
-- Operações; audiência só da Documentação nos três tipos da seção 2b).
BEGIN;

-- 1 --- Coluna do aviso só para a conta Dev ---------------------------------

ALTER TABLE public.alert_type_catalog
  ADD COLUMN IF NOT EXISTS notify_dev_only boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.alert_type_catalog.notify_dev_only IS
  'O sino do tipo vai só às contas com a marca Dev do setor (605; calendário de feriados).';

-- 2 --- Catálogo ------------------------------------------------------------

UPDATE public.alert_type_catalog SET responsible_department = 'equipamentos', audience_departments = ARRAY['equipamentos'] WHERE type = 'demurrage_ptax_recalc_failed';
UPDATE public.alert_type_catalog SET responsible_department = 'administrativo', audience_departments = ARRAY['administrativo'], notify_dev_only = true WHERE type = 'calendario_feriados_pendente';
UPDATE public.alert_type_catalog SET responsible_department = 'equipamentos', audience_departments = ARRAY['equipamentos'] WHERE type = 'voyage_export_after_atd';
-- 2b: a Documentação continua responsável e o Administrativo também recebe.
UPDATE public.alert_type_catalog SET audience_departments = ARRAY['documentacao', 'administrativo'] WHERE type = 'billing_charge_table_missing';
UPDATE public.alert_type_catalog SET audience_departments = ARRAY['documentacao', 'administrativo'] WHERE type = 'billing_calculation_blocked';
UPDATE public.alert_type_catalog SET audience_departments = ARRAY['documentacao', 'administrativo'] WHERE type = 'review_portal_not_ready';

-- 3 --- O catálogo vence o setor do produtor nesses tipos --------------------

CREATE OR REPLACE FUNCTION public._alert_item_department(p_type text, p_department text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  -- O catálogo vence para os tipos do Financeiro (587) e para os que mudaram
  -- de setor na 605; nos demais, o setor que o produtor informa (o ADR e a
  -- Demurrage travada gravam por setor).
  SELECT COALESCE(
    (SELECT c.responsible_department FROM public.alert_type_catalog c
      WHERE c.type = p_type
        AND (c.responsible_department = 'financeiro'
             OR c.type IN ('demurrage_ptax_recalc_failed', 'calendario_feriados_pendente', 'voyage_export_after_atd'))),
    p_department);
$$;

-- Sino: aviso só às contas Dev quando o tipo pede; o desvio do crítico ao
-- Administrativo não muda. Aviso de nova solicitação de desbloqueio também ao
-- Administrativo.
DO $patch$
DECLARE
  v_patch record;
  v_def text;
BEGIN
  FOR v_patch IN
    SELECT * FROM (VALUES
      ('public.fanout_alert_item_for_department(bigint,bigint,bigint,text)',
       $old$      AND (CASE up.role WHEN 'operator' THEN 'documentacao' ELSE up.role END) = ANY (v_audience)
  LOOP$old$,
       $new$      AND (CASE up.role WHEN 'operator' THEN 'documentacao' ELSE up.role END) = ANY (v_audience)
      -- 605: tipo só da conta Dev (calendário de feriados).
      AND (NOT COALESCE(v_catalog.notify_dev_only, false) OR up.is_dev)
  LOOP$new$),
      ('public._notify_ce_unlock_submitted()',
       $old$    ARRAY['documentacao'],$old$,
       $new$    ARRAY['documentacao', 'administrativo'],$new$)
    ) AS p(fn, old_text, new_text)
  LOOP
    v_def := pg_get_functiondef(v_patch.fn::regprocedure);
    IF (length(v_def) - length(replace(v_def, v_patch.old_text, ''))) / length(v_patch.old_text) <> 1 THEN
      RAISE EXCEPTION '605: trecho não encontrado uma única vez em %', v_patch.fn;
    END IF;
    EXECUTE replace(v_def, v_patch.old_text, v_patch.new_text);
  END LOOP;
END;
$patch$;

-- 4 --- Itens ativos passam ao setor novo, com o anterior no histórico ------

WITH target(item_type, department) AS (
  VALUES ('demurrage_ptax_recalc_failed', 'equipamentos'),
         ('calendario_feriados_pendente', 'administrativo'),
         ('voyage_export_after_atd', 'equipamentos')
), moved AS (
  UPDATE public.alert_items AS i
  SET department = src.department_to, updated_at = now()
  FROM (
    SELECT i2.id, i2.department AS department_from, t.department AS department_to
    FROM public.alert_items AS i2
    JOIN target t ON t.item_type = i2.item_type
    WHERE i2.status = 'active'
      AND i2.department IS DISTINCT FROM t.department
      AND NOT EXISTS (
        SELECT 1 FROM public.alert_items AS f
        WHERE f.alert_id = i2.alert_id AND f.item_type = i2.item_type AND f.department = t.department
      )
  ) AS src
  WHERE i.id = src.id
  RETURNING i.id, i.occurrence_id, src.department_from, src.department_to
)
INSERT INTO public.alert_item_events (alert_item_id, occurrence_id, event_type, previous_status, new_status, actor_id, metadata)
SELECT m.id, m.occurrence_id, 'updated', 'active', 'active', NULL,
  jsonb_build_object('migration', '605', 'department_from', m.department_from, 'department_to', m.department_to)
FROM moved AS m;

COMMIT;

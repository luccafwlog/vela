-- 410: BRSEP (Sepetiba) passa a ser apelido de BRIGI (Itaguaí), o código
-- correto do porto (revisão manual de 2026-10-22, item D2).
--
-- Problema:
--   `normalize_port_code` (391) levava SEPETIBA, BRSEP, BRSPB, SPB e SEP a
--   BRSEP, código próprio. O porto de Sepetiba é o de Itaguaí, cujo LOCODE é
--   BRIGI (já no catálogo `ports` desde a 001). O Baplie da GREEN ITAJAI / 11
--   trouxe 242 containers com descarga em BRSEP, que nunca casariam uma escala
--   BRIGI.
--
-- Mudança:
--   1. `normalize_port_code` leva SEPETIBA, BRSEP, BRSPB, SPB, SEP, ITAGUAI,
--      ITAGUAÍ, BRIGI e IGI a BRIGI, pelo mesmo mecanismo de apelido de
--      Vitória (BRVIT → BRVIX). A cópia do app (`STORED_PORT_ALIASES` em
--      src/services/portCode.ts) muda junto e a suíte operationalLists
--      confere as duas. Continua `LANGUAGE sql IMMUTABLE` sem `SET`, para ser
--      expandida inline (docs/operations/seguranca.md).
--   2. Dados gravados com a chave BRSEP passam a BRIGI: Histórico da escala
--      (`audit_logs.entity_id` de `voyage_pod_schedule`/`voyage_pol_schedule`),
--      escala terminalizada (atracações, frentes, revisão), exportação da
--      escala, ADR, omissão, ATD manual do POL, Manifesto Mercante e o espelho
--      da rota, âncora dos Comunicados e listas de portos da Central de
--      Informações. O resumo `voyages.*_schedule_snapshot` é refeito do
--      Histórico, o estado documental é recalculado e os alertas da Viagem
--      reconciliados. Colunas cruas (POL/POD de B/L, Baplie, vazios, Granito,
--      Taxas Locais) ficam como estão: toda comparação passa pela função.
--      Uma tabela cuja troca colida com a escala BRIGI já existente na mesma
--      Viagem (ou que um gatilho recuse) fica como está e é contada num
--      NOTICE, sem impedir o resto.
--      Esta reescrita altera e apaga linhas existentes (inclusive do
--      Histórico e de `voyage_documental_state`, cache recalculado) e depende
--      da afirmação "Data status" do AGENTS.md (seção Gotchas): os dados de
--      produção são de teste.
--
-- Rollback: recriar `normalize_port_code` pela 391. Os dados reescritos não
-- voltam sozinhos (BRIGI de Sepetiba e de Itaguaí ficam indistinguíveis).

-- 1. Régua de porto do banco.
CREATE OR REPLACE FUNCTION public.normalize_port_code(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('BRVIT', 'VIT', 'VITORIA', 'VITÓRIA', 'BRVIX', 'VIX') THEN 'BRVIX'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('SALVADOR', 'BRSSA', 'SSA') THEN 'BRSSA'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('PECEM', 'PECÉM', 'BRPEC', 'PEC') THEN 'BRPEC'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('SANTOS', 'BRSSZ', 'SSZ') THEN 'BRSSZ'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('PARANAGUA', 'PARANAGUÁ', 'BRPNG', 'PNG') THEN 'BRPNG'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('ITAJAI', 'ITAJAÍ', 'BRITJ', 'ITJ') THEN 'BRITJ'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('NAVEGANTES', 'BRNVT', 'NVT') THEN 'BRNVT'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('RIO GRANDE', 'BRRIG', 'RIG') THEN 'BRRIG'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('SUAPE', 'BRSUA', 'SUA') THEN 'BRSUA'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('RECIFE', 'BRREC', 'REC') THEN 'BRREC'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('RIO DE JANEIRO', 'BRRIO', 'BRRDJ') THEN 'BRRIO'
    -- 410: Sepetiba é o porto de Itaguaí; o código correto é BRIGI.
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('ITAGUAI', 'ITAGUAÍ', 'BRIGI', 'IGI', 'SEPETIBA', 'BRSEP', 'BRSPB', 'SPB', 'SEP') THEN 'BRIGI'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('MANAUS', 'BRMAO') THEN 'BRMAO'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('QINGDAO', 'QINDGAO', 'TSINGTAO', 'CNTAO', 'CNQDG', 'QDG', 'TAO') THEN 'CNTAO'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('SHANGHAI', 'CNSHA', 'CNSHG', 'SHG') THEN 'CNSHA'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('TAICANG', 'TAIKANG', 'CNTAC', 'CNTAI', 'CNTAG', 'CNTCA', 'TCA') THEN 'CNTAC'
    -- Ningbo-Zhoushan e um unico complexo portuario: o Baplie costuma trazer CNZOS
    -- (Zhoushan) para carga que o B/L declara como Ningbo (CNNGB).
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('NINGBO', 'CNNGB', 'CNNBO', 'NBO', 'ZHOUSHAN', 'CNZOS', 'ZOS') THEN 'CNNGB'
    -- Guangzhou (CNGZU, CNCAN) e tratado como Nansha.
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('NANSHA', 'CNNSA', 'CNNAN', 'GUANGZHOU', 'CNGZU', 'CNCAN') THEN 'CNNSA'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('ZHANGJIAGANG', 'CNZJG') THEN 'CNZJG'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('XIAMEN', 'AMOY', 'CNXMN', 'XMN') THEN 'CNXMN'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('SHEKOU', 'SHENZHEN', 'CNSHK', 'CNSZK', 'CNSHE') THEN 'CNSHK'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('YANTIAN', 'CNYTN', 'YTN') THEN 'CNYTN'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('HONG KONG', 'HONGKONG', 'HKHKG', 'HKG') THEN 'HKHKG'
    ELSE NULLIF(upper(btrim(COALESCE(p_value, ''))), '')
  END;
$$;

-- 2. Chaves gravadas como BRSEP --------------------------------------------
DO $repair$
DECLARE
  v_step record;
  v_count integer;
  v_changed integer := 0;
  v_skipped text[] := '{}';
  v_voyages bigint[] := '{}';
  v_voyage bigint;
BEGIN
  -- Viagens tocadas: recalculadas no fim.
  SELECT COALESCE(array_agg(DISTINCT split_part(entity_id, '::', 1)::bigint), '{}') INTO v_voyages
  FROM public.audit_logs
  WHERE entity_type IN ('voyage_pod_schedule', 'voyage_pol_schedule')
    AND upper(split_part(entity_id, '::', 2)) = 'BRSEP'
    AND split_part(entity_id, '::', 1) ~ '^[0-9]+$';
  SELECT v_voyages || COALESCE(array_agg(DISTINCT voyage_id), '{}') INTO v_voyages
  FROM public.voyage_documental_state WHERE port = 'BRSEP';

  FOR v_step IN SELECT * FROM (VALUES
    ('Histórico da escala', $sql$UPDATE public.audit_logs SET entity_id = split_part(entity_id, '::', 1) || '::BRIGI'
       WHERE entity_type IN ('voyage_pod_schedule', 'voyage_pol_schedule') AND upper(split_part(entity_id, '::', 2)) = 'BRSEP'$sql$),
    ('atracações', $sql$UPDATE public.voyage_escala_terminal_state SET port = 'BRIGI' WHERE port = 'BRSEP'$sql$),
    ('frentes de operação', $sql$UPDATE public.voyage_escala_operation_fronts SET port = 'BRIGI' WHERE port = 'BRSEP'$sql$),
    ('revisão da escala', $sql$UPDATE public.voyage_escala_revision_state SET port = 'BRIGI' WHERE port = 'BRSEP'$sql$),
    ('exportação da escala', $sql$UPDATE public.voyage_export_schedules SET pol = 'BRIGI' WHERE pol = 'BRSEP'$sql$),
    ('ADR', $sql$UPDATE public.agency_departure_reports SET port = 'BRIGI' WHERE port = 'BRSEP'$sql$),
    ('omissões', $sql$UPDATE public.voyage_omissions SET omitted_pod = 'BRIGI' WHERE omitted_pod = 'BRSEP'$sql$),
    ('ATD manual do POL', $sql$UPDATE public.voyage_pol_atd_manual SET pol = 'BRIGI' WHERE pol = 'BRSEP'$sql$),
    ('espelho da rota (POD)', $sql$UPDATE public.voyage_route_ce_master SET pod = 'BRIGI' WHERE pod = 'BRSEP'$sql$),
    ('espelho da rota (POL)', $sql$UPDATE public.voyage_route_ce_master SET pol = 'BRIGI' WHERE pol = 'BRSEP'$sql$),
    ('Manifesto Mercante', $sql$UPDATE public.manifestos_mercante SET pod = CASE WHEN pod = 'BRSEP' THEN 'BRIGI' ELSE pod END,
       pol = CASE WHEN pol = 'BRSEP' THEN 'BRIGI' ELSE pol END WHERE 'BRSEP' IN (pod, pol)$sql$),
    ('âncora dos Comunicados', $sql$UPDATE public.customer_communications SET anchor_port = 'BRIGI' WHERE anchor_port = 'BRSEP'$sql$),
    ('portos dos Depósitos', $sql$UPDATE public.depot_portal_information SET ports = array_replace(ports, 'BRSEP', 'BRIGI') WHERE 'BRSEP' = ANY(ports)$sql$),
    ('portos dos Agentes', $sql$UPDATE public.port_agents SET ports = array_replace(ports, 'BRSEP', 'BRIGI') WHERE 'BRSEP' = ANY(ports)$sql$),
    -- Cache da conciliação documental: recalculado abaixo com a régua nova.
    ('estado documental', $sql$DELETE FROM public.voyage_documental_state WHERE port = 'BRSEP'$sql$)
  ) AS s(label, statement) LOOP
    BEGIN
      EXECUTE v_step.statement;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_changed := v_changed + v_count;
    EXCEPTION WHEN unique_violation OR check_violation OR raise_exception OR insufficient_privilege THEN
      -- Colisão com a escala BRIGI já existente ou recusa de um gatilho
      -- (ex.: ADR fechado): a tabela fica com BRSEP, que a régua já lê como BRIGI.
      v_skipped := array_append(v_skipped, v_step.label || ' (' || SQLERRM || ')');
    END;
  END LOOP;

  FOR v_voyage IN SELECT DISTINCT unnest(v_voyages) ORDER BY 1 LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = v_voyage);
    -- Resumo das escalas refeito do Histórico (último valor por campo), como
    -- o gatilho `trg_voyage_schedule_snapshot` o monta.
    UPDATE public.voyages
    SET pod_schedule_snapshot = (COALESCE(pod_schedule_snapshot, '{}'::jsonb) - 'BRSEP' - 'BRIGI')
      || COALESCE((
        SELECT jsonb_object_agg(k.port, k.fields)
        FROM (
          SELECT split_part(l.entity_id, '::', 2) AS port,
                 jsonb_object_agg(l.field_name, COALESCE(to_jsonb(l.new_value), 'null'::jsonb)) AS fields
          FROM (
            SELECT DISTINCT ON (entity_id, field_name) entity_id, field_name, new_value
            FROM public.audit_logs
            WHERE entity_type = 'voyage_pod_schedule' AND entity_id IN (v_voyage::text || '::BRSEP', v_voyage::text || '::BRIGI')
            ORDER BY entity_id, field_name, id DESC
          ) l
          GROUP BY 1
        ) k), '{}'::jsonb),
        pol_schedule_snapshot = (COALESCE(pol_schedule_snapshot, '{}'::jsonb) - 'BRSEP' - 'BRIGI')
      || COALESCE((
        SELECT jsonb_object_agg(k.port, k.fields)
        FROM (
          SELECT split_part(l.entity_id, '::', 2) AS port,
                 jsonb_object_agg(l.field_name, COALESCE(to_jsonb(l.new_value), 'null'::jsonb)) AS fields
          FROM (
            SELECT DISTINCT ON (entity_id, field_name) entity_id, field_name, new_value
            FROM public.audit_logs
            WHERE entity_type = 'voyage_pol_schedule' AND entity_id IN (v_voyage::text || '::BRSEP', v_voyage::text || '::BRIGI')
            ORDER BY entity_id, field_name, id DESC
          ) l
          GROUP BY 1
        ) k), '{}'::jsonb)
    WHERE id = v_voyage AND status IS DISTINCT FROM 'cancelled';
    PERFORM public.sync_voyage_documental_status(v_voyage);
    BEGIN
      PERFORM public.reconcile_voyage_operation_alerts(v_voyage, 'migration_410');
    EXCEPTION WHEN insufficient_privilege THEN
      -- No deploy não há usuário na sessão e a leitura do 1º ETA recusa
      -- (is_active_read_user); os alertas da Viagem reconciliam na próxima gravação.
      RAISE NOTICE '410: alertas da Viagem % reconciliam na próxima gravação (%).', v_voyage, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE '410: % linha(s) com BRSEP passaram a BRIGI; % Viagem(ns) recalculada(s).', v_changed, cardinality(v_voyages);
  IF cardinality(v_skipped) > 0 THEN
    RAISE NOTICE '410: ficaram com BRSEP (lidas como BRIGI pela régua): %', array_to_string(v_skipped, '; ');
  END IF;
END
$repair$;

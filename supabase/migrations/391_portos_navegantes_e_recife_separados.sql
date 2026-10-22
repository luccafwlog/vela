-- 391: Navegantes ≠ Itajaí e Recife ≠ Suape (ADR 0095, decisão 12; revisão
-- das importações de 2026-10-21, achado F-08; Lote 3 do plano
-- docs/plans/2026-10-21-frente-das-importacoes.md).
--
-- Problema:
--   `normalize_port_code` convertia BRNVT/NVT/NAVEGANTES em BRITJ e
--   BRREC/RECIFE em BRSUA. São quatro portos e quatro escalas. Toda comparação
--   do banco passa por essa função: B/L de Navegantes casava a escala de
--   Itajaí (alertas, Conciliação, CE pendente, B/Ls esperados, Baplie,
--   Comunicados), a tabela de Taxas Locais de Suape cobrava B/L de Recife
--   (`resolve_local_charge_table_id`, `_bl_charge_table_for_scope`), o status
--   "BLs e CEs" da escala BRNVT era gravado em `<viagem>::BRITJ` e o Manifesto
--   Mercante da rota CNSHA→BRNVT era gravado como CNSHA→BRITJ.
--
-- Mudança:
--   1. `normalize_port_code` separa os quatro portos (NAVEGANTES, BRNVT, NVT →
--      BRNVT; RECIFE, BRREC, REC → BRREC) e recebe os apelidos exatos que só o
--      leitor do Baplie conhecia (BRSPB/SPB/SEP → BRSEP, CNTCA/TCA → CNTAC,
--      TAO → CNTAO, CNCAN → CNNSA): uma régua só no banco e no app
--      (`STORED_PORT_ALIASES` em src/services/portCode.ts, conferida pela
--      suíte operationalLists). Continua `LANGUAGE sql IMMUTABLE` sem `SET`,
--      para ser expandida inline (docs/operations/seguranca.md). Nenhum
--      índice, restrição ou coluna gerada usa a função (conferido no replay).
--   2. `_baplie_port_key` (388) passa a ser só `normalize_port_code`: os
--      apelidos que ela copiava agora estão na função do banco.
--   3. Dados gravados com a forma juntada. Só muda o que tem prova, no próprio
--      banco, de que era Navegantes ou Recife; um 'BRITJ' ou 'BRSUA' sem prova
--      continua como está (pode ser de fato Itajaí ou Suape):
--        a) Manifesto Mercante (`manifestos_mercante.pol/pod`, gravado pela
--           forma normalizada em `guard_manifesto_mercante_canonical`) e o
--           espelho `voyage_route_ce_master`: muda quando todos os B/Ls
--           vinculados ao Manifesto (e, no de vazios, todos os containers de
--           vazios da rota) são do porto separado.
--        b) Status "BLs e CEs" automático (`audit_logs` campo `ces` com a
--           justificativa da conciliação documental, e `export_ces`, que só o
--           gatilho grava) e `voyage_documental_state`: as linhas da escala
--           juntada passam para a escala separada quando todos os B/Ls e o
--           Baplie da Viagem naquele par são do porto separado (na exportação,
--           todas as programações de exportação do par). O resumo
--           `voyages.pod_schedule_snapshot` dos dois portos é refeito do
--           Histórico, o estado documental é recalculado
--           (`sync_voyage_documental_status`) e os alertas da Viagem
--           reconciliados.
--        c) Âncora dos Comunicados (`customer_communications.anchor_port`, NOA,
--           NOR e NOB): muda quando todos os B/Ls do Comunicado são do porto
--           separado e não há outro Comunicado com a mesma identidade. Sem
--           isso, a régua reenviaria o aviso da escala de Navegantes ou Recife.
--      Viagem cancelada fica como está (é somente leitura).
--      Esta reescrita altera linhas existentes, inclusive do Histórico
--      (`audit_logs.entity_id`), e depende da afirmação "Data status" do
--      AGENTS.md (seção Gotchas): os dados de produção são de teste.
--   Não recuperável, fica como está e é contado num NOTICE:
--      - portos dos Depósitos e Agentes da Central de Informações
--        (`depot_portal_information.ports`, `port_agents.ports`): só a forma
--        normalizada foi gravada, e a lista de portos mostrava Navegantes com
--        o código BRITJ; quem cadastrou deve conferir e gravar de novo;
--      - POL/POD de B/L, vazios e Granito gravados como BRITJ/BRSUA a partir
--        do nome NAVEGANTES/RECIFE no arquivo (o texto cru não é guardado);
--      - vínculo do B/L à tabela de Taxas Locais (`bl_charge_table_links`) de
--        B/L de Recife ou Navegantes com a tabela de Suape ou Itajaí: deixa de
--        valer sozinho (`_bl_charge_table_for_scope` exige o mesmo porto, como
--        na troca de POD) e o próximo cálculo usa a tabela do porto certo; o
--        cálculo e a fatura já gravados não são refeitos aqui.
--
-- Rollback: recriar `normalize_port_code` pela definição da 002 com a 113
-- (VIT) e `_baplie_port_key` pela 388. Os dados reescritos não voltam
-- sozinhos: a forma juntada é derivável (BRNVT → BRITJ, BRREC → BRSUA).

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
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('SEPETIBA', 'BRSEP', 'BRSPB', 'SPB', 'SEP') THEN 'BRSEP'
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

-- 2. A régua do Baplie no servidor é a mesma do banco.
CREATE OR REPLACE FUNCTION public._baplie_port_key(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT public.normalize_port_code(p_value)
$$;
REVOKE ALL ON FUNCTION public._baplie_port_key(text) FROM PUBLIC, anon, authenticated;

-- 3. Dados gravados com a forma juntada ---------------------------------------
-- (a suíte local-pg portosSeparados executa de novo este trecho sobre um
-- cenário gravado como antes da 391; ele não muda nada sem prova.)
DO $repair$
DECLARE
  v_pair record;
  v_voyage bigint;
  v_import text[];
  v_export text[];
  v_moved integer;
  v_count integer;
  v_manifests integer := 0;
  v_mirrors integer := 0;
  v_communications integer := 0;
  v_audit integer := 0;
  v_voyages bigint[] := '{}';
  v_reason constant text := 'Atualização automática de BLs e CEs pela conciliação documental';
BEGIN
  CREATE TEMP TABLE p391_manifest (id uuid, side text) ON COMMIT DROP;
  FOR v_pair IN SELECT * FROM (VALUES ('BRITJ', 'BRNVT'), ('BRSUA', 'BRREC')) AS p(merged, split) LOOP
    -- a) Manifesto Mercante e espelho da rota (POD e POL).
    DELETE FROM p391_manifest;
    INSERT INTO p391_manifest (id, side)
    SELECT e.id, e.side
    FROM (
      SELECT m.id, 'pod' AS side, public.normalize_port_code(b.pod) AS port
      FROM public.manifestos_mercante m
      JOIN public.voyages v ON v.id = m.voyage_id AND v.status IS DISTINCT FROM 'cancelled'
      JOIN public.bls b ON b.manifesto_mercante_id = m.id
      WHERE m.pod = v_pair.merged
      UNION ALL
      SELECT m.id, 'pod', public.normalize_port_code(c.pod)
      FROM public.manifestos_mercante m
      JOIN public.voyages v ON v.id = m.voyage_id AND v.status IS DISTINCT FROM 'cancelled'
      JOIN public.vazios_importacao_manifests vm ON vm.voyage_id = m.voyage_id
      JOIN public.vazios_importacao_containers c ON c.manifest_id = vm.id
      WHERE m.pod = v_pair.merged AND m.natureza = 'vazio'
        AND public.normalize_port_code(c.pol) = public.normalize_port_code(m.pol)
        AND public.normalize_port_code(c.pod) IN (v_pair.merged, v_pair.split)
      UNION ALL
      SELECT m.id, 'pol', public.normalize_port_code(b.pol)
      FROM public.manifestos_mercante m
      JOIN public.voyages v ON v.id = m.voyage_id AND v.status IS DISTINCT FROM 'cancelled'
      JOIN public.bls b ON b.manifesto_mercante_id = m.id
      WHERE m.pol = v_pair.merged
      UNION ALL
      SELECT m.id, 'pol', public.normalize_port_code(c.pol)
      FROM public.manifestos_mercante m
      JOIN public.voyages v ON v.id = m.voyage_id AND v.status IS DISTINCT FROM 'cancelled'
      JOIN public.vazios_importacao_manifests vm ON vm.voyage_id = m.voyage_id
      JOIN public.vazios_importacao_containers c ON c.manifest_id = vm.id
      WHERE m.pol = v_pair.merged AND m.natureza = 'vazio'
        AND public.normalize_port_code(c.pod) = public.normalize_port_code(m.pod)
        AND public.normalize_port_code(c.pol) IN (v_pair.merged, v_pair.split)
    ) e
    GROUP BY e.id, e.side
    HAVING bool_and(e.port IS NOT DISTINCT FROM v_pair.split);

    UPDATE public.voyage_route_ce_master cm
    SET pod = v_pair.split
    FROM public.manifestos_mercante m
    JOIN p391_manifest t ON t.id = m.id AND t.side = 'pod'
    WHERE cm.voyage_id = m.voyage_id AND cm.pod = v_pair.merged
      AND cm.pol = m.pol
      AND cm.cargo_mode = CASE WHEN m.natureza = 'vazio' THEN 'vazios' ELSE 'container' END
      AND public.canonical_manifesto_numero(cm.ce_master) = m.numero
      AND NOT EXISTS (SELECT 1 FROM public.voyage_route_ce_master o
        WHERE o.voyage_id = cm.voyage_id AND o.pol = cm.pol AND o.pod = v_pair.split AND o.cargo_mode = cm.cargo_mode);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_mirrors := v_mirrors + v_count;
    UPDATE public.voyage_route_ce_master cm
    SET pol = v_pair.split
    FROM public.manifestos_mercante m
    JOIN p391_manifest t ON t.id = m.id AND t.side = 'pol'
    WHERE cm.voyage_id = m.voyage_id AND cm.pol = v_pair.merged
      AND cm.pod IN (m.pod, CASE WHEN EXISTS (SELECT 1 FROM p391_manifest p WHERE p.id = m.id AND p.side = 'pod') THEN v_pair.split END)
      AND cm.cargo_mode = CASE WHEN m.natureza = 'vazio' THEN 'vazios' ELSE 'container' END
      AND public.canonical_manifesto_numero(cm.ce_master) = m.numero
      AND NOT EXISTS (SELECT 1 FROM public.voyage_route_ce_master o
        WHERE o.voyage_id = cm.voyage_id AND o.pol = v_pair.split AND o.pod = cm.pod AND o.cargo_mode = cm.cargo_mode);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_mirrors := v_mirrors + v_count;

    UPDATE public.manifestos_mercante m
    SET pod = CASE WHEN EXISTS (SELECT 1 FROM p391_manifest t WHERE t.id = m.id AND t.side = 'pod') THEN v_pair.split ELSE m.pod END,
        pol = CASE WHEN EXISTS (SELECT 1 FROM p391_manifest t WHERE t.id = m.id AND t.side = 'pol') THEN v_pair.split ELSE m.pol END
    WHERE m.id IN (SELECT id FROM p391_manifest);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_manifests := v_manifests + v_count;

    -- c) Âncora dos Comunicados.
    UPDATE public.customer_communications cc
    SET anchor_port = v_pair.split
    WHERE cc.anchor_port = v_pair.merged
      AND EXISTS (SELECT 1 FROM public.voyages v WHERE v.id = cc.anchor_voyage_id AND v.status IS DISTINCT FROM 'cancelled')
      AND EXISTS (SELECT 1 FROM public.customer_communication_bls l WHERE l.communication_id = cc.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.customer_communication_bls l JOIN public.bls b ON b.id = l.bl_id
        WHERE l.communication_id = cc.id AND public.normalize_port_code(b.pod) IS DISTINCT FROM v_pair.split)
      AND NOT EXISTS (
        SELECT 1 FROM public.customer_communications o
        WHERE o.kind = cc.kind AND o.customer_id = cc.customer_id AND o.anchor_port = v_pair.split
          AND o.anchor_voyage_id IS NOT DISTINCT FROM cc.anchor_voyage_id
          AND o.anchor_atracacao_id IS NOT DISTINCT FROM cc.anchor_atracacao_id
          AND o.anchor_invoice_id IS NOT DISTINCT FROM cc.anchor_invoice_id
          AND o.dispatch_id IS NOT DISTINCT FROM cc.dispatch_id
          AND o.attempt_discriminator = cc.attempt_discriminator);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_communications := v_communications + v_count;

    -- b) Status "BLs e CEs" e estado documental, por Viagem com o porto separado.
    FOR v_voyage IN
      SELECT DISTINCT x.voyage_id FROM (
        SELECT voyage_id, pod AS port FROM public.bls
        UNION ALL SELECT voyage_id, pod FROM public.baplie_containers
        UNION ALL SELECT voyage_id, pol FROM public.voyage_export_schedules
        UNION ALL SELECT m.voyage_id, c.pod FROM public.vazios_importacao_containers c
          JOIN public.vazios_importacao_manifests m ON m.id = c.manifest_id
      ) x
      JOIN public.voyages v ON v.id = x.voyage_id AND v.status IS DISTINCT FROM 'cancelled'
      WHERE public.normalize_port_code(x.port) = v_pair.split
    LOOP
      v_moved := 0;
      SELECT array_agg(DISTINCT p) INTO v_import FROM (
        SELECT public.normalize_port_code(pod) AS p FROM public.bls WHERE voyage_id = v_voyage
        UNION ALL SELECT public.normalize_port_code(pod) FROM public.baplie_containers WHERE voyage_id = v_voyage
      ) s WHERE p IN (v_pair.merged, v_pair.split);
      IF v_import = ARRAY[v_pair.split] THEN
        UPDATE public.audit_logs
        SET entity_id = v_voyage::text || '::' || v_pair.split
        WHERE entity_type = 'voyage_pod_schedule' AND entity_id = v_voyage::text || '::' || v_pair.merged
          AND field_name = 'ces' AND justification = v_reason;
        GET DIAGNOSTICS v_count = ROW_COUNT;
        v_moved := v_moved + v_count;
      END IF;
      SELECT array_agg(DISTINCT p) INTO v_export FROM (
        SELECT public.normalize_port_code(pol) AS p FROM public.voyage_export_schedules WHERE voyage_id = v_voyage
      ) s WHERE p IN (v_pair.merged, v_pair.split);
      IF v_export = ARRAY[v_pair.split] THEN
        UPDATE public.audit_logs
        SET entity_id = v_voyage::text || '::' || v_pair.split
        WHERE entity_type = 'voyage_pod_schedule' AND entity_id = v_voyage::text || '::' || v_pair.merged
          AND field_name = 'export_ces';
        GET DIAGNOSTICS v_count = ROW_COUNT;
        v_moved := v_moved + v_count;
      END IF;
      IF v_moved > 0 THEN
        v_audit := v_audit + v_moved;
        -- Resumo da escala refeito do Histórico (último valor por campo), como
        -- o gatilho `trg_voyage_schedule_snapshot` o monta.
        UPDATE public.voyages
        SET pod_schedule_snapshot = (COALESCE(pod_schedule_snapshot, '{}'::jsonb) - v_pair.merged - v_pair.split)
          || COALESCE((
            SELECT jsonb_object_agg(k.port, k.fields)
            FROM (
              SELECT split_part(l.entity_id, '::', 2) AS port,
                     jsonb_object_agg(l.field_name, COALESCE(to_jsonb(l.new_value), 'null'::jsonb)) AS fields
              FROM (
                SELECT DISTINCT ON (entity_id, field_name) entity_id, field_name, new_value
                FROM public.audit_logs
                WHERE entity_type = 'voyage_pod_schedule'
                  AND entity_id IN (v_voyage::text || '::' || v_pair.merged, v_voyage::text || '::' || v_pair.split)
                ORDER BY entity_id, field_name, id DESC
              ) l
              GROUP BY 1
            ) k), '{}'::jsonb)
        WHERE id = v_voyage;
      END IF;
      DELETE FROM public.voyage_documental_state
      WHERE voyage_id = v_voyage AND port IN (v_pair.merged, v_pair.split);
      v_voyages := array_append(v_voyages, v_voyage);
    END LOOP;
  END LOOP;

  FOR v_voyage IN SELECT DISTINCT unnest(v_voyages) ORDER BY 1 LOOP
    PERFORM public.sync_voyage_documental_status(v_voyage);
    PERFORM public.reconcile_voyage_operation_alerts(v_voyage, 'migration_391');
  END LOOP;

  RAISE NOTICE '391: % Manifesto(s) Mercante, % espelho(s) de rota, % Comunicado(s), % linha(s) do Histórico da escala e % Viagem(ns) recalculada(s).',
    v_manifests, v_mirrors, v_communications, v_audit, cardinality(v_voyages);

  SELECT count(*) INTO v_count FROM public.bl_charge_table_links l
  JOIN public.bls b ON b.id = l.bl_id JOIN public.charge_tables ct ON ct.id = l.charge_table_id
  WHERE public.normalize_port_code(b.pod) IN ('BRNVT', 'BRREC')
    AND public.normalize_port_code(ct.pod) IS DISTINCT FROM public.normalize_port_code(b.pod);
  RAISE NOTICE '391: % vínculo(s) de B/L de Navegantes/Recife com tabela de outro porto deixam de valer; o próximo cálculo usa a tabela do porto do B/L.', v_count;
  SELECT (SELECT count(*) FROM public.depot_portal_information WHERE ports && ARRAY['BRITJ', 'BRSUA'])
       + (SELECT count(*) FROM public.port_agents WHERE ports && ARRAY['BRITJ', 'BRSUA'])
  INTO v_count;
  RAISE NOTICE '391: % Depósito(s)/Agente(s) da Central de Informações com BRITJ ou BRSUA ficam como estão (pode ser Navegantes ou Recife; conferir).', v_count;
END
$repair$;

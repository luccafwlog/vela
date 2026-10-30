-- 546: revisão da release das migrations 523 a 531 da Demurrage (revisão
-- independente da release luccafwlog/vela#1117, ADR 0112 D7, D10, D25, D29 e D32).
--
-- 1. Tipo desativado com código de grupo continuava cobrando. Desde a 514 (e
--    com a ordem invertida na 528), `_demurrage_canonical_type` devolvia o
--    grupo quando o código do tipo era o de um grupo (20GP, 40FR...) sem olhar
--    `container_types.active`: o Administrativo desativava o 20GP, a tela dizia
--    "ficam sem tarifa", e a caixa seguia em A emitir e era faturada. A regra
--    (CONTEXT.md, Tipo de container; D29) é "tipo inativo não tem tarifa".
--    O grupo do container passa a vir só do cadastro ativo, e a tarifa casa
--    pelo código do grupo que ela guarda (`demurrage_rates.container_type`,
--    FK desde a 514), sem passar pelo cadastro: o problema 1 da 528 (mudar o
--    grupo do tipo 40FR trocava a tarifa de outro grupo) continua resolvido.
--    Vale para a classificação, a emissão, o free time e o Portal.
--    `guard_container_type_code_change` passa a valer também no cadastro: o
--    tipo com o código de um grupo só entra nesse grupo (antes, excluir o 20RF
--    sem uso e cadastrá-lo de novo noutro grupo o fazia cobrar a tarifa errada).
-- 2. A Invoice cancelada à mão (D10) era reemitida sozinha em dois caminhos:
--    a) na troca de Cliente do B/L, a classificação só procurava a cancelada
--       do Cliente novo, e o executor da fila emitia para ele;
--    b) a reemissão por datas de outra caixa do grupo (e a varredura da 529)
--       chamava a emissão direto e cobrava junto a caixa da cancelada à mão.
--    A classificação acha também a cancelada do B/L (Cliente anterior), e a
--    reemissão passa pelo executor da fila; a espera vai no texto do Alerta.
-- 3. A cancelada à mão já atendida pelo Gerar Invoice continuava segurando a
--    caixa: se a Invoice nova fosse cancelada sozinha (datas), a reemissão
--    automática esperava o botão de novo. Só segura a cancelada à mão sem
--    Invoice posterior com a caixa.
-- 4. `cancel_bl` recusava o B/L duplicado do mesmo Cliente com tipo sem tarifa
--    e mandava dispensar a caixa, o que tirava a cobrança do B/L verdadeiro
--    (a dispensa é da caixa do Cliente na Viagem). O outro B/L ativo do mesmo
--    Cliente segura a caixa, como na regra da 517.
-- 5. O Alerta de Travado por mudança de tarifa ou de tipo (516) reconciliava a
--    base inteira a cada comando, na hora, e a falha desfazia a gravação. Passa
--    a reconciliar uma vez no fim da transação, como os containers e B/Ls
--    (527); a falha vira aviso no log e a rotina de 15 minutos refaz.
-- 6. "B/L … não encontrado" com acento no executor da fila.
--
-- Só redefine funções e gatilhos; não reescreve nem apaga linhas.
--
-- Rollback: recriar `_demurrage_canonical_type` e `guard_container_type_code_change`
-- (528) e o gatilho `trg_guard_container_type_code_change` só no UPDATE;
-- `_active_demurrage_rates` e `_portal_list_operation_bls_without_transshipment_core`
-- (138), `_container_free_days` (211), `_calculate_demurrage_invoice_authoritative`
-- (521), `_demurrage_billing_board_core` e `_reconcile_demurrage_after_dates` (531),
-- `_run_import_effect_demurrage` e `bl_open_financial_reasons` (530),
-- `_demurrage_travado_flush` (527) e `_catalog_travado_alerts` (516); apagar os
-- gatilhos `trg_rates_travado_flush` e `trg_container_types_travado_flush`.

-- 1. O grupo de tarifa do container: só pelo cadastro ativo (D29).
CREATE OR REPLACE FUNCTION public._demurrage_canonical_type(p_type text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- 546: tipo inativo ou fora do cadastro não tem grupo, também o que tem o
  -- código de um grupo. A tarifa não passa por aqui: casa pelo código do grupo
  -- que ela guarda.
  SELECT t.rate_group FROM public.container_types AS t
   WHERE t.code = upper(btrim(COALESCE(p_type, ''))) AND t.active;
$function$;

CREATE OR REPLACE FUNCTION public._active_demurrage_rates(p_date date)
 RETURNS SETOF demurrage_rates
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- 546: uma por grupo, pelo código do grupo que a tarifa guarda (FK, 514).
  SELECT DISTINCT ON (r.container_type) r.*
  FROM public.demurrage_rates r WHERE r.active AND r.valid_from<=p_date AND (r.valid_to IS NULL OR r.valid_to>=p_date)
  ORDER BY r.container_type,r.valid_from DESC,r.id DESC;
$function$;

CREATE OR REPLACE FUNCTION public._container_free_days(p_bl_id text, p_container_type text, p_discharge_date date)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT b.free_time_override FROM public.bls AS b WHERE b.id = p_bl_id),
    (SELECT a.free_days
       FROM public.customer_demurrage_agreements AS a
       JOIN public.bls AS b ON b.customer_id = a.customer_id
      WHERE b.id = p_bl_id AND a.active = true
        AND p_discharge_date >= a.valid_from
        AND (a.valid_to IS NULL OR p_discharge_date <= a.valid_to)
      ORDER BY a.valid_from DESC, a.id DESC
      LIMIT 1),
    (SELECT r.free_days
       FROM public._active_demurrage_rates((now() AT TIME ZONE 'America/Sao_Paulo')::date) AS r
      -- 546: a tarifa guarda o código do grupo.
      WHERE r.container_type = public._demurrage_canonical_type(p_container_type)
      ORDER BY r.valid_from DESC, r.id DESC
      LIMIT 1)
  );
$function$;

-- Corpo da 521, com a tarifa casada pelo código do grupo.
CREATE OR REPLACE FUNCTION public._calculate_demurrage_invoice_authoritative(p_bl_id text, p_container_ids bigint[], p_calculation_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_requested_count integer := COALESCE(array_length(p_container_ids, 1), 0);
  v_distinct_count integer;
  v_result jsonb;
BEGIN
  IF NULLIF(btrim(p_bl_id), '') IS NULL
     OR v_requested_count = 0
     OR p_calculation_date IS NULL THEN
    RAISE EXCEPTION 'B/L, containers e data de cálculo são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT requested.id)::integer
    INTO v_distinct_count
  FROM unnest(p_container_ids) AS requested(id);
  IF v_distinct_count <> v_requested_count THEN
    RAISE EXCEPTION 'A emissão de Demurrage não aceita container duplicado.' USING ERRCODE = '22023';
  END IF;

  WITH requested AS (
    SELECT requested.id
    FROM unnest(p_container_ids) AS requested(id)
  ), base AS (
    SELECT
      container.id,
      container.bl_id,
      container.container_number,
      container.type,
      container.discharge_date,
      container.return_date,
      container.demurrage_status,
      bl.customer_id,
      bl.free_time_override,
      bl.demurrage_rate_override_p1_usd,
      bl.demurrage_rate_override_p2_usd,
      public._demurrage_canonical_type(container.type) AS canonical_type,
      -- 521 (ADR 0112, D19 e D23): Clientes com a caixa na Viagem.
      public._demurrage_box_share_count(bl.voyage_id, upper(btrim(container.container_number)), bl.customer_id) AS share_count
    FROM requested
    LEFT JOIN public.bl_containers AS container
      ON container.id = requested.id
     AND container.bl_id = ANY(public.demurrage_group_bl_ids(p_bl_id))
    LEFT JOIN public.bls AS bl ON bl.id = container.bl_id
  ), resolved AS (
    SELECT
      base.*,
      rate.free_days AS table_free_days,
      rate.p1_day_to,
      rate.p1_usd AS table_p1_usd,
      rate.p2_day_from,
      rate.p2_usd AS table_p2_usd,
      agreement.free_days AS agreement_free_days,
      agreement.p1_usd AS agreement_p1_usd,
      agreement.p2_usd AS agreement_p2_usd
    FROM base
    LEFT JOIN LATERAL (
      SELECT r.free_days, r.p1_day_to, r.p1_usd, r.p2_day_from, r.p2_usd
      FROM public._active_demurrage_rates(p_calculation_date) AS r
      WHERE r.active = true
        AND r.valid_from <= p_calculation_date
        AND (r.valid_to IS NULL OR r.valid_to >= p_calculation_date)
        -- 546: a tarifa guarda o código do grupo; o do container vem do cadastro ativo.
        AND r.container_type = base.canonical_type
      ORDER BY r.valid_from DESC, r.id DESC
      LIMIT 1
    ) AS rate ON true
    LEFT JOIN LATERAL (
      SELECT a.free_days, a.p1_usd, a.p2_usd
      FROM public.customer_demurrage_agreements AS a
      WHERE a.customer_id = base.customer_id
        AND a.active = true
        AND base.discharge_date >= a.valid_from
        AND (a.valid_to IS NULL OR base.discharge_date <= a.valid_to)
      ORDER BY a.valid_from DESC, a.id DESC
      LIMIT 1
    ) AS agreement ON true
  ), calculated AS (
    SELECT
      resolved.*,
      (resolved.return_date - resolved.discharge_date)::integer AS total_days,
      COALESCE(resolved.free_time_override, resolved.agreement_free_days, resolved.table_free_days) AS free_days,
      COALESCE(resolved.demurrage_rate_override_p1_usd, resolved.agreement_p1_usd, resolved.table_p1_usd) AS rate_p1_usd,
      COALESCE(resolved.demurrage_rate_override_p2_usd, resolved.agreement_p2_usd, resolved.table_p2_usd) AS rate_p2_usd
    FROM resolved
  ), valued AS (
    SELECT
      calculated.*,
      GREATEST(0, LEAST(calculated.total_days, calculated.p1_day_to) - calculated.free_days)::integer AS days_p1,
      GREATEST(
        0,
        calculated.total_days - GREATEST(calculated.p2_day_from, calculated.free_days + 1) + 1
      )::integer AS days_p2
    FROM calculated
  ), totals AS (
    SELECT
      valued.*,
      -- Cada Cliente paga a parte igual do valor pela própria condição (D23).
      round((valued.days_p1 * valued.rate_p1_usd + valued.days_p2 * valued.rate_p2_usd) / GREATEST(1, valued.share_count), 2) AS subtotal_usd,
      (
        valued.id IS NULL
        OR valued.bl_id IS NULL
        -- A devolução preenchida é o que vale; linha antiga pode ter
        -- `within_free_time` com devolução gravada (C11, migration 191).
        OR valued.discharge_date IS NULL
        OR valued.return_date IS NULL
        OR valued.return_date < valued.discharge_date
        OR valued.total_days < 0
        OR valued.free_days IS NULL
        OR valued.free_days < 0
        OR valued.p1_day_to IS NULL
        OR valued.p2_day_from IS NULL
        OR valued.rate_p1_usd IS NULL
        OR valued.rate_p2_usd IS NULL
        OR valued.rate_p1_usd < 0
        OR valued.rate_p2_usd < 0
      ) AS invalid
    FROM valued
  )
  SELECT jsonb_build_object(
    'items', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'container_id', totals.id,
          'container_number', totals.container_number,
          'container_type', totals.type,
          'discharge_date', totals.discharge_date,
          'return_date', totals.return_date,
          'total_days', totals.total_days,
          'free_days', totals.free_days,
          'days_p1', totals.days_p1,
          'rate_p1_usd', totals.rate_p1_usd,
          'days_p2', totals.days_p2,
          'rate_p2_usd', totals.rate_p2_usd,
          'subtotal_usd', totals.subtotal_usd,
          'box_share_count', GREATEST(1, totals.share_count)
        ) ORDER BY totals.id
      ) FILTER (WHERE NOT totals.invalid AND totals.subtotal_usd >= 0),
      '[]'::jsonb
    ),
    'total_usd', COALESCE(sum(totals.subtotal_usd) FILTER (WHERE NOT totals.invalid AND totals.subtotal_usd >= 0), 0),
    'ready_at', CASE WHEN bool_and(totals.return_date IS NOT NULL) THEN max(totals.return_date) ELSE NULL END,
    'requested_count', count(*)::integer,
    'distinct_numbers', count(DISTINCT upper(btrim(totals.container_number)))::integer,
    'calculated_count', count(*) FILTER (WHERE NOT totals.invalid AND totals.subtotal_usd >= 0)::integer,
    'invalid_count', count(*) FILTER (WHERE totals.invalid)::integer
  )
    INTO v_result
  FROM totals;

  IF COALESCE((v_result->>'requested_count')::integer, 0) <> v_requested_count THEN
    RAISE EXCEPTION 'Um ou mais containers não pertencem ao B/L informado.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE((v_result->>'invalid_count')::integer, 0) > 0 THEN
    RAISE EXCEPTION 'Dados insuficientes ou tarifa inválida para calcular a Demurrage.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE((v_result->>'distinct_numbers')::integer, 0) <> v_requested_count THEN
    RAISE EXCEPTION 'A Invoice de Demurrage cobra cada caixa uma vez: container repetido no grupo.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE((v_result->>'calculated_count')::integer, 0) <> v_requested_count THEN
    RAISE EXCEPTION 'Nenhum container faturável ou conjunto de containers desatualizado.' USING ERRCODE = '22023';
  END IF;

  RETURN v_result;
END;
$function$;

-- Corpo da 138, com a tarifa casada pelo código do grupo.
CREATE OR REPLACE FUNCTION public._portal_list_operation_bls_without_transshipment_core(p_customer_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN (
    WITH active_rates AS (
      -- 546: a tarifa guarda o código do grupo.
      SELECT r.container_type,r.free_days
      FROM public._active_demurrage_rates(CURRENT_DATE) r
    ),
    bl_rows AS (
      SELECT
        b.id AS bl_id,
        b.customer_id,
        vs.carrier_id,
        carrier.name AS carrier_name,
        tracking.tracking_url,
        b.ce_mercante,
        b.pol,
        b.pod,
        b.voyage_id,
        v.voyage_number,
        vs.name AS vessel_name,
        b.free_time_override,
        b.cargo_mode,
        b.bb_weight_ton,
        b.bb_packages_qty
      FROM public.bls AS b
      LEFT JOIN public.voyages AS v ON v.id = b.voyage_id
      LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
      LEFT JOIN public.carriers carrier ON carrier.id=vs.carrier_id
      LEFT JOIN public.carrier_portal_information tracking ON tracking.carrier_id=carrier.id
      WHERE b.customer_id = p_customer_id AND public.bl_has_portal_release(b.id)
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'bl_id', bl.bl_id,
          'ce_mercante', bl.ce_mercante,
          'pol', bl.pol,
          'pod', bl.pod,
          'voyage_id', bl.voyage_id,
          'voyage_number', bl.voyage_number,
          'vessel_name', bl.vessel_name,
          'carrier_id',bl.carrier_id,'carrier_name',bl.carrier_name,'tracking_url',bl.tracking_url,
          'container_count', container_summary.container_count,
          'containers_in_demurrage', container_summary.containers_in_demurrage,
          'containers_returned', container_summary.containers_returned,
          'containers', container_summary.containers,
          'cargo_mode', bl.cargo_mode,
          'bb_weight_ton', bl.bb_weight_ton,
          'bb_packages_qty', bl.bb_packages_qty
        )
        ORDER BY bl.voyage_id DESC NULLS LAST, bl.bl_id
      ),
      '[]'::jsonb
    )
    FROM bl_rows AS bl
    LEFT JOIN LATERAL (
      WITH calculated AS (
        SELECT
          c.id,
          c.container_number,
          c.type,
          c.ownership,
          c.discharge_date,
          c.return_date,
          CASE
            WHEN c.discharge_date IS NULL OR upper(COALESCE(c.ownership,''))='SOC' THEN NULL
            ELSE GREATEST(COALESCE(c.return_date, CURRENT_DATE) - c.discharge_date, 0)
          END AS usage_days,
          CASE
            WHEN c.discharge_date IS NULL OR upper(COALESCE(c.ownership,''))='SOC' THEN NULL
            ELSE COALESCE(bl.free_time_override,agreement.free_days,ar.free_days)
          END AS free_time_days
        FROM public.bl_containers AS c
        LEFT JOIN active_rates AS ar
          ON ar.container_type = public._demurrage_canonical_type(c.type)
        LEFT JOIN LATERAL (
          SELECT a.free_days FROM public.customer_demurrage_agreements a
          WHERE a.customer_id=bl.customer_id AND a.active AND c.discharge_date>=a.valid_from
            AND (a.valid_to IS NULL OR c.discharge_date<=a.valid_to)
          ORDER BY a.valid_from DESC,a.id DESC LIMIT 1
        ) agreement ON true
        WHERE c.bl_id = bl.bl_id
      ),
      with_demurrage AS (
        SELECT
          calculated.*,
          CASE
            WHEN usage_days IS NULL OR free_time_days IS NULL THEN NULL
            ELSE GREATEST(usage_days - free_time_days, 0)
          END AS demurrage_days
        FROM calculated
      ),
      with_status AS (
        SELECT
          with_demurrage.*,
          CASE
            WHEN upper(COALESCE(ownership,''))='SOC' THEN 'soc'
            WHEN discharge_date IS NULL THEN 'sem_descarga'
            WHEN return_date IS NOT NULL THEN 'devolvido'
            WHEN free_time_days IS NULL THEN 'tarifa_indisponivel'
            WHEN COALESCE(demurrage_days, 0) > 0 THEN 'em_demurrage'
            ELSE 'dentro_free_time'
          END AS status
        FROM with_demurrage
      )
      SELECT
        COUNT(*)::int AS container_count,
        COUNT(*) FILTER (WHERE status = 'em_demurrage')::int AS containers_in_demurrage,
        COUNT(*) FILTER (WHERE status = 'devolvido')::int AS containers_returned,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', id,
              'container_number', container_number,
              'type', type,
              'discharge_date', discharge_date,
              'return_date', return_date,
              'usage_days', usage_days,
              'free_time_days', free_time_days,
              'demurrage_days', demurrage_days,
              'status', status
            )
            ORDER BY container_number
          ),
          '[]'::jsonb
        ) AS containers
      FROM with_status
    ) AS container_summary ON true
  );
END;
$function$;

-- O tipo com o código de um grupo só entra nesse grupo, no cadastro e na edição.
CREATE OR REPLACE FUNCTION public.guard_container_type_code_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF EXISTS (SELECT 1 FROM public.demurrage_rate_groups g WHERE g.code = OLD.code)
       AND (NEW.code IS DISTINCT FROM OLD.code OR NEW.rate_group IS DISTINCT FROM OLD.rate_group) THEN
      RAISE EXCEPTION 'O tipo % é o código do grupo de tarifa: o grupo e o código dele não mudam.', OLD.code
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.code IS DISTINCT FROM OLD.code
       AND EXISTS (SELECT 1 FROM public.bl_containers c WHERE upper(btrim(c.type)) = OLD.code) THEN
      RAISE EXCEPTION 'Tipo de container % já usado em B/L: o código não muda. Cadastre o novo código e desative este.', OLD.code
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  -- 546: também no cadastro (o tipo excluído sem uso e cadastrado de novo).
  IF EXISTS (SELECT 1 FROM public.demurrage_rate_groups g WHERE g.code = NEW.code)
     AND NEW.rate_group IS DISTINCT FROM NEW.code THEN
    RAISE EXCEPTION 'O tipo % é o código do grupo de tarifa: cadastre-o no grupo %.', NEW.code, NEW.code
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_container_type_code_change ON public.container_types;
CREATE TRIGGER trg_guard_container_type_code_change BEFORE INSERT OR UPDATE OF code, rate_group ON public.container_types
  FOR EACH ROW EXECUTE FUNCTION public.guard_container_type_code_change();

-- Corpo da 531, com a tarifa pelo código do grupo e a cancelada à mão revista.
CREATE OR REPLACE FUNCTION public._demurrage_billing_board_core(p_customer_id bigint DEFAULT NULL::bigint, p_voyage_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_result jsonb;
BEGIN
  WITH candidate_bls AS (
    -- B/Ls com caixa não-SOC numa Viagem que não foi cancelada.
    SELECT DISTINCT b.id, b.voyage_id, b.customer_id, b.cancelled_at
      FROM public.bls AS b
      JOIN public.voyages AS v ON v.id = b.voyage_id
      JOIN public.bl_containers AS c ON c.bl_id = b.id
     WHERE v.status IS DISTINCT FROM 'cancelled'
       AND c.ownership IS DISTINCT FROM 'SOC'
       AND NULLIF(btrim(c.container_number), '') IS NOT NULL
       AND (p_voyage_id IS NULL OR b.voyage_id = p_voyage_id)
       AND (p_customer_id IS NULL OR b.customer_id = p_customer_id)
  ), grouped AS (
    -- B/L ativo: o grupo do banco (mesmo Cliente e Viagem, caixa dividida).
    -- B/L cancelado ou sem Cliente: ele sozinho.
    SELECT cb.id AS bl_id, cb.voyage_id, cb.customer_id, cb.cancelled_at,
           CASE
             WHEN cb.cancelled_at IS NOT NULL OR cb.customer_id IS NULL THEN ARRAY[cb.id]
             ELSE public.demurrage_group_bl_ids(cb.id)
           END AS group_ids
      FROM candidate_bls AS cb
  ), groups AS (
    SELECT DISTINCT ON (g.group_ids[1]) g.group_ids[1] AS anchor_bl_id, g.group_ids, g.voyage_id, g.customer_id,
           (g.cancelled_at IS NOT NULL) AS cancelled
      FROM grouped AS g
     ORDER BY g.group_ids[1], g.bl_id
  ), boxes AS (
    -- Uma linha por caixa (número) do grupo, a do âncora primeiro, como a emissão.
    SELECT DISTINCT ON (gr.anchor_bl_id, upper(btrim(c.container_number)))
           gr.anchor_bl_id, c.id AS container_id, c.bl_id, upper(btrim(c.container_number)) AS container_key,
           c.container_number, c.type, c.discharge_date, c.return_date,
           b.free_time_override, b.demurrage_rate_override_p1_usd, b.demurrage_rate_override_p2_usd,
           -- 521 (D19): o previsto é a parte do Cliente na caixa dividida.
           public._demurrage_box_share_count(gr.voyage_id, upper(btrim(c.container_number)), gr.customer_id) AS share_count
      FROM groups AS gr
      JOIN public.bl_containers AS c ON c.bl_id = ANY(gr.group_ids)
      JOIN public.bls AS b ON b.id = c.bl_id
     WHERE c.ownership IS DISTINCT FROM 'SOC'
       AND NULLIF(btrim(c.container_number), '') IS NOT NULL
       -- 526: a caixa do B/L cancelado que um B/L ativo do mesmo Cliente na
       -- Viagem segura é cobrada por ele (517 aceita esse cancelamento); não
       -- aparece também no cancelado.
       -- 531: de qualquer Cliente (D22: a caixa passa a ser cobrada só dos
       -- Clientes ativos).
       AND NOT (gr.cancelled AND EXISTS (
         SELECT 1 FROM public.bl_containers AS oc JOIN public.bls AS ob ON ob.id = oc.bl_id
          WHERE ob.voyage_id = gr.voyage_id AND ob.cancelled_at IS NULL
            AND oc.ownership IS DISTINCT FROM 'SOC'
            AND upper(btrim(oc.container_number)) = upper(btrim(c.container_number))))
     ORDER BY gr.anchor_bl_id, upper(btrim(c.container_number)), (c.bl_id = gr.anchor_bl_id) DESC, c.id
  ), resolved AS (
    SELECT bx.*, gr.customer_id, gr.voyage_id,
           public._demurrage_canonical_type(bx.type) AS rate_group,
           rate.free_days AS table_free_days, rate.p1_day_to, rate.p1_usd AS table_p1_usd,
           rate.p2_day_from, rate.p2_usd AS table_p2_usd,
           agreement.free_days AS agreement_free_days, agreement.p1_usd AS agreement_p1_usd,
           agreement.p2_usd AS agreement_p2_usd,
           covering.invoice_id AS covered_by,
           waiver.id AS waiver_id
      FROM boxes AS bx
      JOIN groups AS gr ON gr.anchor_bl_id = bx.anchor_bl_id
      LEFT JOIN LATERAL (
        SELECT r.free_days, r.p1_day_to, r.p1_usd, r.p2_day_from, r.p2_usd
          FROM public._active_demurrage_rates(v_today) AS r
         -- 546: a tarifa guarda o código do grupo; o do container vem do cadastro ativo.
         WHERE r.container_type = public._demurrage_canonical_type(bx.type)
         ORDER BY r.valid_from DESC, r.id DESC
         LIMIT 1
      ) AS rate ON true
      LEFT JOIN LATERAL (
        SELECT a.free_days, a.p1_usd, a.p2_usd
          FROM public.customer_demurrage_agreements AS a
         WHERE a.customer_id = gr.customer_id AND a.active
           AND bx.discharge_date IS NOT NULL
           AND bx.discharge_date >= a.valid_from
           AND (a.valid_to IS NULL OR bx.discharge_date <= a.valid_to)
         ORDER BY a.valid_from DESC, a.id DESC
         LIMIT 1
      ) AS agreement ON true
      -- 517: dispensa da cobrança da caixa (Viagem, Cliente, número).
      LEFT JOIN LATERAL (
        SELECT w.id FROM public.demurrage_box_waivers AS w
         WHERE w.revoked_at IS NULL
           AND w.voyage_id = gr.voyage_id AND w.customer_id IS NOT DISTINCT FROM gr.customer_id
           AND w.container_key = bx.container_key
         LIMIT 1
      ) AS waiver ON true
      LEFT JOIN LATERAL (
        SELECT max(billed.invoice_id) AS invoice_id
          FROM public._demurrage_billed_container_keys(gr.voyage_id, gr.customer_id) AS billed
         WHERE gr.customer_id IS NOT NULL AND billed.container_key = bx.container_key
      ) AS covering ON true
  ), calculated AS (
    SELECT r.*,
           CASE WHEN r.discharge_date IS NULL THEN NULL
                ELSE (COALESCE(r.return_date, v_today) - r.discharge_date)::integer END AS total_days,
           COALESCE(r.free_time_override, r.agreement_free_days, r.table_free_days) AS free_days,
           CASE WHEN r.free_time_override IS NOT NULL THEN 'bl'
                WHEN r.agreement_free_days IS NOT NULL THEN 'acordo'
                WHEN r.table_free_days IS NOT NULL THEN 'tabela' END AS free_source,
           COALESCE(r.demurrage_rate_override_p1_usd, r.agreement_p1_usd, r.table_p1_usd) AS rate_p1_usd,
           COALESCE(r.demurrage_rate_override_p2_usd, r.agreement_p2_usd, r.table_p2_usd) AS rate_p2_usd
      FROM resolved AS r
  ), valued AS (
    SELECT c.*,
           (c.p1_day_to IS NULL OR c.p2_day_from IS NULL OR c.rate_p1_usd IS NULL OR c.rate_p2_usd IS NULL) AS no_rate,
           CASE WHEN c.total_days IS NULL OR c.free_days IS NULL OR c.p1_day_to IS NULL THEN NULL
                ELSE GREATEST(0, LEAST(c.total_days, c.p1_day_to) - c.free_days)::integer END AS days_p1,
           CASE WHEN c.total_days IS NULL OR c.free_days IS NULL OR c.p2_day_from IS NULL THEN NULL
                ELSE GREATEST(0, c.total_days - GREATEST(c.p2_day_from, c.free_days + 1) + 1)::integer END AS days_p2
      FROM calculated AS c
  ), boxed AS (
    SELECT v.*,
           CASE WHEN v.no_rate OR v.days_p1 IS NULL THEN NULL
                ELSE round((v.days_p1 * v.rate_p1_usd + v.days_p2 * v.rate_p2_usd) / GREATEST(1, v.share_count), 2) END AS usd,
           CASE
             WHEN v.covered_by IS NOT NULL THEN 'covered'
             WHEN v.waiver_id IS NOT NULL THEN 'waived'
             WHEN v.discharge_date IS NULL THEN 'no_discharge'
             -- D27: sem tarifa e sem free time de B/L ou acordo, desde a descarga;
             -- com free time, quando ele vence (não há diária para valorar).
             -- 526: devolvida dentro do free time também (D32): a emissão
             -- recusa o grupo com caixa sem tarifa.
             WHEN v.no_rate AND (v.free_days IS NULL OR v.total_days > v.free_days OR v.return_date IS NOT NULL) THEN 'no_rate'
             WHEN v.return_date IS NULL AND v.free_days IS NOT NULL AND v.total_days > v.free_days THEN 'running'
             WHEN v.return_date IS NULL THEN 'in_free_time'
             WHEN v.free_days IS NOT NULL AND v.total_days > v.free_days THEN 'returned_overstay'
             ELSE 'returned_free'
           END AS state
      FROM valued AS v
  ), group_flags AS (
    SELECT gr.anchor_bl_id, gr.group_ids, gr.voyage_id, gr.customer_id, gr.cancelled,
           bool_or(bx.state = 'no_rate') AS has_no_rate,
           bool_or(bx.state = 'running') AS has_running,
           bool_or(bx.state IN ('returned_overstay', 'no_rate') AND bx.return_date IS NOT NULL) AS has_returned_overstay,
           bool_or(bx.state IN ('running', 'returned_overstay', 'no_rate')) AS has_overstay,
           bool_or(bx.return_date IS NULL AND bx.state <> 'waived') AS has_out,
           bool_or(bx.state = 'returned_overstay' AND COALESCE(bx.usd, 0) > 0) AS has_to_issue,
           bool_or(bx.state = 'no_rate' AND NOT EXISTS (
             SELECT 1 FROM public.container_types AS t WHERE t.code = upper(btrim(COALESCE(bx.type, ''))))) AS no_rate_new_type,
           bool_or(bx.state = 'no_rate' AND EXISTS (
             SELECT 1 FROM public.container_types AS t WHERE t.code = upper(btrim(COALESCE(bx.type, ''))) AND NOT t.active)) AS no_rate_inactive_type,
           string_agg(DISTINCT CASE WHEN bx.state = 'no_rate' THEN COALESCE(NULLIF(upper(btrim(bx.type)), ''), '(vazio)') END, ', ') AS no_rate_types,
           COALESCE(sum(bx.usd) FILTER (WHERE bx.state IN ('running', 'returned_overstay')), 0) AS usd
      FROM groups AS gr
      JOIN boxed AS bx ON bx.anchor_bl_id = gr.anchor_bl_id
     GROUP BY gr.anchor_bl_id, gr.group_ids, gr.voyage_id, gr.customer_id, gr.cancelled
  ), blocked AS (
    SELECT gf.*,
           CASE WHEN gf.customer_id IS NOT NULL AND NOT gf.cancelled AND gf.has_overstay
                THEN public._demurrage_issue_block_reason(gf.anchor_bl_id) END AS block_reason,
           CASE WHEN gf.customer_id IS NOT NULL AND NOT gf.cancelled AND gf.has_overstay
                THEN NOT public.bl_has_portal_release(gf.anchor_bl_id) END AS missing_ce
      FROM group_flags AS gf
  ), classified AS (
    SELECT bl.*,
           CASE
             WHEN bl.has_no_rate THEN 'travado'
             WHEN bl.cancelled AND bl.has_overstay THEN 'travado'
             WHEN bl.customer_id IS NULL AND bl.has_overstay THEN 'travado'
             WHEN NOT bl.has_out AND bl.has_to_issue AND bl.block_reason IS NOT NULL THEN 'travado'
             WHEN bl.has_running THEN 'correndo'
             WHEN bl.has_out AND bl.has_returned_overstay THEN 'esperando'
             WHEN NOT bl.has_out AND bl.has_to_issue THEN 'a_emitir'
           END AS division,
           CASE
             WHEN bl.has_no_rate THEN 'sem_tarifa'
             WHEN bl.cancelled AND bl.has_overstay THEN 'bl_cancelado'
             WHEN bl.customer_id IS NULL AND bl.has_overstay THEN 'sem_cliente'
             WHEN NOT bl.has_out AND bl.has_to_issue AND bl.block_reason IS NOT NULL
               THEN CASE WHEN bl.missing_ce THEN 'sem_ce' ELSE 'portal' END
           END AS reason_code
      FROM blocked AS bl
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'anchor_bl_id', cl.anchor_bl_id,
           'bl_ids', to_jsonb(cl.group_ids),
           'voyage_id', cl.voyage_id,
           'voyage_label', (SELECT COALESCE(ve.name, '') || ' / ' || vo.voyage_number
                              FROM public.voyages AS vo LEFT JOIN public.vessels AS ve ON ve.id = vo.vessel_id
                             WHERE vo.id = cl.voyage_id),
           'customer_id', cl.customer_id,
           'customer_name', (SELECT cu.name FROM public.customers AS cu WHERE cu.id = cl.customer_id),
           'customer_cnpj', (SELECT cu.cnpj_cpf FROM public.customers AS cu WHERE cu.id = cl.customer_id),
           'division', cl.division,
           'reason_code', cl.reason_code,
           'reason', CASE cl.reason_code
             WHEN 'sem_tarifa' THEN format('Tipo %s sem tarifa de Demurrage.', cl.no_rate_types)
             WHEN 'bl_cancelado' THEN format('B/L %s cancelado com sobreestadia sem Invoice.', cl.anchor_bl_id)
             WHEN 'sem_cliente' THEN format('B/L %s sem Cliente vinculado.', cl.anchor_bl_id)
             ELSE cl.block_reason END,
           -- Em Correndo e Esperando, o que vai travar a emissão já aparece.
           'warning', CASE WHEN cl.division IN ('correndo', 'esperando') THEN cl.block_reason END,
           'no_rate_types', cl.no_rate_types,
           -- 526: o que destrava o "sem tarifa": tipo fora do cadastro, tipo
           -- desativado ou tarifa do grupo (D4, D27, D32).
           'no_rate_kind', CASE WHEN cl.reason_code = 'sem_tarifa' THEN
             CASE WHEN cl.no_rate_new_type THEN 'tipo_novo' WHEN cl.no_rate_inactive_type THEN 'tipo_inativo' ELSE 'tarifa' END END,
           -- 525: em A emitir, a Invoice cancelada à mão que as caixas esperam
           -- (D10: sem Invoice nova automática) e a emissão já na fila.
           'cancelled_doc', CASE WHEN cl.division = 'a_emitir' THEN (
             SELECT di.doc_number
               FROM public.demurrage_invoices AS di
               JOIN public.bls AS ib ON ib.id = di.bl_id
               JOIN public.demurrage_invoice_items AS it ON it.invoice_id = di.id
              WHERE di.status = 'cancelled' AND ib.voyage_id = cl.voyage_id
                -- 546: também a do Cliente anterior do B/L (troca de Cliente, D10).
                AND (di.customer_id = cl.customer_id OR di.bl_id = ANY (cl.group_ids))
                -- 530: só a cancelada à mão; a automática tem reemissão própria.
                AND public._demurrage_cancelled_by_hand(di.id)
                AND upper(btrim(it.container_number)) IN (
                  SELECT bx.container_key FROM boxed AS bx
                   WHERE bx.anchor_bl_id = cl.anchor_bl_id AND bx.state = 'returned_overstay')
                AND NOT EXISTS (
                  SELECT 1 FROM public.demurrage_invoices AS live
                   WHERE live.replaces_invoice_id = di.id AND live.status IN ('issued', 'overdue', 'paid'))
                -- 546: a caixa saiu depois noutra Invoice (o Gerar Invoice já
                -- atendeu a cancelada à mão); se essa for cancelada sozinha, a
                -- reemissão automática segue.
                AND NOT EXISTS (
                  SELECT 1 FROM public.demurrage_invoices AS later
                    JOIN public.bls AS lb ON lb.id = later.bl_id
                    JOIN public.demurrage_invoice_items AS li ON li.invoice_id = later.id
                   WHERE later.id > di.id AND lb.voyage_id = ib.voyage_id
                     AND (later.customer_id = di.customer_id OR later.customer_id = cl.customer_id)
                     AND upper(btrim(li.container_number)) = upper(btrim(it.container_number)))
              ORDER BY di.id DESC LIMIT 1) END,
           'issue_queued', CASE WHEN cl.division = 'a_emitir' THEN EXISTS (
             SELECT 1 FROM public.import_pending_effects AS e
              WHERE e.effect_kind = 'demurrage_billing'
                AND e.entity_id = ANY (cl.group_ids)
                AND e.status IN ('pending', 'running', 'retry_wait')) ELSE false END,
           'usd', cl.usd,
           'boxes', (SELECT jsonb_agg(jsonb_build_object(
                       'container_id', bx.container_id, 'bl_id', bx.bl_id,
                       'container_number', bx.container_number, 'type', bx.type, 'rate_group', bx.rate_group,
                       'discharge_date', bx.discharge_date, 'return_date', bx.return_date,
                       'total_days', bx.total_days, 'free_days', bx.free_days, 'free_source', bx.free_source,
                       'last_free_day', CASE WHEN bx.discharge_date IS NOT NULL AND bx.free_days IS NOT NULL THEN bx.discharge_date + bx.free_days END,
                       'days_p1', bx.days_p1, 'rate_p1_usd', bx.rate_p1_usd,
                       'days_p2', bx.days_p2, 'rate_p2_usd', bx.rate_p2_usd,
                       'usd', CASE WHEN bx.state IN ('running', 'returned_overstay') THEN bx.usd END,
                       'state', bx.state,
                       'covered_by', bx.covered_by,
                       'covered_doc', (SELECT di.doc_number FROM public.demurrage_invoices AS di WHERE di.id = bx.covered_by),
                       'waiver_id', bx.waiver_id,
                       'box_share_count', GREATEST(1, bx.share_count)
                     ) ORDER BY bx.container_key)
                       FROM boxed AS bx WHERE bx.anchor_bl_id = cl.anchor_bl_id)
         ) ORDER BY cl.anchor_bl_id), '[]'::jsonb)
    INTO v_result
    FROM classified AS cl
   WHERE cl.division IS NOT NULL;
  RETURN v_result;
END;
$function$;

-- Corpo da 530, com o âncora na espera e o texto acentuado.
CREATE OR REPLACE FUNCTION public._run_import_effect_demurrage(p_effect_id bigint, p_bl_id text, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl record;
  v_group jsonb;
BEGIN
  SELECT id, voyage_id, customer_id INTO v_bl FROM public.bls WHERE id = p_bl_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado para a Demurrage.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  -- 530 (decisão do dono de 2026-10-30, D10): grupo cuja Invoice foi
  -- cancelada à mão espera o Gerar Invoice; nenhum caminho automático (datas,
  -- CE, Cliente, rotina) emite por ele. A mesma regra da aba Containers.
  IF v_bl.customer_id IS NOT NULL THEN
    SELECT grp.value INTO v_group
      FROM jsonb_array_elements(public._demurrage_billing_board_core(v_bl.customer_id, v_bl.voyage_id)) AS grp(value)
     WHERE grp.value->'bl_ids' ? p_bl_id
     LIMIT 1;
    IF v_group->>'division' = 'a_emitir' AND v_group->>'cancelled_doc' IS NOT NULL THEN
      -- 546: o âncora, para a reemissão por datas tentar cada grupo uma vez.
      RETURN jsonb_build_object('status', 'awaiting_manual_issue', 'bl_id', p_bl_id,
        'anchor_bl_id', v_group->>'anchor_bl_id', 'cancelled_doc', v_group->>'cancelled_doc');
    END IF;
  END IF;
  RETURN public.issue_demurrage_invoice_for_bl(p_bl_id, NULL);
END;
$function$;

-- Corpo da 531, com a reemissão pelo executor da fila.
CREATE OR REPLACE FUNCTION public._reconcile_demurrage_after_dates(p_bl_ids text[], p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice public.demurrage_invoices%ROWTYPE;
  v_invoice_id bigint;
  v_result jsonb := '[]'::jsonb;
  v_reissue jsonb;
  v_previous text := current_setting('vela.demurrage_internal', true);
  v_paid boolean;
  v_negotiated boolean;
  v_voyage_id bigint;
  v_keys text[];
  v_tried text[];
  v_waiting text[];
  v_extra jsonb;
  v_next_bl text;
  v_attempt jsonb;
  v_unbilled text[];
  v_message text;
  v_state text;
BEGIN
  FOR v_invoice_id IN
    SELECT DISTINCT di.id
    FROM unnest(p_bl_ids) AS changed(bl_id)
    JOIN public.demurrage_invoices AS di
      ON di.bl_id = ANY(public.demurrage_group_bl_ids(changed.bl_id) || changed.bl_id)
      -- A Invoice que cobra caixa deste B/L, mesmo ancorada fora do grupo de
      -- hoje (grupo que se dividiu depois da emissão, 214).
      OR EXISTS (
        SELECT 1 FROM public.demurrage_invoice_items AS own_item
        JOIN public.bl_containers AS own ON own.id = own_item.container_id
        WHERE own_item.invoice_id = di.id AND own.bl_id = changed.bl_id
      )
    WHERE di.status IN ('issued', 'overdue', 'paid')
      AND EXISTS (
        SELECT 1 FROM public.demurrage_invoice_items AS item
        JOIN public.bl_containers AS c ON c.id = item.container_id
        WHERE item.invoice_id = di.id
          AND public._demurrage_item_stale(item.id)
      )
    ORDER BY di.id
  LOOP
    -- A decisão vale para a linha travada (211): uma baixa que confirmou
    -- depois da leitura acima não tem a Invoice paga cancelada e reemitida.
    SELECT * INTO v_invoice FROM public.demurrage_invoices WHERE id = v_invoice_id FOR UPDATE;
    CONTINUE WHEN NOT FOUND OR v_invoice.status NOT IN ('issued', 'overdue', 'paid');
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      JOIN public.bl_containers AS c ON c.id = item.container_id
      WHERE item.invoice_id = v_invoice.id
        AND public._demurrage_item_stale(item.id)
    );
    v_paid := v_invoice.status = 'paid' OR v_invoice.paid_at IS NOT NULL;
    -- Desconto ou disputa aberta (ADR 0079, decisão 1): houve negociação que o
    -- cálculo não refaz. Como a paga, a Invoice não é reemitida sozinha.
    v_negotiated := NOT v_paid
      AND (COALESCE(v_invoice.discount_value, 0) > 0 OR COALESCE(v_invoice.dispute_open, false));
    -- 521 (D22): sem data diferente, o que mudou foi a divisão da caixa.
    v_message := format(CASE WHEN EXISTS (
        SELECT 1 FROM public.demurrage_invoice_items AS item
        JOIN public.bl_containers AS c ON c.id = item.container_id
        WHERE item.invoice_id = v_invoice.id
          AND (c.discharge_date IS DISTINCT FROM item.discharge_date OR c.return_date IS DISTINCT FROM item.return_date))
      THEN 'As datas de container da Invoice de Demurrage %s mudaram depois da emissão%s.'
      -- 522 (D20): a caixa que virou SOC sai da cobrança, não é cobrança perdida.
      WHEN EXISTS (
        SELECT 1 FROM public.demurrage_invoice_items AS item
        JOIN public.bl_containers AS c ON c.id = item.container_id
        WHERE item.invoice_id = v_invoice.id AND c.ownership = 'SOC')
      THEN 'Container da Invoice de Demurrage %s passou a SOC depois da emissão e sai da cobrança%s.'
      -- 529: o B/L da Invoice foi cancelado e a caixa ficou só com os outros Clientes.
      WHEN EXISTS (SELECT 1 FROM public.bls AS b WHERE b.id = v_invoice.bl_id AND b.cancelled_at IS NOT NULL)
      THEN 'O B/L da Invoice de Demurrage %s foi cancelado depois da emissão e a caixa passou a ser cobrada só dos outros Clientes%s.'
      ELSE 'A divisão das caixas entre Clientes da Invoice de Demurrage %s mudou depois da emissão%s.' END,
        v_invoice.doc_number, CASE
          WHEN v_paid THEN ' e ela já tem pagamento: a Régua suspendeu a cobrança'
          WHEN v_negotiated THEN ' e ela tem desconto ou disputa aberta: a Régua suspendeu a cobrança; cancele, gere de novo e refaça o desconto ou responda a disputa'
          ELSE '' END);

    IF v_paid OR v_negotiated THEN
      -- 529: a diferença já avisada e tratada (Alerta resolvido com o mesmo
      -- estado) não reabre o Alerta nem suspende de novo; diferença nova sim.
      v_state := public._demurrage_stale_state(v_invoice.id);
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.alert_items AS i JOIN public.alerts AS a ON a.id = i.alert_id
         WHERE i.item_type = 'demurrage_invoice_dates_changed'
           -- 531: também o Alerta ainda aberto com o mesmo estado: a varredura
           -- não regrava a Invoice a cada passada.
           AND a.entity_type = 'demurrage_invoice' AND a.entity_id = v_invoice.id::text
           AND i.metadata->>'stale_state' = v_state);
      PERFORM public.upsert_alert_item(
        'demurrage_invoice_dates_changed', 'demurrage_invoice', v_invoice.id::text, v_message,
        'container-dates',
        jsonb_build_object('invoice_id', v_invoice.id, 'bl_id', v_invoice.bl_id, 'paid', v_paid, 'negotiated', v_negotiated,
          'stale_state', v_state),
        '/demurrage');
      UPDATE public.demurrage_invoices
         -- 524: o motivo diz a causa (datas, SOC ou divisão da caixa).
         SET dunning_suspended_reason = public._demurrage_stale_reason(v_invoice.id, v_paid)
       WHERE id = v_invoice.id
         -- 317 (R5): a suspensão pela recusa do provedor (D6) fica; ao
         -- resolver o alerta, a retomada aplica a suspensão por datas.
         AND (dunning_suspended_reason IS NULL OR dunning_suspended_reason NOT LIKE 'Cobrança recusada pelo provedor%')
         -- 531: o mesmo motivo não regrava a linha (updated_at e histórico).
         AND dunning_suspended_reason IS DISTINCT FROM public._demurrage_stale_reason(v_invoice.id, v_paid);
      v_result := v_result || jsonb_build_array(jsonb_build_object('invoice_id', v_invoice.id, 'status', 'suspended'));
      CONTINUE;
    END IF;

    -- Sem pagamento: cancela e reemite com as datas atuais (ou só cancela).
    UPDATE public.demurrage_invoices SET status = 'cancelled', updated_at = now()
     WHERE id = v_invoice.id AND status IN ('issued', 'overdue') AND paid_at IS NULL;
    CONTINUE WHEN NOT FOUND;
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
    VALUES ('demurrage_invoice', v_invoice.id::text, 'status', v_invoice.status, 'cancelled', p_actor, now(),
      'Datas de container alteradas: cancelada para reemissão automática.');
    v_extra := '[]'::jsonb;
    v_unbilled := ARRAY[]::text[];
    v_voyage_id := NULL;
    IF EXISTS (SELECT 1 FROM public.bls WHERE id = v_invoice.bl_id AND cancelled_at IS NOT NULL) THEN
      v_reissue := jsonb_build_object('status', 'bl_cancelled', 'bl_id', v_invoice.bl_id);
    -- Viagem Cancelada não recebe Invoice de Demurrage (211): só cancela.
    ELSIF EXISTS (
      SELECT 1 FROM public.bls AS b JOIN public.voyages AS v ON v.id = b.voyage_id
      WHERE b.id = v_invoice.bl_id AND v.status = 'cancelled'
    ) THEN
      v_reissue := jsonb_build_object('status', 'voyage_cancelled', 'bl_id', v_invoice.bl_id);
    ELSE
      -- Cada caixa uma vez (214): a reemissão cobra as caixas da Invoice
      -- cancelada que nenhuma outra Invoice viva cobre. Primeiro pelo grupo do
      -- B/L dela; a caixa que saiu desse grupo, pelo âncora do B/L ativo que
      -- ainda a tem. Cada âncora é tentado uma vez.
      SELECT voyage_id INTO v_voyage_id FROM public.bls WHERE id = v_invoice.bl_id;
      SELECT COALESCE(array_agg(DISTINCT upper(btrim(item.container_number))), ARRAY[]::text[]) INTO v_keys
      FROM public.demurrage_invoice_items AS item
      WHERE item.invoice_id = v_invoice.id AND NULLIF(btrim(item.container_number), '') IS NOT NULL
        -- 522 (D20): a caixa que virou SOC não é cobrada de novo nem conta
        -- como caixa que a reemissão deixou de cobrar.
        AND NOT EXISTS (SELECT 1 FROM public.bl_containers AS c WHERE c.id = item.container_id AND c.ownership = 'SOC');
      v_tried := ARRAY[]::text[];
      v_waiting := ARRAY[]::text[];
      v_next_bl := v_invoice.bl_id;
      PERFORM set_config('vela.demurrage_internal', 'on', true);
      -- 484 (decisão do dono, P7): o Cliente já via a Invoice cancelada; a
      -- substituta sai mesmo com o gate fechado.
      PERFORM set_config('vela.demurrage_reissue_visible', 'on', true);
      LOOP
        -- 546 (D10): pelo executor da fila, que não emite o grupo que espera o
        -- Gerar Invoice de uma Invoice cancelada à mão (a varredura da 529
        -- passa por aqui também).
        -- ponytail: o executor reconhece a espera só com o grupo em A emitir;
        -- com o Gate do Portal fechado (Travado), a reemissão, que passa pelo
        -- gate (484), ainda cobra a caixa da cancelada à mão. Calcular
        -- `cancelled_doc` também em Travado se o caso aparecer.
        v_attempt := public._run_import_effect_demurrage(NULL, v_next_bl, p_actor);
        -- 472 (DEM-D08): a Invoice reemitida guarda qual cancelada ela substitui.
        IF v_attempt->>'status' = 'issued' AND (v_attempt->>'invoice_id') IS NOT NULL THEN
          UPDATE public.demurrage_invoices SET replaces_invoice_id = v_invoice.id
           WHERE id = (v_attempt->>'invoice_id')::bigint;
        END IF;
        IF cardinality(v_tried) = 0 THEN
          v_reissue := v_attempt;
        ELSE
          v_extra := v_extra || jsonb_build_array(v_attempt || jsonb_build_object('bl_id', v_next_bl));
        END IF;
        v_tried := array_append(v_tried, COALESCE(v_attempt->>'anchor_bl_id', public.demurrage_group_anchor(v_next_bl), v_next_bl));
        -- Sem sobreestadia ou aguardando devolução: as caixas do grupo ficam
        -- sem Invoice por regra, não por perda (a devolução enfileira de novo).
        IF v_attempt->>'status' IN ('no_overstay', 'waiting_return') THEN
          v_waiting := v_waiting || ARRAY(
            SELECT DISTINCT upper(btrim(c.container_number)) FROM public.bl_containers AS c
            WHERE c.bl_id = ANY(public.demurrage_group_bl_ids(COALESCE(v_attempt->>'anchor_bl_id', v_next_bl))));
        END IF;
        SELECT holder.id INTO v_next_bl
        FROM unnest(v_keys) AS k(container_key)
        JOIN public.bl_containers AS c ON upper(btrim(c.container_number)) = k.container_key
        JOIN public.bls AS holder ON holder.id = c.bl_id
        WHERE holder.voyage_id = v_voyage_id AND holder.customer_id = v_invoice.customer_id
          AND holder.cancelled_at IS NULL
          AND c.ownership IS DISTINCT FROM 'SOC'
          AND k.container_key <> ALL(v_waiting)
          AND NOT EXISTS (
            SELECT 1 FROM public._demurrage_billed_container_keys(v_voyage_id, v_invoice.customer_id) AS billed
            WHERE billed.container_key = k.container_key)
          AND public.demurrage_group_anchor(holder.id) <> ALL(v_tried)
        ORDER BY k.container_key, holder.id
        LIMIT 1;
        EXIT WHEN NOT FOUND;
      END LOOP;
      PERFORM set_config('vela.demurrage_internal', COALESCE(v_previous, ''), true);
      PERFORM set_config('vela.demurrage_reissue_visible', '', true);
      SELECT COALESCE(array_agg(k.container_key ORDER BY k.container_key), ARRAY[]::text[]) INTO v_unbilled
      FROM unnest(v_keys) AS k(container_key)
      WHERE k.container_key <> ALL(v_waiting)
        AND NOT EXISTS (
          SELECT 1 FROM public._demurrage_billed_container_keys(v_voyage_id, v_invoice.customer_id) AS billed
          WHERE billed.container_key = k.container_key);
    END IF;
    IF cardinality(v_unbilled) > 0 THEN
      -- Caixa da Invoice cancelada que ficou sem cobrança não é sucesso: o
      -- Alerta diz quais caixas conferir e fecha quando todas estiverem numa
      -- Invoice viva (349, resolve_demurrage_dates_changed_on_billing).
      PERFORM public.upsert_alert_item(
        'demurrage_invoice_dates_changed', 'demurrage_invoice', v_invoice.id::text,
        v_message || format(
          ' A reemissão automática não cobrou o(s) container(s) %s: %s',
          array_to_string(v_unbilled, ', '),
          CASE WHEN v_reissue->>'status' = 'blocked'
            THEN 'a emissão aguarda: ' || (v_reissue->>'reason') || ' A nova Invoice sai sozinha quando o motivo for resolvido.'
            -- 546 (D10)
            WHEN v_reissue->>'status' = 'awaiting_manual_issue'
            THEN format('a Invoice %s foi cancelada à mão e o grupo espera o Gerar Invoice na Demurrage.', v_reissue->>'cancelled_doc')
            ELSE 'confira o grupo e emita a Demurrage deles.' END),
        'container-dates',
        jsonb_build_object('invoice_id', v_invoice.id, 'bl_id', v_invoice.bl_id, 'paid', v_paid, 'negotiated', v_negotiated,
          'voyage_id', v_voyage_id, 'customer_id', v_invoice.customer_id,
          'unbilled_containers', to_jsonb(v_unbilled), 'reissue_status', v_reissue->>'status'),
        '/demurrage');
    ELSE
      -- 349 (P1): a reemissão cobriu todas as caixas, ou não havia o que
      -- cobrar (B/L ou Viagem cancelados, sem sobreestadia, aguardando
      -- devolução). Nada a conferir: o alerta não fica aberto.
      PERFORM public.resolve_alert_item(
        'demurrage_invoice_dates_changed', 'demurrage_invoice', v_invoice.id::text, 'container-dates',
        jsonb_build_object('resolution', 'reissue_complete', 'invoice_id', v_invoice.id,
          'reissue_status', v_reissue->>'status'));
    END IF;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'invoice_id', v_invoice.id, 'status', 'cancelled', 'reissue', v_reissue,
      'reissue_extra', v_extra, 'unbilled_containers', to_jsonb(v_unbilled),
      'reissue_complete', cardinality(v_unbilled) = 0));
  END LOOP;

  -- Com as datas de volta às faturadas, a Invoice com desconto ou disputa sai
  -- da suspensão (a paga sai pelo estorno, como na 191).
  UPDATE public.demurrage_invoices AS di
     SET dunning_suspended_reason = NULL
    FROM unnest(p_bl_ids) AS changed(bl_id)
   WHERE di.bl_id = ANY(public.demurrage_group_bl_ids(changed.bl_id) || changed.bl_id)
     AND di.status IN ('issued', 'overdue')
     AND di.paid_at IS NULL
     AND di.dunning_suspended_reason LIKE '% em Invoice com desconto ou disputa; reemitir à mão.'
     AND NOT EXISTS (
       SELECT 1 FROM public.demurrage_invoice_items AS item
       JOIN public.bl_containers AS c ON c.id = item.container_id
       WHERE item.invoice_id = di.id
         AND public._demurrage_item_stale(item.id)
     );
  RETURN v_result;
END;
$function$;

-- Corpo da 530, com a exceção do outro B/L do mesmo Cliente no bloco da 530.
CREATE OR REPLACE FUNCTION public.bl_open_financial_reasons(p_bl_id text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reasons text[] := ARRAY[]::text[];
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.status IN ('draft', 'issued', 'partially_paid')
      AND (i.bl_id = p_bl_id OR EXISTS (SELECT 1 FROM public.invoice_bls ib WHERE ib.invoice_id = i.id AND ib.bl_id = p_bl_id))
  ) THEN
    v_reasons := array_append(v_reasons, 'fatura em aberto');
  END IF;
  -- Só o recebível ligado a fatura viva ou com baixa trava; o resto é anulado
  -- (362: vínculo de fatura cancelada não trava, decisão 12).
  IF EXISTS (
    SELECT 1 FROM public.bl_receivables r
    WHERE r.bl_id = p_bl_id AND r.status IN ('open', 'partially_settled')
      AND (r.settled_amount_brl > 0
           OR EXISTS (SELECT 1 FROM public.invoice_receivable_links l JOIN public.invoices li ON li.id = l.invoice_id WHERE l.receivable_id = r.id AND COALESCE(l.status, '') <> 'obsolete' AND coalesce(li.status, 'issued') NOT IN ('cancelled', 'obsolete'))
           OR EXISTS (SELECT 1 FROM public.ledger_settlements s WHERE s.receivable_id = r.id))
  ) THEN
    v_reasons := array_append(v_reasons, 'recebível em aberto');
  END IF;
  -- A Invoice do grupo é emitida no B/L-âncora com as caixas dos irmãos
  -- (ADR 0078, item 20): o item que aponta para container deste B/L também
  -- trava, como a Invoice do próprio B/L.
  IF EXISTS (
    SELECT 1 FROM public.demurrage_invoices d
    WHERE d.status IN ('draft', 'issued', 'overdue')
      AND (d.bl_id = p_bl_id OR EXISTS (
        SELECT 1 FROM public.demurrage_invoice_items AS item
        JOIN public.bl_containers AS c ON c.id = item.container_id
        WHERE item.invoice_id = d.id AND c.bl_id = p_bl_id
      ))
  ) THEN
    v_reasons := array_append(v_reasons, 'fatura de Demurrage em aberto');
  END IF;
  -- 517 (ADR 0112, D7 e D26): caixa do B/L com sobreestadia sem Invoice viva
  -- nem dispensa, devolvida ou ainda fora e passada do free time, que nenhum
  -- outro B/L ativo do mesmo Cliente na Viagem segura: cancelar perderia a
  -- cobrança. Sai com a Invoice emitida ou com a dispensa.
  IF EXISTS (
    SELECT 1
      FROM public.bls AS b
      JOIN public.voyages AS v ON v.id = b.voyage_id
      JOIN public.bl_containers AS c ON c.bl_id = b.id
     WHERE b.id = p_bl_id AND b.customer_id IS NOT NULL
       AND v.status IS DISTINCT FROM 'cancelled'
       AND c.ownership IS DISTINCT FROM 'SOC'
       AND c.discharge_date IS NOT NULL
       AND NULLIF(btrim(c.container_number), '') IS NOT NULL
       AND public._container_free_days(b.id, c.type, c.discharge_date) IS NOT NULL
       AND (COALESCE(c.return_date, (now() AT TIME ZONE 'America/Sao_Paulo')::date) - c.discharge_date)
           > public._container_free_days(b.id, c.type, c.discharge_date)
       AND NOT EXISTS (
         SELECT 1 FROM public._demurrage_billed_container_keys(b.voyage_id, b.customer_id) AS billed
          WHERE billed.container_key = upper(btrim(c.container_number)))
       AND NOT EXISTS (
         SELECT 1 FROM public.bl_containers AS other_c
         JOIN public.bls AS other ON other.id = other_c.bl_id
          WHERE other.id <> b.id AND other.cancelled_at IS NULL
            AND other.voyage_id = b.voyage_id AND other.customer_id = b.customer_id
            AND upper(btrim(other_c.container_number)) = upper(btrim(c.container_number)))
  ) THEN
    v_reasons := array_append(v_reasons, 'Demurrage a faturar: devolva o container e emita a Invoice, ou dispense a cobrança na Demurrage');
  END IF;
  -- 530 (decisão do dono de 2026-10-30): B/L sem Cliente, ou caixa de tipo
  -- sem tarifa e sem free time (Travado desde a descarga, D27), com
  -- sobreestadia ou travada e sem dispensa: cancelar também perderia a
  -- cobrança em silêncio.
  IF EXISTS (
    SELECT 1
      FROM public.bls AS b
      JOIN public.voyages AS v ON v.id = b.voyage_id
      JOIN public.bl_containers AS c ON c.bl_id = b.id
     WHERE b.id = p_bl_id
       AND v.status IS DISTINCT FROM 'cancelled'
       AND c.ownership IS DISTINCT FROM 'SOC'
       AND c.discharge_date IS NOT NULL
       AND NULLIF(btrim(c.container_number), '') IS NOT NULL
       AND (b.customer_id IS NULL OR public._container_free_days(b.id, c.type, c.discharge_date) IS NULL)
       AND (public._container_free_days(b.id, c.type, c.discharge_date) IS NULL
            OR (COALESCE(c.return_date, (now() AT TIME ZONE 'America/Sao_Paulo')::date) - c.discharge_date)
               > public._container_free_days(b.id, c.type, c.discharge_date))
       AND NOT EXISTS (
         SELECT 1 FROM public._demurrage_billed_container_keys(b.voyage_id, b.customer_id) AS billed
          WHERE billed.container_key = upper(btrim(c.container_number)))
       -- 546: outro B/L ativo do mesmo Cliente na Viagem segura a caixa, como
       -- acima (517); dispensar no duplicado tiraria a cobrança do outro.
       AND NOT (b.customer_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.bl_containers AS other_c
         JOIN public.bls AS other ON other.id = other_c.bl_id
          WHERE other.id <> b.id AND other.cancelled_at IS NULL
            AND other.voyage_id = b.voyage_id AND other.customer_id = b.customer_id
            AND upper(btrim(other_c.container_number)) = upper(btrim(c.container_number))))
  ) THEN
    v_reasons := array_append(v_reasons, 'Demurrage travada: vincule o Cliente ou cadastre a tarifa e emita a Invoice, ou dispense a cobrança na Demurrage');
  END IF;
  RETURN v_reasons;
END;
$function$;

-- 5. Mudança de tarifa ou de tipo: anota e reconcilia uma vez no fim da transação.
CREATE OR REPLACE FUNCTION public._catalog_travado_alerts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- 546: a tarifa e o tipo valem para todas as Viagens; o gatilho adiado
  -- (`_demurrage_travado_flush`) reconcilia a base uma vez no commit.
  PERFORM set_config('vela.travado_pending_all', 'on', true);
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public._demurrage_travado_flush()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pending text := NULLIF(NULLIF(current_setting('vela.travado_pending', true), ''), ',');
  v_voyage text;
BEGIN
  -- 546: tarifa ou tipo mudou: uma reconciliação de todas as Viagens cobre
  -- também as anotadas.
  IF current_setting('vela.travado_pending_all', true) = 'on' THEN
    PERFORM set_config('vela.travado_pending_all', '', true);
    PERFORM set_config('vela.travado_pending', '', true);
    BEGIN
      PERFORM public.reconcile_demurrage_travado_alerts(NULL, 'demurrage_travado_catalogo');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Alerta de Demurrage travada não reconciliado depois da mudança de tarifa ou de tipo: %', SQLERRM;
    END;
    RETURN NULL;
  END IF;
  IF v_pending IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('vela.travado_pending', '', true);
  FOREACH v_voyage IN ARRAY string_to_array(btrim(v_pending, ','), ',') LOOP
    BEGIN
      PERFORM public.reconcile_demurrage_travado_alerts(v_voyage::bigint, 'demurrage_travado_containers');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Alerta de Demurrage travada da Viagem % não reconciliado: %', v_voyage, SQLERRM;
    END;
  END LOOP;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_rates_travado_flush ON public.demurrage_rates;
CREATE CONSTRAINT TRIGGER trg_rates_travado_flush
  AFTER INSERT OR UPDATE OR DELETE ON public.demurrage_rates DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public._demurrage_travado_flush();
DROP TRIGGER IF EXISTS trg_container_types_travado_flush ON public.container_types;
CREATE CONSTRAINT TRIGGER trg_container_types_travado_flush
  AFTER INSERT OR UPDATE OR DELETE ON public.container_types DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public._demurrage_travado_flush();

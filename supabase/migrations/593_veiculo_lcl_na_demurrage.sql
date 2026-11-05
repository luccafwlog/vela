-- 593: Veículo LCL na Demurrage: free time fixo de 30 dias e cobrança que
-- nasce suspensa (decisão do dono de 2026-11-05, ADR 0124).
--
-- O B/L de veículo LCL é o mesmo que já tem as Taxas Locais isentas e o
-- Desbloqueio de CE só com o B/L original: modalidade container, com veículo e
-- Movement To com LCL ou CFS (`_calculate_bl_local_charges_impl_*`, migration
-- 575). Na Demurrage:
--
-- 1. Free time fixo de 30 dias (`_demurrage_lcl_vehicle_free_days`), acima da
--    condição do B/L, do acordo do Cliente e da tarifa; as diárias P1/P2 e as
--    faixas seguem a precedência de sempre. Vale no cálculo da Invoice, na
--    classificação da aba Containers, no status gravado do container, na
--    Consulta de container do site e na aba B/Ls do Portal.
-- 2. Cobrança suspensa por padrão: o container de veículo LCL (todo B/L ativo
--    do Cliente com ele na Viagem é de veículo LCL) não entra na emissão
--    automática (fila de efeitos, datas, CE, troca de Cliente, rotina de 15
--    minutos). A classificação o põe na divisão nova `veiculo_lcl`, fora de
--    Correndo, A emitir, Esperando, Travado, dos cartões em US$ e dos Alertas,
--    e o operador cobra pelo Gerar Invoice. O Gerar Invoice de um grupo em A
--    emitir (com outros containers a cobrar) cobra só os outros, o que a
--    linha mostra; o veículo LCL fica para a divisão Veículo LCL, onde o
--    Gerar Invoice o cobra. A Invoice emitida à mão segue a
--    regra de qualquer Invoice: cancelada pelo sistema (datas, SOC, divisão,
--    troca de CNPJ), é reemitida sozinha; cancelada à mão, o container volta a
--    esperar o Gerar Invoice. O B/L de veículo LCL se cancela sem a recusa
--    "Demurrage correndo ou a emitir".
-- 3. A condição de Demurrage do B/L de veículo LCL recusa free time próprio.
--
-- Funções novas: `_bl_is_lcl_vehicle`, `_demurrage_lcl_vehicle_free_days` e
-- `_demurrage_lcl_vehicle_exempt_box`. Redefinidas (mesma assinatura; CREATE
-- OR REPLACE preserva dono e grants): `_container_free_days` (546),
-- `_calculate_demurrage_invoice_authoritative` (565),
-- `_demurrage_billing_board_core` (546), `issue_demurrage_invoice_for_bl`
-- (548), `assert_demurrage_invoice_complete` (531),
-- `_run_import_effect_demurrage` (546), `bl_open_financial_reasons` (569),
-- `_portal_list_operation_bls_without_transshipment_core` (546),
-- `save_bl_demurrage_config` (573) e `_bls_refresh_demurrage_status` (515).
-- Gatilhos: o status gravado e o Alerta de Demurrage travada também reagem a
-- Movement To, modalidade e veículos do B/L.
--
-- Não reescreve nem apaga linhas. O status gravado dos containers de veículo
-- LCL ainda fora passa a contar 30 dias na próxima gravação do container ou do
-- B/L, ou na rotina diária `container-demurrage-status` (00:17 de Brasília).
-- Invoices já emitidas não mudam (os itens guardam o free time da emissão).
-- Rollback: reaplicar cada função pela migration indicada acima, recriar
-- `trg_bls_refresh_demurrage_status`, `trg_bls_travado_alerts` e
-- `trg_bls_travado_flush` pela 515 e 527, remover os gatilhos `trg_vehicles_*`
-- desta migration e as três funções novas.

-- ─── 1. Quem é veículo LCL e o free time fixo ───────────────────────────

CREATE OR REPLACE FUNCTION public._bl_is_lcl_vehicle(p_bl_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- A mesma regra da isenção das Taxas Locais pelo veículo
  -- (`_calculate_bl_local_charges_impl_*`) e do Desbloqueio de CE (575), lida
  -- dos dados atuais do B/L: modalidade container, com veículo e Movement To
  -- com LCL ou CFS. Prova positiva: sem Movimento declarado não é LCL.
  SELECT EXISTS (
    SELECT 1 FROM public.bls AS b
     WHERE b.id = p_bl_id
       AND b.cargo_mode = 'container'
       AND b.movement_to IS NOT NULL
       AND (upper(btrim(b.movement_to)) LIKE '%LCL%' OR upper(btrim(b.movement_to)) LIKE '%CFS%')
       AND EXISTS (SELECT 1 FROM public.vehicles AS v WHERE v.bl_id = b.id)
  );
$function$;
REVOKE ALL ON FUNCTION public._bl_is_lcl_vehicle(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._demurrage_lcl_vehicle_free_days()
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Free time fixo do veículo LCL (decisão do dono de 2026-11-05).
  SELECT 30;
$function$;
REVOKE ALL ON FUNCTION public._demurrage_lcl_vehicle_free_days() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._demurrage_lcl_vehicle_exempt_box(
  p_voyage_id bigint, p_customer_id bigint, p_group text[], p_container_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    -- Prova positiva, como nas Taxas Locais: todo B/L do grupo com o container
    -- é de veículo LCL. Container dividido com B/L de outra carga do mesmo
    -- Cliente é cobrado como sempre.
    WHEN NOT EXISTS (
      SELECT 1 FROM public.bl_containers AS c
       WHERE c.bl_id = ANY (p_group) AND c.ownership IS DISTINCT FROM 'SOC'
         AND upper(btrim(c.container_number)) = p_container_key)
      THEN false
    WHEN EXISTS (
      SELECT 1 FROM public.bl_containers AS c
       WHERE c.bl_id = ANY (p_group) AND c.ownership IS DISTINCT FROM 'SOC'
         AND upper(btrim(c.container_number)) = p_container_key
         AND NOT public._bl_is_lcl_vehicle(c.bl_id))
      THEN false
    -- A cobrança que o operador já fez continua: se a última Invoice do
    -- container na Viagem (deste Cliente ou de B/L do grupo, para a troca de
    -- CNPJ) foi cancelada pelo sistema, ele volta a ser cobrado sozinho, como
    -- qualquer reemissão. Cancelada à mão, volta a esperar o Gerar Invoice.
    ELSE NOT COALESCE((
      SELECT di.status = 'cancelled' AND NOT public._demurrage_cancelled_by_hand(di.id)
        FROM public.demurrage_invoices AS di
        JOIN public.bls AS ib ON ib.id = di.bl_id
        JOIN public.demurrage_invoice_items AS it ON it.invoice_id = di.id
       WHERE ib.voyage_id = p_voyage_id
         AND (di.customer_id IS NOT DISTINCT FROM p_customer_id OR di.bl_id = ANY (p_group))
         AND upper(btrim(it.container_number)) = p_container_key
       ORDER BY di.id DESC
       LIMIT 1), false)
  END;
$function$;
REVOKE ALL ON FUNCTION public._demurrage_lcl_vehicle_exempt_box(bigint, bigint, text[], text) FROM PUBLIC, anon, authenticated;

-- ─── 2. Free time de 30 dias em cada leitura ─────────────────────────────

-- Corpo da 546; o veículo LCL antes da condição do B/L.
CREATE OR REPLACE FUNCTION public._container_free_days(p_bl_id text, p_container_type text, p_discharge_date date)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    -- 593: veículo LCL, 30 dias fixos, acima da condição do B/L.
    CASE WHEN public._bl_is_lcl_vehicle(p_bl_id) THEN public._demurrage_lcl_vehicle_free_days() END,
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

-- Corpo da 565; o veículo LCL antes da condição do B/L.
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
      -- 593: veículo LCL, free time fixo de 30 dias.
      public._bl_is_lcl_vehicle(bl.id) AS lcl_vehicle,
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
      CASE WHEN resolved.lcl_vehicle THEN public._demurrage_lcl_vehicle_free_days()
           ELSE COALESCE(resolved.free_time_override, resolved.agreement_free_days, resolved.table_free_days) END AS free_days,
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
    RAISE EXCEPTION 'A Invoice de Demurrage cobra cada container uma vez: há container repetido no grupo.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE((v_result->>'calculated_count')::integer, 0) <> v_requested_count THEN
    RAISE EXCEPTION 'Nenhum container faturável ou conjunto de containers desatualizado.' USING ERRCODE = '22023';
  END IF;

  RETURN v_result;
END;
$function$;

-- Corpo da 546; free time do veículo LCL na aba B/Ls do Portal.
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
            -- 593: veículo LCL, 30 dias fixos.
            WHEN public._bl_is_lcl_vehicle(bl.bl_id) THEN public._demurrage_lcl_vehicle_free_days()
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

-- ─── 3. Classificação: divisão Veículo LCL ───────────────────────────────

-- Corpo da 546. A caixa de veículo LCL com sobreestadia sem Invoice ganha o
-- estado `lcl_vehicle` (fica fora das contas de Correndo, A emitir, Esperando
-- e Travado), e o grupo só com ela vai para a divisão `veiculo_lcl`, com o que
-- falta para o Gerar Invoice.
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
           -- 593: free time de 30 dias do B/L de veículo LCL e a caixa com a
           -- cobrança suspensa (todo B/L do grupo com ela é de veículo LCL).
           public._bl_is_lcl_vehicle(c.bl_id) AS lcl_vehicle_bl,
           public._demurrage_lcl_vehicle_exempt_box(gr.voyage_id, gr.customer_id, gr.group_ids, upper(btrim(c.container_number))) AS lcl_exempt,
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
           CASE WHEN r.lcl_vehicle_bl THEN public._demurrage_lcl_vehicle_free_days()
                ELSE COALESCE(r.free_time_override, r.agreement_free_days, r.table_free_days) END AS free_days,
           CASE WHEN r.lcl_vehicle_bl THEN 'veiculo_lcl'
                WHEN r.free_time_override IS NOT NULL THEN 'bl'
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
             -- 593: veículo LCL. Com sobreestadia, a cobrança espera o Gerar
             -- Invoice; no free time, como qualquer caixa. Sem tarifa não trava
             -- (a divisão Veículo LCL diz que falta a tarifa para cobrar).
             WHEN v.lcl_exempt AND v.total_days > v.free_days THEN 'lcl_vehicle'
             WHEN v.lcl_exempt AND v.return_date IS NULL THEN 'in_free_time'
             WHEN v.lcl_exempt THEN 'returned_free'
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
           -- 593: o tipo sem tarifa da caixa de veículo LCL também impede o
           -- Gerar Invoice (o cálculo recusa o grupo), sem travar a cobrança.
           bool_or(bx.rate_missing AND NOT EXISTS (
             SELECT 1 FROM public.container_types AS t WHERE t.code = upper(btrim(COALESCE(bx.type, ''))))) AS no_rate_new_type,
           bool_or(bx.rate_missing AND EXISTS (
             SELECT 1 FROM public.container_types AS t WHERE t.code = upper(btrim(COALESCE(bx.type, ''))) AND NOT t.active)) AS no_rate_inactive_type,
           string_agg(DISTINCT CASE WHEN bx.rate_missing THEN COALESCE(NULLIF(upper(btrim(bx.type)), ''), '(vazio)') END, ', ') AS no_rate_types,
           COALESCE(sum(bx.usd) FILTER (WHERE bx.state IN ('running', 'returned_overstay')), 0) AS usd,
           bool_or(bx.state = 'lcl_vehicle') AS has_lcl_overstay,
           bool_or(bx.lcl_exempt AND bx.rate_missing) AS lcl_no_rate,
           COALESCE(sum(bx.usd) FILTER (WHERE bx.state = 'lcl_vehicle'), 0) AS lcl_usd
      FROM groups AS gr
      JOIN (SELECT b2.*,
                   (b2.state = 'no_rate' OR (b2.lcl_exempt AND b2.no_rate AND b2.state NOT IN ('covered', 'waived'))) AS rate_missing
              FROM boxed AS b2) AS bx ON bx.anchor_bl_id = gr.anchor_bl_id
     GROUP BY gr.anchor_bl_id, gr.group_ids, gr.voyage_id, gr.customer_id, gr.cancelled
  ), blocked AS (
    SELECT gf.*,
           CASE WHEN gf.customer_id IS NOT NULL AND NOT gf.cancelled AND (gf.has_overstay OR gf.has_lcl_overstay)
                THEN public._demurrage_issue_block_reason(gf.anchor_bl_id) END AS block_reason,
           CASE WHEN gf.customer_id IS NOT NULL AND NOT gf.cancelled AND (gf.has_overstay OR gf.has_lcl_overstay)
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
             -- 593: só caixa de veículo LCL com sobreestadia; B/L cancelado
             -- não emite e fica fora.
             WHEN NOT bl.cancelled AND bl.has_lcl_overstay THEN 'veiculo_lcl'
           END AS division,
           CASE
             WHEN bl.has_no_rate THEN 'sem_tarifa'
             WHEN bl.cancelled AND bl.has_overstay THEN 'bl_cancelado'
             WHEN bl.customer_id IS NULL AND bl.has_overstay THEN 'sem_cliente'
             WHEN NOT bl.has_out AND bl.has_to_issue AND bl.block_reason IS NOT NULL
               THEN CASE WHEN bl.missing_ce THEN 'sem_ce' ELSE 'portal' END
           END AS base_reason_code
      FROM blocked AS bl
  ), explained AS (
    -- 593: em Veículo LCL, o que impede o Gerar Invoice, na ordem em que se
    -- resolve: Cliente, tarifa, e com tudo devolvido, CE ou Portal.
    SELECT cl.*,
           CASE WHEN cl.division = 'veiculo_lcl' THEN
             CASE
               WHEN cl.customer_id IS NULL THEN 'sem_cliente'
               WHEN cl.lcl_no_rate THEN 'sem_tarifa'
               WHEN NOT cl.has_out AND cl.block_reason IS NOT NULL
                 THEN CASE WHEN cl.missing_ce THEN 'sem_ce' ELSE 'portal' END
             END
           ELSE cl.base_reason_code END AS reason_code
      FROM classified AS cl
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
           -- 593: em Veículo LCL também, enquanto há container fora.
           'warning', CASE WHEN cl.division IN ('correndo', 'esperando')
                             OR (cl.division = 'veiculo_lcl' AND cl.reason_code IS NULL) THEN cl.block_reason END,
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
           -- 593: em Veículo LCL, o US$ das caixas com a cobrança suspensa.
           'usd', CASE WHEN cl.division = 'veiculo_lcl' THEN cl.lcl_usd ELSE cl.usd END,
           'boxes', (SELECT jsonb_agg(jsonb_build_object(
                       'container_id', bx.container_id, 'bl_id', bx.bl_id,
                       'container_number', bx.container_number, 'type', bx.type, 'rate_group', bx.rate_group,
                       'discharge_date', bx.discharge_date, 'return_date', bx.return_date,
                       'total_days', bx.total_days, 'free_days', bx.free_days, 'free_source', bx.free_source,
                       'last_free_day', CASE WHEN bx.discharge_date IS NOT NULL AND bx.free_days IS NOT NULL THEN bx.discharge_date + bx.free_days END,
                       'days_p1', bx.days_p1, 'rate_p1_usd', bx.rate_p1_usd,
                       'days_p2', bx.days_p2, 'rate_p2_usd', bx.rate_p2_usd,
                       'usd', CASE WHEN bx.state IN ('running', 'returned_overstay', 'lcl_vehicle') THEN bx.usd END,
                       'state', bx.state,
                       'covered_by', bx.covered_by,
                       'covered_doc', (SELECT di.doc_number FROM public.demurrage_invoices AS di WHERE di.id = bx.covered_by),
                       'waiver_id', bx.waiver_id,
                       'box_share_count', GREATEST(1, bx.share_count)
                     ) ORDER BY bx.container_key)
                       FROM boxed AS bx WHERE bx.anchor_bl_id = cl.anchor_bl_id)
         ) ORDER BY cl.anchor_bl_id), '[]'::jsonb)
    INTO v_result
    FROM explained AS cl
   WHERE cl.division IS NOT NULL;
  RETURN v_result;
END;
$function$;

-- ─── 4. Emissão: a automática não cobra o veículo LCL ───────────────────

-- Corpo da 548. O container de veículo LCL com a cobrança suspensa só entra
-- no Gerar Invoice do grupo que está na divisão Veículo LCL: em A emitir, a
-- Invoice cobra só os outros containers, o que a linha mostra. Com
-- `vela.demurrage_auto_issue` ligado (só o executor da fila liga), ele nunca
-- entra, e o grupo só com ele devolve `lcl_vehicle`.
CREATE OR REPLACE FUNCTION public.issue_demurrage_invoice_for_bl(p_bl_id text, p_doc_number text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_group text[] := public.demurrage_group_bl_ids(p_bl_id);
  v_anchor text := v_group[1];
  v_customer_id bigint;
  v_voyage_id bigint;
  v_covering bigint[];
  v_uncovered integer;
  v_container_ids bigint[];
  v_calculation jsonb;
  v_doc text;
  v_block text;
  v_lcl_skipped text[] := ARRAY[]::text[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('vela.demurrage_internal', true) IS DISTINCT FROM 'on'
     AND (auth.uid() IS NULL OR NOT public.is_active_user()) THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bls WHERE id = p_bl_id AND cancelled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'O B/L % está cancelado: a Invoice de Demurrage não é emitida para B/L cancelado.', p_bl_id
      USING ERRCODE = '22023';
  END IF;

  SELECT customer_id, voyage_id INTO v_customer_id, v_voyage_id FROM public.bls WHERE id = v_anchor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'B/L % sem cliente para emissão de Demurrage.', v_anchor USING ERRCODE = '22023';
  END IF;

  -- Cada caixa uma vez (214): a cobertura é por caixa na Viagem e no Cliente,
  -- não pelo grupo de hoje. A trava vale até o fim da transação.
  PERFORM public._lock_demurrage_box_billing(v_voyage_id, v_customer_id);
  -- 593: o container de veículo LCL sem Invoice, com a cobrança suspensa.
  SELECT COALESCE(array_agg(boxes.container_key ORDER BY boxes.container_key), ARRAY[]::text[]) INTO v_lcl_skipped
  FROM (
    SELECT DISTINCT upper(btrim(c.container_number)) AS container_key
    FROM public.bl_containers AS c
    WHERE c.bl_id = ANY(v_group) AND c.ownership IS DISTINCT FROM 'SOC'
      AND NULLIF(btrim(c.container_number), '') IS NOT NULL
  ) AS boxes
  WHERE NOT EXISTS (
      SELECT 1 FROM public._demurrage_billed_container_keys(v_voyage_id, v_customer_id) AS billed
      WHERE billed.container_key = boxes.container_key)
    AND public._demurrage_lcl_vehicle_exempt_box(v_voyage_id, v_customer_id, v_group, boxes.container_key);
  -- Na emissão automática ele espera sempre. No Gerar Invoice, entra só quando
  -- o grupo está na divisão Veículo LCL (o que a linha mostra é ele); em A
  -- emitir, a Invoice cobra os outros containers, e ele fica para lá.
  IF current_setting('vela.demurrage_auto_issue', true) IS DISTINCT FROM 'on'
     AND cardinality(v_lcl_skipped) > 0
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(public._demurrage_billing_board_core(v_customer_id, v_voyage_id)) AS grp(value)
        WHERE grp.value->'bl_ids' ? v_anchor AND grp.value->>'division' = 'veiculo_lcl')
  THEN
    v_lcl_skipped := ARRAY[]::text[];
  END IF;
  WITH boxes AS (
    SELECT DISTINCT upper(btrim(c.container_number)) AS container_key
    FROM public.bl_containers AS c
    WHERE c.bl_id = ANY(v_group) AND c.ownership IS DISTINCT FROM 'SOC'
      AND NULLIF(btrim(c.container_number), '') IS NOT NULL
  ), billed AS (
    SELECT * FROM public._demurrage_billed_container_keys(v_voyage_id, v_customer_id)
  )
  SELECT
    -- 517: a caixa dispensada conta como coberta, sem Invoice (invoice_id nulo).
    (SELECT array_agg(DISTINCT billed.invoice_id ORDER BY billed.invoice_id)
       FROM billed JOIN boxes USING (container_key) WHERE billed.invoice_id IS NOT NULL),
    (SELECT count(*) FROM boxes
      WHERE NOT EXISTS (SELECT 1 FROM billed WHERE billed.container_key = boxes.container_key)
        AND boxes.container_key <> ALL(v_lcl_skipped))
  INTO v_covering, v_uncovered;
  IF v_uncovered = 0 AND cardinality(v_covering) > 0 THEN
    RETURN jsonb_build_object('status', 'existing', 'invoice_id', v_covering[cardinality(v_covering)],
      'invoice_ids', to_jsonb(v_covering), 'anchor_bl_id', v_anchor, 'idempotent', true);
  END IF;
  -- 593: o que sobrou sem Invoice é veículo LCL: a cobrança espera o Gerar Invoice.
  IF v_uncovered = 0 AND cardinality(v_lcl_skipped) > 0 THEN
    RETURN jsonb_build_object('status', 'lcl_vehicle', 'anchor_bl_id', v_anchor, 'group_bl_ids', to_jsonb(v_group),
      'containers', to_jsonb(v_lcl_skipped), 'idempotent', true);
  END IF;
  -- 548: todas as caixas do grupo dispensadas, nenhuma em Invoice: não há o
  -- que emitir, e não é uma Invoice existente (antes devolvia `existing` sem
  -- Invoice, e a tela dizia "já estão em Invoice emitida ou paga").
  IF v_uncovered = 0 AND EXISTS (
       SELECT 1 FROM public._demurrage_waived_container_keys(v_voyage_id, v_customer_id)) THEN
    RETURN jsonb_build_object('status', 'waived', 'anchor_bl_id', v_anchor, 'group_bl_ids', to_jsonb(v_group),
      'idempotent', true);
  END IF;

  -- 517: a caixa dispensada ainda fora não segura o grupo.
  IF EXISTS (
    SELECT 1 FROM public.bl_containers AS c
    WHERE c.bl_id = ANY(v_group) AND c.ownership IS DISTINCT FROM 'SOC' AND c.return_date IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public._demurrage_waived_container_keys(v_voyage_id, v_customer_id) AS waived
        WHERE waived.container_key = upper(btrim(c.container_number)))
  ) THEN
    RETURN jsonb_build_object('status', 'waiting_return', 'anchor_bl_id', v_anchor, 'group_bl_ids', to_jsonb(v_group));
  END IF;

  SELECT COALESCE(array_agg(pick.id ORDER BY pick.id), ARRAY[]::bigint[]) INTO v_container_ids
  FROM (
    SELECT DISTINCT ON (upper(btrim(c.container_number))) c.id
    FROM public.bl_containers AS c
    WHERE c.bl_id = ANY(v_group) AND c.ownership IS DISTINCT FROM 'SOC'
      AND NULLIF(btrim(c.container_number), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public._demurrage_billed_container_keys(v_voyage_id, v_customer_id) AS billed
        WHERE billed.container_key = upper(btrim(c.container_number))
      )
      AND upper(btrim(c.container_number)) <> ALL(v_lcl_skipped)
    ORDER BY upper(btrim(c.container_number)), (c.bl_id = v_anchor) DESC, c.id
  ) AS pick;
  IF cardinality(v_container_ids) = 0 THEN
    RETURN jsonb_build_object('status', 'no_containers', 'anchor_bl_id', v_anchor);
  END IF;

  v_calculation := public._calculate_demurrage_invoice_authoritative(
    v_anchor, v_container_ids, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  IF COALESCE((v_calculation->>'total_usd')::numeric, 0) <= 0 THEN
    RETURN jsonb_build_object('status', 'no_overstay', 'anchor_bl_id', v_anchor);
  END IF;

  -- 472 (DEM-D13): a Invoice de Demurrage segue a trava das faturas: CE
  -- Mercante e Gate de faturamento do Portal aberto. Sem eles, nada é emitido
  -- (a fila não falha); o CE ou a abertura do gate enfileira de novo.
  v_block := public._demurrage_issue_block_reason(v_anchor);
  IF v_block IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'blocked', 'reason', v_block, 'anchor_bl_id', v_anchor);
  END IF;

  v_doc := COALESCE(NULLIF(btrim(p_doc_number), ''), public.next_demurrage_doc_number());
  RETURN public.create_demurrage_invoice_authoritative(v_doc, v_anchor, v_customer_id, v_container_ids, NULL)
    || jsonb_build_object('status', 'issued', 'anchor_bl_id', v_anchor, 'group_bl_ids', to_jsonb(v_group),
         'complementary', COALESCE(cardinality(v_covering), 0) > 0,
         'covering_invoice_ids', to_jsonb(COALESCE(v_covering, ARRAY[]::bigint[])));
END;
$function$;

-- Corpo da 531. A Invoice traz todo container sem Invoice do grupo, menos o
-- de veículo LCL que ela não cobra (a emissão automática o deixa de fora).
CREATE OR REPLACE FUNCTION public.assert_demurrage_invoice_complete(p_invoice_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text;
  v_customer_id bigint;
  v_voyage_id bigint;
  v_group text[];
  v_expected integer;
  v_items integer;
BEGIN
  SELECT di.bl_id, di.customer_id, b.voyage_id INTO v_bl_id, v_customer_id, v_voyage_id
  FROM public.demurrage_invoices AS di
  LEFT JOIN public.bls AS b ON b.id = di.bl_id
  WHERE di.id = p_invoice_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM public.demurrage_invoices WHERE id = p_invoice_id AND status IN ('issued', 'paid')) THEN
    -- Mesma trava da emissão (214): duas transações não cobram a mesma caixa.
    PERFORM public._lock_demurrage_box_billing(v_voyage_id, v_customer_id);
    v_group := public.demurrage_group_bl_ids(v_bl_id);
    -- Caixas que esta Invoice deve trazer: as não-SOC do grupo que nenhuma
    -- outra Invoice viva da Viagem e do Cliente cobre (complementar, 214).
    SELECT count(DISTINCT upper(btrim(c.container_number))) INTO v_expected
    FROM public.bl_containers AS c
    WHERE c.bl_id = ANY(v_group) AND c.ownership IS DISTINCT FROM 'SOC'
      AND NOT EXISTS (
        SELECT 1 FROM public._demurrage_billed_container_keys(v_voyage_id, v_customer_id, p_invoice_id) AS billed
        WHERE billed.container_key = upper(btrim(c.container_number))
      )
      -- 593: o veículo LCL fora desta Invoice espera o Gerar Invoice.
      AND (EXISTS (
             SELECT 1 FROM public.demurrage_invoice_items AS own
              WHERE own.invoice_id = p_invoice_id
                AND upper(btrim(own.container_number)) = upper(btrim(c.container_number)))
           OR NOT public._demurrage_lcl_vehicle_exempt_box(v_voyage_id, v_customer_id, v_group, upper(btrim(c.container_number))));
    IF v_expected = 0 THEN
      IF EXISTS (SELECT 1 FROM public.demurrage_invoice_items WHERE invoice_id = p_invoice_id) THEN
        RAISE EXCEPTION 'Demurrage do B/L % possui itens sem containers físicos correspondentes ou já cobrados em outra Invoice.', v_bl_id USING ERRCODE = '23514';
      END IF;
      RETURN;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.bl_containers AS c
      WHERE c.bl_id = ANY(v_group) AND c.return_date IS NULL AND c.ownership IS DISTINCT FROM 'SOC'
        -- 531: a caixa dispensada ainda fora não segura o grupo (517).
        AND NOT EXISTS (SELECT 1 FROM public._demurrage_waived_container_keys(v_voyage_id, v_customer_id) AS waived
                         WHERE waived.container_key = upper(btrim(c.container_number)))
    ) OR EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      WHERE item.invoice_id = p_invoice_id AND item.return_date IS NULL
    ) THEN
      RAISE EXCEPTION 'Demurrage só pode ser emitida após a devolução de todos os containers do B/L %.', v_bl_id USING ERRCODE = '23514';
    END IF;

    SELECT count(DISTINCT upper(btrim(item.container_number))) INTO v_items
    FROM public.demurrage_invoice_items AS item WHERE item.invoice_id = p_invoice_id;
    IF v_items <> v_expected OR EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      WHERE item.invoice_id = p_invoice_id
      GROUP BY upper(btrim(item.container_number))
      HAVING count(*) > 1
    ) OR EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      WHERE item.invoice_id = p_invoice_id
        AND NOT EXISTS (
          SELECT 1 FROM public.bl_containers AS bc
          WHERE bc.id = item.container_id AND bc.bl_id = ANY(v_group) AND bc.ownership IS DISTINCT FROM 'SOC'
        )
    ) OR EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      JOIN public._demurrage_billed_container_keys(v_voyage_id, v_customer_id, p_invoice_id) AS billed
        ON billed.container_key = upper(btrim(item.container_number))
      WHERE item.invoice_id = p_invoice_id
    ) THEN
      RAISE EXCEPTION 'Demurrage do B/L % não contém o conjunto completo e exclusivo de containers.', v_bl_id USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$function$;

-- Corpo da 546. O executor da fila é o único caminho automático de emissão
-- (datas, CE, troca de Cliente, rotina e reemissão): liga a marca que deixa o
-- veículo LCL de fora.
CREATE OR REPLACE FUNCTION public._run_import_effect_demurrage(p_effect_id bigint, p_bl_id text, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl record;
  v_group jsonb;
  v_previous_auto text := current_setting('vela.demurrage_auto_issue', true);
  v_result jsonb;
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
  -- 593: a emissão automática não cobra o veículo LCL (só o Gerar Invoice).
  PERFORM set_config('vela.demurrage_auto_issue', 'on', true);
  v_result := public.issue_demurrage_invoice_for_bl(p_bl_id, NULL);
  PERFORM set_config('vela.demurrage_auto_issue', COALESCE(v_previous_auto, ''), true);
  RETURN v_result;
END;
$function$;

-- ─── 5. Cancelar o B/L e a condição do B/L ──────────────────────────────

-- Corpo da 569. O container de veículo LCL com a cobrança suspensa não
-- segura o cancelamento do B/L (nada se perde: ele só é cobrado à mão).
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
       -- 593: veículo LCL, cobrança suspensa.
       AND NOT public._demurrage_lcl_vehicle_exempt_box(b.voyage_id, b.customer_id, ARRAY[b.id], upper(btrim(c.container_number)))
  ) THEN
    v_reasons := array_append(v_reasons, 'Demurrage correndo ou a emitir: devolva o container e emita a Invoice, ou dispense a cobrança na Demurrage');
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
       -- 593: veículo LCL, cobrança suspensa.
       AND NOT public._demurrage_lcl_vehicle_exempt_box(b.voyage_id, b.customer_id, ARRAY[b.id], upper(btrim(c.container_number)))
  ) THEN
    v_reasons := array_append(v_reasons, 'Demurrage travada: vincule o Cliente ou cadastre a tarifa e emita a Invoice, ou dispense a cobrança na Demurrage');
  END IF;
  RETURN v_reasons;
END;
$function$;

-- Corpo da 573. O free time do veículo LCL é fixo: a condição do B/L muda só
-- as diárias (o free time gravado antes fica e não vale).
CREATE OR REPLACE FUNCTION public.save_bl_demurrage_config(p_bl_id text, p_expected_updated_at timestamp with time zone, p_free_time_override integer, p_rate_p1_usd numeric, p_rate_p2_usd numeric, p_changed_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.bls%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para configurar demurrage.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_bl FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BL % não encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_updated_at IS NOT NULL AND v_bl.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'BL % foi alterado por outro usuário; recarregue antes de salvar', p_bl_id
      USING ERRCODE = 'PT409';
  END IF;
  -- 593
  IF p_free_time_override IS NOT NULL
     AND p_free_time_override IS DISTINCT FROM v_bl.free_time_override
     AND public._bl_is_lcl_vehicle(p_bl_id) THEN
    RAISE EXCEPTION 'O B/L % é de veículo LCL: o free time é fixo de % dias. Deixe o free time em branco.',
      p_bl_id, public._demurrage_lcl_vehicle_free_days() USING ERRCODE = '22023';
  END IF;

  UPDATE public.bls
  SET
    free_time_override = p_free_time_override,
    demurrage_rate_override_p1_usd = p_rate_p1_usd,
    demurrage_rate_override_p2_usd = p_rate_p2_usd
  WHERE id = p_bl_id;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, justification
  )
  SELECT 'bl', p_bl_id, change.field_name, change.old_value, change.new_value,
         p_changed_by, 'Config de demurrage (Faturamento).'
  FROM (VALUES
    ('free_time_override', v_bl.free_time_override::TEXT, p_free_time_override::TEXT),
    ('demurrage_rate_override_p1_usd', v_bl.demurrage_rate_override_p1_usd::TEXT, p_rate_p1_usd::TEXT),
    ('demurrage_rate_override_p2_usd', v_bl.demurrage_rate_override_p2_usd::TEXT, p_rate_p2_usd::TEXT)
  ) AS change(field_name, old_value, new_value)
  WHERE change.old_value IS DISTINCT FROM change.new_value;
END;
$function$;

-- ─── 6. Gatilhos: Movement To, modalidade e veículos mudam o free time ──

-- Corpo da 515, com Movement To e modalidade.
CREATE OR REPLACE FUNCTION public._bls_refresh_demurrage_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.free_time_override IS DISTINCT FROM OLD.free_time_override
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     -- 593: o B/L passa a ser (ou deixa de ser) de veículo LCL.
     OR NEW.movement_to IS DISTINCT FROM OLD.movement_to
     OR NEW.cargo_mode IS DISTINCT FROM OLD.cargo_mode THEN
    PERFORM public._refresh_demurrage_status_of_bls(ARRAY[NEW.id]);
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_bls_refresh_demurrage_status ON public.bls;
CREATE TRIGGER trg_bls_refresh_demurrage_status
  AFTER UPDATE OF free_time_override, customer_id, movement_to, cargo_mode ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public._bls_refresh_demurrage_status();

-- Gatilhos da 527, com Movement To e modalidade (a divisão do grupo muda).
DROP TRIGGER IF EXISTS trg_bls_travado_alerts ON public.bls;
CREATE TRIGGER trg_bls_travado_alerts
  AFTER UPDATE OF ce_mercante, customer_id, cancelled_at, voyage_id, free_time_override, movement_to, cargo_mode ON public.bls
  FOR EACH ROW
  WHEN (NEW.ce_mercante IS DISTINCT FROM OLD.ce_mercante
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
     OR NEW.voyage_id IS DISTINCT FROM OLD.voyage_id
     OR NEW.free_time_override IS DISTINCT FROM OLD.free_time_override
     OR NEW.movement_to IS DISTINCT FROM OLD.movement_to
     OR NEW.cargo_mode IS DISTINCT FROM OLD.cargo_mode)
  EXECUTE FUNCTION public._bls_travado_alerts();
DROP TRIGGER IF EXISTS trg_bls_travado_flush ON public.bls;
CREATE CONSTRAINT TRIGGER trg_bls_travado_flush
  AFTER UPDATE OF ce_mercante, customer_id, cancelled_at, voyage_id, free_time_override, movement_to, cargo_mode ON public.bls
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.ce_mercante IS DISTINCT FROM OLD.ce_mercante
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
     OR NEW.voyage_id IS DISTINCT FROM OLD.voyage_id
     OR NEW.free_time_override IS DISTINCT FROM OLD.free_time_override
     OR NEW.movement_to IS DISTINCT FROM OLD.movement_to
     OR NEW.cargo_mode IS DISTINCT FROM OLD.cargo_mode)
  EXECUTE FUNCTION public._demurrage_travado_flush();

-- Veículo que entra, sai ou troca de B/L: o B/L pode passar a ser (ou deixar
-- de ser) de veículo LCL. Refaz o status gravado e anota a Viagem para o
-- Alerta de Demurrage travada, como a mudança do B/L.
CREATE OR REPLACE FUNCTION public._vehicles_refresh_demurrage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_ids text[];
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.bl_id IS NOT DISTINCT FROM OLD.bl_id THEN
    RETURN NULL;
  END IF;
  v_bl_ids := array_remove(ARRAY[
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.bl_id END,
    CASE WHEN TG_OP IN ('DELETE', 'UPDATE') THEN OLD.bl_id END], NULL);
  PERFORM public._refresh_demurrage_status_of_bls(v_bl_ids);
  PERFORM public._demurrage_travado_mark(ARRAY(SELECT b.voyage_id FROM public.bls AS b WHERE b.id = ANY (v_bl_ids)));
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._vehicles_refresh_demurrage() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_vehicles_refresh_demurrage ON public.vehicles;
CREATE TRIGGER trg_vehicles_refresh_demurrage
  AFTER INSERT OR DELETE OR UPDATE OF bl_id ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public._vehicles_refresh_demurrage();
DROP TRIGGER IF EXISTS trg_vehicles_travado_flush_ins ON public.vehicles;
CREATE CONSTRAINT TRIGGER trg_vehicles_travado_flush_ins
  AFTER INSERT ON public.vehicles DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public._demurrage_travado_flush();
DROP TRIGGER IF EXISTS trg_vehicles_travado_flush_del ON public.vehicles;
CREATE CONSTRAINT TRIGGER trg_vehicles_travado_flush_del
  AFTER DELETE ON public.vehicles DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public._demurrage_travado_flush();
DROP TRIGGER IF EXISTS trg_vehicles_travado_flush_upd ON public.vehicles;
CREATE CONSTRAINT TRIGGER trg_vehicles_travado_flush_upd
  AFTER UPDATE OF bl_id ON public.vehicles DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.bl_id IS DISTINCT FROM OLD.bl_id)
  EXECUTE FUNCTION public._demurrage_travado_flush();

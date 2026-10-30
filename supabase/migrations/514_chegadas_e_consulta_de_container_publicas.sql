-- 514: Chegadas e saídas e Consulta de container públicas no fwlog.com.br
-- (ADR 0112; supersede em parte a ADR 0090).
--
-- Problema:
--   O site institucional fwlog.com.br vai mostrar, sem login, o quadro
--   "Chegadas e saídas" do Portal e uma consulta por número de container para
--   as transportadoras do Cliente, que não têm conta. A ADR 0090 proíbe
--   leitura pré-login no banco; a ADR 0112 mantém isso (nenhuma função para
--   `anon`) e abre a leitura só por duas Edge Functions com `service_role`,
--   Turnstile e limite de tentativas.
--
-- Mudança:
--   1. `_ship_schedule_core()`: o corpo de `portal_ship_schedule()` (337),
--      sem a guarda de chamador, sem grant de cliente. `portal_ship_schedule()`
--      mantém a guarda da 337 e passa a ler o núcleo: assinatura, retorno,
--      grants e comportamento não mudam (teste de paridade).
--   2. `_public_schedule_port_codes()`: os portos das colunas do quadro
--      (`PORTAL_SCHEDULE_LANES`, src/services/portalScheduleLanes.ts), já com
--      Suape (BRSUA), decisão A5 do dono de 2026-10-29. O teste local-pg
--      compara as duas listas.
--   3. `public_ship_schedule()`: só `service_role`. Mesmo núcleo, filtrado no
--      servidor pelos portos do quadro, sem `voyage_id` (chave opaca
--      `voyage_key`, a posição da viagem nesta resposta) e com teto de 100
--      viagens.
--   4. `_public_lookup_port_codes()`: portos atendidos da consulta, os mesmos
--      de `portalServicePorts` (src/services/informationPort.ts): Salvador,
--      Vitória e Suape.
--   5. `_iso6346_check_digit_valid(text)` e `public_container_lookup(text)`:
--      só `service_role`. Número normalizado, formato ISO 6346 e dígito
--      verificador conferidos antes de ler tabela; igualdade exata no número
--      normalizado (índice da 163); B/L cancelado, Viagem cancelada, porto
--      fora da lista, container SOC e fora da janela de 90 dias não voltam;
--      no máximo uma linha, com a projeção fechada da ADR 0112.
--
-- Não reescreve nem apaga linhas.
-- Rollback: `DROP FUNCTION` das cinco funções novas e recriar
-- `portal_ship_schedule()` com o corpo da 337.

-- 1. Núcleo da programação -------------------------------------------------

CREATE OR REPLACE FUNCTION public._ship_schedule_core()
 RETURNS TABLE(voyage_id bigint, vessel_name text, voyage text, imo_number text, port_code text, kind text, date_value text, actual_value text, omitted boolean)
 LANGUAGE sql
 STABLE
 SET search_path = public, pg_temp
AS $function$
  -- Corpo de `portal_ship_schedule()` da 337, sem mudança: Viagens ativas com
  -- `show_on_portal`; datas pelo último valor da trilha das escalas; escala de
  -- POD retirada sai, omitida aparece "Omitida"; ATD no POL e ATA no POD.
  WITH visible AS (
    SELECT v.id, ve.name AS vessel_name, v.voyage_number, ve.imo
    FROM public.voyages v
    JOIN public.vessels ve ON ve.id = v.vessel_id
    WHERE v.show_on_portal AND v.status = 'active'
  ),
  latest AS (
    SELECT DISTINCT ON (a.entity_type, a.entity_id, a.field_name)
      a.entity_type, a.entity_id, a.field_name, a.new_value
    FROM public.audit_logs a
    WHERE a.entity_type IN ('voyage_pol_schedule', 'voyage_pod_schedule')
    ORDER BY a.entity_type, a.entity_id, a.field_name, a.changed_at DESC
  ),
  deleted_pods AS (
    SELECT entity_id FROM latest
    WHERE entity_type = 'voyage_pod_schedule'
      AND field_name = 'deleted' AND new_value = 'true'
  ),
  omitted_pods AS (
    SELECT entity_id FROM latest
    WHERE entity_type = 'voyage_pod_schedule'
      AND field_name = 'omitted' AND new_value = 'true'
  ),
  pol AS (
    SELECT split_part(entity_id, '::', 1)::bigint AS vid,
           split_part(entity_id, '::', 2) AS port_code,
           new_value AS etd
    FROM latest
    WHERE entity_type = 'voyage_pol_schedule'
      AND field_name = 'etd' AND new_value IS NOT NULL
  ),
  pol_atd AS (
    SELECT split_part(entity_id, '::', 1)::bigint AS vid,
           split_part(entity_id, '::', 2) AS port_code,
           new_value AS atd
    FROM latest
    WHERE entity_type = 'voyage_pol_schedule'
      AND field_name = 'atd' AND new_value IS NOT NULL
  ),
  pod AS (
    SELECT split_part(l.entity_id, '::', 1)::bigint AS vid,
           split_part(l.entity_id, '::', 2) AS port_code,
           MAX(l.new_value) FILTER (WHERE l.field_name = 'eta') AS eta,
           (o.entity_id IS NOT NULL) AS omitted
    FROM latest l
    LEFT JOIN deleted_pods d ON d.entity_id = l.entity_id
    LEFT JOIN omitted_pods o ON o.entity_id = l.entity_id
    WHERE l.entity_type = 'voyage_pod_schedule'
      AND d.entity_id IS NULL
      AND (
        (l.field_name = 'eta' AND l.new_value IS NOT NULL)
        OR o.entity_id IS NOT NULL
      )
    GROUP BY l.entity_id, o.entity_id
  ),
  pod_ata AS (
    SELECT split_part(l.entity_id, '::', 1)::bigint AS vid,
           split_part(l.entity_id, '::', 2) AS port_code,
           l.new_value AS ata
    FROM latest l
    LEFT JOIN deleted_pods d ON d.entity_id = l.entity_id
    WHERE l.entity_type = 'voyage_pod_schedule'
      AND l.field_name = 'ata'
      AND l.new_value IS NOT NULL
      AND d.entity_id IS NULL
  )
  SELECT visible.id, visible.vessel_name, visible.voyage_number, visible.imo,
         pol.port_code, 'pol'::text, pol.etd, pol_atd.atd, false
  FROM visible
  JOIN pol ON pol.vid = visible.id
  LEFT JOIN pol_atd ON pol_atd.vid = pol.vid AND pol_atd.port_code = pol.port_code
  UNION ALL
  SELECT visible.id, visible.vessel_name, visible.voyage_number, visible.imo,
         pod.port_code, 'pod'::text, pod.eta, pod_ata.ata, pod.omitted
  FROM visible
  JOIN pod ON pod.vid = visible.id
  LEFT JOIN pod_ata ON pod_ata.vid = pod.vid AND pod_ata.port_code = pod.port_code;
$function$;

REVOKE ALL ON FUNCTION public._ship_schedule_core() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_ship_schedule()
 RETURNS TABLE(voyage_id bigint, vessel_name text, voyage text, imo_number text, port_code text, kind text, date_value text, actual_value text, omitted boolean)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
BEGIN
  -- Guarda da 337: interno ativo, `service_role` ou conta ativa do Portal.
  IF NOT public.is_active_read_user() AND auth.role() IS DISTINCT FROM 'service_role' THEN
    -- Recusa com 28000 quem não tem conta ativa do Portal.
    PERFORM public.current_portal_customer_id();
  END IF;

  RETURN QUERY SELECT * FROM public._ship_schedule_core();
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.portal_ship_schedule() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_ship_schedule() TO authenticated, service_role;

-- 2. Portos do quadro ------------------------------------------------------

CREATE OR REPLACE FUNCTION public._public_schedule_port_codes()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path = ''
AS $function$
  -- Mesma lista e ordem de `PORTAL_SCHEDULE_LANES` (portalScheduleLanes.ts);
  -- o teste `publicFwlog.local-pg.test.ts` falha se divergirem.
  SELECT ARRAY['CNTAO', 'CNSHA', 'CNTAC', 'CNNGB', 'CNNSA', 'BRSSA', 'BRVIX', 'BRPEC', 'BRSUA']::text[];
$function$;

REVOKE ALL ON FUNCTION public._public_schedule_port_codes() FROM PUBLIC, anon, authenticated;

-- 3. Quadro público --------------------------------------------------------

CREATE OR REPLACE FUNCTION public.public_ship_schedule()
 RETURNS TABLE(voyage_key integer, vessel_name text, voyage text, imo text, port_code text, kind text, date_value text, actual_value text, omitted boolean)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  -- Lista positiva da ADR 0112: sem `voyage_id`. `voyage_key` é a posição da
  -- Viagem nesta resposta (a mais nova primeiro) e só agrupa as escalas; não
  -- identifica nada fora dela. Porto fora do quadro sai aqui, não no navegador.
  -- ponytail: teto fixo de 100 Viagens (hoje são 16 navios); acima disso as
  -- mais antigas saem. Upgrade: paginar ou recortar por data, com ADR.
  WITH lane_rows AS (
    SELECT core.*
    FROM public._ship_schedule_core() AS core
    WHERE core.port_code = ANY (public._public_schedule_port_codes())
  ),
  ranked AS (
    SELECT lane_rows.*, dense_rank() OVER (ORDER BY lane_rows.voyage_id DESC)::integer AS rank
    FROM lane_rows
  )
  SELECT ranked.rank, ranked.vessel_name, ranked.voyage, ranked.imo_number,
         ranked.port_code, ranked.kind, ranked.date_value, ranked.actual_value, ranked.omitted
  FROM ranked
  WHERE ranked.rank <= 100
  ORDER BY ranked.rank, ranked.kind DESC, ranked.port_code;
$function$;

REVOKE ALL ON FUNCTION public.public_ship_schedule() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_ship_schedule() TO service_role;

-- 4. Portos atendidos da consulta ------------------------------------------

CREATE OR REPLACE FUNCTION public._public_lookup_port_codes()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path = ''
AS $function$
  -- Mesmos portos de `portalServicePorts` (informationPort.ts), os atendidos
  -- nas consultas de Taxas Locais e Devolução do Portal; o teste compara.
  SELECT ARRAY['BRVIX', 'BRSSA', 'BRSUA']::text[];
$function$;

REVOKE ALL ON FUNCTION public._public_lookup_port_codes() FROM PUBLIC, anon, authenticated;

-- 5. Consulta de container -------------------------------------------------

CREATE OR REPLACE FUNCTION public._iso6346_check_digit_valid(p_number text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path = ''
AS $function$
DECLARE
  -- Valores das letras na ISO 6346: de A=10 em diante, pulando os múltiplos
  -- de 11 (11, 22, 33).
  v_letters CONSTANT text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  v_letter_values CONSTANT integer[] := ARRAY[10,12,13,14,15,16,17,18,19,20,21,23,24,25,26,27,28,29,30,31,32,34,35,36,37,38];
  v_sum integer := 0;
  v_char text;
  v_value integer;
BEGIN
  IF p_number IS NULL OR p_number !~ '^[A-Z]{3}[UJZ][0-9]{6}[0-9]$' THEN
    RETURN false;
  END IF;
  FOR i IN 1..10 LOOP
    v_char := substr(p_number, i, 1);
    IF i <= 4 THEN
      v_value := v_letter_values[strpos(v_letters, v_char)];
    ELSE
      v_value := v_char::integer;
    END IF;
    v_sum := v_sum + v_value * (1 << (i - 1));
  END LOOP;
  RETURN (v_sum % 11) % 10 = substr(p_number, 11, 1)::integer;
END;
$function$;

REVOKE ALL ON FUNCTION public._iso6346_check_digit_valid(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.public_container_lookup(p_number text)
 RETURNS TABLE(container_number text, container_type text, vessel_name text, voyage text, discharge_port text, discharge_date date, return_date date, free_time_days integer, free_time_until date, situation text)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE
  v_number text := upper(regexp_replace(COALESCE(p_number, ''), '[^A-Za-z0-9]', '', 'g'));
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  -- Formato e dígito verificador antes de qualquer tabela: o que não é número
  -- de container não chega ao índice. Sem linha = "não encontrado", igual para
  -- todos os motivos (ADR 0112).
  IF length(COALESCE(p_number, '')) > 64 OR NOT public._iso6346_check_digit_valid(v_number) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      c.id,
      c.bl_id,
      c.type,
      c.discharge_date,
      c.return_date,
      c.ownership,
      v.id AS voyage_id,
      v.voyage_number,
      ve.name AS vessel_name,
      public.normalize_port_code(b.pod) AS pod_code,
      -- Data de referência da janela (dia de Brasília): descarga; sem ela, a
      -- ATA e depois a ETA da escala do POD; sem escala, a ATA e a ETA gerais.
      COALESCE(
        c.discharge_date,
        (SELECT max(left(btrim(s.value ->> 'ata'), 10)::date)
           FROM jsonb_each(COALESCE(v.pod_schedule_snapshot, '{}'::jsonb)) AS s
          WHERE jsonb_typeof(s.value) = 'object'
            AND public.normalize_port_code(s.key) = public.normalize_port_code(b.pod)
            AND btrim(s.value ->> 'ata') ~ '^\d{4}-\d{2}-\d{2}'),
        (SELECT min(left(btrim(s.value ->> 'eta'), 10)::date)
           FROM jsonb_each(COALESCE(v.pod_schedule_snapshot, '{}'::jsonb)) AS s
          WHERE jsonb_typeof(s.value) = 'object'
            AND public.normalize_port_code(s.key) = public.normalize_port_code(b.pod)
            AND btrim(s.value ->> 'eta') ~ '^\d{4}-\d{2}-\d{2}'),
        (v.ata AT TIME ZONE 'America/Sao_Paulo')::date,
        (v.eta AT TIME ZONE 'America/Sao_Paulo')::date
      ) AS reference_date
    FROM public.bl_containers AS c
    JOIN public.bls AS b ON b.id = c.bl_id
    JOIN public.voyages AS v ON v.id = b.voyage_id
    JOIN public.vessels AS ve ON ve.id = v.vessel_id
    -- Igualdade exata no número normalizado (índice da 163); nunca prefixo.
    WHERE upper(btrim(c.container_number)) = v_number
      AND b.cancelled_at IS NULL
      AND v.status IS DISTINCT FROM 'cancelled'
      AND upper(COALESCE(c.ownership, '')) <> 'SOC'
  ),
  eligible AS (
    SELECT candidates.*
    FROM candidates
    WHERE candidates.pod_code = ANY (public._public_lookup_port_codes())
      AND candidates.reference_date >= v_today - 90
  ),
  picked AS (
    -- Viagem mais recente; na mesma Viagem, o B/L de menor número e depois o
    -- menor id do container, a régua do âncora da Invoice de Demurrage
    -- (`issue_demurrage_invoice_for_bl`): container rateado entre B/Ls
    -- responde sempre pela mesma linha.
    SELECT eligible.*
    FROM eligible
    ORDER BY eligible.reference_date DESC, eligible.voyage_id DESC, eligible.bl_id, eligible.id
    LIMIT 1
  ),
  priced AS (
    SELECT picked.*,
           CASE WHEN picked.discharge_date IS NULL THEN NULL
                ELSE public._container_free_days(picked.bl_id, picked.type, picked.discharge_date)
           END AS free_days
    FROM picked
  )
  SELECT
    v_number,
    priced.type,
    priced.vessel_name,
    priced.voyage_number,
    priced.pod_code,
    priced.discharge_date,
    priced.return_date,
    priced.free_days,
    priced.discharge_date + priced.free_days,
    CASE
      WHEN priced.return_date IS NOT NULL THEN 'devolvido'
      WHEN priced.discharge_date IS NULL THEN 'aguardando_descarga'
      WHEN priced.free_days IS NULL THEN 'prazo_a_confirmar'
      -- Mesma regra do status de Demurrage (`_container_demurrage_status`, 211).
      WHEN public._container_demurrage_status(priced.bl_id, priced.type, priced.discharge_date, priced.return_date, priced.ownership) = 'overdue'
        THEN 'prazo_vencido'
      ELSE 'no_prazo'
    END
  FROM priced;
END;
$function$;

REVOKE ALL ON FUNCTION public.public_container_lookup(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_container_lookup(text) TO service_role;

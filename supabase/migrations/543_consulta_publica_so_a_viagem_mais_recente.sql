-- 543: a Consulta de container pública responde só pela Viagem mais recente do
-- número (ADR 0114, decisão 3: "Uma linha, sempre a da Viagem mais recente
-- daquele número, nunca histórico"). Achado da revisão da PR #1119.
--
-- Problema:
--   `public_container_lookup(text)` (542) aplicava CE Mercante, SOC, porto da
--   consulta e janela de 90 dias antes de escolher a Viagem mais recente. Se a
--   Viagem mais nova do número ficava fora, a resposta caía na anterior: um
--   container descarregado em Salvador há 200 dias sem devolução gravada e,
--   depois, descarregado de novo e devolvido há 95 dias aparecia no site como
--   "Free time vencido" da Viagem antiga. O mesmo com a Viagem nova de B/L ainda
--   sem CE Mercante (aparecia a anterior, "Devolvido") ou num porto fora da
--   consulta (aparecia a anterior, de Salvador).
--
-- Mudança:
--   A função escolhe primeiro a Viagem mais recente do número entre as linhas
--   de B/L e Viagem não cancelados (data de referência mais nova; no empate, a
--   Viagem de maior id) e só então aplica, às linhas dessa Viagem, CE Mercante
--   (`bl_has_portal_release`), SOC, porto da consulta e janela. Sem linha que
--   passe, a resposta é vazia ("não encontrado"), nunca a Viagem anterior. Na
--   Viagem escolhida, o âncora continua o mesmo: data de referência, B/L de
--   menor número e container de menor id. Assinatura, retorno, lista positiva
--   de campos e grants não mudam.
--
-- Só redefine a função; não reescreve nem apaga linhas.
-- Rollback: reaplicar `public_container_lookup(text)` da migration 542.

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
  -- todos os motivos (ADR 0114).
  IF length(COALESCE(p_number, '')) > 64 OR NOT public._iso6346_check_digit_valid(v_number) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    -- As viagens que o container fez de fato: todas as linhas do número em
    -- B/L e Viagem não cancelados, sem nenhum outro recorte ainda.
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
      -- Data de referência (dia de Brasília): descarga; sem ela, a ATA e depois
      -- a ETA da escala do POD; sem escala, a ATA e a ETA gerais.
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
  ),
  newest AS (
    -- A Viagem mais recente do número, antes de qualquer recorte: data de
    -- referência mais nova e, no empate, a Viagem de maior id.
    -- ponytail: linha sem nenhuma data (sem descarga, escala, ATA nem ETA)
    -- não conta, como na janela (decisão 4 da ADR 0114); uma Viagem nova ainda
    -- sem data deixa a anterior responder. Upgrade, se aparecer: tratar como a
    -- mais recente a Viagem sem data de id maior que o da mais nova datada
    -- (resposta vazia).
    SELECT candidates.voyage_id
    FROM candidates
    WHERE candidates.reference_date IS NOT NULL
    ORDER BY candidates.reference_date DESC, candidates.voyage_id DESC
    LIMIT 1
  ),
  eligible AS (
    -- Os recortes valem só para as linhas dessa Viagem. Nenhuma passa: a
    -- resposta é vazia, nunca a Viagem anterior.
    SELECT candidates.*
    FROM candidates
    JOIN newest ON newest.voyage_id = candidates.voyage_id
    -- Só B/L liberado no Portal (com CE Mercante, `bl_has_portal_release`):
    -- o site nunca mostra carga que o próprio Cliente ainda não vê
    -- (decisão do dono de 2026-10-30).
    WHERE public.bl_has_portal_release(candidates.bl_id)
      AND upper(COALESCE(candidates.ownership, '')) <> 'SOC'
      AND candidates.pod_code = ANY (public._public_lookup_port_codes())
      -- Janela: referência nos últimos 90 dias (ou futura), ou container já
      -- descarregado que ainda não voltou, qualquer que seja a idade.
      AND (candidates.reference_date >= v_today - 90
           OR (candidates.discharge_date IS NOT NULL AND candidates.return_date IS NULL))
  ),
  picked AS (
    -- Na Viagem escolhida, o B/L de menor número e depois o menor id do
    -- container, a régua do âncora da Invoice de Demurrage
    -- (`issue_demurrage_invoice_for_bl`): container rateado entre B/Ls
    -- responde sempre pela mesma linha.
    SELECT eligible.*
    FROM eligible
    ORDER BY eligible.reference_date DESC, eligible.bl_id, eligible.id
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

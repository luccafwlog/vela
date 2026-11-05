-- 592: Manifesto Mercante de carga separado por natureza, contêiner ou carga
-- solta (decisão do dono de 2026-11-05). Antes, a rota com B/L de contêiner e
-- de carga solta (CNTR/BB) era uma linha só em Rotas e Manifestos: os números
-- dos dois Manifestos apareciam juntos, sem dizer qual era de qual natureza.
-- Daqui para frente, todo Manifesto de carga é só de contêiner ou só de carga
-- solta, mesmo na mesma rota, e o EDI Mercante de cada um sai só com aquela
-- natureza. O B/L misto fica no Manifesto de carga solta, como já era no EDI
-- (ADR 0116, item 8): o arquivo de contêiner só leva B/L de contêiner.
--
-- 1. `manifestos_mercante.cargo_mode` (`container` ou `carga_solta`; nulo só
--    na natureza `vazio`), com a checagem `manifestos_mercante_cargo_mode_check`.
--    `manifesto_cargo_mode_of_bl(text)` diz a natureza do Manifesto de um B/L
--    (`misto` → `carga_solta`) e `manifesto_cargo_mode_label(text)` dá o nome
--    para as recusas.
-- 2. `_upsert_route_manifesto` (redefinida da 396) recebe a natureza
--    `container`, `carga_solta` ou `vazio`; `carga` sem a natureza é recusada.
--    Número já cadastrado com a outra natureza: "O Manifesto Mercante N é de
--    carga solta (não de contêiner)…" (P0012).
-- 3. Planilha de CE (`_analyze_ce_mercante_rows`, da 486, e
--    `apply_ce_mercante_rows_atomic_legacy_189`, da 509): a natureza vem dos
--    B/Ls; planilha com B/L de contêiner e de carga solta é recusada inteira, e
--    número de Manifesto da outra natureza também.
-- 4. Mover (`move_bls_to_manifesto_mercante`, da 509): recusa a seleção com as
--    duas naturezas e o Manifesto da outra natureza.
-- 5. Informar/Editar (`set_voyage_route_ce_master`, da 573): `p_cargo_mode`
--    `container`, `carga_solta` ou `vazios`, um número por linha; o espelho
--    `voyage_route_ce_master` ganha a linha `carga_solta` e os gatilhos de
--    espelho (da 181) passam a mapear a natureza.
-- 6. Vínculo do B/L (`guard_bl_manifesto_cargo_mode`, gatilho novo em `bls`):
--    o B/L só entra num Manifesto da sua natureza (recusa 22023). Se a natureza do B/L muda (contêiner que ganha carga solta e
--    vira misto, misto que perde a carga solta), ele sai do Manifesto, com o
--    Histórico, e com CE abre o Alerta "CE fora do Manifesto da rota".
-- 7. Reativação (`manifesto_follows_ce_and_cancel`, da 396): o B/L volta ao
--    Manifesto guardado só se ele ainda é da natureza do B/L.
--
-- Plano de preservação: a migration não apaga linha. (a) Em
-- `manifestos_mercante`, só preenche a coluna nova `cargo_mode` de cada
-- Manifesto de carga: pela natureza dos B/Ls vinculados; sem B/L vinculado,
-- pela dos B/Ls ativos da rota quando todos são de uma natureza, e `container`
-- nos demais casos. Manifesto com B/L das duas naturezas não é classificado: a
-- migration para com a lista, sem gravar nada (a produção conferida em
-- 2026-11-05 tinha 4 Manifestos de carga, 3 só de contêiner e 1 só de carga
-- solta, nenhum misturado). Nenhum número, vínculo ou rota muda. (b) No
-- espelho `voyage_route_ce_master`, o número de Manifesto de carga solta que
-- estava na linha `container` passa para uma linha `carga_solta` nova, e a
-- linha `container` fica com o Manifesto de contêiner da rota (ou vazia).
-- Cada linha do espelho trocada ou criada ganha no Histórico da Viagem
-- (`audit_logs`, campo `ce_master`) o número antes e depois, com a
-- justificativa "Migration 592: …". Conferir: `SELECT natureza, cargo_mode,
-- count(*) FROM manifestos_mercante GROUP BY 1, 2;` e as linhas do Histórico
-- da 592. Desfazer: voltar o espelho pelo `old_value` dessas linhas (e apagar
-- as linhas `carga_solta` criadas), largar os gatilhos
-- `zz_guard_bl_manifesto_cargo_mode*` e a coluna `cargo_mode` e reaplicar as
-- funções pela 181, 396, 486, 509 e 573.
-- ponytail: um B/L misto inteiro vai no Manifesto de carga solta; não há
-- divisão do B/L entre dois Manifestos. Upgrade: se o Mercante pedir o
-- contêiner do misto no Manifesto de contêiner, partir o B/L em dois CEs.

-- 1 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.manifesto_cargo_mode_of_bl(p_bl_cargo_mode text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN lower(btrim(COALESCE(p_bl_cargo_mode, ''))) IN ('carga_solta', 'misto') THEN 'carga_solta' ELSE 'container' END;
$function$;

CREATE OR REPLACE FUNCTION public.manifesto_cargo_mode_label(p_cargo_mode text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE p_cargo_mode WHEN 'container' THEN 'contêiner' WHEN 'carga_solta' THEN 'carga solta' ELSE 'vazios' END;
$function$;

ALTER TABLE public.manifestos_mercante ADD COLUMN IF NOT EXISTS cargo_mode text;
COMMENT ON COLUMN public.manifestos_mercante.cargo_mode IS
  'Natureza do Manifesto de carga: container ou carga_solta (B/L misto vai no de carga solta). Nulo só na natureza vazio. Migration 592.';

DO $migration$
DECLARE
  v_mixed text;
BEGIN
  SELECT string_agg(format('%s (Viagem %s, %s → %s)', mm.numero, mm.voyage_id, mm.pol, mm.pod), ', ' ORDER BY mm.numero)
    INTO v_mixed
  FROM public.manifestos_mercante AS mm
  WHERE mm.natureza = 'carga'
    AND (SELECT count(DISTINCT public.manifesto_cargo_mode_of_bl(b.cargo_mode))
         FROM public.bls AS b WHERE b.manifesto_mercante_id = mm.id) > 1;
  IF v_mixed IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 592: Manifesto Mercante com B/L de contêiner e de carga solta: %. Mova os B/Ls de uma das naturezas para outro Manifesto antes de aplicar.', v_mixed;
  END IF;
END
$migration$;

UPDATE public.manifestos_mercante AS mm
SET cargo_mode = COALESCE(
  (SELECT min(public.manifesto_cargo_mode_of_bl(b.cargo_mode))
   FROM public.bls AS b WHERE b.manifesto_mercante_id = mm.id),
  (SELECT CASE WHEN count(DISTINCT public.manifesto_cargo_mode_of_bl(b.cargo_mode)) = 1
               THEN min(public.manifesto_cargo_mode_of_bl(b.cargo_mode)) END
   FROM public.bls AS b
   WHERE b.voyage_id = mm.voyage_id AND b.cancelled_at IS NULL
     AND COALESCE(public.normalize_port_code(b.pol), upper(btrim(b.pol))) = COALESCE(public.normalize_port_code(mm.pol), upper(btrim(mm.pol)))
     AND COALESCE(public.normalize_port_code(b.pod), upper(btrim(b.pod))) = COALESCE(public.normalize_port_code(mm.pod), upper(btrim(mm.pod)))),
  'container')
WHERE mm.natureza = 'carga' AND mm.cargo_mode IS NULL;

ALTER TABLE public.manifestos_mercante DROP CONSTRAINT IF EXISTS manifestos_mercante_cargo_mode_check;
ALTER TABLE public.manifestos_mercante ADD CONSTRAINT manifestos_mercante_cargo_mode_check CHECK (
  (natureza = 'vazio' AND cargo_mode IS NULL)
  OR (natureza = 'carga' AND cargo_mode IN ('container', 'carga_solta')));

-- Espelho: a linha `container` deixa de guardar o número de carga solta, e
-- cada rota com Manifesto de carga solta ganha a linha `carga_solta`. O valor
-- anterior fica no Histórico da Viagem.
DO $migration$
DECLARE
  v_row record;
  v_new text;
BEGIN
  PERFORM set_config('vela.route_manifest_mirror', 'on', true);

  FOR v_row IN
    SELECT DISTINCT ON (mm.voyage_id, upper(btrim(mm.pol)), upper(btrim(mm.pod)))
      mm.voyage_id, upper(btrim(mm.pol)) AS pol, upper(btrim(mm.pod)) AS pod, mm.numero
    FROM public.manifestos_mercante AS mm
    WHERE mm.natureza = 'carga' AND mm.cargo_mode = 'carga_solta'
      AND NOT EXISTS (
        SELECT 1 FROM public.voyage_route_ce_master AS ce
        WHERE ce.voyage_id = mm.voyage_id AND ce.pol = upper(btrim(mm.pol)) AND ce.pod = upper(btrim(mm.pod))
          AND ce.cargo_mode = 'carga_solta' AND ce.ce_master IS NOT NULL)
    ORDER BY mm.voyage_id, upper(btrim(mm.pol)), upper(btrim(mm.pod)), mm.created_at, mm.numero
  LOOP
    INSERT INTO public.voyage_route_ce_master (voyage_id, pol, pod, cargo_mode, ce_master, updated_at)
    VALUES (v_row.voyage_id, v_row.pol, v_row.pod, 'carga_solta', v_row.numero, now())
    ON CONFLICT (voyage_id, pol, pod, cargo_mode) DO UPDATE SET ce_master = EXCLUDED.ce_master, updated_at = now();
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('voyage', v_row.voyage_id::text, 'ce_master', NULL, v_row.numero, NULL,
      format('Migration 592: Nº de Manifesto Mercante por rota (carga solta) %s → %s.', v_row.pol, v_row.pod));
  END LOOP;

  FOR v_row IN
    SELECT ce.id, ce.voyage_id, ce.pol, ce.pod, ce.ce_master
    FROM public.voyage_route_ce_master AS ce
    JOIN public.manifestos_mercante AS mm
      ON mm.voyage_id = ce.voyage_id AND mm.numero = public.canonical_manifesto_numero(ce.ce_master)
    WHERE ce.cargo_mode = 'container' AND mm.natureza = 'carga' AND mm.cargo_mode = 'carga_solta'
  LOOP
    SELECT mm2.numero INTO v_new FROM public.manifestos_mercante AS mm2
    WHERE mm2.voyage_id = v_row.voyage_id AND mm2.natureza = 'carga' AND mm2.cargo_mode = 'container'
      AND upper(btrim(mm2.pol)) = v_row.pol AND upper(btrim(mm2.pod)) = v_row.pod
    ORDER BY mm2.created_at, mm2.numero LIMIT 1;
    UPDATE public.voyage_route_ce_master SET ce_master = v_new, updated_at = now() WHERE id = v_row.id;
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('voyage', v_row.voyage_id::text, 'ce_master', v_row.ce_master, v_new, NULL,
      format('Migration 592: Nº de Manifesto Mercante por rota (contêiner) %s → %s; o número anterior é de carga solta.', v_row.pol, v_row.pod));
  END LOOP;

  PERFORM set_config('vela.route_manifest_mirror', 'off', true);
END
$migration$;

-- 2 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._upsert_route_manifesto(p_voyage_id bigint, p_pol text, p_pod text, p_natureza text, p_numero text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_numero text := public.canonical_manifesto_numero(p_numero);
  v_pol text := COALESCE(public.normalize_port_code(p_pol), upper(btrim(p_pol)));
  v_pod text := COALESCE(public.normalize_port_code(p_pod), upper(btrim(p_pod)));
  -- 592: `p_natureza` é a natureza completa: container, carga_solta ou vazio.
  v_natureza text := CASE WHEN p_natureza = 'vazio' THEN 'vazio' ELSE 'carga' END;
  v_cargo text := CASE WHEN p_natureza IN ('container', 'carga_solta') THEN p_natureza END;
  v_existing public.manifestos_mercante%ROWTYPE;
  v_id uuid;
  v_attempt integer := 0;
BEGIN
  IF p_natureza IS NULL OR p_natureza NOT IN ('container', 'carga_solta', 'vazio') THEN
    RAISE EXCEPTION 'Natureza do Manifesto Mercante inválida: "%". Use contêiner, carga solta ou vazio.', p_natureza
      USING ERRCODE = '22023';
  END IF;
  LOOP
    SELECT * INTO v_existing FROM public.manifestos_mercante WHERE numero = v_numero FOR UPDATE;
    IF FOUND THEN
      IF v_existing.voyage_id IS DISTINCT FROM p_voyage_id
         OR COALESCE(public.normalize_port_code(v_existing.pol), upper(v_existing.pol)) <> v_pol
         OR COALESCE(public.normalize_port_code(v_existing.pod), upper(v_existing.pod)) <> v_pod
         OR v_existing.natureza <> v_natureza THEN
        RAISE EXCEPTION 'O Manifesto Mercante % já está cadastrado para outra viagem, rota ou natureza.', v_numero
          USING ERRCODE = 'P0012';
      END IF;
      IF v_existing.cargo_mode IS DISTINCT FROM v_cargo THEN
        RAISE EXCEPTION 'O Manifesto Mercante % é de % (não de %): um Manifesto é só de contêiner ou só de carga solta.',
          v_numero, public.manifesto_cargo_mode_label(v_existing.cargo_mode), public.manifesto_cargo_mode_label(v_cargo)
          USING ERRCODE = 'P0012';
      END IF;
      RETURN v_existing.id;
    END IF;
    BEGIN
      INSERT INTO public.manifestos_mercante (voyage_id, pol, pod, numero, natureza, cargo_mode)
      VALUES (p_voyage_id, v_pol, v_pod, v_numero, v_natureza, v_cargo)
      RETURNING id INTO v_id;
      RETURN v_id;
    EXCEPTION WHEN unique_violation THEN
      -- 396 (F-49): outra sessão cadastrou o mesmo Nº entre a leitura e a
      -- gravação; relê e decide como acima, em vez de devolver 23505 cru.
      v_attempt := v_attempt + 1;
      IF v_attempt > 1 THEN
        RAISE EXCEPTION 'O Manifesto Mercante % foi cadastrado por outra gravação ao mesmo tempo; confira e grave de novo.', v_numero
          USING ERRCODE = 'P0012';
      END IF;
    END;
  END LOOP;
END;
$function$;

-- 3 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._analyze_ce_mercante_rows(p_rows jsonb, p_manifesto_numero text, p_voyage_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_numero text := public.canonical_manifesto_numero(p_manifesto_numero);
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_item jsonb;
  v_bl public.bls%ROWTYPE;
  v_new_ce text;
  v_holders text;
  v_route record;
  v_routes integer;
  v_manifesto public.manifestos_mercante%ROWTYPE;
  v_has_manifesto boolean := false;
  v_active_ids text[] := ARRAY[]::text[];
  v_current_numero text;
  v_status text;
  v_changes integer := 0;
  v_moves integer := 0;
  v_route_voyage bigint;
  v_route_pol text;
  v_route_pod text;
  v_cargo_modes integer := 0;
  v_route_cargo text;
BEGIN
  IF jsonb_typeof(COALESCE(p_rows, 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('errors', jsonb_build_array(jsonb_build_object('message', 'Nenhuma linha para importar.')),
      'warnings', '[]'::jsonb, 'rows', '[]'::jsonb);
  END IF;
  IF v_numero IS NULL THEN
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('message', 'Informe o número do Manifesto Mercante deste lote antes de importar.'));
  ELSIF v_numero !~ '^[A-Z0-9]{13}$' THEN
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
      format('Nº de Manifesto Mercante inválido: "%s". O número tem 13 caracteres, letras ou dígitos (ex.: 1226501860578).', p_manifesto_numero)));
  ELSE
    SELECT * INTO v_manifesto FROM public.manifestos_mercante WHERE numero = v_numero;
    v_has_manifesto := FOUND;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_new_ce := NULLIF(regexp_replace(COALESCE(v_item->>'ce', ''), '\s', '', 'g'), '');
    SELECT * INTO v_bl FROM public.bls WHERE id = btrim(v_item->>'bl_id');
    IF NOT FOUND THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_item->>'bl_id',
        'message', format('B/L %s não encontrado no sistema.', v_item->>'bl_id')));
      CONTINUE;
    END IF;
    IF v_bl.cancelled_at IS NOT NULL THEN
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_bl.id,
        'message', format('B/L %s cancelado: a linha é ignorada.', v_bl.id)));
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_bl.id, 'status', 'cancelled'));
      CONTINUE;
    END IF;
    IF v_new_ce IS NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_bl.id,
        'message', format('Linha sem CE Mercante para o B/L %s.', v_bl.id)));
      CONTINUE;
    END IF;
    IF v_new_ce !~ '^[0-9]{15}$' THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_bl.id,
        'message', format('CE Mercante inválido para o B/L %s: o CE tem 15 dígitos.', v_bl.id)));
      CONTINUE;
    END IF;
    -- Unicidade como no gatilho `guard_ce_mercante_unique`: B/Ls de carga não
    -- cancelados e B/Ls de Granito (ADR 0078, item 3; K7).
    SELECT string_agg(holder, ', ' ORDER BY holder) INTO v_holders FROM (
      SELECT other.id AS holder
      FROM public.bls AS other
      WHERE other.id <> v_bl.id AND other.cancelled_at IS NULL
        AND public.ce_mercante_key(other.ce_mercante) = public.ce_mercante_key(v_new_ce)
      UNION ALL
      SELECT 'B/L de Granito ' || g.bl_number
      FROM public.granite_bls AS g
      WHERE public.ce_mercante_key(g.ce_mercante) = public.ce_mercante_key(v_new_ce)
    ) AS holders;
    IF v_holders IS NOT NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_bl.id,
        'message', format('O CE Mercante %s já está em outro B/L não cancelado (%s).', v_new_ce, v_holders)));
      CONTINUE;
    END IF;

    v_active_ids := array_append(v_active_ids, v_bl.id);
    SELECT numero INTO v_current_numero FROM public.manifestos_mercante WHERE id = v_bl.manifesto_mercante_id;
    v_status := CASE
      WHEN NULLIF(btrim(COALESCE(v_bl.ce_mercante, '')), '') IS NULL THEN 'new'
      WHEN public.ce_mercante_key(v_bl.ce_mercante) = public.ce_mercante_key(v_new_ce) THEN 'same'
      ELSE 'change'
    END;
    IF v_status = 'change' THEN v_changes := v_changes + 1; END IF;
    IF v_current_numero IS NOT NULL AND v_numero IS NOT NULL AND v_current_numero IS DISTINCT FROM v_numero THEN
      v_moves := v_moves + 1;
    END IF;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'row', v_item->'row',
      'bl_id', v_bl.id,
      'status', v_status,
      'current_ce', NULLIF(btrim(COALESCE(v_bl.ce_mercante, '')), ''),
      'new_ce', v_new_ce,
      'current_manifesto', v_current_numero,
      'target_manifesto', v_numero,
      'manifesto_change', v_current_numero IS NOT NULL AND v_current_numero IS DISTINCT FROM v_numero,
      'live_invoices', to_jsonb(public._bl_live_invoice_numbers(v_bl.id)),
      'portal_visible', v_bl.customer_id IS NOT NULL AND NULLIF(btrim(COALESCE(v_bl.ce_mercante, '')), '') IS NOT NULL
        AND public.customer_portal_access_ready(v_bl.customer_id),
      'comunicado_sent', EXISTS (
        SELECT 1 FROM public.customer_communications AS c
        JOIN public.customer_communication_bls AS cb ON cb.communication_id = c.id
        WHERE cb.bl_id = v_bl.id AND c.kind = 'ce_mercante_taxas' AND c.status IN ('enviado', 'parcial', 'simulado')),
      'unlock_confirmed', public._bl_ce_unlock_conferred(v_bl.id, v_bl.ce_mercante)
    ));
  END LOOP;

  IF cardinality(v_active_ids) > 0 AND v_numero ~ '^[A-Z0-9]{13}$' THEN
    SELECT count(DISTINCT (b.voyage_id, public.normalize_port_code(b.pol), public.normalize_port_code(b.pod))) INTO v_routes
    FROM public.bls AS b WHERE b.id = ANY(v_active_ids);
    SELECT b.voyage_id, btrim(b.pol) AS pol, btrim(b.pod) AS pod INTO v_route FROM public.bls AS b WHERE b.id = ANY(v_active_ids) ORDER BY b.id LIMIT 1;
    v_route_voyage := v_route.voyage_id; v_route_pol := v_route.pol; v_route_pod := v_route.pod;
    -- 592: a natureza do Manifesto (contêiner ou carga solta) vem dos B/Ls.
    SELECT count(DISTINCT public.manifesto_cargo_mode_of_bl(b.cargo_mode)), min(public.manifesto_cargo_mode_of_bl(b.cargo_mode))
      INTO v_cargo_modes, v_route_cargo
    FROM public.bls AS b WHERE b.id = ANY(v_active_ids);
    IF v_routes > 1 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
        'Os B/Ls da planilha são de mais de uma viagem ou rota (POL → POD). Um manifesto tem uma única rota: separe a planilha por manifesto.'));
    ELSIF v_cargo_modes > 1 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
        'A planilha tem B/Ls de contêiner e de carga solta. Um Manifesto Mercante é só de contêiner ou só de carga solta (o B/L misto vai no de carga solta): separe a planilha por natureza.'));
    ELSIF NULLIF(v_route.pol, '') IS NULL OR NULLIF(v_route.pod, '') IS NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
        'Os B/Ls da planilha não têm POL e POD cadastrados; sem rota não há manifesto.'));
    ELSIF p_voyage_id IS NOT NULL AND v_route.voyage_id IS DISTINCT FROM p_voyage_id THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message', 'Os B/Ls da planilha não pertencem à viagem selecionada.'));
    ELSIF v_has_manifesto AND (
      v_manifesto.voyage_id IS DISTINCT FROM v_route.voyage_id
      OR COALESCE(public.normalize_port_code(v_manifesto.pol), upper(v_manifesto.pol)) IS DISTINCT FROM public.normalize_port_code(v_route.pol)
      OR COALESCE(public.normalize_port_code(v_manifesto.pod), upper(v_manifesto.pod)) IS DISTINCT FROM public.normalize_port_code(v_route.pod)
      OR v_manifesto.natureza <> 'carga'
    ) THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
        format('O Manifesto Mercante %s já está cadastrado para outra viagem, rota ou natureza.', v_numero)));
    ELSIF v_has_manifesto AND v_manifesto.cargo_mode IS DISTINCT FROM v_route_cargo THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
        format('O Manifesto Mercante %s é de %s e os B/Ls da planilha são de %s. Um Manifesto é só de contêiner ou só de carga solta: use o número do Manifesto de %s da rota.',
          v_numero, public.manifesto_cargo_mode_label(v_manifesto.cargo_mode),
          public.manifesto_cargo_mode_label(v_route_cargo), public.manifesto_cargo_mode_label(v_route_cargo))));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'errors', v_errors,
    'warnings', v_warnings,
    'rows', v_rows,
    'active_bl_ids', to_jsonb(v_active_ids),
    'manifesto', jsonb_build_object('numero', v_numero, 'exists', v_has_manifesto,
      'voyage_id', v_route_voyage, 'pol', v_route_pol, 'pod', v_route_pod, 'cargo_mode', v_route_cargo),
    'changes', v_changes,
    'moves', v_moves,
    'needs_confirmation', (v_changes + v_moves) > 0
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.apply_ce_mercante_rows_atomic_legacy_189(p_rows jsonb, p_changed_by uuid, p_target text DEFAULT 'bls'::text, p_manifesto_numero text DEFAULT NULL::text, p_voyage_id bigint DEFAULT NULL::bigint, p_confirm_changes boolean DEFAULT false, p_reason text DEFAULT NULL::text, p_defer_billing boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_row jsonb;
  v_result text;
  v_errors jsonb := '[]'::jsonb;
  v_analysis jsonb;
  v_inserted integer := 0;
  v_overwritten integer := 0;
  v_unchanged integer := 0;
  v_numero text := public.canonical_manifesto_numero(p_manifesto_numero);
  v_bl_ids text[];
  v_active text[];
  v_voyage bigint;
  v_manifesto public.manifestos_mercante%ROWTYPE;
  v_created boolean := false;
  v_pending text[] := ARRAY[]::text[];
  v_previous_deferred text := current_setting('vela.ce_billing_deferred', true);
  v_message text;
  v_state text;
  v_justification text;
  v_route_pol text;
  v_route_pod text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_target NOT IN ('bls', 'granite') THEN
    RAISE EXCEPTION 'Destino de CE Mercante inválido: %', p_target USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_rows, 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('message', 'Nenhuma linha para importar.')));
  END IF;

  IF p_target = 'granite' THEN
    BEGIN
      FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
        BEGIN
          v_result := public.apply_granite_ce_mercante_update((v_row->>'bl_id')::uuid, v_row->>'ce', p_changed_by);
          CASE v_result
            WHEN 'overwritten' THEN v_overwritten := v_overwritten + 1;
            WHEN 'unchanged' THEN v_unchanged := v_unchanged + 1;
            ELSE v_inserted := v_inserted + 1;
          END CASE;
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_row->'row', 'bl_id', v_row->>'bl_id',
            'message', public._ce_row_error_message(v_state, v_message)));
        END;
      END LOOP;
      IF jsonb_array_length(v_errors) > 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'ce_rows_rollback';
      END IF;
    EXCEPTION WHEN SQLSTATE 'P0099' THEN
      RETURN jsonb_build_object('ok', false, 'errors', v_errors);
    END;
    RETURN jsonb_build_object('ok', true, 'processed', jsonb_array_length(p_rows),
      'inserted', v_inserted, 'overwritten', v_overwritten, 'unchanged', v_unchanged);
  END IF;

  -- Trava a Viagem antes dos B/Ls: duas planilhas da mesma Viagem não se
  -- cruzam travando os B/Ls em ordens diferentes (deadlock, ADR 0078 item 9).
  SELECT array_agg(DISTINCT btrim(value->>'bl_id')) INTO v_bl_ids FROM jsonb_array_elements(p_rows);
  SELECT COALESCE(p_voyage_id, (SELECT b.voyage_id FROM public.bls AS b WHERE b.id = ANY(v_bl_ids) ORDER BY b.id LIMIT 1)) INTO v_voyage;
  IF v_voyage IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('ce_mercante_voyage:' || v_voyage, 180));
  END IF;
  PERFORM 1 FROM public.bls WHERE id = ANY(v_bl_ids) ORDER BY id FOR UPDATE;

  v_analysis := public._analyze_ce_mercante_rows(p_rows, p_manifesto_numero, p_voyage_id);
  IF jsonb_array_length(v_analysis->'errors') > 0 THEN
    RETURN jsonb_build_object('ok', false, 'errors', v_analysis->'errors', 'warnings', v_analysis->'warnings');
  END IF;
  IF (v_analysis->>'needs_confirmation')::boolean AND (NOT p_confirm_changes OR v_reason IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'needs_confirmation', true, 'warnings', v_analysis->'warnings',
      'errors', jsonb_build_array(jsonb_build_object('message', format(
        'A planilha troca o CE de %s B/L(s) e muda o Manifesto de %s B/L(s): confirme na prévia, com motivo.',
        v_analysis->>'changes', v_analysis->>'moves'))));
  END IF;
  v_active := ARRAY(SELECT jsonb_array_elements_text(v_analysis->'active_bl_ids'));

  -- Rastro (ADR 0078, item 9; K8): o invólucro da 189 define o contexto com a
  -- Viagem informada; sem Viagem na tela, vale a dos B/Ls. O Histórico do CE,
  -- do Manifesto criado e do vínculo leva o contexto, a rota e o motivo. A
  -- planilha de CE refina o contexto que o próprio invólucro gravou (a 190 faz
  -- o primeiro contexto da transação valer até o fim; aqui ele é o mesmo, só
  -- mais completo).
  PERFORM set_config('vela.import_context', '', true);
  PERFORM public._set_import_context('CE Mercante',
    COALESCE((v_analysis->'manifesto'->>'voyage_id')::bigint, v_voyage), COALESCE(v_numero, p_manifesto_numero));
  v_route_pol := NULLIF(v_analysis->'manifesto'->>'pol', '');
  v_route_pod := NULLIF(v_analysis->'manifesto'->>'pod', '');
  v_justification := concat_ws(' · ',
    COALESCE(NULLIF(btrim(current_setting('vela.import_context', true)), ''), 'Importação de CE Mercante'),
    CASE WHEN v_route_pol IS NOT NULL AND v_route_pod IS NOT NULL THEN
      'Rota ' || COALESCE(public.normalize_port_code(v_route_pol), upper(v_route_pol))
        || ' → ' || COALESCE(public.normalize_port_code(v_route_pod), upper(v_route_pod)) END,
    CASE WHEN v_reason IS NOT NULL THEN 'Motivo: ' || v_reason END);

  IF cardinality(v_active) > 0 THEN
    SELECT * INTO v_manifesto FROM public.manifestos_mercante WHERE numero = v_numero;
    v_created := NOT FOUND;
  END IF;

  IF p_defer_billing THEN
    PERFORM set_config('vela.ce_billing_deferred', 'on', true);
  END IF;

  BEGIN
    FOR v_row IN
      SELECT value FROM jsonb_array_elements(v_analysis->'rows')
      WHERE value->>'status' IN ('new', 'same', 'change')
    LOOP
      BEGIN
        -- A troca com Desbloqueio conferido abre o alerta na porta única
        -- (`_set_bl_ce_mercante`, migration 195).
        v_result := public._set_bl_ce_mercante(v_row->>'bl_id', v_row->>'new_ce', v_actor, v_justification, 'ce_mercante_planilha');
        CASE v_result
          WHEN 'overwritten' THEN v_overwritten := v_overwritten + 1;
          WHEN 'unchanged' THEN v_unchanged := v_unchanged + 1;
          ELSE v_inserted := v_inserted + 1;
        END CASE;
        IF v_result <> 'unchanged' THEN
          -- Rede da emissão: o efeito revalida e não refatura (migration 178).
          INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id, created_by)
          VALUES (gen_random_uuid(), 'local_billing', v_row->>'bl_id', v_actor)
          ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
          v_pending := array_append(v_pending, v_row->>'bl_id');
        -- Mesma planilha de novo (212): o B/L que a emissão interrompida
        -- deixou sem fatura volta ao lote; o faturado não.
        ELSIF EXISTS (
          SELECT 1 FROM public.bls AS b
          WHERE b.id = v_row->>'bl_id' AND b.cancelled_at IS NULL
            AND NULLIF(btrim(COALESCE(b.ce_mercante, '')), '') IS NOT NULL
            AND COALESCE(b.financial_status, 'pending') = 'pending')
          AND cardinality(public._live_local_invoice_ids_for_bl(v_row->>'bl_id')) = 0 THEN
          v_pending := array_append(v_pending, v_row->>'bl_id');
        END IF;
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_row->'row', 'bl_id', v_row->>'bl_id',
          'message', public._ce_row_error_message(v_state, v_message)));
      END;
    END LOOP;

    IF jsonb_array_length(v_errors) > 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'ce_rows_rollback';
    END IF;

    IF cardinality(v_active) > 0 THEN
      PERFORM public._upsert_route_manifesto((v_analysis->'manifesto'->>'voyage_id')::bigint,
        v_analysis->'manifesto'->>'pol', v_analysis->'manifesto'->>'pod', v_analysis->'manifesto'->>'cargo_mode', v_numero);
      SELECT * INTO v_manifesto FROM public.manifestos_mercante WHERE numero = v_numero;
      IF v_created THEN
        INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
        VALUES ('voyage', v_manifesto.voyage_id::text, 'manifesto_mercante_created', NULL, v_numero, v_actor, v_justification);
      END IF;
      PERFORM public._link_bls_to_manifesto(v_active, v_manifesto.id, v_actor, v_justification);
    END IF;
  EXCEPTION WHEN SQLSTATE 'P0099' THEN
    PERFORM set_config('vela.ce_billing_deferred', COALESCE(v_previous_deferred, ''), true);
    RETURN jsonb_build_object('ok', false, 'errors', v_errors, 'warnings', v_analysis->'warnings');
  END;
  PERFORM set_config('vela.ce_billing_deferred', COALESCE(v_previous_deferred, ''), true);

  RETURN jsonb_build_object(
    'ok', true,
    'processed', jsonb_array_length(p_rows),
    'inserted', v_inserted,
    'overwritten', v_overwritten,
    'unchanged', v_unchanged,
    'ignored', (SELECT count(*) FROM jsonb_array_elements(v_analysis->'rows') WHERE value->>'status' = 'cancelled'),
    'warnings', v_analysis->'warnings',
    'manifesto_mercante_id', v_manifesto.id,
    'manifesto_created', v_created,
    'billing_pending_bl_ids', CASE WHEN p_defer_billing THEN to_jsonb(v_pending) ELSE '[]'::jsonb END
  );
END;
$function$;

-- 4 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.move_bls_to_manifesto_mercante(p_bl_ids text[], p_numero text, p_reason text, p_expected jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_numero text := public.canonical_manifesto_numero(p_numero);
  v_ids text[];
  v_route record;
  v_routes integer;
  v_target public.manifestos_mercante%ROWTYPE;
  v_created boolean := false;
  v_moved integer;
  v_cargo_modes integer;
  v_cargo text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da mudança de Manifesto Mercante.' USING ERRCODE = '22023';
  END IF;
  IF v_numero IS NULL OR v_numero !~ '^[A-Z0-9]{13}$' THEN
    RAISE EXCEPTION 'Nº de Manifesto Mercante inválido: "%". O número tem 13 caracteres, letras ou dígitos (ex.: 1226501860578).', p_numero
      USING ERRCODE = 'P0012';
  END IF;

  v_ids := public._lock_bls_for_manifesto(p_bl_ids);
  -- 478 (CEB-D01): o B/L fica no Manifesto Mercante só com CE (ADR 0095, decisão 19).
  IF EXISTS (SELECT 1 FROM public.bls AS b WHERE b.id = ANY(v_ids) AND NULLIF(btrim(COALESCE(b.ce_mercante, '')), '') IS NULL) THEN
    RAISE EXCEPTION 'B/L sem CE Mercante não entra em Manifesto: %. O CE entra pela planilha de CE Mercante, que também vincula o Manifesto.',
      (SELECT string_agg(b.id, ', ' ORDER BY b.id) FROM public.bls AS b WHERE b.id = ANY(v_ids) AND NULLIF(btrim(COALESCE(b.ce_mercante, '')), '') IS NULL)
      USING ERRCODE = '22023';
  END IF;
  PERFORM public._check_expected_manifestos(v_ids, p_expected);
  SELECT count(DISTINCT (b.voyage_id, public.normalize_port_code(b.pol), public.normalize_port_code(b.pod))) INTO v_routes
  FROM public.bls AS b WHERE b.id = ANY(v_ids);
  IF v_routes > 1 THEN
    RAISE EXCEPTION 'Os B/Ls selecionados são de mais de uma viagem ou rota (POL → POD); um Manifesto tem uma única rota.' USING ERRCODE = '22023';
  END IF;
  SELECT b.voyage_id, btrim(b.pol) AS pol, btrim(b.pod) AS pod INTO v_route FROM public.bls AS b WHERE b.id = ANY(v_ids) LIMIT 1;
  IF NULLIF(v_route.pol, '') IS NULL OR NULLIF(v_route.pod, '') IS NULL THEN
    RAISE EXCEPTION 'Os B/Ls selecionados não têm POL e POD cadastrados; sem rota não há Manifesto.' USING ERRCODE = '22023';
  END IF;
  -- 592: um Manifesto é só de contêiner ou só de carga solta.
  SELECT count(DISTINCT public.manifesto_cargo_mode_of_bl(b.cargo_mode)), min(public.manifesto_cargo_mode_of_bl(b.cargo_mode))
    INTO v_cargo_modes, v_cargo
  FROM public.bls AS b WHERE b.id = ANY(v_ids);
  IF v_cargo_modes > 1 THEN
    RAISE EXCEPTION 'Os B/Ls selecionados são de contêiner e de carga solta; um Manifesto Mercante é só de contêiner ou só de carga solta (o B/L misto vai no de carga solta). Mova cada natureza para o seu Manifesto.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_target FROM public.manifestos_mercante WHERE numero = v_numero;
  v_created := NOT FOUND;
  PERFORM public._upsert_route_manifesto(v_route.voyage_id, v_route.pol, v_route.pod, v_cargo, v_numero);
  SELECT * INTO v_target FROM public.manifestos_mercante WHERE numero = v_numero;
  IF v_created THEN
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('voyage', v_route.voyage_id::text, 'manifesto_mercante_created', NULL, v_numero, v_actor, v_reason);
  END IF;

  v_moved := public._link_bls_to_manifesto(v_ids, v_target.id, v_actor, v_reason);
  RETURN jsonb_build_object(
    'manifesto_mercante_id', v_target.id, 'numero', v_numero, 'created', v_created,
    'moved', v_moved, 'unchanged', cardinality(v_ids) - v_moved);
END;
$function$;

-- 5 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_voyage_route_ce_master(p_voyage_id bigint, p_pol text, p_pod text, p_ce_master text, p_changed_by uuid, p_cargo_mode text DEFAULT 'container'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_norm text := public.canonical_manifesto_numero(p_ce_master);
  v_pol text := upper(btrim(COALESCE(p_pol, '')));
  v_pod text := upper(btrim(COALESCE(p_pod, '')));
  v_mode text := lower(btrim(COALESCE(p_cargo_mode, 'container')));
  v_old text;
  v_old_manifesto public.manifestos_mercante%ROWTYPE;
  v_linked integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para editar o Nº de Manifesto Mercante.' USING ERRCODE = '42501';
  END IF;
  -- 592: a linha da rota é de contêiner, de carga solta ou de vazios.
  IF v_mode NOT IN ('container', 'carga_solta', 'vazios') THEN
    RAISE EXCEPTION 'Natureza da linha inválida: "%". Use contêiner, carga solta ou vazios.', p_cargo_mode USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem % não encontrada', p_voyage_id USING ERRCODE = 'P0002';
  END IF;
  IF v_norm IS NOT NULL AND v_norm !~ '^[A-Z0-9]{13}$' THEN
    RAISE EXCEPTION 'Nº de Manifesto Mercante inválido: "%". O número tem 13 caracteres, letras ou dígitos (ex.: 1226501860578).', p_ce_master
      USING ERRCODE = 'P0012';
  END IF;

  -- 396 (F-49): a mesma trava das importações da Viagem (387). "Informar"
  -- espera a planilha de CE da mesma Viagem em vez de cruzar com ela (23505).
  PERFORM public._lock_import_voyages(ARRAY[p_voyage_id]);
  -- 217: a rota é travada antes de ler o número antigo.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    format('route_ce_master:%s:%s:%s:%s', p_voyage_id, v_pol, v_pod, v_mode), 0));

  SELECT ce_master INTO v_old FROM public.voyage_route_ce_master
    WHERE voyage_id = p_voyage_id AND pol = v_pol AND pod = v_pod AND cargo_mode = v_mode
    FOR UPDATE;

  -- Troca ou limpeza (215): o Manifesto antigo com B/L não muda por aqui.
  IF public.canonical_manifesto_numero(v_old) IS NOT NULL
     AND public.canonical_manifesto_numero(v_old) IS DISTINCT FROM v_norm THEN
    SELECT * INTO v_old_manifesto FROM public.manifestos_mercante
      WHERE numero = public.canonical_manifesto_numero(v_old) AND voyage_id = p_voyage_id
      FOR UPDATE;
    IF FOUND THEN
      SELECT count(*) INTO v_linked FROM public.bls WHERE manifesto_mercante_id = v_old_manifesto.id;
      IF v_linked > 0 THEN
        RAISE EXCEPTION 'O Manifesto Mercante % tem % B/L(s) vinculado(s): para trocar o número, use Ver B/Ls → Mover; para tirar o número, Ver B/Ls → Desvincular.',
          v_old_manifesto.numero, v_linked USING ERRCODE = '22023';
      END IF;
      DELETE FROM public.manifestos_mercante WHERE id = v_old_manifesto.id;
    END IF;
  END IF;

  -- Fonte única (ADR 0078, item 6): o Manifesto da rota.
  IF v_norm IS NOT NULL THEN
    PERFORM public._upsert_route_manifesto(p_voyage_id, v_pol, v_pod,
      CASE v_mode WHEN 'vazios' THEN 'vazio' WHEN 'carga_solta' THEN 'carga_solta' ELSE 'container' END, v_norm);
  END IF;

  PERFORM set_config('vela.route_manifest_mirror', 'on', true);
  INSERT INTO public.voyage_route_ce_master(voyage_id, pol, pod, cargo_mode, ce_master, updated_by, updated_at)
  VALUES (p_voyage_id, v_pol, v_pod, v_mode, v_norm, p_changed_by, now())
  ON CONFLICT (voyage_id, pol, pod, cargo_mode)
  DO UPDATE SET ce_master = EXCLUDED.ce_master, updated_by = EXCLUDED.updated_by, updated_at = now();
  PERFORM set_config('vela.route_manifest_mirror', 'off', true);

  IF COALESCE(v_old, '') IS DISTINCT FROM COALESCE(v_norm, '') THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('voyage', p_voyage_id::text, 'ce_master', NULLIF(v_old, ''), v_norm, p_changed_by,
            CASE v_mode WHEN 'vazios' THEN 'Nº de Manifesto Mercante por rota (vazios)'
                 WHEN 'carga_solta' THEN 'Nº de Manifesto Mercante por rota (carga solta)'
                 ELSE 'Nº de Manifesto Mercante por rota (contêiner)' END);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_route_ce_master_to_manifesto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF current_setting('vela.route_manifest_mirror', true) = 'on' THEN
    RETURN NEW;
  END IF;
  NEW.ce_master := public.canonical_manifesto_numero(NEW.ce_master);
  IF NEW.ce_master IS NOT NULL AND NEW.ce_master ~ '^[A-Z0-9]{13}$' THEN
    PERFORM public._upsert_route_manifesto(NEW.voyage_id, NEW.pol, NEW.pod,
      CASE NEW.cargo_mode WHEN 'vazios' THEN 'vazio' WHEN 'carga_solta' THEN 'carga_solta' ELSE 'container' END,
      NEW.ce_master);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_manifesto_to_route_ce_master()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mode text := CASE WHEN NEW.natureza = 'vazio' THEN 'vazios'
                      WHEN NEW.cargo_mode = 'carga_solta' THEN 'carga_solta'
                      ELSE 'container' END;
BEGIN
  IF current_setting('vela.route_manifest_mirror', true) = 'on' THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('vela.route_manifest_mirror', 'on', true);
  INSERT INTO public.voyage_route_ce_master(voyage_id, pol, pod, cargo_mode, ce_master, updated_by, updated_at)
  VALUES (NEW.voyage_id, upper(btrim(NEW.pol)), upper(btrim(NEW.pod)), v_mode, NEW.numero, auth.uid(), now())
  ON CONFLICT (voyage_id, pol, pod, cargo_mode)
  DO UPDATE SET ce_master = COALESCE(public.voyage_route_ce_master.ce_master, EXCLUDED.ce_master), updated_at = now();
  PERFORM set_config('vela.route_manifest_mirror', 'off', true);
  RETURN NULL;
END;
$function$;

-- 6 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_bl_manifesto_cargo_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_manifesto public.manifestos_mercante%ROWTYPE;
  v_bl_cargo text := public.manifesto_cargo_mode_of_bl(NEW.cargo_mode);
  v_previous text;
BEGIN
  IF NEW.manifesto_mercante_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_manifesto FROM public.manifestos_mercante WHERE id = NEW.manifesto_mercante_id;
  IF NOT FOUND OR v_manifesto.natureza <> 'carga' OR v_manifesto.cargo_mode = v_bl_cargo THEN
    RETURN NEW;
  END IF;

  -- O vínculo é o mesmo e a natureza do B/L mudou: o B/L sai do Manifesto.
  IF TG_OP = 'UPDATE' AND NEW.manifesto_mercante_id IS NOT DISTINCT FROM OLD.manifesto_mercante_id THEN
    PERFORM public._audit_skip_once('bls', NEW.id, 'manifesto_mercante_id');
    NEW.manifesto_mercante_id := NULL;
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bl', NEW.id, 'manifesto_mercante', v_manifesto.numero, NULL, auth.uid(),
      format('Desvínculo automático: o B/L passou a ser de %s e o Manifesto Mercante é de %s.',
        public.manifesto_cargo_mode_label(v_bl_cargo), public.manifesto_cargo_mode_label(v_manifesto.cargo_mode)));
    IF NEW.cancelled_at IS NULL AND NULLIF(btrim(COALESCE(NEW.ce_mercante, '')), '') IS NOT NULL THEN
      v_previous := current_setting('alerts.foundation_trigger', true);
      BEGIN
        PERFORM set_config('alerts.foundation_trigger', 'on', true);
        PERFORM public.upsert_alert_item(
          'ce_fora_do_manifesto_da_rota', 'bl', NEW.id,
          format('CE fora do Manifesto da rota: o B/L %s (CE %s) passou a ser de %s e saiu do Manifesto Mercante %s, que é de %s. Inclua o B/L num Manifesto de %s da rota ou corrija o CE.',
            NEW.id, btrim(NEW.ce_mercante), public.manifesto_cargo_mode_label(v_bl_cargo), v_manifesto.numero,
            public.manifesto_cargo_mode_label(v_manifesto.cargo_mode), public.manifesto_cargo_mode_label(v_bl_cargo)),
          'bl_cargo_mode_change',
          jsonb_build_object('bl_id', NEW.id, 'ce_mercante', btrim(NEW.ce_mercante),
            'old_manifesto', v_manifesto.numero, 'voyage_id', NEW.voyage_id, 'pol', NEW.pol, 'pod', NEW.pod,
            'cargo_mode', NEW.cargo_mode, 'old_cargo_mode', OLD.cargo_mode),
          '/bls/' || NEW.id);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Alerta de CE fora do Manifesto da rota do B/L % não aberto: %', NEW.id, SQLERRM;
      END;
      PERFORM set_config('alerts.foundation_trigger', COALESCE(v_previous, ''), true);
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'O B/L % é de % e o Manifesto Mercante % é de %: um Manifesto é só de contêiner ou só de carga solta (o B/L misto vai no de carga solta).',
    NEW.id, public.manifesto_cargo_mode_label(v_bl_cargo), v_manifesto.numero, public.manifesto_cargo_mode_label(v_manifesto.cargo_mode)
    USING ERRCODE = '22023';
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_bl_manifesto_cargo_mode() FROM PUBLIC, anon, authenticated;

-- O nome com `zz_` faz o gatilho rodar depois dos outros BEFORE de `bls`
-- (ordem alfabética): ele vê o vínculo que a reativação e a mudança de rota
-- deixaram e a natureza que `trg_sync_bl_weight_cargo_mode` recalculou. Sem
-- lista de colunas: o recálculo troca `cargo_mode` sem ele estar no SET.
DROP TRIGGER IF EXISTS zz_guard_bl_manifesto_cargo_mode ON public.bls;
CREATE TRIGGER zz_guard_bl_manifesto_cargo_mode
  BEFORE UPDATE ON public.bls
  FOR EACH ROW
  WHEN (NEW.manifesto_mercante_id IS NOT NULL
    AND (OLD.manifesto_mercante_id IS DISTINCT FROM NEW.manifesto_mercante_id
      OR OLD.cargo_mode IS DISTINCT FROM NEW.cargo_mode))
  EXECUTE FUNCTION public.guard_bl_manifesto_cargo_mode();
DROP TRIGGER IF EXISTS zz_guard_bl_manifesto_cargo_mode_insert ON public.bls;
CREATE TRIGGER zz_guard_bl_manifesto_cargo_mode_insert
  BEFORE INSERT ON public.bls
  FOR EACH ROW
  WHEN (NEW.manifesto_mercante_id IS NOT NULL)
  EXECUTE FUNCTION public.guard_bl_manifesto_cargo_mode();

-- 7 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.manifesto_follows_ce_and_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_parked uuid;
  v_target public.manifestos_mercante%ROWTYPE;
  v_old_numero text;
  v_has_ce boolean := NULLIF(btrim(COALESCE(NEW.ce_mercante, '')), '') IS NOT NULL;
BEGIN
  -- Cancelamento: sai do Manifesto e guarda o vínculo para a reativação.
  IF OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL THEN
    IF NEW.manifesto_mercante_id IS NOT NULL THEN
      SELECT numero INTO v_old_numero FROM public.manifestos_mercante WHERE id = NEW.manifesto_mercante_id;
      INSERT INTO public.bl_manifesto_mercante_parking (bl_id, manifesto_mercante_id)
      VALUES (NEW.id, NEW.manifesto_mercante_id)
      ON CONFLICT (bl_id) DO UPDATE SET manifesto_mercante_id = EXCLUDED.manifesto_mercante_id, parked_at = now();
      PERFORM public._audit_skip_once('bls', NEW.id, 'manifesto_mercante_id');
      NEW.manifesto_mercante_id := NULL;
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES ('bl', NEW.id, 'manifesto_mercante', v_old_numero, NULL, auth.uid(),
        concat_ws(' · ', 'Saiu do Manifesto Mercante: B/L cancelado.', NULLIF(btrim(COALESCE(NEW.cancel_reason, '')), '')));
    END IF;
    RETURN NEW;
  END IF;

  -- Reativação: volta ao Manifesto guardado, se ele ainda é da rota do B/L.
  IF OLD.cancelled_at IS NOT NULL AND NEW.cancelled_at IS NULL THEN
    DELETE FROM public.bl_manifesto_mercante_parking WHERE bl_id = NEW.id
    RETURNING manifesto_mercante_id INTO v_parked;
    IF v_parked IS NOT NULL AND NEW.manifesto_mercante_id IS NULL AND v_has_ce THEN
      SELECT * INTO v_target FROM public.manifestos_mercante WHERE id = v_parked;
      IF FOUND
         AND v_target.voyage_id = NEW.voyage_id
         AND COALESCE(public.normalize_port_code(v_target.pol), upper(btrim(v_target.pol)))
             IS NOT DISTINCT FROM COALESCE(public.normalize_port_code(NEW.pol), upper(btrim(NEW.pol)))
         AND COALESCE(public.normalize_port_code(v_target.pod), upper(btrim(v_target.pod)))
             IS NOT DISTINCT FROM COALESCE(public.normalize_port_code(NEW.pod), upper(btrim(NEW.pod)))
         -- 592: e se ainda é da natureza do B/L (contêiner ou carga solta).
         AND v_target.cargo_mode IS NOT DISTINCT FROM public.manifesto_cargo_mode_of_bl(NEW.cargo_mode) THEN
        PERFORM public._audit_skip_once('bls', NEW.id, 'manifesto_mercante_id');
        NEW.manifesto_mercante_id := v_target.id;
        INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
        VALUES ('bl', NEW.id, 'manifesto_mercante', NULL, v_target.numero, auth.uid(),
          'Voltou ao Manifesto Mercante: B/L reativado.');
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- CE removido: sai do Manifesto (o CE volta só pela planilha, com o Nº).
  IF NULLIF(btrim(COALESCE(OLD.ce_mercante, '')), '') IS NOT NULL AND NOT v_has_ce
     AND NEW.manifesto_mercante_id IS NOT NULL
     AND NEW.manifesto_mercante_id IS NOT DISTINCT FROM OLD.manifesto_mercante_id THEN
    SELECT numero INTO v_old_numero FROM public.manifestos_mercante WHERE id = NEW.manifesto_mercante_id;
    PERFORM public._audit_skip_once('bls', NEW.id, 'manifesto_mercante_id');
    NEW.manifesto_mercante_id := NULL;
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bl', NEW.id, 'manifesto_mercante', v_old_numero, NULL, auth.uid(),
      'Saiu do Manifesto Mercante: CE Mercante removido.');
  END IF;

  -- Vínculo novo de B/L ativo: a guarda antiga não vale mais.
  IF NEW.manifesto_mercante_id IS NOT NULL AND NEW.cancelled_at IS NULL
     AND NEW.manifesto_mercante_id IS DISTINCT FROM OLD.manifesto_mercante_id THEN
    DELETE FROM public.bl_manifesto_mercante_parking WHERE bl_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

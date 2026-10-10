-- 176: unicidade do CE Mercante e porta única de gravação
-- (M06 e M08 da revisão de 2026-10-09; ADR 0078, itens 1, 2, 3 e 5).
--
-- 1. `ce_mercante_key(text)`: chave normalizada do CE (letras e dígitos, em
--    maiúsculas, sem zeros à esquerda). É a chave da unicidade e da
--    conciliação com a ZPT.
-- 2. Unicidade: um CE só pode estar em um B/L não cancelado, somando B/Ls de
--    carga e de Granito. O gatilho `guard_ce_mercante_unique` cobre toda porta
--    (planilha, ficha, Granito, reativação) e serializa o mesmo CE por advisory
--    lock, para transações concorrentes receberem a mensagem de negócio; o
--    índice único parcial em `bls` é a rede. B/L cancelado libera o CE.
-- 3. Porta única: `_set_bl_ce_mercante` valida 15 dígitos e audita com motivo;
--    UPDATE de `bls.ce_mercante` fora dela é recusado (`guard_bl_ce_mercante_port`).
--    A exceção é a manutenção direta por um papel superusuário (sessão de
--    banco do dono ou fixture de teste); a API (PostgREST) nunca conecta assim.
--    `save_bl_review` deixa de gravar o CE.
-- 4. Ficha do B/L: `correct_bl_ce_mercante` e `remove_bl_ce_mercante`, para
--    qualquer usuário ativo, com motivo no Histórico. Remover só sem fatura
--    viva, com a orientação de o Administrativo cancelar a fatura antes.
--    Comunicado de CE e Taxas já enviado abre a pendência de reenvio
--    (`comunicado_ce_reenvio_pendente`).
--
-- Antes de criar a unicidade, a migration aborta listando os B/Ls se houver CE
-- repetido entre B/Ls não cancelados (ou com Granito); não reescreve linhas.
--
-- Rollback: DROP dos gatilhos `guard_ce_mercante_unique` e
-- `guard_bl_ce_mercante_port`, do índice `bls_ce_mercante_active_key`, das
-- funções novas; reaplicar `apply_ce_mercante_update` da 016,
-- `save_bl_review` da 064 e `ce_unlock_reconcile` da 161.

CREATE OR REPLACE FUNCTION public.ce_mercante_key(p_ce text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT NULLIF(ltrim(upper(regexp_replace(COALESCE(p_ce, ''), '[^0-9A-Za-z]', '', 'g')), '0'), '');
$function$;

-- O índice único avalia a chave com o papel de quem grava.
GRANT EXECUTE ON FUNCTION public.ce_mercante_key(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.ce_mercante_key(text) IS
  'Chave normalizada do CE Mercante (unicidade e conciliação ZPT): letras e dígitos, maiúsculas, sem zeros à esquerda.';

DO $precheck$
DECLARE
  v_repeated text;
BEGIN
  SELECT string_agg(format('CE %s em %s', repeated.key, repeated.holders), '; ' ORDER BY repeated.key)
  INTO v_repeated
  FROM (
    SELECT holders.key, string_agg(holders.holder, ', ' ORDER BY holders.holder) AS holders
    FROM (
      SELECT public.ce_mercante_key(ce_mercante) AS key, 'B/L ' || id AS holder
      FROM public.bls WHERE cancelled_at IS NULL AND public.ce_mercante_key(ce_mercante) IS NOT NULL
      UNION ALL
      SELECT public.ce_mercante_key(ce_mercante), 'Granito ' || bl_number
      FROM public.granite_bls WHERE public.ce_mercante_key(ce_mercante) IS NOT NULL
    ) AS holders
    GROUP BY holders.key
    HAVING count(*) > 1
  ) AS repeated;
  IF v_repeated IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 176 abortada: CE Mercante repetido entre B/Ls nao cancelados (%). Corrija ou cancele os B/Ls antes de aplicar.', v_repeated;
  END IF;
END
$precheck$;

CREATE UNIQUE INDEX IF NOT EXISTS bls_ce_mercante_active_key
  ON public.bls (public.ce_mercante_key(ce_mercante))
  WHERE cancelled_at IS NULL AND public.ce_mercante_key(ce_mercante) IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_ce_mercante_unique()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key text := public.ce_mercante_key(NEW.ce_mercante);
  v_holder text;
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
  v_self text := NEW.id::text;
  v_reactivation boolean;
BEGIN
  -- Granito não tem cancelamento; o jsonb evita ler coluna inexistente.
  v_reactivation := TG_TABLE_NAME = 'bls' AND TG_OP = 'UPDATE'
    AND v_old->>'cancelled_at' IS NOT NULL AND v_new->>'cancelled_at' IS NULL;
  IF v_key IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'bls' AND v_new->>'cancelled_at' IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NOT v_reactivation
     AND public.ce_mercante_key(v_old->>'ce_mercante') IS NOT DISTINCT FROM v_key THEN
    RETURN NEW;
  END IF;

  -- Serializa o mesmo CE: a segunda transação espera e vê o B/L da primeira.
  PERFORM pg_advisory_xact_lock(hashtextextended('ce_mercante:' || v_key, 0));

  SELECT holder INTO v_holder FROM (
    SELECT 'B/L ' || b.id AS holder
    FROM public.bls AS b
    WHERE b.cancelled_at IS NULL
      AND public.ce_mercante_key(b.ce_mercante) = v_key
      AND (TG_TABLE_NAME <> 'bls' OR b.id <> v_self)
    UNION ALL
    SELECT 'B/L de Granito ' || g.bl_number
    FROM public.granite_bls AS g
    WHERE public.ce_mercante_key(g.ce_mercante) = v_key
      AND (TG_TABLE_NAME <> 'granite_bls' OR g.id::text <> v_self)
  ) AS holders
  ORDER BY holder
  LIMIT 1;

  IF v_holder IS NOT NULL THEN
    IF v_reactivation THEN
      RAISE EXCEPTION 'O B/L % nao pode ser reativado: o CE Mercante % dele esta agora no %. Um CE so pode estar em um B/L nao cancelado.',
        v_self, NEW.ce_mercante, v_holder USING ERRCODE = 'P0010';
    END IF;
    RAISE EXCEPTION 'O CE Mercante % ja esta no %. Um CE so pode estar em um B/L nao cancelado: confira o numero ou cancele o outro B/L.',
      NEW.ce_mercante, v_holder USING ERRCODE = 'P0010';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_ce_mercante_unique ON public.bls;
CREATE TRIGGER guard_ce_mercante_unique
  BEFORE INSERT OR UPDATE OF ce_mercante, cancelled_at ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public.guard_ce_mercante_unique();

DROP TRIGGER IF EXISTS guard_ce_mercante_unique ON public.granite_bls;
CREATE TRIGGER guard_ce_mercante_unique
  BEFORE INSERT OR UPDATE OF ce_mercante ON public.granite_bls
  FOR EACH ROW EXECUTE FUNCTION public.guard_ce_mercante_unique();

-- Porta única do CE do B/L de carga.
CREATE OR REPLACE FUNCTION public.guard_bl_ce_mercante_port()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.ce_mercante IS DISTINCT FROM OLD.ce_mercante
     AND current_setting('vela.ce_mercante_port', true) IS DISTINCT FROM 'on'
     -- Manutenção (migration, script de superusuário sem papel de usuário) passa;
     -- sessão de usuário (`authenticated`/`anon`) nunca passa.
     AND (COALESCE(current_setting('request.jwt.claim.role', true), '') IN ('authenticated', 'anon')
          OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = session_user AND rolsuper)) THEN
    RAISE EXCEPTION 'O CE Mercante do B/L % muda so pela planilha de CE Mercante ou pela ficha do B/L (Corrigir ou Remover CE Mercante).', OLD.id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_bl_ce_mercante_port ON public.bls;
CREATE TRIGGER guard_bl_ce_mercante_port
  BEFORE UPDATE OF ce_mercante ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public.guard_bl_ce_mercante_port();

INSERT INTO public.alert_type_catalog(type, severity, responsible_department, audience_departments, default_destination)
VALUES ('comunicado_ce_reenvio_pendente', 'normal', 'documentacao', ARRAY['documentacao'], '/bls')
ON CONFLICT (type) DO NOTHING;

CREATE OR REPLACE FUNCTION public._set_bl_ce_mercante(
  p_bl_id text,
  p_ce text,
  p_actor uuid,
  p_reason text,
  p_source text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ce text := NULLIF(regexp_replace(COALESCE(p_ce, ''), '\s', '', 'g'), '');
  v_old text;
  v_previous text := current_setting('vela.ce_mercante_port', true);
  v_result text;
BEGIN
  IF v_ce IS NOT NULL AND v_ce !~ '^[0-9]{15}$' THEN
    RAISE EXCEPTION 'CE Mercante invalido para o B/L %: o CE tem 15 digitos (recebido "%").', p_bl_id, p_ce
      USING ERRCODE = '22023';
  END IF;

  SELECT ce_mercante INTO v_old FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF NULLIF(btrim(COALESCE(v_old, '')), '') IS NOT DISTINCT FROM v_ce THEN
    RETURN 'unchanged';
  END IF;

  PERFORM set_config('vela.ce_mercante_port', 'on', true);
  UPDATE public.bls SET ce_mercante = v_ce WHERE id = p_bl_id;
  PERFORM set_config('vela.ce_mercante_port', COALESCE(v_previous, 'off'), true);

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bl', p_bl_id, 'ce_mercante', COALESCE(v_old, ''), COALESCE(v_ce, ''), p_actor, p_reason);

  v_result := CASE
    WHEN v_ce IS NULL THEN 'removed'
    WHEN NULLIF(btrim(COALESCE(v_old, '')), '') IS NULL THEN 'inserted'
    ELSE 'overwritten'
  END;

  -- Comunicado de CE e Taxas já enviado com o CE anterior: o Cliente precisa
  -- recebê-lo de novo (ADR 0078, itens 4 e 5).
  IF v_result <> 'inserted' AND EXISTS (
    SELECT 1 FROM public.customer_communications AS c
    JOIN public.customer_communication_bls AS cb ON cb.communication_id = c.id
    WHERE cb.bl_id = p_bl_id AND c.kind = 'ce_mercante_taxas' AND c.status IN ('enviado', 'parcial')
  ) THEN
    BEGIN
      PERFORM public.upsert_alert_item(
        'comunicado_ce_reenvio_pendente', 'bl', p_bl_id,
        format('O CE Mercante do B/L %s mudou (%s -> %s) depois do Comunicado de CE e Taxas: reenvie o Comunicado ao Cliente.',
          p_bl_id, COALESCE(v_old, 'sem CE'), COALESCE(v_ce, 'removido')),
        p_source,
        jsonb_build_object('bl_id', p_bl_id, 'old_ce', v_old, 'new_ce', v_ce, 'reason', p_reason),
        '/bls/' || p_bl_id
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Nao foi possivel abrir a pendencia de reenvio do B/L %: %', p_bl_id, SQLERRM;
    END;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public._set_bl_ce_mercante(text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._set_bl_ce_mercante(text, text, uuid, text, text) TO service_role;

-- Planilha de CE Mercante: mesma porta; a planilha nunca remove CE.
CREATE OR REPLACE FUNCTION public.apply_ce_mercante_update(p_bl_id text, p_new_ce text, p_changed_by uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(COALESCE(p_new_ce, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Linha sem CE Mercante para o B/L %: a planilha nao remove CE (use Remover CE Mercante na ficha).', p_bl_id
      USING ERRCODE = '22023';
  END IF;

  v_result := public._set_bl_ce_mercante(p_bl_id, p_new_ce, v_actor, 'Importacao CE Mercante', 'ce_mercante_planilha');
  IF v_result = 'unchanged' THEN RETURN v_result; END IF;

  INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id, created_by)
  VALUES (gen_random_uuid(), 'local_billing', p_bl_id, v_actor)
  ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;

  RETURN v_result;
END;
$function$;

-- Ficha do B/L: Corrigir CE Mercante.
CREATE OR REPLACE FUNCTION public.correct_bl_ce_mercante(p_bl_id text, p_ce text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_old text;
  v_result text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da correcao do CE Mercante.' USING ERRCODE = '22023';
  END IF;
  SELECT ce_mercante INTO v_old FROM public.bls WHERE id = p_bl_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF NULLIF(btrim(COALESCE(v_old, '')), '') IS NULL THEN
    RAISE EXCEPTION 'O B/L % ainda nao tem CE Mercante: o CE entra pela planilha de CE Mercante, que tambem vincula o Manifesto Mercante.', p_bl_id
      USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(p_ce, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o CE Mercante correto (15 digitos). Para tirar o CE, use Remover CE Mercante.' USING ERRCODE = '22023';
  END IF;
  v_result := public._set_bl_ce_mercante(p_bl_id, p_ce, auth.uid(), 'Correcao do CE Mercante pela ficha: ' || v_reason, 'ce_mercante_ficha');
  RETURN jsonb_build_object('status', v_result, 'bl_id', p_bl_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.correct_bl_ce_mercante(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_bl_ce_mercante(text, text, text) TO authenticated, service_role;

-- Ficha do B/L: Remover CE Mercante (só sem fatura viva).
CREATE OR REPLACE FUNCTION public.remove_bl_ce_mercante(p_bl_id text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_invoices text;
  v_result text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da remocao do CE Mercante.' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  SELECT string_agg(i.invoice_number, ', ' ORDER BY i.invoice_number) INTO v_invoices
  FROM public.invoices AS i
  WHERE i.status NOT IN ('draft', 'cancelled', 'obsolete')
    AND (i.bl_id = p_bl_id OR EXISTS (SELECT 1 FROM public.invoice_bls AS ib WHERE ib.invoice_id = i.id AND ib.bl_id = p_bl_id));
  IF v_invoices IS NOT NULL THEN
    RAISE EXCEPTION 'O CE Mercante do B/L % nao pode ser removido: ha fatura emitida (%). O Administrativo precisa cancelar a fatura antes.', p_bl_id, v_invoices
      USING ERRCODE = 'P0011';
  END IF;
  v_result := public._set_bl_ce_mercante(p_bl_id, NULL, auth.uid(), 'Remocao do CE Mercante pela ficha: ' || v_reason, 'ce_mercante_ficha');
  RETURN jsonb_build_object('status', v_result, 'bl_id', p_bl_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.remove_bl_ce_mercante(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_bl_ce_mercante(text, text) TO authenticated, service_role;

-- A edição da ficha deixa de gravar o CE.
CREATE OR REPLACE FUNCTION public.save_bl_review(p_bl_id text, p_expected_updated_at timestamp with time zone, p_update_payload jsonb, p_audit_rows jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_current_updated_at timestamptz;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para revisar B/L.'
      USING ERRCODE = '42501';
  END IF;

  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'updated_at obrigatorio; recarregue o B/L antes de salvar'
      USING ERRCODE = 'PT409';
  END IF;

  SELECT updated_at INTO v_current_updated_at
  FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BL % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF v_current_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'BL % foi alterado por outro usuario; recarregue antes de salvar', p_bl_id
      USING ERRCODE = 'PT409';
  END IF;

  -- A cubagem breakbulk faltava na funcao legada. Persistimos primeiro sob o
  -- mesmo lock e repassamos a nova versao. Audit rows do navegador sao
  -- deliberadamente descartadas: os triggers registram os valores reais.
  IF p_update_payload ? 'bb_cbm' THEN
    UPDATE public.bls
    SET bb_cbm = NULLIF(p_update_payload->>'bb_cbm', '')::numeric
    WHERE id = p_bl_id
    RETURNING updated_at INTO v_current_updated_at;
  END IF;

  SELECT public.save_bl_review_legacy_070(
    p_bl_id,
    v_current_updated_at,
    -- O CE Mercante não muda pela edição da ficha: só por Corrigir/Remover
    -- CE Mercante (migration 176; ADR 0078, itens 1, 2 e 5).
    p_update_payload - 'bb_cbm' - 'ce_mercante',
    '[]'::jsonb,
    p_changed_by
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

-- Conciliação com a ZPT pela mesma chave da unicidade.
CREATE OR REPLACE FUNCTION public.ce_unlock_reconcile(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE total integer; unlocked integer; divergent integer; stale integer; ignored integer; unknown integer; summary jsonb; BEGIN
 IF NOT public.is_active_user() THEN RAISE EXCEPTION '42501: Acesso negado.' USING ERRCODE='42501'; END IF;
 PERFORM ce_unlock_private.actor(true);
 IF jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 20000 THEN RAISE EXCEPTION 'Arquivo da ZPT vazio ou grande demais (máximo de 20000 linhas)'; END IF;
 DROP TABLE IF EXISTS pg_temp.zpt_rows;
 CREATE TEMP TABLE zpt_rows ON COMMIT DROP AS
 SELECT bl_id,ce,zpt_status,descr,upd,pend,is_unlocked,exported_at IS NOT NULL was_exported,
 (NOT is_unlocked AND exported_at IS NOT NULL AND upd IS NOT NULL AND upd<exported_at) is_stale
 FROM (SELECT DISTINCT ON (b.id) b.id bl_id, b.ce_mercante ce, s.zpt_status, s.descr, s.upd, s.pend,
 lower(s.zpt_status)='desbloqueado' is_unlocked,
 (SELECT max(i.exported_at) FROM public.ce_unlock_request_bls i WHERE i.bl_id=b.id AND i.active) exported_at
 FROM (SELECT btrim(x->>'ce') ce, btrim(coalesce(x->>'status','')) zpt_status, nullif(btrim(x->>'description'),'') descr,
 nullif(x->>'updated_at','')::timestamptz upd, coalesce(ARRAY(SELECT jsonb_array_elements_text(x->'pending')),'{}'::text[]) pend
 FROM jsonb_array_elements(p_rows) x) s
 JOIN public.bls b ON public.ce_mercante_key(b.ce_mercante)=public.ce_mercante_key(s.ce) AND b.cancelled_at IS NULL
 WHERE s.zpt_status<>'' AND s.ce<>'' ORDER BY b.id, s.upd DESC NULLS LAST) q;
 INSERT INTO public.ce_unlock_zpt_status(bl_id,ce_mercante,status,zpt_status,description,pending,without_export,zpt_updated_at,reconciled_by)
 SELECT bl_id,ce,CASE WHEN is_unlocked THEN 'unlocked' ELSE 'divergent' END,zpt_status,descr,pend,is_unlocked AND NOT was_exported,upd,auth.uid()
 FROM zpt_rows WHERE is_unlocked OR (was_exported AND NOT is_stale)
 ON CONFLICT (bl_id) DO UPDATE SET ce_mercante=EXCLUDED.ce_mercante,status=EXCLUDED.status,zpt_status=EXCLUDED.zpt_status,description=EXCLUDED.description,
 pending=EXCLUDED.pending,without_export=EXCLUDED.without_export,zpt_updated_at=EXCLUDED.zpt_updated_at,reconciled_at=now(),reconciled_by=EXCLUDED.reconciled_by;
 DELETE FROM public.ce_unlock_zpt_status z USING zpt_rows r WHERE z.bl_id=r.bl_id AND NOT r.is_unlocked AND NOT r.was_exported;
 SELECT count(*) FILTER (WHERE is_unlocked), count(*) FILTER (WHERE NOT is_unlocked AND was_exported AND NOT is_stale),
 count(*) FILTER (WHERE is_stale), count(*) FILTER (WHERE NOT is_unlocked AND NOT was_exported)
 INTO unlocked,divergent,stale,ignored FROM zpt_rows;
 total:=jsonb_array_length(p_rows);
 SELECT count(*) INTO unknown FROM jsonb_array_elements(p_rows) x WHERE NOT EXISTS(SELECT 1 FROM public.bls b WHERE public.ce_mercante_key(b.ce_mercante)=public.ce_mercante_key(x->>'ce') AND b.cancelled_at IS NULL);
 summary:=jsonb_build_object('rows',total,'unlocked',unlocked,'divergent',divergent,'stale',stale,'ignored',ignored,'unknown_ce',unknown);
 INSERT INTO public.ce_unlock_events(action,actor_id,payload) VALUES('reconcile',auth.uid(),summary);
 RETURN summary;
END $function$;

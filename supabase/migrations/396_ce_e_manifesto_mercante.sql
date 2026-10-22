-- 396: CE e Manifesto Mercante (Lote 5 do plano
-- docs/plans/2026-10-21-frente-das-importacoes.md; ADR 0095, decisões 19 e
-- 20; achados F-49, F-53, F-17 e F-18 da revisão
-- docs/archive/audits/2026-10-21-revisao-importacoes.md).
--
-- Problemas:
--   1. (F-49, decisão 19) Remover o CE pela ficha ou cancelar o B/L deixava o
--      B/L vinculado ao Manifesto Mercante (`bls.manifesto_mercante_id`).
--   2. (Decisão 20) Mudar a rota (POL, POD ou Viagem) desvinculava o
--      Manifesto, mas o CE ficava, sem nenhum aviso.
--   3. (F-49) O espelho `voyage_route_ce_master` aceitava INSERT e UPDATE
--      direto de `authenticated` (limpar o número sem a RPC).
--   4. (F-49) `set_import_batch_ce_master` gravava no lote um Nº que a rota
--      recusou (ou que nem existe na Viagem).
--   5. (F-49) "Informar" e a planilha de CE ao mesmo tempo, com o mesmo Nº,
--      davam 23505 cru: as duas sessões inseriam o mesmo Manifesto.
--   6. (F-53) `set_voyage_route_ce_master` de 5 argumentos chamava a de 6 com
--      5 argumentos e dava "function ... is not unique".
--   7. (F-17/ADR 0094 B3) No modo diferido da planilha de CE (o da tela), a
--      falha de cálculo das Taxas Locais chegava crua ("Cambio (ROE) nao
--      configurado"), sem o B/L nem o formato da B3.
--   8. (F-18) `apply_ce_mercante_rows_atomic` não declarava
--      `statement_timeout`, diferente das 333, 334 e 335.
--
-- Mudança:
--   1. Gatilho `manifesto_follows_ce_and_cancel` (BEFORE UPDATE OF
--      ce_mercante, cancelled_at, manifesto_mercante_id ON bls):
--      * CE removido (tinha, ficou sem): o B/L sai do Manifesto, com Histórico
--        "Saiu do Manifesto Mercante: CE Mercante removido.". Registrar o CE de
--        novo é só pela planilha de CE, que vincula o Manifesto da planilha.
--      * B/L cancelado: sai do Manifesto, com Histórico, e o Manifesto fica
--        guardado em `bl_manifesto_mercante_parking`.
--      * B/L reativado: volta ao Manifesto guardado, com Histórico, se o
--        Manifesto ainda existe, é da Viagem e da rota do B/L e o B/L tem CE.
--        Senão a guarda é descartada e o B/L fica fora (a planilha o recoloca).
--   2. Alerta `ce_fora_do_manifesto_da_rota` (normal, Documentação, entidade
--      `bl`): abre quando o B/L ativo com CE muda de rota e fica sem
--      Manifesto (`unlink_manifesto_on_route_change`, redefinida); fecha
--      quando o CE muda (troca ou remoção), quando o B/L entra num Manifesto
--      (que, por Mover ou pela planilha, é sempre da rota do B/L) ou quando é
--      cancelado. Excluir o B/L apaga o alerta (347). Falha ao mexer no alerta
--      vira WARNING e não desfaz a gravação.
--   3. `voyage_route_ce_master`: sem INSERT, UPDATE nem DELETE para
--      `authenticated` e `anon` (grants e policies); escrita só pelas RPCs
--      (SECURITY DEFINER). SELECT continua.
--   4. `set_import_batch_ce_master`: o Nº precisa ter 13 caracteres e estar
--      cadastrado num Manifesto da Viagem do lote; limpar exige que o Nº antigo
--      não esteja mais cadastrado na Viagem (a rota não o recusou).
--   5. `set_voyage_route_ce_master` pega a trava `import_voyage:<id>` (387)
--      antes da trava da rota, e espera a planilha da mesma Viagem.
--      `_upsert_route_manifesto` traduz a corrida que sobrar (23505) em
--      "já cadastrado" (mesma rota: devolve o existente; outra: P0012).
--   6. DROP da `set_voyage_route_ce_master` de 5 argumentos; a de 6 tem
--      `p_cargo_mode` com padrão e atende as chamadas de 5.
--   7. `trg_auto_bill_bl_after_ce_mercante` (modo diferido) recusa com
--      `_raise_local_charge_failure` (379): "Taxas Locais do B/L X não
--      calculadas: …". `_ce_row_error_message` devolve essa mensagem como veio,
--      qualquer que seja o SQLSTATE.
--   8. `apply_ce_mercante_rows_atomic` com `statement_timeout = 60s`.
--   9. Acerto: B/L cancelado ainda vinculado sai do Manifesto, com Histórico, e
--      o Manifesto fica guardado para a reativação.
--
-- Reescreve linhas existentes (acerto 9: `bls.manifesto_mercante_id` dos B/Ls
-- cancelados). Depende da afirmação "Data status" do AGENTS.md (seção
-- Gotchas): o banco de produção só tem dados de teste.
--
-- ponytail: a guarda do Manifesto vale só para o cancelamento. O CE removido
-- não guarda o Manifesto porque o CE só volta pela planilha, que traz o Nº.
--
-- Rollback: DROP TRIGGER manifesto_follows_ce_and_cancel e
-- resolve_ce_fora_do_manifesto ON public.bls; DROP das funções novas e da
-- tabela bl_manifesto_mercante_parking; reaplicar as definições anteriores de
-- unlink_manifesto_on_route_change (207), set_import_batch_ce_master (002),
-- set_voyage_route_ce_master (217), _upsert_route_manifesto (181),
-- trg_auto_bill_bl_after_ce_mercante (379) e _ce_row_error_message (195);
-- recriar a sobrecarga de 5 argumentos e as policies/grants do espelho (002);
-- ALTER FUNCTION apply_ce_mercante_rows_atomic RESET statement_timeout;
-- UPDATE alert_type_catalog SET active = false WHERE type =
-- 'ce_fora_do_manifesto_da_rota'. O acerto 9 tem volta pela guarda: os
-- Históricos com "migration 396" dizem o que saiu.

-- 1 -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bl_manifesto_mercante_parking (
  bl_id text PRIMARY KEY REFERENCES public.bls(id) ON DELETE CASCADE,
  manifesto_mercante_id uuid NOT NULL REFERENCES public.manifestos_mercante(id) ON DELETE CASCADE,
  parked_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.bl_manifesto_mercante_parking IS
  'Manifesto Mercante de que o B/L saiu ao ser cancelado (396); a reativação o recoloca. Só o gatilho escreve.';
ALTER TABLE public.bl_manifesto_mercante_parking ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bl_manifesto_mercante_parking FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.bl_manifesto_mercante_parking TO service_role;

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
             IS NOT DISTINCT FROM COALESCE(public.normalize_port_code(NEW.pod), upper(btrim(NEW.pod))) THEN
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

REVOKE ALL ON FUNCTION public.manifesto_follows_ce_and_cancel() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS manifesto_follows_ce_and_cancel ON public.bls;
CREATE TRIGGER manifesto_follows_ce_and_cancel
  BEFORE UPDATE OF ce_mercante, cancelled_at, manifesto_mercante_id ON public.bls
  FOR EACH ROW
  WHEN (OLD.ce_mercante IS DISTINCT FROM NEW.ce_mercante
     OR OLD.cancelled_at IS DISTINCT FROM NEW.cancelled_at
     OR OLD.manifesto_mercante_id IS DISTINCT FROM NEW.manifesto_mercante_id)
  EXECUTE FUNCTION public.manifesto_follows_ce_and_cancel();

-- 2 -------------------------------------------------------------------------
INSERT INTO public.alert_type_catalog (type, severity, responsible_department, audience_departments, default_destination)
VALUES ('ce_fora_do_manifesto_da_rota', 'normal', 'documentacao', ARRAY['documentacao'], '/bls')
ON CONFLICT (type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.unlink_manifesto_on_route_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_route_changed boolean := NEW.voyage_id IS DISTINCT FROM OLD.voyage_id
    OR public.normalize_port_code(NEW.pol) IS DISTINCT FROM public.normalize_port_code(OLD.pol)
    OR public.normalize_port_code(NEW.pod) IS DISTINCT FROM public.normalize_port_code(OLD.pod);
  v_old_numero text;
  v_previous text;
BEGIN
  IF NOT v_route_changed THEN
    RETURN NEW;
  END IF;
  IF OLD.manifesto_mercante_id IS NOT NULL
     AND NEW.manifesto_mercante_id IS NOT DISTINCT FROM OLD.manifesto_mercante_id THEN
    SELECT numero INTO v_old_numero FROM public.manifestos_mercante WHERE id = OLD.manifesto_mercante_id;
    NEW.manifesto_mercante_id := NULL;
    PERFORM public._audit_skip_once('bls', OLD.id, 'manifesto_mercante_id');
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bl', OLD.id, 'manifesto_mercante', v_old_numero, NULL, auth.uid(),
      'Desvínculo automático: o POL, o POD ou a Viagem do B/L mudou.');
  END IF;

  -- Decisão 20 (396): B/L ativo com CE que mudou de rota e ficou sem
  -- Manifesto: a Documentação inclui o B/L no Manifesto da rota nova ou corrige
  -- o CE.
  IF NEW.cancelled_at IS NULL AND NEW.manifesto_mercante_id IS NULL
     AND NULLIF(btrim(COALESCE(NEW.ce_mercante, '')), '') IS NOT NULL THEN
    v_previous := current_setting('alerts.foundation_trigger', true);
    BEGIN
      PERFORM set_config('alerts.foundation_trigger', 'on', true);
      PERFORM public.upsert_alert_item(
        'ce_fora_do_manifesto_da_rota', 'bl', NEW.id,
        format('CE fora do Manifesto da rota: o B/L %s (CE %s) mudou de rota (%s → %s) e saiu do Manifesto Mercante%s. Inclua o B/L no Manifesto da rota nova ou corrija o CE.',
          NEW.id, btrim(NEW.ce_mercante),
          COALESCE(public.normalize_port_code(NEW.pol), NULLIF(upper(btrim(NEW.pol)), ''), '?'),
          COALESCE(public.normalize_port_code(NEW.pod), NULLIF(upper(btrim(NEW.pod)), ''), '?'),
          COALESCE(' ' || v_old_numero, '')),
        'bl_route_change',
        jsonb_build_object('bl_id', NEW.id, 'ce_mercante', btrim(NEW.ce_mercante),
          'old_manifesto', v_old_numero, 'voyage_id', NEW.voyage_id, 'pol', NEW.pol, 'pod', NEW.pod,
          'old_voyage_id', OLD.voyage_id, 'old_pol', OLD.pol, 'old_pod', OLD.pod),
        '/bls/' || NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Alerta de CE fora do Manifesto da rota do B/L % não aberto: %', NEW.id, SQLERRM;
    END;
    PERFORM set_config('alerts.foundation_trigger', COALESCE(v_previous, ''), true);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_ce_fora_do_manifesto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_previous text := current_setting('alerts.foundation_trigger', true);
  v_resolution text := CASE
    WHEN OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL THEN 'bl_cancelled'
    WHEN OLD.ce_mercante IS DISTINCT FROM NEW.ce_mercante THEN 'ce_changed'
    ELSE 'manifesto_linked'
  END;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'ce_fora_do_manifesto_da_rota' AND i.status = 'active'
      AND a.entity_type = 'bl' AND a.entity_id = NEW.id) THEN
    RETURN NULL;
  END IF;
  BEGIN
    PERFORM set_config('alerts.foundation_trigger', 'on', true);
    PERFORM public.resolve_alert_item('ce_fora_do_manifesto_da_rota', 'bl', NEW.id, v_resolution,
      jsonb_build_object('resolution', v_resolution));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Alerta de CE fora do Manifesto da rota do B/L % não fechado: %', NEW.id, SQLERRM;
  END;
  PERFORM set_config('alerts.foundation_trigger', COALESCE(v_previous, ''), true);
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_ce_fora_do_manifesto() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS resolve_ce_fora_do_manifesto ON public.bls;
CREATE TRIGGER resolve_ce_fora_do_manifesto
  AFTER UPDATE OF ce_mercante, manifesto_mercante_id, cancelled_at ON public.bls
  FOR EACH ROW
  WHEN (OLD.ce_mercante IS DISTINCT FROM NEW.ce_mercante
     OR (NEW.manifesto_mercante_id IS NOT NULL AND NEW.manifesto_mercante_id IS DISTINCT FROM OLD.manifesto_mercante_id)
     OR (OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL))
  EXECUTE FUNCTION public.resolve_ce_fora_do_manifesto();

-- 3 -------------------------------------------------------------------------
DROP POLICY IF EXISTS voyage_route_ce_master_insert_active_global ON public.voyage_route_ce_master;
DROP POLICY IF EXISTS voyage_route_ce_master_update_active_global ON public.voyage_route_ce_master;
DROP POLICY IF EXISTS voyage_route_ce_master_delete_admin ON public.voyage_route_ce_master;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.voyage_route_ce_master FROM PUBLIC, anon, authenticated;

-- 4 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_import_batch_ce_master(p_batch_id bigint, p_ce_master text, p_changed_by uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_batch public.import_batches%ROWTYPE;
  v_normalized text := public.canonical_manifesto_numero(p_ce_master);
  v_old_value text;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para editar CE Master.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_batch FROM public.import_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote de importacao % nao encontrado', p_batch_id
      USING ERRCODE = 'P0002';
  END IF;

  v_old_value := NULLIF(btrim(COALESCE(v_batch.ce_master, '')), '');
  IF v_old_value IS NOT DISTINCT FROM v_normalized THEN
    RETURN;
  END IF;

  -- 396 (F-49): o lote guarda só o Nº que a rota aceitou.
  IF v_normalized IS NOT NULL THEN
    IF v_normalized !~ '^[A-Z0-9]{13}$' THEN
      RAISE EXCEPTION 'Nº de Manifesto Mercante inválido: "%". O número tem 13 caracteres, letras ou dígitos (ex.: 1226501860578).', p_ce_master
        USING ERRCODE = 'P0012';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.manifestos_mercante m
                   WHERE m.numero = v_normalized AND m.voyage_id = v_batch.voyage_id) THEN
      RAISE EXCEPTION 'O Nº de Manifesto Mercante % não está cadastrado em uma rota desta Viagem: informe-o na rota antes.', v_normalized
        USING ERRCODE = '22023';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.manifestos_mercante m
                WHERE m.numero = public.canonical_manifesto_numero(v_old_value) AND m.voyage_id = v_batch.voyage_id) THEN
    RAISE EXCEPTION 'O Nº de Manifesto Mercante % continua cadastrado na rota: tire o número da rota antes.', v_old_value
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.import_batches SET ce_master = v_normalized WHERE id = p_batch_id;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('import_batches', COALESCE(v_batch.voyage_id::text, p_batch_id::text), 'ce_master',
    v_old_value, v_normalized, p_changed_by, 'Atualizacao manual de CE Master');
END;
$function$;

-- 5 e 6 ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.set_voyage_route_ce_master(bigint, text, text, text, uuid);

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
    RAISE EXCEPTION 'Usuario sem permissao ativa para editar o Nº de Manifesto Mercante.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem % nao encontrada', p_voyage_id USING ERRCODE = 'P0002';
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
      CASE WHEN v_mode = 'vazios' THEN 'vazio' ELSE 'carga' END, v_norm);
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
            CASE WHEN v_mode = 'vazios' THEN 'Nº de Manifesto Mercante por rota (vazios)'
                 ELSE 'Nº de Manifesto Mercante por rota' END);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_voyage_route_ce_master(bigint, text, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_voyage_route_ce_master(bigint, text, text, text, uuid, text) TO authenticated;

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
  v_existing public.manifestos_mercante%ROWTYPE;
  v_id uuid;
  v_attempt integer := 0;
BEGIN
  LOOP
    SELECT * INTO v_existing FROM public.manifestos_mercante WHERE numero = v_numero FOR UPDATE;
    IF FOUND THEN
      IF v_existing.voyage_id IS DISTINCT FROM p_voyage_id
         OR COALESCE(public.normalize_port_code(v_existing.pol), upper(v_existing.pol)) <> v_pol
         OR COALESCE(public.normalize_port_code(v_existing.pod), upper(v_existing.pod)) <> v_pod
         OR v_existing.natureza <> p_natureza THEN
        RAISE EXCEPTION 'O Manifesto Mercante % já está cadastrado para outra viagem, rota ou natureza.', v_numero
          USING ERRCODE = 'P0012';
      END IF;
      RETURN v_existing.id;
    END IF;
    BEGIN
      INSERT INTO public.manifestos_mercante (voyage_id, pol, pod, numero, natureza)
      VALUES (p_voyage_id, v_pol, v_pod, v_numero, p_natureza)
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

-- 7 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_auto_bill_bl_after_ce_mercante()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_previous_request_role text := current_setting('request.jwt.claim.role', true);
  v_role_impersonated boolean := false;
  v_result jsonb;
BEGIN
  -- Emissão em lotes (migration 181): a planilha grava o CE e o cálculo na
  -- transação e a tela emite logo depois por `emit_ce_mercante_billing`; o
  -- efeito local_billing registrado na gravação fica como rede.
  IF current_setting('vela.ce_billing_deferred', true) = 'on' THEN
    BEGIN
      PERFORM public.calculate_bl_local_charges(NEW.id, v_actor, true);
    EXCEPTION WHEN OTHERS THEN
      -- 396 (ADR 0094, B3; F-17): a planilha recusa com o B/L e o que falta.
      PERFORM public._raise_local_charge_failure(NEW.id, SQLSTATE, SQLERRM);
    END;
    RETURN NEW;
  END IF;

  v_result := public.auto_bill_bl_after_ce_mercante(NEW.id, v_actor);
  IF v_result->>'reason' = 'auto_billing_failed'
     AND coalesce(v_result->>'message', '') LIKE 'Taxas Locais do B/L % não calculadas:%' THEN
    PERFORM public._raise_local_charge_failure(NEW.id, v_result->>'sqlstate', v_result->>'message');
  END IF;

  -- 288: sem Cliente conciliado o faturamento para antes de calcular. O CE
  -- recém-cadastrado confirma o cálculo mesmo assim (rateio com os irmãos já
  -- gravados); a fatura espera o Cliente.
  IF v_result->>'reason' = 'customer_reconciliation_pending'
     AND NULLIF(BTRIM(OLD.ce_mercante), '') IS NULL THEN
    BEGIN
      PERFORM public.calculate_bl_local_charges(NEW.id, v_actor, true);
    EXCEPTION WHEN OTHERS THEN
      -- 379 (ADR 0094, B3): o CE gravado pela ficha é recusado com a falha.
      PERFORM public._raise_local_charge_failure(NEW.id, SQLSTATE, SQLERRM);
    END;
  END IF;

  -- `held` é a retenção do Portal: quem a desfaz é a ativação do Portal ou a
  -- Liberação, não uma nova tentativa da fila.
  IF v_result->>'status' NOT IN ('invoiced', 'already_invoiced', 'skipped', 'held')
     AND NOT EXISTS (
       SELECT 1
       FROM public.import_pending_effects AS e
       WHERE e.entity_id = NEW.id
         AND e.effect_kind = 'local_billing'
         AND e.status IN ('pending', 'running', 'retry_wait')
     ) THEN
    IF auth.uid() IS NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
      PERFORM set_config('request.jwt.claim.role', 'service_role', true);
      v_role_impersonated := true;
    END IF;

    PERFORM public.enqueue_import_effect(
      gen_random_uuid(),
      'local_billing',
      NEW.id,
      v_actor,
      1,
      NULL,
      jsonb_build_object(
        'source', 'ce_mercante_auto_billing',
        'ce_mercante', NEW.ce_mercante,
        'reason', v_result->>'reason',
        'message', v_result->>'message',
        'actor_source', CASE WHEN v_actor IS NULL THEN 'system' ELSE 'request' END
      )
    );

    IF v_role_impersonated THEN
      PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_request_role, ''), true);
      v_role_impersonated := false;
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    IF v_role_impersonated THEN
      PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_request_role, ''), true);
    END IF;
    RAISE;
END;
$function$;

CREATE OR REPLACE FUNCTION public._ce_row_error_message(p_sqlstate text, p_message text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    -- 396 (ADR 0094, B3): a recusa de cálculo já vem com o B/L e o que falta.
    WHEN p_message LIKE 'Taxas Locais do B/L % não calculadas:%' THEN p_message
    WHEN p_sqlstate IN ('P0010', '22023', 'P0002', 'P0003', 'P0011', 'P0012', '42501') THEN p_message
    WHEN p_sqlstate = '23505' THEN 'Este CE Mercante ou Manifesto já está em outro registro; confira o número.'
    WHEN p_sqlstate IN ('40P01', '40001', '55P03') THEN 'Outra gravação estava usando os mesmos B/Ls; importe de novo.'
    WHEN p_sqlstate = '57014' THEN 'A gravação demorou demais; importe a planilha em partes menores.'
    WHEN p_sqlstate LIKE 'P0%' THEN p_message
    ELSE 'Não foi possível gravar o CE desta linha. Confira o B/L e o CE.'
  END;
$function$;

-- 8 -------------------------------------------------------------------------
-- O PostgREST (v12+) aplica o `statement_timeout` da função à transação da
-- chamada, como nas 333, 334 e 335 (F-18).
ALTER FUNCTION public.apply_ce_mercante_rows_atomic(jsonb, uuid, text, text, bigint, boolean, text, boolean)
  SET statement_timeout TO '60s';

-- 9 -------------------------------------------------------------------------
-- Depende do "Data status" do AGENTS.md: B/L cancelado ainda vinculado sai do
-- Manifesto, com Histórico, e o vínculo fica guardado para a reativação. B/L
-- de Viagem cancelada fica como está (a Viagem é selada).
INSERT INTO public.bl_manifesto_mercante_parking (bl_id, manifesto_mercante_id)
SELECT b.id, b.manifesto_mercante_id
FROM public.bls AS b
WHERE b.cancelled_at IS NOT NULL AND b.manifesto_mercante_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.voyages AS v WHERE v.id = b.voyage_id AND v.status = 'cancelled')
ON CONFLICT (bl_id) DO NOTHING;

INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
SELECT 'bl', b.id, 'manifesto_mercante', m.numero, NULL, NULL,
  'Saiu do Manifesto Mercante: B/L cancelado (acerto da migration 396).'
FROM public.bls AS b
JOIN public.manifestos_mercante AS m ON m.id = b.manifesto_mercante_id
WHERE b.cancelled_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.voyages AS v WHERE v.id = b.voyage_id AND v.status = 'cancelled');

DO $acerto$
DECLARE
  v_id text;
BEGIN
  FOR v_id IN SELECT bl_id FROM public.bl_manifesto_mercante_parking LOOP
    PERFORM public._audit_skip_once('bls', v_id, 'manifesto_mercante_id');
  END LOOP;
  UPDATE public.bls AS b SET manifesto_mercante_id = NULL
  FROM public.bl_manifesto_mercante_parking AS p
  WHERE p.bl_id = b.id AND b.cancelled_at IS NOT NULL AND b.manifesto_mercante_id IS NOT NULL;
END
$acerto$;

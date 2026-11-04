-- 583: baixa, cancelamento de baixa, Restituição e Conciliação Pix só do
-- Financeiro e da conta Dev; cancelar fatura com o Financeiro; cancelar Invoice
-- de Demurrage e mudar a Régua também com o Financeiro e Equipamentos.
--
-- Decisão do dono de 2026-11-04 (revisão da matriz "O que cada setor pode"):
--
--   | Ação                                                          | Antes            | Agora                       |
--   |---------------------------------------------------------------|------------------|-----------------------------|
--   | Registrar pagamento (baixa manual) e confirmar Restituição    | Adm, Fin         | Fin e conta Dev             |
--   | Cancelar baixa (Taxas Locais e Demurrage)                     | Adm              | Fin e conta Dev             |
--   | Preparar cancelamento financeiro de B/L (fatura paga)         | Adm              | Fin e conta Dev             |
--   | Registrar pagamento de Invoice de Demurrage                   | Adm, Fin         | Fin e conta Dev             |
--   | Conciliar Pix (vincular, confirmar, exceção, recebimento Itaú) | Adm, Fin         | Fin e conta Dev             |
--   | Cancelar fatura (sem pagamento), inclusive consolidada        | Adm              | Adm, Fin (e a conta Dev)    |
--   | Cancelar Invoice de Demurrage; mudar o intervalo da Régua     | Adm              | Adm, Fin, Equ (e a conta Dev) |
--
-- A conta Dev (ADR 0104, `is_dev_user()`: conta ativa do Administrativo com a
-- marca dada por migration) pode tudo de qualquer setor; nas ações acima que
-- saem do Administrativo ela entra pelo novo predicado
-- `is_financeiro_or_dev_user()`. Nas demais ela já passa como Administrativo.
-- Liquidar Ajuste de COD continua com Financeiro e Administrativo
-- (`settle_cod_adjustment` segue com `is_financeiro_user()`, que inclui o
-- Administrativo desde a 002), e cancelar fatura passa a usar esse mesmo
-- predicado. Cancelar fatura e Invoice de Demurrage continua recusado com
-- pagamento registrado (`_cancel_invoice_core`, `cancel_demurrage_invoice`):
-- a fatura paga primeiro tem a baixa cancelada pelo Financeiro.
--
-- Como: cada guarda é trocada no lugar (`pg_get_functiondef` + `replace`, como
-- a 578, a 579 e a 582), com a conferência de que o trecho aparece exatamente
-- uma vez; assinatura, SECURITY DEFINER, search_path, grants e o resto do
-- corpo ficam iguais. As funções internas da baixa (`register_*_payment`,
-- `reconcile_invoice_payment_by_txid`) e as camadas antigas do cancelamento de
-- baixa (`reverse_invoice_payment_legacy_134` > `_reverse_invoice_payment_impl_109`,
-- que só `reverse_invoice_payment` chama) trocam junto, porque herdam o usuário
-- de quem chama: a baixa automática Itaú entra como a conta de integração
-- (`app_settings.itau_pix_settlement_actor`), que é do Financeiro desde a 440;
-- se ela ainda for de outro setor, o Pix vai para análise com "Sem permissão
-- de faturamento." até a conta passar para o Financeiro (aviso no fim).
-- Funções antigas sem EXECUTE para `authenticated` (`*_legacy_*`,
-- `settle_invoice_refund`, `register_invoice_correction_refund`) ficam como
-- estão. A leitura (policies de `invoice_refunds`, `itau_pix_receipt_failures`)
-- não muda.
--
-- Plano de preservação: a migration não grava, não reescreve nem apaga linha
-- existente: cria uma função e redefine guardas de funções. Conferir: a bateria
-- `src/integration/permissoesPorPerfil.local-pg.test.ts` (P5, P14 e "Dev") e
-- `SELECT pg_get_functiondef(...)` das funções abaixo. Desfazer: reaplicar a
-- definição anterior de cada função (pg_get_functiondef antes desta migration,
-- ou trocar de volta os trechos listados abaixo) e remover
-- `is_financeiro_or_dev_user()`.

-- 1 --- Quem é Financeiro ou Dev ---------------------------------------------
CREATE OR REPLACE FUNCTION public.is_financeiro_or_dev_user()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Financeiro ativo (pessoa ou a conta de integração da baixa Itaú) ou a
  -- conta Dev, que pode tudo de qualquer setor (decisão do dono de 2026-11-04).
  SELECT (EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.id = auth.uid()
      AND p.active = true
      AND p.role = 'financeiro'
  ) AND public._internal_token_current())
  OR public.is_dev_user();
$function$;

REVOKE ALL ON FUNCTION public.is_financeiro_or_dev_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_financeiro_or_dev_user() TO authenticated;

-- 2 --- Guardas trocadas no lugar --------------------------------------------
DO $patch$
DECLARE
  v_patch record;
  v_def text;
BEGIN
  FOR v_patch IN
    SELECT * FROM (VALUES
      -- Baixa manual de Taxas Locais e avulsa, e as internas que ela chama.
      ('public.register_verified_invoice_payment(bigint,numeric,text,timestamp with time zone,text,uuid,text)',
       'public.is_financeiro_user()', 'public.is_financeiro_or_dev_user()'),
      ('public.register_invoice_payment(bigint,numeric,text,timestamp with time zone,text,uuid)',
       'public.is_financeiro_user()', 'public.is_financeiro_or_dev_user()'),
      ('public.register_ledger_invoice_payment(bigint,numeric,text,timestamp with time zone,text,text,text,uuid)',
       'public.is_financeiro_user()', 'public.is_financeiro_or_dev_user()'),
      ('public.register_ledger_invoice_payment(bigint,numeric,text,timestamp with time zone,text,text,text,uuid,uuid)',
       'public.is_financeiro_user()', 'public.is_financeiro_or_dev_user()'),
      ('public.reconcile_invoice_payment_by_txid(text,numeric,timestamp with time zone)',
       'public.is_financeiro_user()', 'public.is_financeiro_or_dev_user()'),
      -- Confirmar Restituição (e o gatilho que confere a devolução).
      ('public.confirm_invoice_refund(bigint,text,text,timestamp with time zone)',
       'public.is_financeiro_user()', 'public.is_financeiro_or_dev_user()'),
      ('public.confirm_demurrage_refund(bigint,text,text,timestamp with time zone)',
       'public.is_financeiro_user()', 'public.is_financeiro_or_dev_user()'),
      ('public.guard_financial_refund_evidence()',
       'public.is_financeiro_user()', 'public.is_financeiro_or_dev_user()'),
      -- Registrar pagamento de Invoice de Demurrage (o service_role segue aceito).
      ('public.register_demurrage_payment(uuid,bigint,date,text,numeric,numeric)',
       'public.is_financeiro_user()', 'public.is_financeiro_or_dev_user()'),
      -- Cancelar baixa e preparar cancelamento financeiro de B/L.
      ('public.reverse_invoice_payment(bigint,text,uuid)',
       'public.is_admin()', 'public.is_financeiro_or_dev_user()'),
      -- Camadas antigas que só reverse_invoice_payment chama (134 > 109), com
      -- guarda própria do Administrativo.
      ('public.reverse_invoice_payment_legacy_134(bigint,text,uuid)',
       'public.is_admin()', 'public.is_financeiro_or_dev_user()'),
      ('public._reverse_invoice_payment_impl_109(bigint,text,uuid)',
       'public.is_admin()', 'public.is_financeiro_or_dev_user()'),
      ('public.reverse_demurrage_payment(bigint,text,uuid)',
       'public.is_admin()', 'public.is_financeiro_or_dev_user()'),
      ('public.prepare_bl_financial_cancellation(bigint,text,text)',
       $s$NOT public.is_admin() THEN RAISE EXCEPTION 'Somente o Administrativo prepara cancelamento financeiro.'$s$,
       $s$NOT public.is_financeiro_or_dev_user() THEN RAISE EXCEPTION 'Somente o Financeiro prepara cancelamento financeiro.'$s$),
      -- Conciliação Pix e Pix recebidos.
      ('public.link_pix_reconciliation_candidate(bigint,text,bigint,bigint)',
       'public.is_financeiro_user()', 'public.is_financeiro_or_dev_user()'),
      ('public.confirm_unified_pix_matches(jsonb)',
       $s$-- Conciliar é do Financeiro e do Administrativo (ADR 0085, D5).
  IF auth.uid() IS NULL OR NOT public.is_financeiro_user() THEN$s$,
       $s$-- Conciliar é do Financeiro e da conta Dev (decisão do dono de 2026-11-04; 583).
  IF auth.uid() IS NULL OR NOT public.is_financeiro_or_dev_user() THEN$s$),
      ('public.confirm_demurrage_pix_matches(jsonb)',
       'public.is_financeiro_user()', 'public.is_financeiro_or_dev_user()'),
      ('public.upsert_pix_reconciliation_exceptions(text,jsonb)',
       'public.is_financeiro_user()', 'public.is_financeiro_or_dev_user()'),
      ('public.resolve_pix_reconciliation_exception(bigint,text,bigint,bigint,text)',
       'public.is_financeiro_user()', 'public.is_financeiro_or_dev_user()'),
      ('public.itau_pix_mark_receipt_handled(text,text)',
       'public.is_financeiro_user()', 'public.is_financeiro_or_dev_user()'),
      ('public.list_itau_pix_receipt_candidates(text,text)',
       'public.is_financeiro_user()', 'public.is_financeiro_or_dev_user()'),
      ('public.itau_pix_settle_received(text,text,bigint)',
       'public.is_financeiro_user()', 'public.is_financeiro_or_dev_user()'),
      -- Cancelar fatura sem pagamento: Administrativo ou Financeiro
      -- (`is_financeiro_user()` inclui o Administrativo e a conta Dev).
      ('public.cancel_invoice(bigint,text,uuid)',
       'public.is_admin()', 'public.is_financeiro_user()'),
      ('public.obsolete_consolidated_invoice(bigint,text,uuid)',
       'public.is_admin()', 'public.is_financeiro_user()'),
      -- Recusa de Remover CE com fatura viva: quem cancela agora é Adm ou Fin.
      ('public.remove_bl_ce_mercante(text,text,text)',
       'O Administrativo precisa cancelar a fatura antes.',
       'O Administrativo ou o Financeiro precisa cancelar a fatura antes.'),
      -- Cancelar Invoice de Demurrage: Administrativo, Financeiro ou Equipamentos.
      ('public.cancel_demurrage_invoice(uuid,bigint,text)',
       'AND (auth.uid() IS NULL OR NOT public.is_admin()) THEN',
       $s$AND (auth.uid() IS NULL OR NOT public.is_active_user()
          OR coalesce(public.current_actor_role(), '') NOT IN ('administrativo', 'financeiro', 'equipamentos')) THEN$s$),
      -- Mudar o intervalo da Régua: Administrativo, Financeiro ou Equipamentos.
      ('public.set_demurrage_dunning_interval_days(integer)',
       $s$IF v_role IS DISTINCT FROM 'administrativo' THEN
    RAISE EXCEPTION 'Somente o perfil administrativo pode alterar o intervalo da régua.'$s$,
       $s$IF coalesce(v_role, '') NOT IN ('administrativo', 'financeiro', 'equipamentos') THEN
    RAISE EXCEPTION 'Mudar o intervalo da régua é do Administrativo, do Financeiro ou de Equipamentos.'$s$)
    ) AS p(fn, old_text, new_text)
  LOOP
    v_def := pg_get_functiondef(v_patch.fn::regprocedure);
    IF (length(v_def) - length(replace(v_def, v_patch.old_text, ''))) / length(v_patch.old_text) <> 1 THEN
      RAISE EXCEPTION '583: guarda não encontrada uma única vez em %', v_patch.fn;
    END IF;
    EXECUTE replace(v_def, v_patch.old_text, v_patch.new_text);
  END LOOP;
END;
$patch$;

-- 3 --- Aviso: a conta da baixa automática Itaú precisa ser do Financeiro ----
DO $aviso$
DECLARE
  v_role text;
BEGIN
  SELECT p.role INTO v_role
    FROM public.app_settings s
    JOIN public.user_profiles p ON p.id = s.itau_pix_settlement_actor
   WHERE s.id = 1;
  IF v_role IS NOT NULL AND v_role <> 'financeiro' THEN
    RAISE WARNING '583: a conta da baixa automática Itaú é do setor %, não do Financeiro; a baixa automática de Taxas Locais e avulsa vai para análise até ela passar para o Financeiro.', v_role;
  END IF;
END;
$aviso$;

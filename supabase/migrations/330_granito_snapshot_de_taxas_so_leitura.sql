-- 330: os snapshots de taxas do Granito ficam só para leitura pela API
-- (revisão da PR do lote 5b da identidade visual).
--
-- Problema:
--   A `329` apagou `granite_rates` porque a tabela "continuava gravável pela
--   API", mas os snapshots que ficaram (`granite_bl_charges`, base das faturas
--   antigas de Granito por `invoice_granite_bls`) mantinham as policies
--   `granite_bl_charges_insert_active_global` e
--   `granite_bl_charges_update_active_global` (`is_active_user()`) e o grant
--   de INSERT, UPDATE e DELETE para `authenticated` (migration `002`).
--   Qualquer pessoa ativa, de qualquer setor, podia gravar ou alterar pelo
--   PostgREST o valor de uma taxa por trás de uma fatura de Granito emitida.
--   Desde a `325` nenhum caminho grava esses snapshots: o cálculo saiu
--   (`329`) e o efeito `granite_billing` termina sem agir.
--
-- Mudança:
--   - saem as policies de INSERT e UPDATE de `granite_bl_charges`;
--   - `authenticated` perde INSERT, UPDATE e DELETE na tabela; a leitura
--     (`granite_bl_charges_select_active`, `is_active_read_user()`) continua;
--   - a exclusão de B/L de Granito segue apagando os snapshots pela FK em
--     cascata, que não depende do grant de quem exclui.
--
-- Dados: nenhuma linha é reescrita ou apagada.
-- Rollback: recriar as duas policies com `is_active_user()` (texto da `002`)
-- e `GRANT INSERT, UPDATE, DELETE ON public.granite_bl_charges TO
-- authenticated`.

DROP POLICY IF EXISTS granite_bl_charges_insert_active_global ON public.granite_bl_charges;
DROP POLICY IF EXISTS granite_bl_charges_update_active_global ON public.granite_bl_charges;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.granite_bl_charges FROM authenticated;
REVOKE ALL ON TABLE public.granite_bl_charges FROM anon;

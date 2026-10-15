-- 236: só o job do BCB e o Informar PTAX gravam a referência cambial (item
-- A14 do plano de correções; ADR 0083, item 14; ADR 0065, decisão 4).
--
-- Problema: `save_exchange_rate_reference` e `save_exchange_rate_reference_v2`
-- aceitavam qualquer usuário interno ativo; o cabeçalho de toda tela gravava
-- a cotação do BCB lida no navegador (ou o cache local) e qualquer chamada
-- pela API podia gravar a referência usada na emissão de Demurrage.
--
-- Mudança: `authenticated` perde EXECUTE nas duas funções. Gravam a
-- referência só o job `recalc-demurrage-ptax` (`service_role`) e o Informar
-- PTAX (`recalculate_demurrage_invoices_manual` → `recalculate_demurrage_invoices`,
-- `SECURITY DEFINER`, que já grava a referência como dono). O navegador deixa
-- de chamar a gravação (`src/services/demurrage/demurrageRoe.ts` e
-- `demurrageKpis.ts`).
--
-- Só muda privilégios; não reescreve nem apaga linhas.
-- Rollback: GRANT EXECUTE nas duas funções a `authenticated`.

REVOKE EXECUTE ON FUNCTION public.save_exchange_rate_reference(numeric, numeric, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.save_exchange_rate_reference_v2(numeric, numeric, date, text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_exchange_rate_reference(numeric, numeric, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_exchange_rate_reference_v2(numeric, numeric, date, text, date) TO service_role;

-- 155: restaura de novo o singleton app_settings (id = 1).
-- Em 2026-10-07, ao conferir a aplicação das migrations 151–154, a linha estava
-- ausente em produção apesar da 104 (que a restaurou em 2026-09-28). Nenhuma
-- migration ou script do repositório a apaga; a remoção veio de fora dele.
-- Sem a linha, a integração Itaú (pix_provider, itau_pix_settlement_actor,
-- checkpoint de recebimentos, validade das cobranças) não pode ser configurada:
-- os UPDATE ... WHERE id = 1 não afetam nada. Mesmo padrão fail-closed da 104;
-- não sobrescreve uma linha existente.
INSERT INTO public.app_settings (
  id,
  communications_enabled,
  demurrage_dunning_interval_days
)
VALUES (1, false, 7)
ON CONFLICT (id) DO NOTHING;
